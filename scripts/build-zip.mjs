// Builds the Chrome Web Store upload package from the extension/ folder.
// The zip has manifest.json at its ROOT (a common submission mistake is nesting
// everything inside a folder). Output: dist/a11y-companion-<version>.zip
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const execFileP = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extDir = join(root, 'extension');
const distDir = join(root, 'dist');

const manifest = JSON.parse(await readFile(join(extDir, 'manifest.json'), 'utf8'));
const out = join(distDir, `a11y-companion-${manifest.version}.zip`);

await mkdir(distDir, { recursive: true });
await rm(out, { force: true });

// Zip the CONTENTS of extension/ (cwd = extension) so manifest.json is at root.
await execFileP('zip', ['-r', '-X', out, '.', '-x', '*.DS_Store', '-x', '__MACOSX*'], { cwd: extDir });

// Verify manifest.json sits at the archive root.
const { stdout } = await execFileP('unzip', ['-l', out]);
const hasRootManifest = stdout.split('\n').some((l) => /\s manifest\.json$/.test(l));
console.log(stdout.trim());
console.log(hasRootManifest ? `\n✓ ${out} — manifest.json at root, v${manifest.version}` : '\n✗ manifest.json NOT at archive root!');
if (!hasRootManifest) process.exit(1);
