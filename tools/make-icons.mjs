// Génère pwa/icons/* depuis un seul dessin (carte foil et orbite des cinq couleurs). Rendu par Chromium (Playwright). node make-icons.mjs
import { writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

/** Dessin 512×512 (logo « carte et orbite » : une carte foil, une orbite et les cinq billes de mana W U B R G (blanc au centre, devant la carte), trois devant la carte, deux derrière).
 *  bleed:false → carré arrondi à coins transparents (icône « any ») ; true → plein cadre (maskable / Apple : dessin réduit dans la zone sûre). */
const LOGO = `
    <g transform="rotate(-20 50 52)"><path d="M12 52A38 13 0 0 1 88 52" fill="none" stroke="#9aa3b8" stroke-width="2.4" stroke-linecap="round"/><circle cx="27.7" cy="41.5" r="3.4" fill="#ff7a5c" fill-opacity=".85"/><circle cx="72.3" cy="41.5" r="3.4" fill="#6fd08c" fill-opacity=".85"/></g>
    <g transform="rotate(-11 51 50)"><rect x="37" y="27" width="28" height="41" rx="5" fill="url(#foil)"/><rect x="39.6" y="29.6" width="22.8" height="35.8" rx="3.2" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1.1"/></g>
    <g transform="rotate(-20 50 52)"><path d="M12 52A38 13 0 0 0 88 52" fill="none" stroke="#9aa3b8" stroke-width="2.4" stroke-linecap="round"/><circle cx="86.1" cy="56" r="4.3" fill="#7fb0ff"/><circle cx="50" cy="65" r="4.3" fill="#f8f6d8"/><circle cx="13.9" cy="56" r="4.3" fill="#b5a3c8"/></g>`;
/** bg : fond (dégradé) · logo : dessin · k : échelle du dessin (100 unités → 512 px × k / 5.12). */
const art = ({ bleed, bg = true, logo = true, k }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx=".3" cy=".25" r="1"><stop offset="0" stop-color="#232b5c"/><stop offset=".7" stop-color="#0b0f1c"/></radialGradient>
    <linearGradient id="foil" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8fc3"/><stop offset=".26" stop-color="#ffd479"/><stop offset=".5" stop-color="#7be8c8"/><stop offset=".74" stop-color="#7fb0ff"/><stop offset="1" stop-color="#c79bff"/></linearGradient>
  </defs>
  ${bg ? `<rect width="512" height="512" ${bleed ? '' : 'rx="118"'} fill="url(#bg)"/>` : ''}
  ${logo ? `<g transform="translate(256 256) scale(${k || (bleed ? 4.3 : 5.12)}) translate(-50 -50)">${LOGO}</g>` : ''}
</svg>`;

const OUT = new URL('../pwa/icons/', import.meta.url).pathname;
writeFileSync(OUT + 'icon.svg', art({ bleed: false }));

const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const page = await browser.newPage();
const png = async (name, size, bleed) => {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${art({ bleed })}`);
  await page.screenshot({ path: OUT + name, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log(name, size);
};
await png('icon-192.png', 192, false);
await png('icon-512.png', 512, false);
await png('maskable-512.png', 512, true);
await png('apple-touch-icon.png', 180, true);
await png('favicon-32.png', 32, false);

// Appli Android (android-app/, Capacitor) : icônes classiques et rondes, icône adaptative (fond + dessin dans la zone sûre de 66 dp sur 108), écrans de démarrage.
const RES = new URL('../android-app/android/app/src/main/res/', import.meta.url).pathname;
if (existsSync(RES)) {
  const shot = async (file, w, h, svg, round) => {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${w}px;height:${h}px${round ? ';border-radius:50%' : ''}}</style>${svg}`);
    await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
  };
  for (const [d, n] of [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]]) {
    const dir = RES + 'mipmap-' + d + '/';
    await shot(dir + 'ic_launcher.png', 48 * n, 48 * n, art({ bleed: false }));
    await shot(dir + 'ic_launcher_round.png', 48 * n, 48 * n, art({ bleed: true }), true);
    await shot(dir + 'ic_launcher_foreground.png', 108 * n, 108 * n, art({ bg: false, k: 3.1 }));
    await shot(dir + 'ic_launcher_background.png', 108 * n, 108 * n, art({ bleed: true, logo: false }));
  }
  writeFileSync(RES + 'mipmap-anydpi-v26/ic_launcher.xml', '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@mipmap/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n');
  writeFileSync(RES + 'mipmap-anydpi-v26/ic_launcher_round.xml', readFileSync(RES + 'mipmap-anydpi-v26/ic_launcher.xml'));
  // écrans de démarrage : fond nuit, logo au centre (même taille relative partout)
  for (const d of readdirSync(RES).filter(x => /^drawable/.test(x) && existsSync(RES + x + '/splash.png'))) {
    const f = RES + d + '/splash.png', b = readFileSync(f), w = b.readUInt32BE(16), h = b.readUInt32BE(20), s = Math.round(Math.min(w, h) * 0.42);
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<style>html,body{margin:0;width:${w}px;height:${h}px;background:radial-gradient(120% 80% at 20% 0%,#1d2552,#0b0f1c 62%);display:grid;place-items:center}svg{width:${s}px;height:${s}px}</style>${art({ bg: false, k: 4.6 })}`);
    await page.screenshot({ path: f, clip: { x: 0, y: 0, width: w, height: h } });
  }
  console.log('android : icônes et écrans de démarrage');
}
await browser.close();
