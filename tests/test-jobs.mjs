// Tâches de fond du proxy : cadence, cache, rattachement, annulation, 429, jeton refusé, désactivation, auth.
import './setup-env.mjs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const reqs = []; let mode = {}; const REFUSED = 'jeton-refuse-0123456789abc'; // mode : { bad: Set(bp) → 429 une fois, dead: status pour tous, delay }
const mkp = (bp, i, lang = 'fr') => ({ id: bp * 100 + i, blueprint_id: bp, quantity: 2, graded: false, on_vacation: false, bundle_size: 1, name_en: 'gros champ inutile', description: 'x'.repeat(400),
  price: { cents: 100 + i, currency: 'EUR', formatted: '1 €' }, properties_hash: { condition: 'Near Mint', mtg_language: lang, mtg_foil: false, collector_number: '9', secret_field: 1 },
  expansion: { code: 'cmm', name_en: 'Commander Masters', id: 1, extra: true }, user: { id: i, username: 'u' + i, country_code: 'FR', can_sell_via_hub: true, user_type: 'normal', email: 'x@y.z' } });
const up = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const bp = Number(u.searchParams.get('blueprint_id'));
  const finish = () => {
    if (req.headers.authorization === 'Bearer ' + REFUSED) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":"Unauthorized"}'); }
    if (mode.dead) { res.writeHead(mode.dead, { 'Content-Type': 'application/json' }); return res.end('{"error":"x"}'); }
    if (mode.bad && mode.bad.has(bp)) { mode.bad.delete(bp); res.writeHead(429, { 'Content-Type': 'application/json' }); return res.end('{"error":"Too many requests: max 10 requests per second"}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const empty = bp % 5 === 0; // un blueprint sur 5 : aucune offre
    res.end(JSON.stringify({ [bp]: empty ? [] : [mkp(bp, 1, u.searchParams.get('language') || 'en'), mkp(bp, 2, u.searchParams.get('language') || 'en')] }));
  };
  reqs.push({ t: Date.now(), bp, q: u.search, auth: req.headers.authorization });
  mode.delay ? setTimeout(finish, mode.delay) : finish();
});
await new Promise(r => up.listen(0, '127.0.0.1', r));
const start = (env, port, args = []) => new Promise((resolve, reject) => {
  const p = spawn('node', [...args, 'proxy.mjs'], { env: { ...process.env, EDH_SOURCE_URL: '', PORT: String(port), CT_UPSTREAM: `http://127.0.0.1:${up.address().port}/api/v2`, CARDTRADER_TOKEN: 'tok', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', d => { out += d; if (/Mana Orbit →/.test(out)) resolve(p); }); p.stderr.on('data', d => { out += d; });
  p.on('exit', code => { if (code) reject(new Error('exit ' + code + ': ' + out)); });
});
const procs = []; const cleanup = () => { for (const p of procs) try { p.kill(); } catch {} up.close(); };
process.on('exit', cleanup);
const J = async (B, path, init = {}, headers = {}) => { const r = await fetch(B + path, { ...init, headers: { 'Content-Type': 'application/json', ...headers } }); const t = await r.text(); let o; try { o = JSON.parse(t); } catch { o = t; } return { s: r.status, o }; };
const post = (B, body, h) => J(B, '/api/jobs', { method: 'POST', body: JSON.stringify(body) }, h);
const sleep = ms => new Promise(x => setTimeout(x, ms));
const drain = async (B, id, h, max = 60000) => { // relève tous les résultats comme le fait l'application
  const items = []; let from = 0; const t0 = Date.now(); let last;
  for (;;) { const r = await J(B, `/api/jobs/${id}?from=${from}`, {}, h); assert.equal(r.s, 200); last = r.o; items.push(...r.o.items); from = r.o.next; if (r.o.status !== 'running' && from >= r.o.count) return { items, last }; assert.ok(Date.now() - t0 < max, 'délai dépassé'); if (!r.o.items.length) await new Promise(x => setTimeout(x, 60)); }
};
const bpsOf = (a, n) => Array.from({ length: n }, (_, i) => a + i);

let p = await start({}, 18830); procs.push(p); // TTL par défaut (10 min / 3 h)
const B = 'http://127.0.0.1:18830';
let r = await J(B, '/__ping'); assert.equal(r.o.jobs, true); console.log('✓ ping annonce les tâches de fond');

// 1) cadence, résultats allégés, ordre, compteurs
{
  reqs.length = 0; const bps = bpsOf(1000, 40);
  r = await post(B, { type: 'offers', lang: 'fr', foil: 'no', bps }); assert.equal(r.s, 202); assert.equal(r.o.total, 40); assert.equal(r.o.attached, false); assert.match(r.o.id, /^[a-f0-9]{24}$/);
  const id = r.o.id; const { items, last } = await drain(B, id);
  assert.equal(items.length, 40); assert.deepEqual(items.map(i => i.bp).sort((a, b) => a - b), bps, 'tous les blueprints, une seule fois');
  assert.equal(last.status, 'done'); assert.equal(last.done, 40); assert.equal(last.errors, 0); assert.equal(last.sent, 40); assert.equal(last.cached, 0);
  const full = items.find(i => i.bp === 1001); assert.equal(full.products.length, 2);
  const pr = full.products[0]; assert.deepEqual(Object.keys(pr).sort(), ['blueprint_id', 'bundle_size', 'expansion', 'graded', 'id', 'on_vacation', 'price', 'properties_hash', 'quantity', 'user'], 'champs utiles seulement');
  assert.deepEqual(pr.price, { cents: 101, currency: 'EUR' }); assert.deepEqual(pr.user, { id: 1, username: 'u1', country_code: 'FR', can_sell_via_hub: true, user_type: 'normal' }); assert.equal(pr.properties_hash.secret_field, undefined);
  assert.deepEqual(items.find(i => i.bp === 1000).products, [], 'blueprint sans offre : liste vide');
  const q = new URLSearchParams(reqs[0].q); assert.equal(q.get('language'), 'fr'); assert.equal(q.get('foil'), 'false'); assert.equal(reqs[0].auth, 'Bearer tok');
  const gaps = reqs.slice(1).map((x, i) => x.t - reqs[i].t); const span = reqs.at(-1).t - reqs[0].t;
  console.log('cadence :', (39 / (span / 1000)).toFixed(2), 'req/s ; plus petit écart', Math.min(...gaps), 'ms');
  assert.ok(Math.min(...gaps) >= 0, 'ok'); assert.ok(39 / (span / 1000) <= 9.7, 'jamais plus de ~9,6 req/s vers CardTrader : ' + (39 / (span / 1000)));
  let burst = 0; for (let i = 0; i < reqs.length; i++) { let n = 1; while (i + n < reqs.length && reqs[i + n].t - reqs[i].t < 1000) n++; burst = Math.max(burst, n); } assert.ok(burst <= 10, 'jamais plus de 10 requêtes dans une fenêtre d\'1 s : ' + burst);
  console.log('✓ cadence ≤ 9,6 req/s (pic', burst, 'req / s), résultats allégés, blueprint vide conservé');

  // 2) rattachement : même recherche pendant / juste après → même tâche, aucune requête de plus
  const n0 = reqs.length; r = await post(B, { type: 'offers', lang: 'fr', foil: 'no', bps: bps.slice().reverse() }); assert.equal(r.o.attached, true); assert.equal(r.o.id, id, 'même signature (ordre indifférent) → même tâche');
  const again = await drain(B, id); assert.equal(again.items.length, 40); assert.equal(reqs.length, n0); console.log('✓ relance identique : rattachée à la tâche terminée, 0 requête');

  // 3) cache : autre tâche (langue différente = autre clé ; même clé mais « fresh » = tâche neuve)
  r = await post(B, { type: 'offers', lang: 'fr', foil: 'no', bps, fresh: true }); assert.equal(r.o.attached, false); const f = await drain(B, r.o.id);
  assert.equal(f.last.cached, 0); assert.equal(f.last.sent, 40); assert.equal(reqs.length, n0 + 40); console.log('✓ « actualiser » : tout est relu chez CardTrader');
  assert.ok(f.last.dataAge >= 0 && f.last.dataAge < 30, 'dataAge présent : ' + f.last.dataAge);
  r = await post(B, { type: 'offers', lang: 'fr', foil: 'no', bps }); assert.equal(r.o.attached, true); assert.equal(r.o.id, f.last.id, 'la relance se rattache à la tâche la plus RÉCENTE (la lecture fraîche), pas à la plus ancienne'); console.log('✓ rattachement à la tâche la plus récente');
  // sous le TTL : un sous-ensemble est servi par le cache
  const n1 = reqs.length; r = await post(B, { type: 'offers', lang: 'fr', foil: 'no', bps: bps.slice(0, 10) }); const c = await drain(B, r.o.id);
  assert.equal(c.last.cached, 10); assert.equal(c.last.sent, 0); assert.equal(reqs.length, n1); assert.ok(c.last.cacheAge >= 0); console.log('✓ cache : 10 / 10 servis sans requête amont');
  // autre langue : clés distinctes
  r = await post(B, { type: 'offers', lang: 'en', foil: 'no', bps: bps.slice(0, 5) }); const e = await drain(B, r.o.id); assert.equal(e.last.cached, 0); assert.equal(new URLSearchParams(reqs.at(-1).q).get('language'), 'en'); console.log('✓ cache par langue');

  // 3 ter) token d'un utilisateur : le cache partagé des offres n'est lu qu'une fois ce token accepté par CardTrader
  const ten = bps.slice(0, 10), n2 = reqs.length;
  r = await post(B, { type: 'offers', lang: 'fr', foil: 'no', bps: ten }, { 'x-ct-token': REFUSED }); assert.equal(r.o.attached, false);
  let u = await drain(B, r.o.id, { 'x-ct-token': REFUSED }); assert.equal(u.last.status, 'failed'); assert.equal(u.last.fatal, 401); assert.equal(u.last.cached, 0, 'token inventé : aucune offre du cache');
  assert.ok(reqs.slice(n2).every(x => x.auth === 'Bearer ' + REFUSED));
  const GOOD = 'jeton-valide-0123456789abc';
  r = await post(B, { type: 'offers', lang: 'fr', foil: 'no', bps: ten }, { 'x-ct-token': GOOD }); u = await drain(B, r.o.id, { 'x-ct-token': GOOD });
  assert.equal(u.last.status, 'done'); assert.ok(u.last.sent >= 1 && u.last.sent <= 4, 'relu chez CardTrader jusqu\'à la première réponse : ' + u.last.sent); assert.equal(u.last.cached, 10 - u.last.sent, 'puis le cache');
  console.log('✓ token d\'un utilisateur : cache des offres servi seulement après une réponse acceptée (' + u.last.sent + ' lues, ' + u.last.cached + ' du cache)');
}

// 3 bis) TTL : une instance à TTL court (offres 1,5 s, absences 3,5 s)
{
  const pT = await start({ OFFER_TTL_MS: '1500', OFFER_TTL_EMPTY_MS: '3500' }, 18833); procs.push(pT); const BT = 'http://127.0.0.1:18833'; const bps = bpsOf(1000, 10);
  r = await post(BT, { type: 'offers', lang: 'fr', foil: 'no', bps }); await drain(BT, r.o.id);
  await new Promise(x => setTimeout(x, 1700)); const n2 = reqs.length; r = await post(BT, { type: 'offers', lang: 'fr', foil: 'no', bps }); const t = await drain(BT, r.o.id);
  assert.equal(t.last.cached, 2, 'seules les 2 absences d\'offres (bp 1000 et 1005) restent en cache après 1,7 s : ' + t.last.cached); assert.equal(reqs.length - n2, 8); console.log('✓ TTL : offres expirées, absences conservées plus longtemps');
  await new Promise(x => setTimeout(x, 3600)); const n3 = reqs.length; r = await post(BT, { type: 'offers', lang: 'fr', foil: 'no', bps: [1000, 1005] }); const t2 = await drain(BT, r.o.id); assert.equal(t2.last.cached, 0); assert.equal(reqs.length - n3, 2); console.log('✓ TTL des absences : expirées à leur tour');
}

// 4) annulation : la boucle s'arrête, ce qui est déjà lu reste en cache
{
  mode = { delay: 40 }; reqs.length = 0; const bps = bpsOf(2000, 60);
  r = await post(B, { type: 'offers', lang: 'fr', foil: 'any', bps }); const id = r.o.id; await new Promise(x => setTimeout(x, 450));
  r = await J(B, '/api/jobs/' + id, { method: 'DELETE' }); assert.equal(r.o.status, 'cancelled'); const sent = reqs.length; await new Promise(x => setTimeout(x, 500));
  assert.ok(sent > 0 && sent < 60, 'annulée en cours de route : ' + sent); assert.ok(reqs.length <= sent + 4, 'plus de nouvelles requêtes après l\'annulation (requêtes déjà parties : ' + (reqs.length - sent) + ')');
  r = await J(B, '/api/jobs/' + id); assert.equal(r.o.status, 'cancelled'); const n = reqs.length;
  r = await post(B, { type: 'offers', lang: 'fr', foil: 'any', bps }); assert.equal(r.o.attached, false, 'une tâche annulée n\'est pas réutilisée'); const d = await drain(B, r.o.id);
  assert.ok(d.last.cached >= 1, 'les offres déjà lues avant l\'annulation sont reprises depuis le cache : ' + d.last.cached); assert.equal(d.items.length, 60); assert.ok(reqs.length - n < 60);
  console.log('✓ annulation : arrêt net, reprise depuis le cache (', d.last.cached, 'déjà lus )'); mode = {};
}

// 5) 429 CardTrader : pause, nouvel essai, aucune perte
{
  reqs.length = 0; mode = { bad: new Set([3003, 3010]) }; const bps = bpsOf(3000, 20);
  r = await post(B, { type: 'offers', lang: 'fr', foil: 'any', bps }); const d = await drain(B, r.o.id);
  assert.equal(d.items.length, 20); assert.equal(d.last.errors, 0, 'les 429 sont absorbés'); assert.ok(d.items.every(i => !i.error)); assert.equal(reqs.length, 22, '2 nouvelles tentatives'); console.log('✓ 429 : nouvelle tentative, résultat complet'); mode = {};
}

// 6) jeton CardTrader refusé → tâche en échec, signalée
{
  mode = { dead: 401 }; r = await post(B, { type: 'offers', lang: 'fr', foil: 'any', bps: bpsOf(4000, 10) }); const d = await drain(B, r.o.id);
  assert.equal(d.last.status, 'failed'); assert.equal(d.last.fatal, 401); console.log('✓ jeton refusé : échec signalé (fatal 401)'); mode = {};
  mode = { dead: 500 }; r = await post(B, { type: 'offers', lang: 'fr', foil: 'any', bps: bpsOf(4100, 3) }); const e = await drain(B, r.o.id, undefined, 60000);
  assert.equal(e.last.status, 'done'); assert.equal(e.last.errors, 3); assert.ok(e.items.every(i => i.error)); console.log('✓ erreur amont persistante : par blueprint, la tâche se termine'); mode = {};
}

// 7) validation, inconnu, méthodes
{
  for (const [bad, why] of [[{ type: 'x', bps: [1] }, 'type'], [{ type: 'offers', bps: [] }, 'liste vide'], [{ type: 'offers', bps: ['a'] }, 'non entier'], [{ type: 'offers', bps: [-3] }, 'négatif'], [{ type: 'offers', bps: [1], lang: 'fr; x' }, 'langue'],
    [{ type: 'offers', bps: [1], foil: 'maybe' }, 'foil'], [{ type: 'offers', bps: bpsOf(1, 3001) }, '> 3000']]) { r = await post(B, bad); assert.equal(r.s, 400, why); }
  r = await J(B, '/api/jobs', { method: 'POST', body: '{pas du json' }); assert.equal(r.s, 400);
  r = await J(B, '/api/jobs/' + 'a'.repeat(24)); assert.equal(r.s, 404); assert.equal(r.o.error, 'job_not_found');
  r = await J(B, '/api/jobs/..%2fexpansions'); assert.equal(r.s, 404); r = await J(B, '/api/jobs/zz'); assert.equal(r.s, 404);
  r = await J(B, '/api/jobs'); assert.equal(r.s, 405);
  console.log('✓ validation des paramètres, tâche inconnue, méthodes');
}

// 8) auth : sans clé 401 ; avec clé OK ; la cadence est partagée avec le relais direct
{
  const p2 = await start({ APP_KEY: 'k'.repeat(16) }, 18831); procs.push(p2); const B2 = 'http://127.0.0.1:18831';
  r = await post(B2, { type: 'offers', lang: 'fr', foil: 'any', bps: [1] }); assert.equal(r.s, 401); assert.equal(r.o.error, 'auth_required');
  r = await J(B2, '/api/jobs/' + 'a'.repeat(24)); assert.equal(r.s, 401);
  r = await post(B2, { type: 'offers', lang: 'fr', foil: 'any', bps: [1, 2] }, { 'x-app-key': 'k'.repeat(16) }); assert.equal(r.s, 202);
  const d = await drain(B2, r.o.id, { 'x-app-key': 'k'.repeat(16) }); assert.equal(d.items.length, 2); console.log('✓ auth : les tâches exigent la clé / le compte comme le reste de l\'API');
  reqs.length = 0; const t0 = Date.now();
  await Promise.all(Array.from({ length: 12 }, (_, i) => J(B2, `/api/marketplace/products?blueprint_id=${6000 + i}&language=fr`, {}, { 'x-app-key': 'k'.repeat(16) })));
  const span = Date.now() - t0; assert.ok(span >= 11 * 100, 'relais direct aussi cadencé (12 requêtes en ' + span + ' ms)'); console.log('✓ le relais direct de marketplace/products est cadencé (', span, 'ms pour 12 )');
}

// 8 bis) token d'un utilisateur : 2 recherches en cours au plus (les autres places restent libres)
{
  mode = { delay: 60 }; const h = { 'x-ct-token': 'jeton-occupe-0123456789abc' }, ids = [];
  for (let i = 0; i < 2; i++) { r = await post(B, { type: 'offers', lang: 'fr', foil: 'any', bps: bpsOf(20000 + i * 1000, 60) }, h); assert.equal(r.s, 202); ids.push(r.o.id); }
  r = await post(B, { type: 'offers', lang: 'fr', foil: 'any', bps: bpsOf(23000, 60) }, h); assert.equal(r.s, 429); assert.equal(r.o.error, 'busy'); assert.match(r.o.message, /ce token/);
  r = await post(B, { type: 'offers', lang: 'fr', foil: 'any', bps: bpsOf(20000, 60) }, h); assert.equal(r.s, 202); assert.equal(r.o.attached, true, 'même recherche : rattachée, pas comptée');
  r = await post(B, { type: 'offers', lang: 'fr', foil: 'any', bps: bpsOf(24000, 60) }); assert.equal(r.s, 202, 'token du serveur : place libre'); ids.push(r.o.id);
  r = await post(B, { type: 'offers', lang: 'fr', foil: 'any', bps: bpsOf(25000, 60) }, { 'x-ct-token': 'autre-jeton-0123456789abc' }); assert.equal(r.s, 202, 'autre utilisateur : place libre'); ids.push(r.o.id);
  for (const id of ids) assert.equal((await J(B, '/api/jobs/' + id, { method: 'DELETE' })).o.status, 'cancelled');
  r = await post(B, { type: 'offers', lang: 'fr', foil: 'any', bps: bpsOf(23000, 60) }, h); assert.equal(r.s, 202, 'annulées : de nouveau possible');
  await J(B, '/api/jobs/' + r.o.id, { method: 'DELETE' }); mode = {};
  console.log('✓ token d\'un utilisateur : 2 recherches en cours au plus ; token du serveur et autres utilisateurs non gênés');
}

// 8 ter) résultats gardés plafonnés (JOB_RESULTS_MB) : tâches terminées oubliées d'abord, puis la tâche en cours échoue (l'appli lit le reste elle-même)
{
  const pR = await start({ JOB_RESULTS_MB: '0.01' }, 18834); procs.push(pR); const BR = 'http://127.0.0.1:18834';
  r = await post(BR, { type: 'offers', lang: 'fr', foil: 'no', bps: bpsOf(100, 5) }); const small = r.o.id; let d = await drain(BR, small); assert.equal(d.last.status, 'done');
  r = await post(BR, { type: 'offers', lang: 'fr', foil: 'no', bps: bpsOf(200, 40) }); const big = r.o.id; d = await drain(BR, big);
  assert.equal(d.last.status, 'failed'); assert.equal(d.last.fatal, null); assert.ok(d.last.count > 3 && d.last.count < 40, 'arrêtée en route : ' + d.last.count);
  assert.equal((await J(BR, '/api/jobs/' + small)).s, 404, 'la tâche terminée a été oubliée d\'abord');
  r = await post(BR, { type: 'offers', lang: 'fr', foil: 'no', bps: bpsOf(300, 3) }); d = await drain(BR, r.o.id); assert.equal(d.last.status, 'done'); assert.equal(d.items.length, 3);
  console.log('✓ résultats des tâches plafonnés : tâche terminée oubliée, puis tâche trop grosse en échec ; le serveur continue');
}

// 8 quater) le token brut d'un utilisateur ne reste pas en mémoire (cadence, tâches) : instantané du tas après usage
{
  const { mkdtempSync, readdirSync, readFileSync, statSync, rmSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'heap-')), T1 = 'jeton-memoire-' + Math.random().toString(36).slice(2) + 'abcdef', T2 = 'jeton-encours-' + Math.random().toString(36).slice(2) + 'abcdef';
  const pH = await start({ JOB_KEEP_MS: '600000' }, 18835, ['--heapsnapshot-signal=SIGUSR2', '--diagnostic-dir=' + dir]); procs.push(pH); const BH = 'http://127.0.0.1:18835';
  const snap = async () => {
    const before = new Set(readdirSync(dir)); pH.kill('SIGUSR2'); let f = '';
    for (let i = 0; i < 200 && !f; i++) { await sleep(100); f = readdirSync(dir).find(x => !before.has(x) && x.endsWith('.heapsnapshot')) || ''; }
    assert.ok(f, 'instantané écrit'); let size = -1;
    for (let i = 0; i < 100; i++) { const z = statSync(join(dir, f)).size; if (z > 0 && z === size) break; size = z; await sleep(150); }
    return readFileSync(join(dir, f), 'utf8');
  };
  r = await J(BH, '/api/marketplace/products?blueprint_id=7001&language=fr', {}, { 'x-ct-token': T1 }); assert.equal(r.s, 200);
  r = await post(BH, { type: 'offers', lang: 'fr', foil: 'no', bps: bpsOf(7100, 6) }, { 'x-ct-token': T1 }); const d = await drain(BH, r.o.id, { 'x-ct-token': T1 }); assert.equal(d.last.status, 'done');
  mode = { delay: 400 }; r = await post(BH, { type: 'offers', lang: 'fr', foil: 'no', bps: bpsOf(7200, 40) }, { 'x-ct-token': T2 }); const run = r.o.id; await sleep(300);
  let heap = await snap(); assert.ok(heap.includes(T2), 'contrôle : le token d\'une recherche en cours est bien visible dans l\'instantané');
  await J(BH, '/api/jobs/' + run, { method: 'DELETE' }, { 'x-ct-token': T2 }); await sleep(900); mode = {};
  for (let i = 0; i < 3; i++) { await J(BH, '/__ping'); await J(BH, '/api/jobs/' + run); }
  heap = await snap(); assert.ok(!heap.includes(T1), 'token d\'une recherche terminée : effacé'); assert.ok(!heap.includes(T2), 'token d\'une recherche annulée : effacé');
  rmSync(dir, { recursive: true, force: true });
  console.log('✓ tokens des utilisateurs : absents de la mémoire après la recherche (cadence par empreinte, tâche terminée ou annulée)');
}

// 9) désactivation
{
  const p3 = await start({ JOBS: '0' }, 18832); procs.push(p3); const B3 = 'http://127.0.0.1:18832';
  r = await J(B3, '/__ping'); assert.equal(r.o.jobs, false); r = await post(B3, { type: 'offers', lang: 'fr', foil: 'any', bps: [1] }); assert.equal(r.s, 404); assert.equal(r.o.error, 'jobs_disabled');
  r = await J(B3, '/api/marketplace/products?blueprint_id=1'); assert.equal(r.s, 200); console.log('✓ JOBS=0 : tâches désactivées, relais direct intact');
}
console.log('\nJOBS OK'); process.exit(0);
