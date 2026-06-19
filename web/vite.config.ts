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
        // Ensure the session cookie is scoped to the bare 'localhost'
        // host (no port) so it's sent on both 5173 and 3001. Without
        // this, the cookie's host-only scope is the backend's origin
        // (localhost:3001) and the browser won't attach it to the
        // proxied request, causing a 401 on /auth/me right after login.
        cookieDomainRewrite: 'localhost',
      },
    },
  },
});
