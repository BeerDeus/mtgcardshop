// Assemble src/* → deck-deal.html (document autonome, servi par proxy.mjs et versionné : l'hébergeur ne lance aucun build)
//                + dist/deck-deal.artifact.html (fragment publiable, non versionné)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const rd = f => readFileSync(join(root, 'src', f), 'utf8');

writeFileSync(join(root, 'edhbin.cjs'), rd('edhbin.js'));      // copie pour le générateur (gen-edhrec.mjs), déployée avec lui
const css = rd('style.css').trim();
const body = rd('body.html').trim();
const js = ['core.js', 'edhbin.js', 'cloud.js', 'data.js', 'tasks.js', 'app.js', 'filters.js', 'decks.js', 'dklist.js', 'viewer.js', 'collection.js', 'edh.js', 'value.js', 'extras.js', 'alerts.js', 'scan.js', 'builder.js', 'share.js', 'back.js', 'pwa.js', 'push.js', 'main.js'].map(rd).join('\n\n').replace(/<\/script/gi, '<\\/script').trim();

const TITLE = 'Deck Deal';
const FONTS = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Instrument+Sans:wght@400..700&family=JetBrains+Mono:wght@400..600&display=swap';
const DESC = 'Colle une decklist Magic : Deck Deal trouve les offres CardTrader en français, le meilleur prix et remplit le panier.';

const fragment = `<title>${TITLE}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>
${css}
</style>
${body}
<script>
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
<style>
html{padding-top:env(safe-area-inset-top,0px)}
[hidden]{display:none!important}
img{max-width:100%}
${css}
</style>
</head>
<body>
${body}
<script>
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
