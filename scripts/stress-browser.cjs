// Browser stress run (headless, software GL: draw/triangle counts and memory are meaningful,
// frame times are NOT representative of a phone). Usage:
//   npm run dev &   (or npm run preview)
//   node scripts/stress-browser.cjs [url] [playwright-module-path] [seconds-per-run]
// For every chapter and quality preset: fills the entity pools to their caps, plays for a while and
// prints draw calls, triangles, particles, JS heap growth and JS time per frame (cpu).
const url = process.argv[2] || 'http://localhost:5173/';
const { chromium } = require(process.argv[3] || 'playwright');
const secs = Number(process.argv[4] || 6);

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'] });
  const p = await b.newPage({ viewport: { width: 960, height: 440 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(url);
  await p.waitForFunction(() => window.__game, null, { timeout: 30000 });
  await p.click('#startBtn');
  console.log('chapter  preset  drawCalls  tris   particles  heapMB(start->end)  cpuMs');
  for (const preset of ['high', 'medium', 'low']) {
    await p.evaluate((q) => window.__game.changeSettings({ quality: q, qualityAuto: false }, 'quality'), preset);
    for (let ch = 0; ch < 6; ch++) {
      await p.evaluate((i) => {
        const g = window.__game;
        g.save.progress.tutorialDone = true;
        g.startMatch(i);
        const s = g.sim;
        const pl = s.players[0];
        const hostile = s.creatureTypes.filter((t) => !t.startsWith('x'));
        for (let k = 0; k < 40; k++) s.spawnCreature(hostile[k % hostile.length], pl.x + 30 + (k % 8) * 10, pl.z + 30 + Math.floor(k / 8) * 10);
        for (let k = 0; k < 200; k++) s.spawnOrb(pl.x + (k % 15) * 5, pl.y, pl.z + Math.floor(k / 15) * 5, 4, 0, 0);
      }, ch);
      const heap0 = await p.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0);
      let worstTris = 0, worstCalls = 0, worstParticles = 0;
      const end = Date.now() + secs * 1000;
      while (Date.now() < end) {
        await p.keyboard.down('Space');
        await p.waitForTimeout(250);
        const st = await p.evaluate(() => window.__game.renderer.stats);
        worstTris = Math.max(worstTris, st.triangles);
        worstCalls = Math.max(worstCalls, st.drawCalls);
        worstParticles = Math.max(worstParticles, st.particles);
      }
      const heap1 = await p.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0);
      const cpu = await p.evaluate(() => window.__game.cpuAvg);
      console.log(`${String(ch + 1).padEnd(8)} ${preset.padEnd(7)} ${String(worstCalls).padEnd(10)} ${String(worstTris).padEnd(6)} ${String(worstParticles).padEnd(10)} ${heap0.toFixed(0)}->${heap1.toFixed(0)}`.padEnd(70) + ` ${cpu.toFixed(1)}`);
    }
  }
  console.log(errors.length ? `ERRORS: ${errors.slice(0, 5).join(' | ')}` : 'no console errors');
  await b.close();
})();
