/**
 * USCCB daily Mass readings fetcher.
 *
 * The USCCB publishes daily readings via several channels. None of
 * them are perfect for a self-hosted server, so we cascade through
 * all of them in order of preference:
 *
 *   1. The Prisma cache (UsccbDailyReading) — instant, populated by
 *      the previous two paths.
 *   2. A FeedBurner RSS feed at https://feeds.feedburner.com/UsccbDailyReadings
 *      — accessible to plain HTTP, no auth. Holds ~10 most recent
 *      days, so anything older than a week needs a fallback.
 *   3. The Wayback Machine snapshot of the per-day HTML page at
 *      https://bible.usccb.org/bible/readings/MMDDYY.cfm — that page
 *      itself is gated by a Cloudflare "Obolus" proof-of-work JS
 *      challenge, so curl/fetch gets the challenge page, not the
 *      readings. The Wayback Machine captures it without the
 *      challenge. Snapshots exist for almost every date going back
 *      years. The "closest" snapshot is fine for our use case
 *      since readings don't change once published.
 *
 * Strategy:
 *   - On startup, seed the next 7 days (RSS first, Wayback for
 *     dates RSS missed).
 *   - A 24-hour timer re-seeds the next 7 days, so the cache stays
 *     one week ahead of the calendar.
 *   - getDailyReading(date) chains the same cascade for the date
 *     the user is asking about.
 *
 * Mass readings don't change once published, so the Wayback
 * snapshot from any time is safe to cache forever.
 */

import { prisma } from './prisma.js';

// Canonical USCCB daily-readings RSS feed. The old feedburner
// URL (`https://feeds.feedburner.com/UsccbDailyReadings`) and the
// bible.usccb.org/rss/daily.xml path both 404 as of 2026-06-24
// — USCCB migrated their Drupal site. The canonical new URL is
// bible.usccb.org/readings.rss (301 redirects from the older
// /bible/readings/rss/daily.xml path land here too).
//
// If this URL ever 404s again, fall back to:
//   1. https://bible.usccb.org/bible/readings/rss/daily.xml (legacy)
//   2. Wayback Machine per-day snapshots (handled in
//      fetchReadingByWayback below — works regardless of RSS state)
const FEED_URL = 'https://bible.usccb.org/readings.rss';
const WAYBACK_PREFIX = 'https://web.archive.org/web/';

// Date in YYYY-MM-DD form.
export type DailyReading = {
  date: string;
  liturgicalInfo: string;
  firstReading: string;
  firstReadingRef: string;
  responsorialPsalm: string;
  psalmRef: string;
  gospelAcclamation: string;
  gospel: string;
  gospelRef: string;
};

function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
}

