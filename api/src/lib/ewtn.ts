/**
 * EWTN daily-readings fetcher. Captcha-less, parseable JSON-LD
 * `articleBody` payload, no JS execution required. Used as the
 * PRIMARY source for /spiritual/director since USCCB redesigned
 * their site in mid-2026 and now serves behind a Cloudflare
 * Obolus challenge for non-browser clients.
 *
 * Translation: RSV-CE (Revised Standard Version, Catholic Edition).
 * USCCB uses NABRE (New American Bible Revised Edition). The two
 * translations agree on ~95% of verse text; the differences are
 * limited to specific phrasings. For a personal spiritual reflection
 * the difference is negligible — we surface "RSV-CE" in the UI so
 * the user knows the translation.
 *
 * Source URL pattern:
 *   https://www.ewtn.com/daily-readings/YYYY-MM-DD
 *
 * The page is Next.js. The readings text lives in the JSON-LD
 * schema's `articleBody` field — a plain-text dump with one
 * section per block (First Reading / Responsorial Psalm / Second
 * Reading / Gospel), each formatted as:
 *
 *   SectionHeader
 *   <blank>
 *   Citation
 *   1
 *   verse 1 text
 *   2
 *   verse 2 text
 *   ...
 *   <blank>
 *   NextSectionHeader
 *
 * On days without a Second Reading (most weekdays), the parser
 * just skips it. For Sundays + Solemnities that have one, we
 * concatenate it onto firstReading with a clear separator so the
 * LLM still has the full text to work with.
 */

const EWTN_URL = (date: string) =>
  `https://www.ewtn.com/daily-readings/${date}`;

type ParsedSections = {
  liturgicalInfo: string;
  firstReading: string;
  firstReadingRef: string;
  responsorialPsalm: string;
  psalmRef: string;
  gospelAcclamation: string;
  gospel: string;
  gospelRef: string;
};

/**
 * Fetch + parse the EWTN daily readings page. Returns null on any
 * failure (network, parse, missing articleBody) — callers fall
 * through to USCCB / Wayback.
 */
export async function fetchEwtnReading(date: string): Promise<ParsedSections | null> {
  let html: string;
  try {
    const res = await fetch(EWTN_URL(date), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FitQuest/1.0; +https://fitquest.local)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  // Locate the JSON-LD <script type="application/ld+json"> block.
  // The readings text is in the `articleBody` field.
  const ldMatch = html.match(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!ldMatch) return null;

  // Group 1 always exists on a successful match; the guard is for
  // noUncheckedIndexedAccess.
  const ldJson = ldMatch[1];
  if (ldJson == null) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(ldJson);
  } catch {
    return null;
  }
  const body = parsed?.articleBody;
  if (typeof body !== 'string' || body.trim().length < 50) return null;

  // The JSON-LD articleBody doesn't include the liturgical title
  // (e.g. "The Nativity of St. John the Baptist"). That title
  // lives in a styled div on the page — pull it out so we can
  // populate liturgicalInfo alongside the readings.
  const titleFromHtml = extractLiturgicalTitle(html);

  return parseArticleBody(body, titleFromHtml);
}

/**
 * Extract the liturgical title from the EWTN page HTML. The title
 * sits in a div with a Tailwind text-size class (text-2xl,
 * text-3xl, or text-[28px] depending on the date). We can't rely
 * on the class name staying stable, so we match by *content*
 * instead — any div whose text matches a known liturgical
 * pattern is the title.
 */
function extractLiturgicalTitle(html: string): string {
  // Walk every <div>...</div> and pick the one whose contents look
  // like a liturgical title. Patterns: "Weekday of the Nth Week in
  // Ordinary Time", "Xth Sunday of ...", "Solemnity/Memorial/Feast
  // of ...". Bare weekday names ("Wednesday") and month names
  // ("June") match too, so we skip those — keep only matches that
  // include a fuller liturgical phrasing.
  const divRe = /<div[^>]*>([^<]{8,120})<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = divRe.exec(html)) !== null) {
    // Group 1 always exists on a match (required by the pattern).
    const raw = m[1];
    if (raw == null) continue;
    const t = raw.trim();
    const isBareWeekday = /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/.test(t);
    const isBareMonth = /^(?:January|February|March|April|May|June|July|August|September|October|November|December)$/.test(t);
    if (isBareWeekday || isBareMonth) continue;
    const isLiturgical =
      /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/.test(t) ||
      /^\d+(?:st|nd|rd|th)\s+Sunday\b/.test(t) ||
      /^(?:Solemnity|Memorial|Feast)\s+of\b/.test(t) ||
      /\((?:Solemnity|Memorial|Feast|Optional)\)$/.test(t);
    if (isLiturgical) return t;
  }
  return '';
}

/**
 * Split the articleBody dump into the standard sections. Returns
 * an object shaped like the existing DailyReading so it can flow
 * straight into the saveReading pipeline without conversion.
 */
