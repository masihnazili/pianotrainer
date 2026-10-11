// Optional browser end-to-end test for Phase 2 (fake MIDI device, wait mode, rhythm mode).
// Needs Playwright:  npm i -D playwright && npx playwright install chromium
// Start the dev server first (npm run dev:web, default port 5173), then:  node tests/e2e/phase2.mjs
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
await ctx.addInitScript(() => {
  const input = { id: 'fake1', name: 'Fake Piano', manufacturer: 'Test', state: 'connected', onmidimessage: null };
  const access = { inputs: new Map([['fake1', input]]), onstatechange: null };
  window.__fake = { input, access };
  navigator.requestMIDIAccess = async () => access;
});
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', e => errors.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await p.goto('http://localhost:5173/?debug');
await p.waitForSelector('.step-btn');
const log = (k, v) => console.log(k.padEnd(34), v);

// ---- MIDI connect
await p.click('#btn-midi');
await p.waitForTimeout(100);
log('device label:', (await p.textContent('#device-label')).trim());
log('device chip connected:', await p.locator('#device.connected').count());

const send = (type, midi, vel = 100) => p.evaluate(([t, m, v]) => {
  window.__fake.input.onmidimessage({ data: [t === 'on' ? 0x90 : 0x80, m, v], timeStamp: performance.now() });
}, [type, midi, vel]);

// ---- WAIT mode on "Ode to Joy"
await p.locator('.step-btn').nth(2).click();
await p.click('.mode[data-mode="wait"]');
await p.click('#btn-play');
await p.waitForTimeout(100);
log('wait: practice active:', await p.evaluate(() => window.__piano.practice.active));
log('wait: tempo control hidden:', await p.locator('#ctl-tempo').isHidden());
log('wait: active note + hint key:', `${await p.locator('.note.is-active').count()} / ${await p.locator('.key.is-target').count()}`);
await send('on', 61); await p.waitForTimeout(40);   // wrong note first
log('wait: wrong flash on key:', await p.locator('.key.is-wrong').count());
await p.waitForTimeout(400);
const groups = await p.evaluate(() => window.__piano.practice.evaluator.groups.map(g => g.midis));
for (let i = 0; i < groups.length; i++) {
  for (const m of groups[i]) { await send('on', m); await send('off', m, 0); }
  if (i === 10) await p.screenshot({ path: './p2-wait-mid.png' });
}
await p.waitForTimeout(150);
log('wait: result visible:', await p.locator('#result').isVisible());
log('wait: result class:', await p.getAttribute('#result', 'class'));
log('wait: result text:', (await p.textContent('#result')).replace(/\s+/g, ' ').slice(0, 160));
log('wait: correct/warn notes:', `${await p.locator('.note.is-correct').count()} / ${await p.locator('.note.is-warn').count()}`);
await p.screenshot({ path: './p2-wait-result.png' });

// ---- computer keyboard + screen keys produce events
await p.keyboard.press('KeyA');
log('computer key sounded (pressed state cleared):', await p.locator('.key.is-pressed').count());

// ---- RHYTHM mode on the first warm-up (RH), tempo 140
await p.locator('.step-btn').nth(1).click();
await p.click('.mode[data-mode="rhythm"]');
await p.evaluate(() => { const t = document.getElementById('tempo'); t.value = 140; t.dispatchEvent(new Event('input')); });
await p.click('#btn-play');
await p.waitForFunction(() => window.__piano.practice.evaluator && window.__piano.practice.evaluator.slots.length > 0);
log('rhythm: slots:', await p.evaluate(() => window.__piano.practice.evaluator.slots.length));
// schedule simulated playing: jitter, skip slots 3 and 9, one wrong extra note
await p.evaluate(() => {
  const ev = window.__piano.practice.evaluator;
  const fake = window.__fake.input;
  ev.slots.forEach((s, i) => {
    if (i === 3 || i === 9) return;
    const jitter = ((i % 5) - 2) * 0.012; // +-24ms
    const delay = (s.expected + jitter) * 1000 - performance.now();
    setTimeout(() => fake.onmidimessage({ data: [0x90, s.midi, 90], timeStamp: performance.now() }), Math.max(0, delay));
  });
  const d = (ev.slots[5].expected + 0.1) * 1000 - performance.now();
  setTimeout(() => fake.onmidimessage({ data: [0x90, 61, 90], timeStamp: performance.now() }), d);
});
await p.waitForTimeout(2200);
await p.screenshot({ path: './p2-rhythm-mid.png' });
log('rhythm: cursor visible mid-run:', await p.getAttribute('#cursor', 'visibility'));
await p.waitForSelector('#result:not([hidden])', { timeout: 20000 });
const summary = await p.evaluate(() => window.__piano.practice.evaluator.summary());
log('rhythm summary:', JSON.stringify(summary));
log('rhythm: result text:', (await p.textContent('#result')).replace(/\s+/g, ' ').slice(0, 260));
log('rhythm: correct/warn notes:', `${await p.locator('.note.is-correct').count()} / ${await p.locator('.note.is-warn').count()}`);
await p.screenshot({ path: './p2-rhythm-result.png' });

// ---- text step hides controls
await p.locator('.step-btn').nth(0).click();
log('text step: controls/modes hidden:', `${await p.locator('#controls').isHidden()} / ${await p.locator('#modes').isHidden()}`);

// ---- visit all steps
const n = await p.locator('.step-btn').count();
for (let i = 0; i < n; i++) { await p.locator('.step-btn').nth(i).click(); await p.waitForTimeout(40); }
log('visited steps:', n);
log('ERRORS:', JSON.stringify(errors));
await b.close();
