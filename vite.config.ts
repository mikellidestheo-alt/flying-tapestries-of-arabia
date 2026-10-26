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

export default defineConfig({
  base: './',
  plugins: [swPrecache()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
  },
  server: { host: true },
});
