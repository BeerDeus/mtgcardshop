// BENCH scan OCR (outil de mesure, pas un test) : Tesseract.js servi depuis node_modules à la place du CDN, cartes synthétiques (fixtures/), photos puis caméra simulée.
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium, startWorld, newPage, txt, ok } from '../tests/e2e-world.mjs';

const TESS_DIR = process.env.TESS_DIR || new URL('../tests/node_modules', import.meta.url).pathname;
if (!existsSync(TESS_DIR + '/tesseract.js')) { console.log('· tesseract.js absent (TESS_DIR) : test OCR ignoré'); process.exit(0); }
const FX = new URL('../tests/fixtures/', import.meta.url).pathname, fx = n => FX + n;
const map = [
  [/\/npm\/tesseract\.js@5\.1\.1\/dist\/(.+)$/, m => `${TESS_DIR}/tesseract.js/dist/${m[1]}`, 'text/javascript'],
  [/\/npm\/tesseract\.js-core@5\.1\.1\/(.+)$/, m => `${TESS_DIR}/tesseract.js-core/${m[1]}`, null],
  [/\/npm\/@tesseract\.js-data\/(eng|fra)\/4\.0\.0_best_int\/(.+)$/, m => `${TESS_DIR}/@tesseract.js-data/${m[1]}/4.0.0_best_int/${m[2]}`, 'application/gzip'],
];
const cdnHits = [];
async function routeCdn(ctx) {
  await ctx.route('https://cdn.jsdelivr.net/**', route => {
    const u = new URL(route.request().url()); cdnHits.push(u.pathname);
    for (const [re, file, type] of map) {
      const m = re.exec(u.pathname); if (!m) continue;
      const f = file(m); if (!existsSync(f)) return route.fulfill({ status: 404, body: 'nf' });
      return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: type || (f.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'), body: readFileSync(f) });
    }
    return route.fulfill({ status: 404, body: 'nf' });
  });
}

const world = await startWorld({ port: 18911, bigCatalog: 35000 });
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const { ctx, p } = await newPage(browser, world, { goto: false });
await routeCdn(ctx); await p.goto(world.url); await p.waitForTimeout(700);
await p.click('#btnColl'); await p.waitForSelector('.coll.on'); await p.click('.coll-tools [data-act="scan"]'); await p.waitForSelector('.scan.on');
const names = (process.argv[2] || 'swords,crater,wrath,llanowar,edgar,sceau,anneau,epees,colere,elfes,behemoth,nonsense,blurry').split(',');
const reps = Number(process.argv[3] || 1);
await p.evaluate(() => {
  window.__calls = [];
  const o = ocrLines; ocrLines = async (c, lang, psm) => { const t = performance.now(); const r = await o(c, lang, psm); __calls.push({ k: 'ocr', lang, psm, w: c.width, h: c.height, ms: Math.round(performance.now() - t), n: r.length }); return r; };
  const f = frenchName; frenchName = async (t, s) => { const t0 = performance.now(); const r = await f(t, s); __calls.push({ k: 'fr', ms: Math.round(performance.now() - t0), r: r && r.name }); return r; };
  window.__bench = async b64 => {
    const img = new Image(); await new Promise(r => { img.onload = r; img.src = 'data:image/png;base64,' + b64; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0);
    __calls = []; const cat = await collCatalog(), t0 = performance.now(); const m = await readCard(c, cat, true);
    return { total: Math.round(performance.now() - t0), m: m && [m.name, m.score, m.card, m.lang], calls: __calls.slice() };
  };
});
// démarrage à froid : catalogue (35 000 noms), puis moteur anglais, puis français
console.log('froid :', JSON.stringify(await p.evaluate(async () => { const t = performance.now(); await collCatalog(); const a = performance.now(); await ocrWorker('eng'); const b = performance.now(); await ocrWorker('fra'); const c = performance.now(); return { catalogue_ms: Math.round(a - t), moteur_eng_ms: Math.round(b - a), moteur_fra_ms: Math.round(c - b) }; })));
// échauffement : modèles chargés (hors mesure)
await p.evaluate(async () => { await ocrLines(Object.assign(document.createElement('canvas'), { width: 200, height: 60 }), 'eng', '6'); await ocrLines(Object.assign(document.createElement('canvas'), { width: 200, height: 60 }), 'fra', '6'); });
const rows = [];
for (let r = 0; r < reps; r++) for (const n of names) {
  const b64 = readFileSync((process.env.BENCH_DIR || '/tmp/bench') + `/${n}.png`).toString('base64');
  const res = await p.evaluate(b => window.__bench(b), b64); rows.push({ n, ...res });
  console.log(n.padEnd(10), String(res.total).padStart(5), 'ms', JSON.stringify(res.m), res.calls.map(c => c.k === 'ocr' ? `${c.lang}/${c.psm}:${c.w}x${c.h}:${c.ms}` : `fr:${c.ms}`).join(' '));
}
const sure = rows.filter(r => r.m && r.m[1] >= 0.84), tot = rows.reduce((a, r) => a + r.total, 0);
console.log(`\n${rows.length} lectures · ${sure.length} sûres · moyenne ${Math.round(tot / rows.length)} ms · lecture sûre moyenne ${Math.round(sure.reduce((a, r) => a + r.total, 0) / Math.max(1, sure.length))} ms · appels OCR moyens ${(rows.reduce((a, r) => a + r.calls.filter(c => c.k === 'ocr').length, 0) / rows.length).toFixed(1)}`);
await ctx.close(); await browser.close(); world.stop();
