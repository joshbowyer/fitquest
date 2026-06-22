import { TOTP, generate as totpGen, verify as totpVerify } from '@otplib/totp';
import { NobleCryptoPlugin } from '@otplib/plugin-crypto-noble';
import { ScureBase32Plugin } from '@otplib/plugin-base32-scure';
import { randomBytes, createHash } from 'crypto';

/**
 * TOTP (RFC 6238) helpers using otplib v13. v13 changed the API
 * from a singleton `authenticator` to a class-based one that
 * requires explicit crypto + base32 plugins. We instantiate the
 * plugins once at module load (they're stateless) and reuse them.
 *
 * Defaults: SHA-1, 6 digits, 30s step, ±30s tolerance. SHA-1 is
 * what Google Authenticator / Authy ship with; the "upgrade to
 * SHA-256" RFC story is real but not worth the compatibility
 * friction for v1.
 */

const cryptoPlugin = new NobleCryptoPlugin();
const base32Plugin = new ScureBase32Plugin();

/** Default options for verify — shared by login + setup verify. */
const VERIFY_OPTS = {
  algorithm: 'sha1' as const,
  digits: 6 as const,
  period: 30,
  /// ±30s tolerance = ±1 step. Tight enough that a stolen code
  /// expires within 90s; loose enough for clock skew.
  epochTolerance: 30,
};

/**
 * Generate a fresh base32-encoded TOTP secret. 20 bytes = 160 bits
 * per RFC 4226 §4 R1. The user scans this into their authenticator
 * app via QR, then must verify a code before totpEnabled flips on.
 */
export function generateTotpSecret(): string {
  const totp = new TOTP({ crypto: cryptoPlugin, base32: base32Plugin });
  return totp.generateSecret();
}

/**
 * Generate the otpauth:// URL for the QR code. We hardcode the
 * issuer as 'FitQuest' so the user's authenticator groups all
 * codes by app. Label is `<issuer>:<username>` per RFC 6238 §5.1.
 */
export function totpUrl(username: string, secret: string): string {
  const totp = new TOTP({
    crypto: cryptoPlugin,
    base32: base32Plugin,
    secret,
    issuer: 'FitQuest',
    label: username,
  });
  return totp.toURI();
}

/**
 * Verify a 6-digit TOTP code against the secret. Returns true if
 * the code is valid within the ±30s window. Never throws.
 */
export async function verifyTotp(secret: string, code: string): Promise<boolean> {
  if (!secret || !code) return false;
  // Strip whitespace / dashes / etc. Authenticator apps sometimes
  // format codes as "123 456" for readability.
  const clean = String(code).replace(/[\s-]/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  try {
    const result = await totpVerify({
      secret,
      token: clean,
      crypto: cryptoPlugin,
      base32: base32Plugin,
      ...VERIFY_OPTS,
    });
    return result.valid;
  } catch {
    return false;
  }
}

/**
 * Generate a recovery code. 10 chars from the alphabet
 * `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (no I/O/0/1 to avoid
 * look-alikes when reading off a phone). User writes these down
 * once at setup; each one is a single-use bypass if they lose
 * their authenticator.
 */
export function generateRecoveryCodes(count = 8): string[] {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let s = '';
    const bytes = randomBytes(10);
    for (let j = 0; j < 10; j++) {
      s += alphabet[bytes[j]! % alphabet.length];
    }
    // XXXX-XXXX-XX for readability when writing them down.
    out.push(`${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 10)}`);
  }
  return out;
}

// ============================================================
// Trusted-device token helpers. The cookie holds the raw token;
// the DB stores only sha256(token) so a leak doesn't leak trust.
// ============================================================

/**
 * Generate a fresh opaque token + its sha256 hash. The token is
 * what we put in the cookie; the hash is what we store in the DB.
 * Cookie is HttpOnly + Secure (Secure flag enforced in production
 * via the cookie plugin's `secure: true` option).
 */
export function newTrustedDeviceToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  const hash = sha256(token);
  return { token, hash };
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Hash a recovery code for storage. Same one-way approach so the
 * DB doesn't leak codes if it's ever read directly. We use sha256
 * (same as trusted-device tokens) for simplicity — both are
 * high-entropy random strings so no need for bcrypt's slow hash.
 */
export function hashRecoveryCode(code: string): string {
  return sha256(code.replace(/[\s-]/g, '').toUpperCase());
}