/**
 * Tiny in-process rate limiter for the auth surface. Self-hosted
 * FitQuest is single-process so an in-memory store is fine; the
 * moment someone scales to multi-process, swap this for a Redis
 * store with the same interface.
 *
 * Two policies live here:
 *
 *   - `loginByIp`: 10 attempts / 15 min sliding window per IP.
 *     Defends against scripted password-spray from a single
 *     address. The cap is generous enough that a user typing their
 *     password 4 times in a row never trips it.
 *
 *   - `loginByUser`: 10 consecutive failures → 15 min lockout on
 *     that account. Resets on successful login. Defends against
 *     targeted brute-force on a known username.
 *
 * Both are checked together: a request gets rejected if EITHER
 * fires. The user-facing error message is generic ("too many
 * attempts") to avoid leaking which policy tripped.
 */

type Bucket = number[]; // timestamps of recent attempts

const buckets = new Map<string, Bucket>();
const lockedUntil = new Map<string, number>();

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;

/// Trim a bucket to only entries inside the active window. Called
/// before each check so old attempts don't count against the cap.
function trim(bucket: Bucket, now: number): Bucket {
  const cutoff = now - WINDOW_MS;
  return bucket.filter((t) => t > cutoff);
}

export type RateCheckResult =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

/**
 * Check both rate limits. `ip` is the request IP; `userKey` is
 * either the username being attempted or a placeholder like
 * '__no_user__' for failed lookups (so an attacker can't bypass
 * the per-user lockout by failing fast on non-existent users).
 */
export function checkLoginRate(ip: string, userKey: string): RateCheckResult {
  const now = Date.now();
  // Account lockout has priority — it's the slower policy.
  const lock = lockedUntil.get(userKey);
  if (lock && lock > now) {
    return { allowed: false, retryAfterMs: lock - now };
  } else if (lock && lock <= now) {
    lockedUntil.delete(userKey);
  }
  // IP sliding window.
  const ipKey = `ip:${ip}`;
  const ipBucket = trim(buckets.get(ipKey) ?? [], now);
  buckets.set(ipKey, ipBucket);
  if (ipBucket.length >= MAX_ATTEMPTS) {
    const oldest = ipBucket[0]!;
    return { allowed: false, retryAfterMs: oldest + WINDOW_MS - now };
  }
  return { allowed: true };
}

/**
 * Record a failed login attempt. Updates both the IP bucket and
 * (if `userKey` is a real username) the per-user lockout counter.
 */
export function recordFailedLogin(ip: string, userKey: string): void {
  const now = Date.now();
  const ipKey = `ip:${ip}`;
  const ipBucket = trim(buckets.get(ipKey) ?? [], now);
  ipBucket.push(now);
  buckets.set(ipKey, ipBucket);
  if (userKey !== '__no_user__') {
    const userBucket = trim(buckets.get(`u:${userKey}`) ?? [], now);
    userBucket.push(now);
    buckets.set(`u:${userKey}`, userBucket);
    if (userBucket.length >= MAX_ATTEMPTS) {
      lockedUntil.set(userKey, now + LOCKOUT_MS);
    }
  }
}

/**
 * Clear rate state for a user/IP. Called after a successful
 * login so a real user who mistyped 3 times doesn't carry that
 * against them forever.
 */
export function clearLoginRate(ip: string, userKey: string): void {
  buckets.delete(`ip:${ip}`);
  buckets.delete(`u:${userKey}`);
  lockedUntil.delete(userKey);
}

// =============================================================================
// Coach chat rate limits
// =============================================================================
//
// Two policies on the coach:
//   - BURST: 5 messages / 1 min sliding window per user. Anti-spam
//     against "click send repeatedly" + accidental double-clicks.
//     Generous enough that a real user having a long back-and-forth
//     with the coach (which involves multiple sends in a row) never
//     trips it.
//   - DAILY: 50 messages / 24h sliding window per user. Cost cap.
//     Self-hosted / minimax-m3 budgets are tight; 50 is enough
//     for a heavy day of Q&A, low enough that a runaway script
//     can't burn the daily token allotment.
//
// Single-process in-memory store — same caveat as the auth
// limiter: if FitQuest scales to multi-process, swap the Maps
// for a Redis store with the same interface.

const CHAT_BURST_WINDOW_MS = 60 * 1000;
const CHAT_BURST_MAX = 5;
const CHAT_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const CHAT_DAILY_MAX = 50;

/**
 * Check both chat policies against the same user. Returns the
 * tighter one (the one the caller should reject with 429).
 * Allowed = no policy fired; deny = the policy that fired plus
 * a retry hint in ms.
 */
export function checkChatRate(userId: string): RateCheckResult {
  const now = Date.now();
  const burstKey = `chat.burst:${userId}`;
  const dailyKey = `chat.daily:${userId}`;
  const burstBucket = trimTo(buckets.get(burstKey) ?? [], now, CHAT_BURST_WINDOW_MS);
  const dailyBucket = trimTo(buckets.get(dailyKey) ?? [], now, CHAT_DAILY_WINDOW_MS);
  buckets.set(burstKey, burstBucket);
  buckets.set(dailyKey, dailyBucket);
  if (burstBucket.length >= CHAT_BURST_MAX) {
    const oldest = burstBucket[0]!;
    return { allowed: false, retryAfterMs: oldest + CHAT_BURST_WINDOW_MS - now };
  }
  if (dailyBucket.length >= CHAT_DAILY_MAX) {
    const oldest = dailyBucket[0]!;
    return { allowed: false, retryAfterMs: oldest + CHAT_DAILY_WINDOW_MS - now };
  }
  return { allowed: true };
}

/**
 * Record a successful chat send (so the bucket counts it toward
 * the policy limits). Idempotent re. the burst — if the user
 * retries a network failure the call has already counted.
 */
export function recordChatSend(userId: string): void {
  const now = Date.now();
  const burstBucket = trimTo(buckets.get(`chat.burst:${userId}`) ?? [], now, CHAT_BURST_WINDOW_MS);
  const dailyBucket = trimTo(buckets.get(`chat.daily:${userId}`) ?? [], now, CHAT_DAILY_WINDOW_MS);
  burstBucket.push(now);
  dailyBucket.push(now);
  buckets.set(`chat.burst:${userId}`, burstBucket);
  buckets.set(`chat.daily:${userId}`, dailyBucket);
}

/// Trim helper with explicit window (vs. the auth one which uses a
/// file-scoped WINDOW_MS constant). Avoids leaking the auth
/// policy's 15-min window into the chat policy.
function trimTo(bucket: Bucket, now: number, windowMs: number): Bucket {
  const cutoff = now - windowMs;
  return bucket.filter((t) => t > cutoff);
}