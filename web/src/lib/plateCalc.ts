// Re-export from api/src/lib/plateCalc.ts so there's a single source of
// truth (the api-side copy is the one we run vitest against). The web
// bundler resolves the relative path via Vite's TS transformer.
// Keep this file a pure re-export — no logic here.
export * from '../../../api/src/lib/plateCalc';