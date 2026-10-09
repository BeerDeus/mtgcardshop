// Ressources XML Android (res/**, AndroidManifest.xml) : erreurs que Gradle refuse et qu'aucun SDK ne vérifie ici.
// « -- » dans un commentaire XML est interdit (SAXParseException à la compilation de l'APK) ; balises de commentaire bien fermées.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = 'android-app/android/app/src/main', files = [join(root, 'AndroidManifest.xml')];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.xml')) files.push(p); } })(join(root, 'res'));
const bad = [];
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(/<!--([\s\S]*?)-->/g)) if (m[1].includes('--') || m[1].endsWith('-')) bad.push(`${f}:${s.slice(0, m.index).split('\n').length} « -- » dans un commentaire`);
  if ((s.match(/<!--/g) || []).length !== (s.match(/-->/g) || []).length) bad.push(`${f} : commentaire mal fermé`);
  if (!/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*</.test(s)) bad.push(`${f} : début de fichier inattendu`);
}
assert.deepEqual(bad, [], bad.join('\n'));
console.log(`✓ ${files.length} fichiers XML Android : commentaires valides`);
