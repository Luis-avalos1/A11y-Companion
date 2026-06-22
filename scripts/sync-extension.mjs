// Copies the extension's runtime files into demo/lib so the live demo runs the
// SAME code that ships in the extension. Run this after changing the extension.
import { cp, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ext = join(root, 'extension');
const lib = join(root, 'demo', 'lib');

await mkdir(join(lib, 'fonts'), { recursive: true });
await cp(join(ext, 'shared.js'), join(lib, 'shared.js'));
await cp(join(ext, 'content.js'), join(lib, 'content.js'));
for (const f of await readdir(join(ext, 'fonts'))) {
  if (f.endsWith('.woff2')) await cp(join(ext, 'fonts', f), join(lib, 'fonts', f));
}
console.log('✓ synced shared.js, content.js, and fonts into demo/lib');
