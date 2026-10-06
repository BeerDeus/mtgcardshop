/* ── edhbin.js : format binaire des decks (EDH2), partagé par le générateur (Node) et l'appli ─────────────────────
   Pourquoi : 10 000 decks en texte pèsent ~25 Mo et se lisent en plusieurs secondes sur un téléphone. Ici chaque carte est un numéro (Uint16) dans un
   dictionnaire, chaque deck une tranche d'un grand tableau : ~2 Mo compressé pour 10 000 decks, lu en quelques millisecondes, sans créer d'objet par carte.
   Fichier (petit-boutiste, sections alignées sur 4 octets) :
     'EDH2' · u32 longueur de l'en-tête · en-tête JSON { v, at, nc, nd, nn, ne, ng, sl:[octets cmds, decks, noms], tl?:[[slug, libellé]] (thèmes EDHREC, facultatif) }
     JSON des commandants  [[slug, decks, identité, [noms], chemin d'image, thèmes?]]     thèmes : [[indice dans tl, nombre de decks EDHREC]] (absent = aucun ; un ancien lecteur ignore ce 6e champ)
     JSON des decks        [[indice du commandant, source, libellé, lien]]   lien : '' aucun · 0 deck moyen EDHREC · n archidekt.com/decks/n · sinon texte
     noms des cartes       un par ligne (indice = numéro de la carte)
     u32 × (nd + 1)        début de chaque deck dans la liste des entrées
     u16 × ne              numéro de carte de chaque entrée        (ne = total des cartes de tous les decks, terrains de base compris)
     u8 × ne               quantité de chaque entrée
     u32 × nn              prix Cardmarket en centimes par numéro de carte (0 = inconnu)
     u16 × ng              numéros des cartes de la liste Game Changers
   Un deck ne contient ni doublon (la 1re ligne gagne) ni son propre commandant (compté à part). */
const EDHB_MAX_CARDS = 65535;
const edhPad4 = n => (n + 3) & ~3;

/** model : { v, at, cmds:[{ slug, decks, ci, names, img, themes?:[[slug, libellé, nombre]] }], decks:[{ slug, src, label, url, cards:[[nom, qté]] }], price:[[nom, centimes]] | Map, gc:[nom] } ; keyOf : nom → clé (la même que ownKey de l'appli). Retourne un Uint8Array. */
function edhPack(model, keyOf) {
  const clean = n => String(n == null ? '' : n).replace(/[\r\n\t]+/g, ' ').trim();
  const kc = new Map(), kf = keyOf; keyOf = n => { let k = kc.get(n); if (k === undefined) { k = kf(n); kc.set(n, k); } return k; };      // les mêmes noms reviennent dans des centaines de decks
  const idOf = new Map(), names = [];
  const add = raw => {
    const n = clean(raw), k = keyOf(n); let id = idOf.get(k);
    if (id === undefined) { id = names.length; if (id >= EDHB_MAX_CARDS) throw new Error('trop de cartes distinctes (' + id + ')'); idOf.set(k, id); names.push(n); }
    else if (!names[id].includes('//') && n.includes('//')) names[id] = n;      // le nom complet d'une carte à deux faces vaut mieux que sa première face seule
    return id;
  };
  const slugIx = new Map(), cmds = [], cmdKeys = [], thIx = new Map(), tl = [];
  const themeOf = ([slug, label, n]) => {      // thème → [indice dans le dictionnaire, nombre de decks] ; null si invalide
    const s = clean(slug).replace(/\s+/g, '-'), c = Math.round(Number(n) || 0); if (!s || c <= 0) return null;
    let i = thIx.get(s); if (i === undefined) { i = tl.length; thIx.set(s, i); tl.push([s, clean(label).slice(0, 40) || s]); }
    return [i, c];
  };
  for (const c of model.cmds || []) {
    if (slugIx.has(c.slug)) continue; slugIx.set(c.slug, cmds.length); for (const n of c.names) add(n);
    const th = (c.themes || []).map(themeOf).filter(Boolean), row = [c.slug, Math.max(0, Math.round(Number(c.decks) || 0)), c.ci || '', c.names.map(clean), c.img || '']; if (th.length) row.push(th);
    cmds.push(row); cmdKeys.push(c.names.map(n => keyOf(clean(n))));
  }
  const meta = [], off = [0], ids = [], qty = [];
  for (const d of model.decks || []) {
    const ci = slugIx.get(d.slug); if (ci === undefined) continue;
    const seen = new Set(cmdKeys[ci]);
    for (const [n, q] of d.cards || []) {
      const k = keyOf(clean(n)); if (!k || seen.has(k)) continue; seen.add(k);
      ids.push(add(n)); qty.push(Math.max(1, Math.min(99, Math.round(Number(q) || 1))));
    }
    off.push(ids.length);
    const url = d.url || '', m = /^https:\/\/archidekt\.com\/decks\/(\d+)$/.exec(url);
    meta.push([ci, d.src || 'edhrec', d.label || '', !url ? '' : (d.src || 'edhrec') === 'edhrec' && url === 'https://edhrec.com/average-decks/' + d.slug ? 0 : m ? Number(m[1]) : url]);
  }
  const pr = new Uint32Array(names.length);
  for (const [n, v] of model.price instanceof Map ? model.price : model.price || []) { const id = idOf.get(keyOf(clean(n))); if (id !== undefined && v > 0) pr[id] = Math.round(v); }
  const gcIds = []; for (const n of model.gc || []) { const k = keyOf(clean(n)); if (k) gcIds.push(add(n)); }
  const enc = new TextEncoder(), cm = enc.encode(JSON.stringify(cmds)), dk = enc.encode(JSON.stringify(meta)), nm = enc.encode(names.join('\n'));
  const head = enc.encode(JSON.stringify({ v: model.v || 0, at: model.at || '', nc: cmds.length, nd: meta.length, nn: names.length, ne: ids.length, ng: gcIds.length, sl: [cm.length, dk.length, nm.length], ...(tl.length ? { tl } : {}) }));
  const hp = edhPad4(8 + head.length), cp = edhPad4(cm.length), dp = edhPad4(dk.length), np = edhPad4(nm.length);
  const total = hp + cp + dp + np + 4 * off.length + edhPad4(2 * ids.length) + edhPad4(ids.length) + 4 * names.length + edhPad4(2 * gcIds.length);
  const buf = new Uint8Array(total), dv = new DataView(buf.buffer);
  buf.set([0x45, 0x44, 0x48, 0x32], 0); dv.setUint32(4, head.length, true); buf.set(head, 8);
  let p = hp; buf.set(cm, p); p += cp; buf.set(dk, p); p += dp; buf.set(nm, p); p += np;
  new Uint32Array(buf.buffer, p, off.length).set(off); p += 4 * off.length;
  new Uint16Array(buf.buffer, p, ids.length).set(ids); p += edhPad4(2 * ids.length);
  new Uint8Array(buf.buffer, p, qty.length).set(qty); p += edhPad4(ids.length);
  new Uint32Array(buf.buffer, p, names.length).set(pr); p += 4 * names.length;
  new Uint16Array(buf.buffer, p, gcIds.length).set(gcIds);
  return buf;
}

