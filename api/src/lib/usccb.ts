/**
 * USCCB daily Mass readings fetcher.
 *
 * The USCCB publishes daily readings via two channels:
 *   1. A FeedBurner RSS feed at https://feeds.feedburner.com/UsccbDailyReadings
 *      — accessible to plain HTTP, no auth, contains ~10 most recent days.
 *   2. Per-day HTML pages at https://bible.usccb.org/bible/readings/MMDDYY.cfm
 *      — these are gated by a Cloudflare "Obolus" proof-of-work JS
 *      challenge, so curl/fetch gets a challenge page, not the readings.
 *
 * Strategy:
 *   - Hit the RSS feed (works, gives us the last 10 days).
 *   - Parse the date from the item's <link> URL (MMDDYY.cfm or
 *     memorial slug like 'memorial-immaculate-heart-blessed-virgin-mary').
 *   - Parse the description HTML into structured readings.
 *   - Cache in UsccbDailyReading table.
 *
 * The cache fills naturally: each day's reading is available on the
 * feed for ~10 days, so by the time it's gone, it's cached. For a
 * full 1-year offline cache, the roadmap calls for scraping the .cfm
 * pages through a headless browser (Puppeteer) or via the USCCB API
 * (which exists but requires an API key).
 */

import { prisma } from './prisma.js';

const FEED_URL = 'https://feeds.feedburner.com/UsccbDailyReadings';

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
  // Header lines look like:
  //   "Reading 1 <a href="...">1 Kings 21:1-16</a>"
  //   "Responsorial Psalm <a href="...">Psalm 5:2-3ab, 4b-6a, 6b-7</a>"
  //   "Alleluia <a href="...">Psalm 119:105</a>"
  //   "Gospel <a href="...">Matthew 5:38-42</a>"
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
      // Compute a simple source hash so we can detect USCCB site changes
      const sourceHash = Buffer.from(it.description).toString('base64').slice(0, 32);
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
 * Get the reading for a given date. Tries cache first, then refreshes
 * the feed and re-tries. Returns null if USCCB doesn't have a reading
 * we can find (e.g. a date older than the feed window).
 */
export async function getDailyReading(date: string): Promise<DailyReading | null> {
  const cached = await prisma.usccbDailyReading.findUnique({ where: { date } });
  if (cached) {
    return {
      date: cached.date,
      liturgicalInfo: cached.liturgicalInfo ?? '',
      firstReading: cached.firstReading ?? '',
      firstReadingRef: cached.firstReadingRef ?? '',
      responsorialPsalm: cached.responsorialPsalm ?? '',
      psalmRef: cached.psalmRef ?? '',
      gospelAcclamation: cached.gospelAcclamation ?? '',
      gospel: cached.gospel ?? '',
      gospelRef: cached.gospelRef ?? '',
    };
  }
  // Cache miss — refresh and re-try.
  await refreshUsccbCache();
  const refetched = await prisma.usccbDailyReading.findUnique({ where: { date } });
  if (!refetched) return null;
  return {
    date: refetched.date,
    liturgicalInfo: refetched.liturgicalInfo ?? '',
    firstReading: refetched.firstReading ?? '',
    firstReadingRef: refetched.firstReadingRef ?? '',
    responsorialPsalm: refetched.responsorialPsalm ?? '',
    psalmRef: refetched.psalmRef ?? '',
    gospelAcclamation: refetched.gospelAcclamation ?? '',
    gospel: refetched.gospel ?? '',
    gospelRef: refetched.gospelRef ?? '',
  };
}
