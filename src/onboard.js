/* ── onboard.js : premier lancement ───────────────────────────────────────────────────────────────
   Trois écrans, une seule fois, seulement sur un appareil vierge (ni collection, ni deck, ni token) :
   1. Bienvenue · 2. Ta collection (importer un fichier, scanner, plus tard) · 3. Les prix (Cardmarket par défaut, token CardTrader facultatif, compte).
   Passé, terminé ou abandonné : on ne le revoit plus (deckdeal:onboard). Les navigateurs pilotés par les tests ne le voient pas, sauf avec ?onboarding. */
const OB_KEY = 'deckdeal:onboard';
const OB_FORCE = typeof location !== 'undefined' && /[?&]onboarding\b/.test(location.search);
const OB = { el: null, i: 0 };

function obSeen() { try { return !!localStorage.getItem(OB_KEY); } catch (e) { return true; } }
function obMark() { try { localStorage.setItem(OB_KEY, String(Date.now())); } catch (e) { /* ignore */ } }
function obMaybe() {
  if (OB.el || obSeen()) return;
  const fresh = !collCount() && !allDecks().length && !S.token;
  if (!fresh) { obMark(); return; }                                                    // déjà utilisée sur cet appareil : jamais d'accueil
  if (typeof navigator !== 'undefined' && navigator.webdriver && !OB_FORCE) return;     // tests automatisés : l'accueil masquerait l'appli
  obOpen();
}
function obOpen() {
  const el = OB.el = document.createElement('div');
  el.className = 'ob'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', T('Bienvenue dans Mana Orbit'));
  el.innerHTML = `<div class="ob-aura" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <button class="link-btn ob-skip" type="button" data-ob="skip">${T('Passer')}</button>
    <div class="ob-track">
      <section class="ob-s" aria-label="${T('Bienvenue')}">
        <div class="ob-lang" role="group" aria-label="${T('Langue')}">${Object.entries(I18N_LANGS).map(([c, n]) => `<button type="button" class="ob-chip${c === I18N.lang ? ' on' : ''}" data-ob="lang:${c}" aria-pressed="${c === I18N.lang}">${esc(n)}</button>`).join('')}</div>
        <div class="ob-logo"><svg class="logo" aria-hidden="true"><use href="#i-logo"/></svg></div>
        <h1>${T('Bienvenue dans {app}', { app: '<span class="foil-t">Mana Orbit</span>' })}</h1>
        <p>${T('Ta collection Magic et sa valeur au jour le jour, tes decks, et les meilleurs prix pour les compléter.')}</p>
        <ul class="ob-pts"><li><b>${T('Collection')}</b><span>${T('Importe, scanne, suis ce qu\'elle vaut.')}</span></li><li><b>${T('Decks')}</b><span>${T('Les decks EDHREC dont tu as déjà le plus de cartes.')}</span></li><li><b>${T('Prix')}</b><span>${T('Cardmarket chaque jour, CardTrader pour remplir ton panier.')}</span></li></ul>
        <button class="btn block" type="button" data-ob="next">${T('Commencer')}</button>
      </section>
      <section class="ob-s" aria-label="${T('Ta collection')}">
        <h2>${T('Ajoute ta collection')}</h2>
        <p>${T('Tu l\'as déjà dans une autre appli ? Exporte-la en CSV et importe le fichier : c\'est le plus rapide.')}</p>
        <div class="ob-opts">
          <button class="ob-opt" type="button" data-ob="import"><svg class="i"><use href="#i-upload"/></svg><b>${T('Importer un fichier')}</b><span>${T('CSV de ManaBox, Moxfield, Dragon Shield, Archidekt, Deckbox… ou une liste « 3 Sol Ring ».')}</span></button>
          <button class="ob-opt" type="button" data-ob="scan"><svg class="i"><use href="#i-camera"/></svg><b>${T('Scanner mes cartes')}</b><span>${T('L\'appareil photo lit le nom de la carte, en français ou en anglais.')}</span></button>
        </div>
        <button class="btn ghost block" type="button" data-ob="next">${T('Plus tard')}</button>
      </section>
      <section class="ob-s" aria-label="${T('Les prix')}">
        <h2>${T('Les prix')}</h2>
        <p>${T('Par défaut, Mana Orbit donne le <b>prix tendance Cardmarket</b> de chaque carte, mis à jour chaque jour.')}</p>
        <div class="field-in"><label class="label" for="obToken">${T('Tu achètes sur CardTrader ? (facultatif)')}</label><input type="password" id="obToken" autocomplete="off" spellcheck="false" placeholder="${T('Ton token API CardTrader')}">
          <span class="hint">${T('Avec ton token (cardtrader.com › Paramètres › API) : offres réelles des vendeurs, port optimisé, panier rempli pour toi. Modifiable plus tard dans les réglages.')}</span></div>
        <div class="ob-acts"><button class="btn block" type="button" data-ob="done">${T('C\'est parti')}</button>
          <button class="link-btn link-inline" type="button" data-ob="account">${T('Créer un compte pour sauvegarder ma collection')}</button></div>
      </section>
    </div>
    <div class="ob-dots" aria-hidden="true"><i></i><i></i><i></i></div>`;
  document.body.appendChild(el);
  OB.i = 0; obGo(0);
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-ob]'); if (!b) return;
    const a = b.dataset.ob; haptic('tap');
    if (a.startsWith('lang:')) { const c = a.slice(5); if (c !== I18N.lang) { try { localStorage.setItem('deckdeal:lang', c); } catch (x) { /* ignore */ } location.reload(); } return; }
    if (a === 'next') obGo(OB.i + 1);
    else if (a === 'skip') obClose();
    else if (a === 'import') obClose(() => openCollImport());
    else if (a === 'scan') obClose(() => openScan());
    else if (a === 'done') obClose();
    else if (a === 'account') obClose(() => openAccount());
  });
  const tok = $('#obToken', el);
  tok.oninput = () => { S.token = tok.value.trim(); if (S.token) S.src = 'auto'; syncCTX(); saveStore(); modeLabel(); };
  // glisser d'un écran à l'autre
  let x0 = null;
  el.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  el.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 60) obGo(OB.i + (dx < 0 ? 1 : -1)); }, { passive: true });
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
}
function obGo(i) {
  const el = OB.el; if (!el) return;
  OB.i = Math.max(0, Math.min(2, i));
  $('.ob-track', el).style.transform = `translateX(${-OB.i * 100}%)`;
  $$('.ob-dots i', el).forEach((d, k) => d.classList.toggle('on', k === OB.i));
  $$('.ob-s', el).forEach((s, k) => { s.inert = k !== OB.i; s.setAttribute('aria-hidden', String(k !== OB.i)); });
  $('.ob-skip', el).hidden = OB.i === 2;
}
/** Retour du téléphone : écran précédent, ou fermeture depuis le premier. */
function obBack() { if (OB.i > 0) obGo(OB.i - 1); else obClose(); }
function obClose(then) {
  const el = OB.el; if (!el) return; OB.el = null; obMark();
  el.classList.remove('on'); setTimeout(() => el.remove(), reduceMotion() ? 0 : 380);
  homeSoon(0);
  if (then) setTimeout(then, reduceMotion() ? 0 : 260);
}