/** Lit un fichier EDH2 (ArrayBuffer ou Uint8Array). Retourne { v, at, themes:[[slug, libellé]], cmds:[{ slug, decks, ci, names, img, th:[[indice, nombre]] }], dk:[[indice commandant, source, libellé, lien]], names, off, ids, qty, pr, gc } — les tableaux typés sont des vues, rien n'est copié. Lève une erreur si le fichier est tronqué ou n'est pas un EDH2. */
function edhUnpack(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  const buf = u8.byteOffset % 4 ? u8.slice().buffer : u8.buffer, base = u8.byteOffset % 4 ? 0 : u8.byteOffset, len = u8.byteLength;
  if (len < 12 || u8[0] !== 0x45 || u8[1] !== 0x44 || u8[2] !== 0x48 || u8[3] !== 0x32) throw new Error('format');
  const dv = new DataView(buf, base, len), hl = dv.getUint32(4, true);
  if (8 + hl > len) throw new Error('tronqué');
  const dec = new TextDecoder(), head = JSON.parse(dec.decode(new Uint8Array(buf, base + 8, hl)));
  const [lc, ld, ln] = head.sl, nd = head.nd, nn = head.nn, ne = head.ne, ng = head.ng;
  const need = edhPad4(8 + hl) + edhPad4(lc) + edhPad4(ld) + edhPad4(ln) + 4 * (nd + 1) + edhPad4(2 * ne) + edhPad4(ne) + 4 * nn + edhPad4(2 * ng);
  if (need !== len) throw new Error('tronqué');
  let p = edhPad4(8 + hl);
  const text = n => { const s = dec.decode(new Uint8Array(buf, base + p, n)); p += edhPad4(n); return s; };
  const cmds = JSON.parse(text(lc)).map(([slug, decks, ci, names, img, th]) => ({ slug, decks, ci, names, img, th: Array.isArray(th) ? th : [] })), dk = JSON.parse(text(ld)), nmText = text(ln), names = nn ? nmText.split('\n') : [];
  if (names.length !== nn) throw new Error('noms');
  const off = new Uint32Array(buf, base + p, nd + 1); p += 4 * (nd + 1);
  const ids = new Uint16Array(buf, base + p, ne); p += edhPad4(2 * ne);
  const qty = new Uint8Array(buf, base + p, ne); p += edhPad4(ne);
  const pr = new Uint32Array(buf, base + p, nn); p += 4 * nn;
  const gc = new Uint16Array(buf, base + p, ng);
  if (off[nd] !== ne || dk.length !== nd) throw new Error('decks');
  return { v: head.v, at: head.at, themes: Array.isArray(head.tl) ? head.tl : [], cmds, dk, names, off, ids, qty, pr, gc };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { edhPack, edhUnpack, EDHB_MAX_CARDS };
