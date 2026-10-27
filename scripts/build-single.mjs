// Builds dist/flying-tapestries-of-arabia.html: the whole game (code, styles, fonts, music) in one file that
// opens straight from the phone's Downloads folder, offline. Co-op still goes to the live site.
// Runs after the normal build (see package.json "build").
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

execFileSync('npx', ['vite', 'build', '--config', 'vite.single.config.ts'], { stdio: 'inherit' });

const dir = 'dist-single';
let html = readFileSync(`${dir}/index.html`, 'utf8');
const assets = readdirAssets();
function readdirAssets() {
  return execFileSync('ls', [`${dir}/assets`]).toString().trim().split('\n');
}
const js = readFileSync(`${dir}/assets/${assets.find((f) => f.endsWith('.js'))}`, 'utf8');
const cssFile = assets.find((f) => f.endsWith('.css'));
let css = cssFile ? readFileSync(`${dir}/assets/${cssFile}`, 'utf8') : ''; // in an IIFE build the CSS usually rides inside the JS

const b64 = (path, mime) => `data:${mime};base64,${readFileSync(path).toString('base64')}`;
// Fonts referenced from the stylesheet (wherever the CSS ended up).
const inlineFonts = (text) => text.replace(/url\(["']?[^)"']*?fonts\/([a-z0-9-]+\.woff2)["']?\)/g, (_m, f) => `url(${b64(`public/fonts/${f}`, 'font/woff2')})`);
css = inlineFonts(css);
// The background track: fetch() accepts data: URLs, so no separate file is needed.
const track = 'music/searing-horizon-strike.ogg';
if (!js.includes(track)) throw new Error('music track path not found in the bundle');
const inlineJs = inlineFonts(js).split(track).join(b64(`public/${track}`, 'audio/ogg')).replace(/<\/script/gi, '<\\/script');

html = html
  .replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '')
  .replace(/<link[^>]*rel="stylesheet"[^>]*>/g, '')
  .replace(/<link[^>]*rel="(manifest|preload|modulepreload)"[^>]*>/g, '')
  .replace('</head>', () => (css ? `<style>${css}</style></head>` : '</head>'))
  .replace('</body>', () => `<script>${inlineJs}</script></body>`);

if (!existsSync('dist')) throw new Error('run the normal build first');
const out = 'dist/flying-tapestries-of-arabia.html';
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1048576).toFixed(2)} MB)`);
