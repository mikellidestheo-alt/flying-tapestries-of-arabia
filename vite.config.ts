import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** After the build, inject the precache list and a content hash into dist/sw.js. */
function swPrecache(): Plugin {
  return {
    name: 'sw-precache',
    apply: 'build',
    closeBundle() {
      const dist = 'dist';
      const swPath = join(dist, 'sw.js');
      if (!existsSync(swPath)) return;
      const files: string[] = [];
      const walk = (d: string) => {
        for (const f of readdirSync(d)) {
          const p = join(d, f);
          if (statSync(p).isDirectory()) walk(p);
          else if (p !== swPath && !p.endsWith('.map')) files.push(relative(dist, p).split('\\').join('/'));
        }
      };
      walk(dist);
      files.sort();
      const hash = createHash('sha1').update(readFileSync(swPath));
      for (const f of files) hash.update(f).update(readFileSync(join(dist, f)));
      const list = ['./', ...files.map((f) => `./${f}`)];
      const sw = readFileSync(swPath, 'utf8')
        .replace("'__VERSION__'", JSON.stringify(hash.digest('hex').slice(0, 12)))
        .replace("'__PRECACHE__'", JSON.stringify(list));
      writeFileSync(swPath, sw);
    },
  };
}

// The Worker only accepts same-origin requests, so the dev proxy presents the Worker's own origin.
const devProxy = (scheme: 'http' | 'ws') => ({ target: `${scheme}://127.0.0.1:8787`, changeOrigin: true, headers: { Origin: 'http://127.0.0.1:8787' } });

export default defineConfig({
  base: './',
  plugins: [swPrecache()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
  },
  // Co-op during development: run `npx wrangler dev --port 8787` next to `npm run dev`; the game's same-origin
  // /api and /ws requests are forwarded to it (in production the Worker serves them directly).
  server: { host: true, proxy: { '/api': devProxy('http'), '/ws': { ...devProxy('ws'), ws: true } } },
});
