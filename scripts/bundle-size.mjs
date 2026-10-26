// Prints production bundle sizes (raw + gzip) and fails if the JS budget is exceeded.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const BUDGET_JS_GZIP_KB = 300; // see CLAUDE.md performance budget
const dir = 'dist';
let total = 0;
let totalJs = 0;
function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else {
      const buf = readFileSync(p);
      const gz = gzipSync(buf).length;
      total += gz;
      if (p.endsWith('.js')) totalJs += gz;
      console.log(`${(buf.length / 1024).toFixed(1).padStart(8)} KB  ${(gz / 1024).toFixed(1).padStart(7)} KB gz  ${p}`);
    }
  }
}
walk(dir);
console.log(`\nTotal gzip: ${(total / 1024).toFixed(1)} KB   JS gzip: ${(totalJs / 1024).toFixed(1)} KB (budget ${BUDGET_JS_GZIP_KB} KB)`);
if (totalJs / 1024 > BUDGET_JS_GZIP_KB) {
  console.error('JS bundle over budget');
  process.exit(1);
}
