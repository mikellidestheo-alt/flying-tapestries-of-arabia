// Local check that the built game works with no network (needs Playwright + a running `npm run preview`).
// Usage: node scripts/test-offline.cjs http://localhost:4173/ [path-to-playwright]
const { chromium } = require(process.argv[3] || 'playwright');
(async () => {
  const url = process.argv[2] || 'http://localhost:4173/';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(1500);
  const cached = await page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('fta-')));
  console.log('caches:', cached.join(', ') || '(none)');
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForTimeout(1200);
  const title = await page.textContent('h1');
  console.log('offline reload shows title:', JSON.stringify(title));
  await page.click('#startBtn');
  await page.waitForTimeout(300);
  await page.click('#playBtn');
  await page.waitForTimeout(2500);
  const mana = await page.textContent('#manaText');
  const timer = await page.textContent('#timer');
  console.log('offline play: mana', mana, 'timer', timer);
  console.log('page errors:', errors.length ? errors.join(' | ') : 'none');
  const ok = !!title && /Tapestries/.test(title) && mana !== '0' && errors.length === 0 && cached.length > 0;
  console.log(ok ? 'OFFLINE OK' : 'OFFLINE FAILED');
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
