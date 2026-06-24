#!/usr/bin/env node
/**
 * Re-import only the SLEEP files (skip dedup by deleting existing
 * FIT sleep rows first). Used after a parseSleep change.
 */
import fs from 'node:fs';
import path from 'node:path';

const COOKIE_JAR = '/tmp/cookies.txt';
const BASE_URL = 'http://localhost:3001';
const BATCH_SIZE = 25;

function loadCookie() {
  const txt = fs.readFileSync(COOKIE_JAR, 'utf-8');
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
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Batch failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const cookie = loadCookie();
  const dir = '/tmp/gadgetbridge/SLEEP/2026';
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.fit')).map((f) => path.join(dir, f)).sort();
  console.log(`Re-importing ${files.length} SLEEP files`);

  let totalCreated = 0;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const slice = files.slice(i, i + BATCH_SIZE);
    const result = await postBatch(slice, cookie);
    let created = 0;
    for (const f of result.files) for (const _ of f.created) created++;
    totalCreated += created;
    console.log(`batch ${Math.floor(i / BATCH_SIZE) + 1}: ${slice.length} files, +${created} new`);
  }
  console.log(`Done. ${totalCreated} new sleep rows.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
