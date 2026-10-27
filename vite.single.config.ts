// Build of the whole game as ONE self-contained HTML file (scripts/build-single.mjs inlines the result).
// Co-op from that file talks to the live site (VITE_COOP_ORIGIN).
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  publicDir: false,
  define: { 'import.meta.env.VITE_COOP_ORIGIN': JSON.stringify(process.env.COOP_ORIGIN ?? 'https://flying-tapestries-of-arabia.mikellidestheo.workers.dev') },
  build: {
    target: 'es2022',
    outDir: 'dist-single',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } },
  },
});
