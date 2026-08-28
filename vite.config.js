import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: true },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'test/e2e/**'],
  },
});
