import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      // App code imports via absolute "/public/..." URLs (served by the PWA).
      { find: '/public', replacement: fileURLToPath(new URL('./public', import.meta.url)) }
    ]
  },
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        pretendToBeVisual: true
      }
    }
  }
});
