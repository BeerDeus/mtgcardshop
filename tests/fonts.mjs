// Polices de l'appli (Bricolage Grotesque, Instrument Sans) servies aux tests depuis tools/fonts au lieu de Google Fonts :
// même mise en page partout (CI GitHub ou poste local), quelles que soient les polices installées sur la machine.
// JetBrains Mono (zones de texte brut seulement) garde la police monospace du système.
import { readFileSync } from 'node:fs';

const dir = new URL('../tools/fonts/', import.meta.url);
const FILES = { 'bricolage.woff2': readFileSync(new URL('bricolage-grotesque-latin-opsz-normal.woff2', dir)), 'instrument.woff2': readFileSync(new URL('instrument-sans-latin-wght-normal.woff2', dir)) };
const CSS = `@font-face{font-family:'Bricolage Grotesque';font-style:normal;font-weight:200 800;font-display:block;src:url(https://fonts.gstatic.com/t/bricolage.woff2) format('woff2')}
@font-face{font-family:'Instrument Sans';font-style:normal;font-weight:400 700;font-display:block;src:url(https://fonts.gstatic.com/t/instrument.woff2) format('woff2')}`;
const CORS = { 'access-control-allow-origin': '*' };

/** Branche les polices locales sur une page ou un contexte Playwright (remplace l'ancien blocage de Google Fonts). */
export async function routeFonts(target) {
  await target.route(/fonts\.googleapis\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', headers: CORS, body: CSS }));
  await target.route(/fonts\.gstatic\.com/, r => { const f = FILES[new URL(r.request().url()).pathname.split('/').pop()]; return f ? r.fulfill({ status: 200, contentType: 'font/woff2', headers: CORS, body: f }) : r.abort(); });
}
