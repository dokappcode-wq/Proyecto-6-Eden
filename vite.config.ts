import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Puerto fijo del proyecto; abre el navegador al arrancar `npm run dev`.
  server: { port: 8006, open: true },
  // three.js ocupa ~550 kB por sí solo; el aviso por defecto (500 kB) sería ruido permanente.
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1200 },
  test: { include: ['tests/**/*.test.ts'] },
});
