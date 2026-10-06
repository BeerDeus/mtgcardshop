/* ── tasks.js : pastilles de progression flottantes (haut à droite) ─────────────────────────────
   Elles survivent à la fermeture des fenêtres : une tâche lancée depuis une feuille continue,
   et son avancement reste visible. Une tâche « cachée » (feuille d'origine encore ouverte, ou
   barre de progression déjà à l'écran) ne s'affiche pas et ne clignote pas à la fin. */
const Tasks = (() => {
  const R = 9.5, CIRC = 2 * Math.PI * R;
  const host = () => (typeof document !== 'undefined' ? document.getElementById('tasks') : null);
  const NOOP = { set() {}, show() {}, finish() {}, remove() {}, label() {}, isShown: () => false, done: true };

  /** label : titre ; o : {total, sub, hidden}. Retourne une poignée {set, show, finish, remove, label, isShown}. */
  function start(label, o = {}) {
    const h = host(); if (!h) return NOOP;
    const el = document.createElement('div');
    el.className = 'task' + (o.hidden ? ' hide' : '') + (o.total ? '' : ' indet'); el.setAttribute('role', 'status');
    el.innerHTML = `<span class="task-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><circle class="trk" cx="12" cy="12" r="${R}"/><circle class="arc" cx="12" cy="12" r="${R}" stroke-dasharray="${CIRC.toFixed(2)}" stroke-dashoffset="${(CIRC * 0.72).toFixed(2)}"/><path class="chk" d="M7.4 12.6l3 3 6.2-6.4"/><path class="bang" d="M12 7.2v5.6M12 16.3v.1"/></svg></span>
      <span class="task-txt"><span class="task-t"></span><span class="task-s"></span></span>
      <button class="task-x" type="button" aria-label="Fermer" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg></button>
      <span class="task-bar"><i></i></span>`;
    const t = el.querySelector('.task-t'), s = el.querySelector('.task-s'), arc = el.querySelector('.arc'), bar = el.querySelector('.task-bar i'), x = el.querySelector('.task-x');
    t.textContent = label; s.textContent = o.sub || '';
    h.appendChild(el);
    let timer = 0, gone = false;
    const reveal = () => { void el.offsetWidth; requestAnimationFrame(() => el.classList.add('in')); };
    const api = {
      done: false,
      set(done, total, sub) {
        if (gone || api.done) return;
        const f = total > 0 ? Math.max(0, Math.min(1, done / total)) : null;
        el.classList.toggle('indet', f === null);
        if (f !== null) { arc.style.strokeDashoffset = (CIRC * (1 - f)).toFixed(2); bar.style.width = (f * 100).toFixed(1) + '%'; }
        s.textContent = sub != null ? sub : (total > 0 ? `${done} / ${total}` : '');
      },
      label(text) { t.textContent = text; },
      isShown: () => !gone && !el.classList.contains('hide'),
      show(flag) {
        if (gone) return;
        if (flag && el.classList.contains('hide')) { el.classList.remove('hide'); reveal(); }
        else if (!flag && !el.classList.contains('hide')) { el.classList.remove('in'); el.classList.add('hide'); }
      },
      /** kind : 'ok' | 'warn' | 'bad'. Si la tâche est cachée, l'interface d'origine montre déjà le résultat : on retire sans bruit. */
      finish(msg, kind = 'ok', detail = '') {
        if (gone || api.done) return;
        api.done = true;
        if (el.classList.contains('hide')) return api.remove();
        el.classList.remove('indet'); el.classList.add(kind); t.textContent = msg; s.textContent = detail; x.hidden = false;
        el.onclick = api.remove; clearTimeout(timer); timer = setTimeout(api.remove, kind === 'ok' ? 4500 : 9000);
      },
      remove() {
        if (gone) return; gone = true; clearTimeout(timer); api.done = true;
        el.classList.remove('in'); setTimeout(() => el.remove(), 320);
      },
    };
    if (!o.hidden) { el.classList.add('hide'); api.show(true); }
    return api;
  }

  /** Sous une feuille ouverte, la pile passe tout en haut pour ne pas masquer son bouton de fermeture. */
  function layout() {
    const h = host(); if (h) h.classList.toggle('over', typeof sheets !== 'undefined' && sheets.length > 0);
  }
  return { start, layout };
})();
