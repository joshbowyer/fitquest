import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
        // No cookieDomainRewrite: we want the session cookie to be
        // host-only on whatever origin the browser uses (localhost
        // in dev, the dev machine's LAN IP for laptop/phone access).
        // Rewriting the domain to 'localhost' would break access via
        // the LAN IP, since the browser would only send the cookie on
        // requests to 'localhost'.
      },
    },
  },
});
