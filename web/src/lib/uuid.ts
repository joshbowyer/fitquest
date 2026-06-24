// Browser-safe UUID v4 helper. `crypto.randomUUID()` is only
// available on HTTPS / localhost — on the LAN dev box
// (http://10.0.0.59) we fall back to RFC 4122 v4 via
// `crypto.getRandomValues`. Same implementation as the API
// helper at api/src/lib/randomUuid.ts.

export function randomUuid(): string {
  if (typeof crypto !== 'undefined') {
    if (typeof (crypto as any).randomUUID === 'function') {
      return (crypto as any).randomUUID();
    }
    if (typeof crypto.getRandomValues === 'function') {
      const buf = new Uint8Array(16);
      crypto.getRandomValues(buf);
      // RFC 4122 v4 — set version (4) and variant (10xx).
      buf[6] = (buf[6] & 0x0f) | 0x40;
      buf[8] = (buf[8] & 0x3f) | 0x80;
      const hex = Array.from(buf, (b) => b.toString(16).padStart(2, '0'));
      return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
    }
  }
  // Last-resort fallback (Math.random is fine here because this is
  // a non-cryptographic identifier used for SVG `<defs>` keys).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