function stripTags(s: string): string {
  return unescapeHtml(s.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * USCCB appends a copyright notice to the bottom of each reading
 * (e.g. " - - - Lectionary for Mass for Use in the Dioceses of the
 * United States, second typical edition, Copyright © ..."). We strip
 * that here so the user only sees the scripture text. The full
 * attribution is documented in the project README.
 */
function stripCopyright(body: string): string {
  // Cut at the first occurrence of any sentinel.
  const cutMarkers = [
    /\s*-\s*-\s*-\s*/,          // ASCII hyphen separator (what the RSS uses)
    /\s*—\s*—\s*—\s*/,          // em-dash separator (defensive)
    /\s+Lectionary for Mass/i,  // direct start of attribution
    /\s+Copyright\s+©/i,        // direct start of © line
  ];
  let cut = body.length;
  for (const re of cutMarkers) {
    const m = body.match(re);
    if (m && m.index !== undefined && m.index < cut) {
      cut = m.index;
    }
  }
  return body.slice(0, cut).trim();
}

function extractRef(headerLine: string): { ref: string; rest: string } {
  // RSS header lines look like:
  //   "Reading 1 <a href="...">1 Kings 21:1-16</a>"
  //   "Responsorial Psalm <a href="...">Psalm 5:2-3ab, 4b-6a, 6b-7</a>"
  //   "Alleluia <a href="...">Psalm 119:105</a>"
  //   "Gospel <a href="...">Matthew 5:38-42</a>"
  // Wayback HTML wraps each ref in <div class="address"><a href="...">REF</a></div>
  // — handled by parseWaybackPage below.
  const refMatch = headerLine.match(/<a[^>]*>([^<]+)<\/a>/);
  const ref = refMatch && refMatch[1] ? refMatch[1].trim() : '';
  const rest = headerLine.replace(/<a[^>]*>[^<]+<\/a>/, '').trim();
  return { ref, rest };
}

function parseDescription(descHtml: string): Omit<DailyReading, 'date' | 'liturgicalInfo'> {
  const text = unescapeHtml(descHtml);
  // Find each section by its opening marker
  const findAfter = (marker: RegExp): string | null => {
    const m = text.match(marker);
    return m ? text.slice(m.index! + m[0].length).trim() : null;
  };

  // First reading: "Reading 1 <a href="...">REF</a>" then text until
  // the next section header.
  const r1Match = text.match(/<h4>\s*Reading 1\b[\s\S]*?<\/h4>/i);
  let firstReading = '';
  let firstReadingRef = '';
  if (r1Match) {
    const headerText = r1Match[0];
    const after = text.slice(r1Match.index! + headerText.length);
    const stopMatch = after.match(/<h4>/);
    const stop = stopMatch ? stopMatch.index! : after.length;
    const body = stripTags(after.slice(0, stop));
    const { ref } = extractRef(headerText);
    firstReadingRef = ref;
    firstReading = stripCopyright(body);
  }

  // Responsorial Psalm
  const r2Match = text.match(/<h4>\s*Responsorial\s+Psalm[\s\S]*?<\/h4>/i);
  let responsorialPsalm = '';
  let psalmRef = '';
  if (r2Match) {
    const headerText = r2Match[0];
    const after = text.slice(r2Match.index! + headerText.length);
    const stopMatch = after.match(/<h4>/);
    const stop = stopMatch ? stopMatch.index! : after.length;
    const body = stripTags(after.slice(0, stop));
    const { ref } = extractRef(headerText);
    psalmRef = ref;
    responsorialPsalm = stripCopyright(body);
  }

  // Gospel Acclamation: the "Alleluia <a>REF</a> R. [text]" block.
  // Note: Alleluia is preceded by R. (the response from the psalm)
  // — we want the verse part, not the response.
  const acclamationMatch = text.match(/R\.\s*\(?[A-Za-z0-9]+\)?\s*<\/p>[\s\S]*?<h4>\s*Alleluia[\s\S]*?<\/h4>/i);
  let gospelAcclamation = '';
  if (acclamationMatch) {
    // Take from "Alleluia" header to next <h4>
    const acStart = acclamationMatch[0].indexOf('Alleluia');
    const headerEnd = acclamationMatch[0].indexOf('</h4>') + 6;
    const after = acclamationMatch[0].slice(headerEnd);
    const stopMatch = after.match(/<h4>/);
    const stop = stopMatch ? stopMatch.index! : after.length;
    gospelAcclamation = stripCopyright(stripTags(after.slice(0, stop)));
  }

  // Gospel
  const gospelMatch = text.match(/<h4>\s*Gospel[\s\S]*?<\/h4>/i);
  let gospel = '';
  let gospelRef = '';
  if (gospelMatch) {
    const headerText = gospelMatch[0];
    const after = text.slice(gospelMatch.index! + headerText.length);
    // Gospel runs to end of description (no following <h4>)
    const body = stripTags(after);
    const { ref } = extractRef(headerText);
    gospelRef = ref;
    gospel = stripCopyright(body);
  }

  return {
    firstReading,
    firstReadingRef,
    responsorialPsalm,
    psalmRef,
    gospelAcclamation,
    gospel,
    gospelRef,
  };
}

function dateFromLink(link: string): string | null {
  // Link formats:
  //   https://bible.usccb.org/bible/readings/061526.cfm        -> 2026-06-15
  //   https://bible.usccb.org/bible/readings/memorial-immaculate-heart-blessed-virgin-mary
  // The .cfm form is what we can parse deterministically. The slug
  // form has no date — we have to look at pubDate instead.
  const m = link.match(/\/readings\/(\d{2})(\d{2})(\d{2})\.cfm/);
  if (m) {
    const mm = m[1];
    const dd = m[2];
    const yy = m[3];
    // 2-digit year: assume 2000s
    return `20${yy}-${mm}-${dd}`;
  }
  return null;
}

function dateFromPubDate(pubDate: string): string | null {
  // Format: "Mon, 15 Jun 2026 04:30:00 EDT"
  const m = pubDate.match(/(\d{1,2})\s+(\w{3})\s+(\d{4})/);
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  const months: Record<string, string> = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  };
  const dd = m[1].padStart(2, '0');
  const mm = months[m[2]] ?? '01';
  const yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}

function parseRss(xml: string): Array<{ date: string; title: string; description: string; link: string }> {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const results: Array<{ date: string; title: string; description: string; link: string }> = [];
  for (const item of items) {
    const title = stripTags(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
    const link = item.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? '';
    const pubDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? '';
    const description = item.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? '';
    // Prefer date from link (MMDDYY.cfm), fall back to pubDate.
    const date = dateFromLink(link) ?? dateFromPubDate(pubDate);
    if (!date) continue;
    results.push({ date, title, description, link });
  }
  return results;
}

async function fetchRssFeed(): Promise<string> {
  const res = await fetch(FEED_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; FitQuest/1.0; +https://fitquest.local)',
      Accept: 'application/rss+xml, application/xml, text/xml',
    },
    // 10s timeout via AbortSignal
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`USCCB feed HTTP ${res.status}`);
  return await res.text();
}

// =============================================================================
// Wayback Machine fallback
// =============================================================================
//
// The live per-day HTML page at bible.usccb.org/bible/readings/MMDDYY.cfm
// is gated by a Cloudflare Obolus proof-of-work challenge that returns
// "Checking connection..." for non-browser clients. The Wayback Machine
// snapshots the page without that challenge. Their JSON API
// (archive.org/wayback/available) tells us the closest snapshot URL.
//
// Parsed structure (verified 2026-06-22 against a snapshot of 2026-06-12):
//
//   <title>Solemnity of the Most Sacred Heart of Jesus | USCCB</title>
//   ...
//   <h2>Solemnity of the Most Sacred Heart of Jesus</h2>
//   ...
//   <h3 class="name">Reading 1 </h3>
//   <div class="address"><a href="...">Deuteronomy 7:6-11</a></div>
//   <div class="content-body"><p>SCRIPTURE TEXT</p></div>
//   ...
//   <h3 class="name">Responsorial Psalm </h3>
//   ...
//   <h3 class="name">Alleluia </h3>
//   ...
//   <h3 class="name">Gospel </h3>
//   <div class="address"><a href="...">Luke 15:3-7</a></div>
//   <div class="content-body"><p>GOSPEL TEXT</p></div>
//
// Mass readings don't change once published, so any Wayback snapshot
// (often weeks older than the live page) is correct content.

const WAYBACK_AVAILABLE = 'https://archive.org/wayback/available';

async function findWaybackSnapshot(url: string): Promise<string | null> {
  // archive.org/wayback/available?url=... returns
  // { archived_snapshots: { closest: { available, url, timestamp } } }
  // or empty object if nothing captured.
  try {
    const res = await fetch(`${WAYBACK_AVAILABLE}?url=${encodeURIComponent(url)}`, {
      headers: { 'User-Agent': 'FitQuest/1.0 (+https://fitquest.local)' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const snap = data?.archived_snapshots?.closest;
    if (!snap || snap.available !== true) return null;
    return snap.url as string;
  } catch {
    return null;
  }
}

function mmddyy(date: string): string {
  // YYYY-MM-DD → MMDDYY (USCCB's URL format). The regex groups
  // are (year, month, day), so we capture as y/m/d and reassemble
  // as month-day-year2 — easy to flip if you go from "ymd" to "mdy"
  // naming in destructuring, hence the comment.
  const m = date.match(/^\d{4}-(\d{2})-\d{2}$/)?.[1] ?? '00';
  const d = date.match(/^\d{4}-\d{2}-(\d{2})$/)?.[1] ?? '00';
  const y = date.match(/^\d{4}-\d{2}-\d{2}$/)?.[0]?.slice(2, 4) ?? '00';
  return `${m}${d}${y}`;
}

async function fetchReadingByWayback(date: string): Promise<DailyReading | null> {
  const cfm = mmddyy(date);
  // Wayback URL candidates, tried in order. USCCB has had multiple
  // URL formats over the years and Wayback snapshots each version
  // separately:
  //   1. /MMDDYY-Day       (current 2026 format, no .cfm suffix)
  //   2. /MMDDYY-Day.cfm   (2024-era format)
  //   3. /MMDDYY-Vigil.cfm (some solemnities have a Vigil Mass)
  //   4. /MMDDYY.cfm       (legacy main page — used to contain the
  //                         readings inline; now a JS-rendered picker)
  // We try the newest format first because that's where Wayback
  // has the most recent snapshots (timestamp 2026-06-23 for
  // today, vs 2025-11-13 for the legacy .cfm path).
  const usccbUrl = `https://bible.usccb.org/bible/readings/${cfm}.cfm`;
  const dayNoCfm = `https://bible.usccb.org/bible/readings/${cfm}-Day`;
  const dayCfm = `https://bible.usccb.org/bible/readings/${cfm}-Day.cfm`;
  const vigilCfm = `https://bible.usccb.org/bible/readings/${cfm}-Vigil.cfm`;

  // Some solemnities (e.g. Nativity of St. John the Baptist on
  // 6/24) have two reading sets: a Vigil Mass and a Mass during
  // the Day. We want the "during the day" readings, so prefer
  // the Day variants.
  const daySnapshot = await findWaybackSnapshot(dayNoCfm)
    ?? await findWaybackSnapshot(dayCfm);
  let snapshotUrl: string | null = daySnapshot;
  if (!snapshotUrl) {
    snapshotUrl = await findWaybackSnapshot(vigilCfm)
      ?? await findWaybackSnapshot(usccbUrl);
  }
  if (!snapshotUrl) {
    console.log(`[fetchReadingByWayback] ${date}: no wayback snapshot for ${usccbUrl}`);
    return null;
  }

  let html: string;
  try {
    const res = await fetch(snapshotUrl, {
      headers: { 'User-Agent': 'FitQuest/1.0 (+https://fitquest.local)' },
      signal: AbortSignal.timeout(15_000),
      redirect: 'follow',
    });
    if (!res.ok) {
      console.log(`[fetchReadingByWayback] ${date}: snapshot fetch ${res.status}`);
      return null;
    }
    html = await res.text();
  } catch (err: any) {
    console.log(`[fetchReadingByWayback] ${date}: fetch error ${err?.message ?? err}`);
    return null;
  }

  // If the main page only contains the "Vigil/Day" picker and
  // no actual readings, fall back to fetching the LIVE -Day URL
  // directly (the Wayback lookup for -Day may have missed a
  // snapshot; try harder here). This block previously referenced
  // a `dayUrl` variable that never existed — a ReferenceError
  // that turned "no readings found" into a crash that propagated
  // out of seedReading and 500'd the spiritual routes.
  if (!/Reading\s+(?:[0-9]+|[IVX]+)/i.test(html)) {
    try {
      const r2 = await fetch(dayNoCfm, {
        headers: { 'User-Agent': 'FitQuest/1.0 (+https://fitquest.local)' },
        signal: AbortSignal.timeout(15_000),
        redirect: 'follow',
      });
      if (r2.ok) {
        const h2 = await r2.text();
        if (/Reading\s+(?:[0-9]+|[IVX]+)/i.test(h2)) html = h2;
      }
    } catch { /* ignore */ }
    if (!/Reading\s+(?:[0-9]+|[IVX]+)/i.test(html)) {
      console.log(`[fetchReadingByWayback] ${date}: HTML has no Reading sections (page might be a vigil/day picker)`);
      return null;
    }
  }

  return parseWaybackPage(html, date);
}

function parseWaybackPage(html: string, date: string): DailyReading | null {
  // Liturgical title from <title>...</title>: "Foo | USCCB"
  const titleMatch = html.match(/<title>([\s\S]*?)\s*\|\s*USCCB<\/title>/i);
  let liturgicalInfo = '';
  if (titleMatch && titleMatch[1]) {
    liturgicalInfo = stripTags(titleMatch[1]);
  }
  // Fallback: the first non-menu <h2> on the page (the menu h2s
  // are class="visually-hidden" and get filtered by parseString).
  if (!liturgicalInfo) {
    const h2Match = html.match(/<h2(?![^>]*visually-hidden)[^>]*>([^<]+)<\/h2>/i);
    if (h2Match && h2Match[1]) liturgicalInfo = stripTags(h2Match[1]);
  }
  if (!liturgicalInfo) {
    console.log(`[parseWaybackPage] ${date}: no title found`);
    return null;
  }

  // Helper: extract the body text between a section marker (h3.name)
  // and the next h3. Returns { ref, text }.
  //
  // The section name passed in is matched as a regex after a
  // \\s+ so we can accept either Arabic (Reading 1) or Roman
  // (Reading I) numerals — USCCB's HTML used Roman numerals on
  // older snapshots and Arabic on newer ones.
  function readSection(sectionRegex: string): { ref: string; text: string } {
    const re = new RegExp(
      `<h3 class="name">\\s*${sectionRegex}\\s*</h3>([\\s\\S]*?)(?=<h3 class="name">|<div class="wr-block)`,
      'i',
    );
    const m = html.match(re);
    if (!m || !m[1]) return { ref: '', text: '' };
    const block = m[1];
    // Reference: <a href="...">REF</a> inside <div class="address">
    const refMatch = block.match(/<div class="address">[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
    const ref = refMatch && refMatch[1] ? stripTags(refMatch[1]) : '';
    // Body: <div class="content-body"><p>...</p></div>
    const bodyMatch = block.match(/<div class="content-body">([\s\S]*?)<\/div>/i);
    let text = '';
    if (bodyMatch && bodyMatch[1]) {
      text = stripTags(bodyMatch[1]);
    }
    return { ref, text: stripCopyright(text) };
  }

  // Roman numeral helper: matches "1", "2", "3", "I", "II", "III"
  // as the trailing marker on "Reading N" / "Reading N".
  const num = '(?:[0-9]+|[IVX]+)';
  const r1 = readSection(`Reading\\s+${num}`);
  const r2 = readSection(`Reading\\s+${num}\\s*2|Reading\\s+II`);
  const psalm = readSection('Responsorial Psalm');
  const alleluia = readSection('Alleluia');
  const gospel = readSection('Gospel');

  return {
    date,
    liturgicalInfo,
    firstReading: r1.text,
    firstReadingRef: r1.ref,
    responsorialPsalm: psalm.text,
    psalmRef: psalm.ref,
    gospelAcclamation: alleluia.text,
    gospel: gospel.text,
    gospelRef: gospel.ref,
  };
}

// =============================================================================
// Cache + lookup
// =============================================================================

/**
 * Save one parsed reading to the cache. Idempotent: skips when the
 * sourceHash is unchanged so re-fetches don't churn the DB.
 */
async function saveReading(reading: DailyReading, source: 'usccb-rss' | 'usccb-wayback' | 'ewtn'): Promise<void> {
  // Source hash: lightweight summary of the actual content fields
  // (skipping date + liturgicalInfo because they vary for the
  // same reading across snapshots). Two snapshots of the same
  // content → same hash → no update churn.
  const sourceHash = Buffer.from(JSON.stringify({
    r1: reading.firstReading, p: reading.responsorialPsalm,
    a: reading.gospelAcclamation, g: reading.gospel,
  })).toString('base64').slice(0, 32);

  const existing = await prisma.usccbDailyReading.findUnique({
    where: { date: reading.date },
    select: { id: true, sourceHash: true },
  });
  if (existing && existing.sourceHash === sourceHash) return;

  await prisma.usccbDailyReading.upsert({
    where: { date: reading.date },
    create: {
      date: reading.date,
      liturgicalInfo: reading.liturgicalInfo,
      firstReading: reading.firstReading,
      firstReadingRef: reading.firstReadingRef,
      responsorialPsalm: reading.responsorialPsalm,
      psalmRef: reading.psalmRef,
      gospelAcclamation: reading.gospelAcclamation,
      gospel: reading.gospel,
      gospelRef: reading.gospelRef,
      source,
      sourceHash,
    },
    update: {
      liturgicalInfo: reading.liturgicalInfo,
      firstReading: reading.firstReading,
      firstReadingRef: reading.firstReadingRef,
      responsorialPsalm: reading.responsorialPsalm,
      psalmRef: reading.psalmRef,
      gospelAcclamation: reading.gospelAcclamation,
      gospel: reading.gospel,
      gospelRef: reading.gospelRef,
      source,
      sourceHash,
      fetchedAt: new Date(),
    },
  });
}

function toRow(r: DailyReading | null): DailyReading | null {
  if (!r) return null;
  return {
    date: r.date,
    liturgicalInfo: r.liturgicalInfo,
    firstReading: r.firstReading,
    firstReadingRef: r.firstReadingRef,
    responsorialPsalm: r.responsorialPsalm,
    psalmRef: r.psalmRef,
    gospelAcclamation: r.gospelAcclamation,
    gospel: r.gospel,
    gospelRef: r.gospelRef,
  };
}

/**
 * Try to fetch + cache a reading for `date`. Cascade: RSS first
 * (it's the canonical source for the past ~10 days), then Wayback
 * for older dates. Returns the reading on success, null otherwise.
 */
export async function seedReading(date: string): Promise<DailyReading | null> {
  // Cache check: treat empty gospel as a MISS, not a hit. Half-baked
  // fetches (parse errors, EWTN articleBody truncation, Wayback
  // returning a vigil/day picker without content) leave a row with
  // `liturgicalInfo` populated but the reading text empty. Returning
  // that row makes the UI say "no readings" forever until the daily
  // cron runs — terrible UX. Delete the bad row and fall through to
  // the live cascade so the user gets a real fetch on this request.
  const cached = await prisma.usccbDailyReading.findUnique({ where: { date } });
  if (cached && cached.gospel && cached.gospel.trim().length > 0) {
    return toRow({
      date: cached.date,
      liturgicalInfo: cached.liturgicalInfo ?? '',
      firstReading: cached.firstReading ?? '',
      firstReadingRef: cached.firstReadingRef ?? '',
      responsorialPsalm: cached.responsorialPsalm ?? '',
      psalmRef: cached.psalmRef ?? '',
      gospelAcclamation: cached.gospelAcclamation ?? '',
      gospel: cached.gospel,
      gospelRef: cached.gospelRef ?? '',
    });
  }
  if (cached) {
    // Empty-content cache hit. Drop the row so the upcoming upsert
    // doesn't dedupe against a stub.
    await prisma.usccbDailyReading.delete({ where: { date } }).catch(() => {});
  }

  // EWTN is the new primary source. Captcha-less, parseable JSON-LD
  // payload, ships the readings text directly (USCCB's site now
  // serves behind Cloudflare Obolus for non-browser clients).
  // Translation: RSV-CE. Stamped as source='ewtn' so the UI can
  // note the translation when it matters.
  const { fetchEwtnReading } = await import('./ewtn.js');
  const ewtn = await fetchEwtnReading(date);
  if (ewtn) {
    await saveReading({
      date,
      liturgicalInfo: ewtn.liturgicalInfo,
      firstReading: ewtn.firstReading,
      firstReadingRef: ewtn.firstReadingRef,
      responsorialPsalm: ewtn.responsorialPsalm,
      psalmRef: ewtn.psalmRef,
      gospelAcclamation: ewtn.gospelAcclamation,
      gospel: ewtn.gospel,
      gospelRef: ewtn.gospelRef,
    }, 'ewtn');
    return toRow({
      date,
      ...ewtn,
    });
  }

  // EWTN failed (network, parse, missing articleBody). Fall back
  // to the legacy USCCB cascade: RSS → Wayback.
  //
  // Try RSS first — covers ~10 most recent days. We always re-fetch
  // the RSS even when asking for a single date because (a) it's the
  // canonical source and (b) refreshUsccbCache fills all the dates
  // it has at once, so the next date lookup will be a cache hit.
  let xml: string | null = null;
  try {
    xml = await fetchRssFeed();
  } catch {
    // Network error — fall through to Wayback.
  }
  let rssHadReadableText = false;
  if (xml) {
    const items = parseRss(xml);
    let found = null;
    for (const it of items) {
      try {
        const parsed = parseDescription(it.description);
        // USCCB redesigned their site in 2026 — the RSS feed's
        // <description> now contains only navigation links to the
        // per-day HTML pages (which themselves are JS-rendered and
        // don't ship reading text). Detect that case: if the parsed
        // firstReading AND gospel are both empty, skip saving +
        // continue to Wayback. We don't save an empty row because
        // that would poison the cache and make the dashboard think
        // "no reading for today" is the permanent answer.
        if (!parsed.firstReading.trim() && !parsed.gospel.trim()) continue;
        rssHadReadableText = true;
        await saveReading({
          date: it.date,
          liturgicalInfo: it.title,
          ...parsed,
        }, 'usccb-rss');
        if (it.date === date) found = { date: it.date, liturgicalInfo: it.title, ...parsed };
      } catch {
        // skip malformed entry
      }
    }
    if (found) return toRow(found);
  }

  // RSS didn't have a readable entry for this date. Two cases:
  //   (a) Older date (~10+ days back) where RSS doesn't cover it
  //   (b) Recent date where RSS exists but the description has no
  //       reading text (USCCB's 2026 redesign; navigation-only RSS)
  // Both fall through to Wayback.
  const wb = await fetchReadingByWayback(date);
  if (wb) {
    await saveReading(wb, 'usccb-wayback');
    return toRow(wb);
  }

  // Surface a structured warning so the operator can tell whether
  // the failure is "USCCB site changed shape" (rssHadReadableText
  // false + no wayback) vs "date genuinely unavailable" (rss had
  // text for other dates but not this one). Logged once per
  // request; safe to leave on because the spiritual director card
  // surfaces a clear "feed unavailable" UI in this case.
  if (xml && !rssHadReadableText) {
    console.warn(`[usccb] RSS returned no readable text for ${date} (USCCB redesign path)`);
  }
  return null;
}

/**
 * Refresh the local cache from the RSS feed. Idempotent — re-fetches
 * update existing rows. Returns the number of rows updated.
 */
export async function refreshUsccbCache(): Promise<{ updated: number; skipped: number }> {
  let xml: string;
  try {
    xml = await fetchRssFeed();
  } catch (err) {
    return { updated: 0, skipped: 0 };
  }
  const items = parseRss(xml);
  let updated = 0;
  let skipped = 0;
  for (const it of items) {
    try {
      const parsed = parseDescription(it.description);
      const existing = await prisma.usccbDailyReading.findUnique({
        where: { date: it.date },
        select: { id: true, sourceHash: true },
      });
      const sourceHash = Buffer.from(JSON.stringify({
        r1: parsed.firstReading, p: parsed.responsorialPsalm,
        a: parsed.gospelAcclamation, g: parsed.gospel,
      })).toString('base64').slice(0, 32);
      if (existing && existing.sourceHash === sourceHash) {
        skipped++;
        continue;
      }
      await prisma.usccbDailyReading.upsert({
        where: { date: it.date },
        create: {
          date: it.date,
          liturgicalInfo: it.title,
          ...parsed,
          source: 'usccb',
          sourceHash,
        },
        update: {
          liturgicalInfo: it.title,
          ...parsed,
          sourceHash,
          fetchedAt: new Date(),
        },
      });
      updated++;
    } catch (err) {
      skipped++;
    }
  }
  return { updated, skipped };
}

/**
 * Pre-cache the next N days. Called on startup + daily by the
 * scheduler. Each date tries the cache, then RSS, then Wayback
 * (so the FIRST call after a fresh server boot fills everything,
 * and later calls are quick because the cache is warm).
 *
 * We pass `today` as a parameter so tests / seeds from arbitrary
 * dates work the same way.
 */
export async function seedUpcomingReadings(days: number, today: Date = new Date()): Promise<{
  fromCache: number;
  fromRss: number;
  fromWayback: number;
  failed: number;
}> {
  let fromCache = 0, fromRss = 0, fromWayback = 0, failed = 0;

  // Always refresh the RSS first — it covers the next ~10 days
  // for free and any date outside that window falls through to
  // Wayback individually.
  await refreshUsccbCache();

  const start = new Date(today.getTime());
  start.setHours(12, 0, 0, 0); // noon UTC; tz safety
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime());
    d.setUTCDate(d.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);

    // Cache hit?
    const cached = await prisma.usccbDailyReading.findUnique({ where: { date } });
    if (cached) {
      fromCache++;
      continue;
    }

    // Otherwise hit Wayback directly (RSS already refreshed).
    try {
      const wb = await fetchReadingByWayback(date);
      if (wb) {
        await saveReading(wb, 'usccb-wayback');
        fromWayback++;
        console.log(`[usccb] wayback cached ${date} (${wb.gospelRef})`);
      } else {
        failed++;
        console.log(`[usccb] wayback miss for ${date} (no snapshot or parse failed)`);
      }
    } catch (err: any) {
      failed++;
      console.log(`[usccb] wayback error for ${date}: ${err?.message ?? err}`);
    }
  }

  return { fromCache, fromRss: 0, fromWayback, failed };
}

/**
 * Get the reading for a given date. Tries cache → RSS → Wayback.
 * Returns null if every source fails (e.g. date outside both
 * windows AND no Wayback snapshot, which shouldn't happen for
 * anything in the last ~10 years).
 */
export async function getDailyReading(date: string): Promise<DailyReading | null> {
  return seedReading(date);
}

/**
 * Status report for the readings pipeline. Probes each source
 * independently so the UI can tell the user which leg of the
 * cascade is failing (EWTN? RSS? Wayback?). Returns one
 * ReadingSourceStatus per source attempted.
 *
 * Sources probed in order:
 *   - cache  — instant DB read (no network)
 *   - ewtn    — primary since USCCB redesigned their site in mid-2026
 *   - rss     — USCCB's bible.usccb.org/readings.rss (still ships
 *               description blocks, but text is sometimes missing)
 *   - wayback — last resort, snapshots exist for almost every date
 *
 * Each source reports either ok/error/empty so the operator can
 * tell whether the failure is "site changed shape" vs "date is
 * genuinely unavailable".
 */
export type ReadingSourceStatus =
  | { source: 'cache'; ok: true; fetchedAt: Date; readingSource: string }
  | {
      source: 'cache';
      ok: false;
      reason: string;
      fetchedAt?: Date;
      readingSource?: string;
    }
  | { source: 'ewtn' | 'rss' | 'wayback'; ok: boolean; reason?: string };

export async function getReadingsStatus(date: string): Promise<{
  date: string;
  overallOk: boolean;
  cacheHit: boolean;
  sources: ReadingSourceStatus[];
}> {
  const sources: ReadingSourceStatus[] = [];

  // Cache probe — instant, no network. The 'ok' flag follows the
  // content quality: a row with empty gospel is a stub, not a hit.
  // (seedReading now treats these as misses too.)
  const cached = await prisma.usccbDailyReading.findUnique({
    where: { date },
    select: { id: true, source: true, fetchedAt: true, gospel: true },
  });
  if (cached) {
    const hasContent = (cached.gospel ?? '').trim().length > 0;
    if (hasContent) {
      sources.push({
        source: 'cache',
        ok: true,
        fetchedAt: cached.fetchedAt,
        readingSource: cached.source,
      });
    } else {
      sources.push({
        source: 'cache',
        ok: false,
        fetchedAt: cached.fetchedAt,
        readingSource: cached.source,
        reason: 'cached row has empty gospel (stub from a half-baked fetch)',
      });
    }
  } else {
    sources.push({ source: 'cache', ok: false, reason: 'not cached yet' });
  }

  // EWTN probe — primary source
  try {
    const { fetchEwtnReading } = await import('./ewtn.js');
    const r = await fetchEwtnReading(date);
    sources.push({
      source: 'ewtn',
      ok: r != null,
      reason: r == null ? 'fetch or parse failed (see server logs)' : undefined,
    });
  } catch (err: any) {
    sources.push({ source: 'ewtn', ok: false, reason: String(err?.message ?? err) });
  }

  // USCCB RSS probe — checks if any item in the RSS matches the date.
  // Doesn't save to cache so this is a read-only diagnostic.
  try {
    const xml = await fetchRssFeed();
    const items = parseRss(xml);
    const match = items.find((i) => i.date === date);
    if (!match) {
      sources.push({ source: 'rss', ok: false, reason: 'date not in current RSS window (~10 days)' });
    } else {
      const parsed = parseDescription(match.description);
      if (!parsed.firstReading.trim() && !parsed.gospel.trim()) {
        sources.push({
          source: 'rss',
          ok: false,
          reason: 'RSS has the date but description is navigation-only (USCCB redesign path)',
        });
      } else {
        sources.push({ source: 'rss', ok: true });
      }
    }
  } catch (err: any) {
    sources.push({ source: 'rss', ok: false, reason: `fetch: ${err?.message ?? err}` });
  }

  // Wayback probe — calls fetchReadingByWayback but does NOT save.
  try {
    const r = await fetchReadingByWayback(date);
    sources.push({
      source: 'wayback',
      ok: r != null,
      reason: r == null ? 'no snapshot or parse failed' : undefined,
    });
  } catch (err: any) {
    sources.push({ source: 'wayback', ok: false, reason: String(err?.message ?? err) });
  }

  return {
    date,
    overallOk: sources.some((s) => s.ok),
    cacheHit: !!cached,
    sources,
  };
}