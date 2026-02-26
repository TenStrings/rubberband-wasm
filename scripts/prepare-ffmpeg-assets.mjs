import { mkdir, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const srcDir = join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const outDir = join(root, 'public', 'vendor', 'ffmpeg');

await mkdir(outDir, { recursive: true });
await copyFile(join(srcDir, 'ffmpeg-core.js'), join(outDir, 'ffmpeg-core.js'));
await copyFile(join(srcDir, 'ffmpeg-core.wasm'), join(outDir, 'ffmpeg-core.wasm'));

console.log('Prepared ffmpeg core assets at public/vendor/ffmpeg');
