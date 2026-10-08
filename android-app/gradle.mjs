// « npm run apk » / « npm run bundle » : sous Windows, npm lance ses scripts avec cmd.exe, qui ne connaît pas « ./gradlew » → gradlew.bat là-bas, ./gradlew ailleurs.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const win = process.platform === 'win32';
// .bat : seulement par le shell (Node refuse de le lancer directement depuis 2024) ; cmd.exe le trouve dans le dossier courant (android/)
const r = spawnSync(win ? 'gradlew.bat' : './gradlew', process.argv.slice(2), { cwd: fileURLToPath(new URL('./android/', import.meta.url)), stdio: 'inherit', shell: win });
if (r.error) console.error(r.error.message);
process.exit(r.status ?? 1);