export function parseArticleBody(body: string, titleFromHtml: string = ''): ParsedSections | null {
  // Normalize NBSPs (EWTN uses \u00a0 in verse text — see the
  // "O LORD" NBSPs in Psalm 139). Treating them as regular spaces
  // means downstream formatters don't need to special-case them.
  const normalized = body.replace(/\u00a0/g, ' ');
  const parsed = splitIntoSections(normalized);
  if (!parsed) return null;
  const { liturgicalInfo, sections } = parsed;
  if (sections.length === 0) return null;

  // Prefer the HTML-extracted title (matches the visible page
  // heading, includes "(Solemnity)" suffix). Fall back to the
  // first non-blank line of articleBody if HTML extraction failed.
  const effectiveTitle = titleFromHtml || liturgicalInfo;

  let firstReading = '';
  let firstReadingRef = '';
  let responsorialPsalm = '';
  let psalmRef = '';
  let gospel = '';
  let gospelRef = '';
  let secondReading = '';
  let secondReadingRef = '';

  for (const sec of sections) {
    const header = sec.header.toLowerCase();
    if (header === 'first reading') {
      firstReadingRef = sec.citation;
      firstReading = sec.body;
    } else if (header === 'responsorial psalm') {
      psalmRef = sec.citation;
      responsorialPsalm = sec.body;
    } else if (header === 'second reading') {
      secondReadingRef = sec.citation;
      secondReading = sec.body;
    } else if (header === 'gospel') {
      gospelRef = sec.citation;
      gospel = sec.body;
    }
    // Other section names (alleluia verse, antiphon) are ignored —
    // we don't have a field for them in the DailyReading type.
  }

  // EWTN doesn't include a "Gospel Acclamation" (the Alleluia
  // verse before the Gospel) in articleBody — that lives on the
  // full Mass page elsewhere. Leave gospelAcclamation empty for
  // EWTN-sourced rows; the LLM doesn't currently consume this
  // field anyway.

  // For Sundays + Solemnities with a Second Reading, concatenate
  // it onto firstReading so the LLM sees both. The separator is
  // explicit so a future UI surface knows where the second starts.
  if (secondReading) {
    const secondLabel = secondReadingRef
      ? `\n\n— Second Reading (${secondReadingRef}) —\n\n${secondReading}`
      : `\n\n— Second Reading —\n${secondReading}`;
    firstReading = firstReading
      ? `${firstReading}${secondLabel}`
      : secondReading;
    firstReadingRef = firstReadingRef
      ? `${firstReadingRef}; ${secondReadingRef}`
      : secondReadingRef;
  }

  // Need at least the gospel — that's the field the spiritual
  // director card surfaces. Without it we treat the fetch as
  // failed and let the caller try the next source.
  if (!gospel && !firstReading) return null;

  return {
    liturgicalInfo: effectiveTitle,
    firstReading,
    firstReadingRef,
    responsorialPsalm,
    psalmRef,
    gospelAcclamation: '',
    gospel,
    gospelRef,
  };
}

type Section = { header: string; citation: string; body: string };

function splitIntoSections(body: string): { liturgicalInfo: string; sections: Section[] } | null {
  const lines = body.split('\n');
  const sections: Section[] = [];
  let i = 0;

  // NOTE: split() arrays are dense, so every in-bounds lines[i] is
  // a string. The `?? ''` fallbacks below only satisfy
  // noUncheckedIndexedAccess — they never fire inside the
  // `i < lines.length` guards.

  // Skip leading blanks.
  while (i < lines.length && !(lines[i] ?? '').trim()) i++;

  // First non-blank line is the global page title (e.g. "The
  // Nativity of Saint John the Baptist"). Return it separately
  // so the caller can put it in liturgicalInfo.
  if (i >= lines.length) return null;
  const liturgicalInfo = (lines[i] ?? '').trim();
  i++;

  while (i < lines.length) {
    if (!(lines[i] ?? '').trim()) { i++; continue; }
    const header = (lines[i] ?? '').trim();
    i++;
    // Skip blanks between header and citation.
    while (i < lines.length && !(lines[i] ?? '').trim()) i++;
    if (i >= lines.length) break;
    const citation = (lines[i] ?? '').trim();
    i++;
    // Collect verse pairs until we hit a blank or end-of-body.
    const verses: string[] = [];
    while (i < lines.length && (lines[i] ?? '').trim()) {
      const numLine = (lines[i] ?? '').trim();
      i++;
      // If the next line is verse text (non-blank, not a known
      // section header), the numLine was a verse number — append
      // "num text". Otherwise numLine was the next section's
      // header and we should rewind so the outer loop picks it up.
      const next = lines[i];
      if (next != null && next.trim() && !isLikelySectionHeader(next)) {
        verses.push(`${numLine} ${next.trim()}`);
        i++;
      } else if (!isLikelySectionHeader(numLine)) {
        // Section body without a verse number — rare but happens
        // (e.g. some Psalms don't have numbered verses).
        verses.push(numLine);
      } else {
        // It WAS another section header — rewind so the outer
        // loop picks it up.
        i--;
        break;
      }
    }
    sections.push({
      header,
      citation,
      body: verses.join('\n').trim(),
    });
  }

  return { liturgicalInfo, sections };
}

/**
 * Best-effort check whether a line looks like a section header
 * ("First Reading", "Responsorial Psalm", "Second Reading",
 * "Gospel", or similar). Used to break out of the verse-collection
 * loop when we accidentally consume into the next section's header.
 */
function isLikelySectionHeader(line: string): boolean {
  const t = line.trim().toLowerCase();
  return t === 'first reading'
    || t === 'responsorial psalm'
    || t === 'second reading'
    || t === 'gospel'
    || t === 'gospel acclamation'
    || t === 'alleluia';
}
