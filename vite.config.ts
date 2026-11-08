import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));
const base = '/streetgame/';

const DOS_RUNTIME = ['emulators.js', 'wdosbox.js', 'wdosbox.wasm', 'wdosbox-x.js', 'wdosbox-x.wasm', 'wlibzip.js', 'wlibzip.wasm'];

function publishDosEmulator(): Plugin {
  const from = path.join(root, 'node_modules/emulators/dist');
  const dest = path.join(root, 'public/emulator/dos');
  const publish = (directory: string) => {
    mkdirSync(directory, { recursive: true });
    for (const name of DOS_RUNTIME) copyFileSync(path.join(from, name), path.join(directory, name));
  };
  return {
    name: 'publish-dos-emulator',
    buildStart() {
      publish(dest);
    },
    configureServer(server) {
      publish(dest);
      // Vite skips gitignored files in public/, so serve this runtime directly.
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0];
        const marker = '/emulator/dos/';
        const index = pathname.indexOf(marker);
        if (index < 0) return next();
        const name = pathname.slice(index + marker.length);
        if (!DOS_RUNTIME.includes(name)) return next();
        const file = path.join(dest, name);
        if (!existsSync(file)) return next();
        res.setHeader('Content-Type', dosContentType(name));
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      publish(path.join(root, 'dist/emulator/dos'));
    },
  };
}

function dosContentType(name: string): string {
  if (name.endsWith('.wasm')) return 'application/wasm';
  if (name.endsWith('.js')) return 'text/javascript';
  return 'application/octet-stream';
}

function emuRev(): string {
  return createHash('sha256').update(readFileSyncSafe(path.join(root, 'public/emulator/tatoemu.wasm'))).digest('hex').slice(0, 12);
}

function readFileSyncSafe(file: string): Buffer {
  try {
    return readFileSync(file);
  } catch {
    return Buffer.from('dev');
  }
}

function streetgameSw(): Plugin {
  return {
    name: 'streetgame-sw',
    apply: 'build',
    async closeBundle() {
      const dist = path.join(root, 'dist');
      const files = await walk(dist);
      const precache = files
        .filter((file) => !file.endsWith(`${path.sep}sw.js`))
        .filter((file) => !file.split(path.sep).includes('roms'))
        .filter((file) => !file.split(path.sep).includes('bios'))
        .filter((file) => !file.split(path.sep).includes('emulator'))
        .map((file) => base + path.relative(dist, file).split(path.sep).join('/'));
      if (!precache.includes(`${base}index.html`)) precache.push(`${base}index.html`);
      if (!precache.includes(base)) precache.push(base);
      const shell = createHash('sha256').update(precache.slice().sort().join('\n')).digest('hex').slice(0, 12);
      const template = await readFile(path.join(root, 'scripts/sw-template.js'), 'utf8');
      const source = template
        .replaceAll('__SHELL__', shell)
        .replaceAll('__EMU__', emuRev())
        .replaceAll('__PRECACHE__', JSON.stringify(precache));
      await writeFile(path.join(dist, 'sw.js'), source);
    },
  };
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const info = await stat(full);
    if (info.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}

export default defineConfig({
  base,
  define: {
    __EMU_REV__: JSON.stringify(emuRev()),
  },
  plugins: [publishDosEmulator(), streetgameSw()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
