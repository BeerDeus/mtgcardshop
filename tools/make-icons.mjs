// Génère pwa/icons/* depuis un seul dessin (foil card). Rendu par Chromium (Playwright). node make-icons.mjs
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

/** Dessin 512×512. bleed:false → carré arrondi à coins transparents (icône « any ») ; true → plein cadre (maskable / Apple). */
const art = ({ bleed }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#171f3d"/><stop offset="1" stop-color="#0a0e1c"/></linearGradient>
    <linearGradient id="foil" x1=".08" y1="0" x2=".92" y2="1"><stop offset="0" stop-color="#ff8fc3"/><stop offset=".24" stop-color="#ffd479"/><stop offset=".48" stop-color="#7be8c8"/><stop offset=".72" stop-color="#7fb0ff"/><stop offset="1" stop-color="#c79bff"/></linearGradient>
    <radialGradient id="glow" cx=".5" cy=".46" r=".55"><stop offset="0" stop-color="#7fb0ff" stop-opacity=".30"/><stop offset="1" stop-color="#7fb0ff" stop-opacity="0"/></radialGradient>
    <clipPath id="face"><rect x="-88" y="-123" width="176" height="246" rx="22"/></clipPath>
  </defs>
  <rect width="512" height="512" ${bleed ? '' : 'rx="112"'} fill="url(#bg)"/>
  <rect width="512" height="512" ${bleed ? '' : 'rx="112"'} fill="url(#glow)"/>
  <g transform="translate(256 256) scale(1.1) translate(-256 -256)">
  <g transform="translate(284 250) rotate(11)"><rect x="-88" y="-123" width="176" height="246" rx="22" fill="#1d2748" stroke="#3a4672" stroke-width="3"/><rect x="-70" y="-105" width="140" height="22" rx="7" fill="#2b3865"/></g>
  <g transform="translate(236 262) rotate(-8)">
    <rect x="-88" y="-123" width="176" height="246" rx="22" fill="url(#foil)"/>
    <g clip-path="url(#face)"><path d="M-140 70 L60 -150 L110 -150 L-90 70 Z" fill="#fff" opacity=".26"/><path d="M-40 150 L150 -60 L170 -60 L-20 150 Z" fill="#fff" opacity=".14"/></g>
    <rect x="-88" y="-123" width="176" height="246" rx="22" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="3"/>
    <rect x="-70" y="-105" width="112" height="24" rx="8" fill="#0b0f1c" fill-opacity=".72"/>
    <circle cx="58" cy="-93" r="12" fill="#0b0f1c" fill-opacity=".72"/>
    <rect x="-70" y="-64" width="140" height="92" rx="10" fill="#0b0f1c" fill-opacity=".38"/>
    <rect x="-70" y="44" width="140" height="10" rx="5" fill="#0b0f1c" fill-opacity=".55"/><rect x="-70" y="64" width="96" height="10" rx="5" fill="#0b0f1c" fill-opacity=".55"/>
    <rect x="22" y="82" width="48" height="24" rx="9" fill="#fff" fill-opacity=".92"/><path d="M52.4 89.6A7 7 0 1 0 52.4 98.4M39.6 92.3h9.6M39.6 95.7h9.6" fill="none" stroke="#10152b" stroke-width="2.6" stroke-linecap="round"/>
  </g>
  </g>
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
await browser.close();
