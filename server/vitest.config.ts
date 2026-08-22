import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: [
      // Source uses NodeNext-style '.js' specifiers; strip them for Vitest.
      { find: /^@\/(.*)\.js$/, replacement: `${fileURLToPath(new URL('./src', import.meta.url))}/$1` },
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
