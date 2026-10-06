// Vidéo de démonstration des animations (outil, pas un test) : node tools/demo-motion.mjs → shots/demo-motion.webm
// Faux monde des tests (tests/e2e-world.mjs), images de cartes colorées générées à la volée.
import '../tests/setup-env.mjs';
import { renameSync, readdirSync, mkdirSync } from 'node:fs';
import { chromium, startWorld, newPage } from '../tests/e2e-world.mjs';

const world = await startWorld({ port: 18970 });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const DECK = 'Commander\n1 Edgar Markov\n\nDeck\n1 Sol Ring\n1 Swords to Plowshares\n1 Craterhoof Behemoth\n1 Command Tower\n1 Arcane Signet\n1 Wrath of God\n1 Llanowar Elves\n10 Plains';
const seed = `try { localStorage.setItem('deckdeal:coll:v1', JSON.stringify({ t: '4 Sol Ring *FR*\\n2 Swords to Plowshares\\n3 Llanowar Elves\\n1 Wrath of God\\n1 Craterhoof Behemoth', u: 1, s: '', b: null }));
  localStorage.setItem('deckdeal:decks:v1', JSON.stringify([{ id: 'd1', name: 'Edgar', text: ${JSON.stringify(DECK)}, opts: {}, cards: 18, history: [], createdAt: 1, updatedAt: 2 }])); } catch (e) {}`;
const hue = s => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
const card = name => { const h = hue(name); return `<svg xmlns="http://www.w3.org/2000/svg" width="488" height="680"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},55%,55%)"/><stop offset="1" stop-color="hsl(${(h + 60) % 360},50%,30%)"/></linearGradient></defs><rect width="488" height="680" rx="24" fill="#111"/><rect x="18" y="18" width="452" height="644" rx="16" fill="url(#g)"/><rect x="36" y="36" width="416" height="54" rx="8" fill="rgba(255,255,255,.8)"/><text x="52" y="72" font-family="sans-serif" font-size="28" font-weight="700" fill="#222">${name}</text><rect x="36" y="110" width="416" height="300" rx="8" fill="rgba(0,0,0,.25)"/><rect x="36" y="430" width="416" height="200" rx="8" fill="rgba(255,255,255,.75)"/></svg>`; };
mkdirSync('shots/video', { recursive: true });
const { p, ctx } = await newPage(browser, world, { init: seed, goto: false, ctx: { isMobile: false, hasTouch: false, recordVideo: { dir: 'shots/video', size: { width: 390, height: 844 } } } });
await p.route('https://cards.scryfall.io/**', r => { const n = decodeURIComponent(r.request().url().split('/').pop().replace(/\.(jpg|png)$/, '')).replace(/-/g, ' '); r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'image/svg+xml', body: card(n.replace(/\b\w/g, c => c.toUpperCase())) }); });
await p.goto(world.url); await p.waitForTimeout(1800);
const tap = async sel => { const b = await p.$(sel); const r = await b.boundingBox(); await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2, { steps: 8 }); await p.mouse.down(); await p.waitForTimeout(90); await p.mouse.up(); };
// collection : onglets
await tap('#btnColl'); await p.waitForTimeout(1600);
for (const t of ['stats', 'trade', 'list']) { await tap(`#collSeg [data-v="${t}"]`); await p.waitForTimeout(1100); }
await tap('.coll-list .crow .thumb'); await p.waitForTimeout(1200);
// inclinaison de la carte en grand
const c = await (await p.$('.imgv-card')).boundingBox();
await p.mouse.move(c.x + c.width * 0.2, c.y + c.height * 0.2);
let k = 0; for (const [x, y] of [[0.8, 0.25], [0.8, 0.8], [0.2, 0.8], [0.5, 0.5]]) { await p.mouse.move(c.x + c.width * x, c.y + c.height * y, { steps: 18 }); if (process.env.SHOTS) await p.screenshot({ path: `shots/demo-tilt-${++k}.png` }); }
await p.waitForTimeout(500);
await p.keyboard.press('Escape'); await p.waitForTimeout(700);
await tap('.coll .dv-back'); await p.waitForTimeout(700);
// decks → viewer → main de départ
await tap('#btnDecks'); await p.waitForTimeout(1200);
await tap('.deck-main'); await p.waitForTimeout(1800);
await p.evaluate(() => document.querySelector('.dv.on .dv-scroll').scrollTo({ top: 260, behavior: 'smooth' })); await p.waitForTimeout(900);
await tap('.dv.on [data-act="hand"]'); await p.waitForTimeout(1600);
await tap('[data-act="redeal"]'); await p.waitForTimeout(1600);
await ctx.close(); await browser.close();
const f = readdirSync('shots/video').find(x => x.endsWith('.webm'));
renameSync('shots/video/' + f, 'shots/demo-motion.webm');
console.log('shots/demo-motion.webm');
process.exit(0);
