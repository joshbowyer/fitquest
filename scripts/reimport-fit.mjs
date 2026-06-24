#!/usr/bin/env node
/**
 * Bulk re-import all FIT files from /tmp/gadgetbridge via the
 * existing /import/batch endpoint. Skips duplicates server-side
 * (the persist function dedupes on (userId, metric, recordedAt)).
 *
 * Usage:
 *   node scripts/reimport-fit.mjs
 *
 * Requires:
 *   - /tmp/gadgetbridge/{SLEEP,METRICS,MONITOR,HRV_STATUS,ACTIVITY}/2026/
 *   - A valid fitquest_session cookie in /tmp/cookies.txt
 *     (the same one curl uses)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COOKIE_JAR = '/tmp/cookies.txt';
const BASE_URL = 'http://localhost:3001';
const BATCH_SIZE = 25; // endpoint caps at 50; stay under for headroom
const FILE_LIMIT = 200 * 1024 * 1024; // 200MB cap per file

function* walkFitFiles(root) {
  for (const sub of ['SLEEP', 'METRICS', 'MONITOR', 'HRV_STATUS', 'ACTIVITY']) {
    const dir = path.join(root, sub, '2026');
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      if (f.endsWith('.fit')) yield path.join(dir, f);
    }
  }
}

function loadCookie() {
  const txt = fs.readFileSync(COOKIE_JAR, 'utf-8');
  // The cookie jar uses libcurl's Netscape format with a
  // `#HttpOnly_<host>` prefix on each line. Tabs separate fields.
  // 7 fields: domain, includeSubdomains, path, secure, expires, name, value
  const lines = txt.split('\n');
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length >= 7 && parts[5] === 'fitquest_session') {
      return `fitquest_session=${parts[6]}`;
    }
  }
  throw new Error('No fitquest_session cookie in ' + COOKIE_JAR);
}

async function postBatch(files, cookie) {
  const payload = {
    files: files.map((p) => ({
      filename: path.basename(p),
      contentBase64: fs.readFileSync(p).toString('base64'),
    })),
  };
  const res = await fetch(`${BASE_URL}/import/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Batch failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function main() {
  const cookie = loadCookie();
  const allFiles = [...walkFitFiles('/tmp/gadgetbridge')];
  console.log(`Found ${allFiles.length} FIT files under /tmp/gadgetbridge`);

  let totalCreated = 0;
  let totalSkipped = 0;
  let totalBatches = 0;
  let totalErrors = 0;

  for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
    const slice = allFiles.slice(i, i + BATCH_SIZE);
    try {
      const result = await postBatch(slice, cookie);
      totalBatches++;
      let created = 0;
      let skipped = 0;
      for (const f of result.files) {
        for (const c of f.created) created++;
        if (f.skipped) for (const s of f.skipped) skipped++;
      }
      totalCreated += created;
      totalSkipped += skipped;
      const dt = new Date().toLocaleTimeString();
      console.log(`[${dt}] batch ${totalBatches}: ${slice.length} files, +${created} new, ${skipped} skipped`);
    } catch (e) {
      totalErrors++;
      console.error(`[error] batch starting at ${i}: ${e.message}`);
    }
  }

  console.log('---');
  console.log(`Done. ${totalBatches} batches, ${totalCreated} new rows, ${totalSkipped} skipped, ${totalErrors} errors.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
