// Cuid-ish ID generator. Prisma uses cuid() by default but
// we're in pure JS land for the import flow, so we approximate
// the format: timestamp prefix + random base36 suffix.
// Not strictly required to match cuid format — Prisma treats
// the column as `String @id` so any unique string works — but
// keeping the timestamp prefix helps when debugging ("when
// was this row created?").

export function randomUuid(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 14);
  return `c${ts}${rand}`.padEnd(25, '0');
}
