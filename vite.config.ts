import { defineConfig } from 'vite';

export default defineConfig({
  server: { open: true },
  test: { environment: 'jsdom' },
});
