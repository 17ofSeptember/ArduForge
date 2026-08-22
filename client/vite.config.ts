import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

const SERVER_PORT = process.env['ARDUFORGE_PORT'] ?? '5174';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Each of these is large and changes on a different cadence than the
        // app, so they get their own long-lived chunks.
        manualChunks: {
          reactflow: ['@xyflow/react'],
          codemirror: ['@codemirror/state', '@codemirror/view', '@codemirror/lang-cpp', '@codemirror/language'],
          charts: ['uplot'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  server: {
    port: 5173,
    // Fail loudly instead of walking to the next free port. Vite's default is
    // to increment, and the next port up is 5174, which is the backend. The
    // result is a UI that loads while every API call fails, with the real cause
    // scrolled off the terminal. A refusal to start is far easier to diagnose.
    strictPort: true,
    // Proxying keeps the browser same-origin, so no CORS surprises later when
    // the WebSocket endpoints land in Phase 1.
    proxy: {
      '/api': { target: `http://localhost:${SERVER_PORT}`, changeOrigin: true },
      '/ws': { target: `ws://localhost:${SERVER_PORT}`, ws: true },
    },
  },
});
