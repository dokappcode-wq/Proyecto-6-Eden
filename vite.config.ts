import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 5173 },
  // three.js ocupa ~550 kB por sí solo; el aviso por defecto (500 kB) sería ruido permanente.
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 900 },
  test: { include: ['tests/**/*.test.ts'] },
});
