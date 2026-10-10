// Assemble src/* → deck-deal.html (document autonome, servi par proxy.mjs et versionné : l'hébergeur ne lance aucun build)
//                + dist/deck-deal.artifact.html (fragment publiable, non versionné)
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const rd = f => readFileSync(join(root, 'src', f), 'utf8');

writeFileSync(join(root, 'edhbin.cjs'), rd('edhbin.js'));      // copie pour le générateur (gen-edhrec.mjs), déployée avec lui
// Feuille principale + feuilles par fonction (src/css/*.css, ordre alphabétique) : une seule <style>.
const CSS_DIR = join(root, 'src', 'css');
const css = [rd('style.css'), ...(existsSync(CSS_DIR) ? readdirSync(CSS_DIR).filter(f => f.endsWith('.css')).sort().map(f => readFileSync(join(CSS_DIR, f), 'utf8')) : [])].join('\n').trim();
// Écran de lancement : son script part juste après #splash, avant le gros script (premier rendu : thème, mode, chorégraphie déjà lancée).
const splashJs = rd('splash.js').replace(/<\/script/gi, '<\\/script').trim();
const body = rd('body.html').trim().replace('<!--splash.js-->', () => `<script>\n${splashJs}\n</script>`);
// Dictionnaires des langues (src/i18n/<code>.json : { « texte français » : « traduction » }) : un bloc JSON inerte par langue, placé avant le code.
const I18N_DIR = join(root, 'src', 'i18n');
// Une langue peut être répartie en plusieurs fichiers (en.json, en.app.json…) : ils sont fusionnés.
const i18nAll = {};
// en.app.json, en.coll.json… d'abord, puis en.json : il tranche quand deux parties traduisent le même texte différemment.
for (const f of (existsSync(I18N_DIR) ? readdirSync(I18N_DIR) : []).sort((a, b) => (a.split('.').length === 2) - (b.split('.').length === 2) || (a < b ? -1 : 1))) {
  const m = /^([a-z]{2}(?:-[A-Z]{2})?)(?:\.[a-z0-9-]+)?\.json$/.exec(f); if (!m) continue;
  Object.assign(i18nAll[m[1]] = i18nAll[m[1]] || {}, JSON.parse(readFileSync(join(I18N_DIR, f), 'utf8')));
}
const js = ['core.js', 'edhbin.js', 'cloud.js', 'data.js', 'tasks.js', 'app.js', 'motion.js', 'filters.js', 'decks.js', 'dklist.js', 'viewer.js', 'zoom.js', 'collection.js', 'edh.js', 'value.js', 'extras.js', 'alerts.js', 'scan.js', 'builder.js', 'share.js', 'home.js', 'onboard.js', 'native.js', 'ads.js', 'widget.js', 'qr.js', 'sets.js', 'setview.js', 'help.js', 'back.js', 'pwa.js', 'push.js', 'main.js'].map(rd).join('\n\n').replace(/<\/script/gi, '<\\/script').trim();

// <script type="application/json" id="i18n-en"> : jamais compilé ; core.js n'analyse que celui de la langue choisie (le français n'en lit aucun).
// « < » échappé (\u003c, relu tel quel par JSON.parse) : une traduction ne peut pas fermer la balise.
const i18nTags = Object.keys(i18nAll).sort().map(c => `<script type="application/json" id="i18n-${c}">${JSON.stringify(i18nAll[c]).replace(/</g, '\\u003c')}</script>`).join('\n');

// Version affichée dans Réglages (quel code le téléphone exécute) ; pwa/sw.js lit la ligne « const DD_BUILD = '…' » de la page
// pour ne garder qu'une vraie page de l'app et proposer « Recharger » quand elle change : ne pas en modifier la forme.
const BUILD = createHash('sha1').update(css + body + i18nTags + js).digest('hex').slice(0, 8);
const TITLE = 'Mana Orbit';
const FONTS = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Instrument+Sans:wght@400..700&family=JetBrains+Mono:wght@400..600&display=swap';
// Scryfall : connexions ouvertes pendant que la page se charge (API en fetch CORS, images relues en CORS anonyme par le service worker).
const SCRY = '<link rel="preconnect" href="https://api.scryfall.com" crossorigin>\n<link rel="preconnect" href="https://cards.scryfall.io" crossorigin>';
const DESC = 'Ta collection Magic, tes decks et les meilleurs prix : valeur de tes cartes, decks EDHREC à monter, panier CardTrader le moins cher.';

const fragment = `<title>${TITLE}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
${SCRY}
<style>
${css}
</style>
${body}
${i18nTags}
<script>
const DD_BUILD = '${BUILD}';
${js}
</script>
`;

const doc = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="description" content="${DESC}">
<meta name="theme-color" content="#f1f3f8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0d1020" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/svg+xml" href="icons/icon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${TITLE}">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<title>${TITLE}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
${SCRY}
<style>
html{padding-top:env(safe-area-inset-top,0px)}
[hidden]{display:none!important}
img{max-width:100%}
${css}
</style>
</head>
<body>
${body}
${i18nTags}
<script>
const DD_BUILD = '${BUILD}';
${js}
</script>
</body>
</html>
`;

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'deck-deal.html'), doc);
writeFileSync(join(root, 'dist', 'deck-deal.artifact.html'), fragment);
console.log('deck-deal.html', (doc.length / 1024).toFixed(1) + ' KB');
console.log('dist/deck-deal.artifact.html', (fragment.length / 1024).toFixed(1) + ' KB');
