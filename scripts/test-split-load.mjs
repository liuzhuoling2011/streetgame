/**
 * End-to-end check for split ROM loading.
 *
 * Builds a synthetic file larger than 25 MB, splits it, serves only the parts
 * from `vite preview`, and drives the real page:
 *   - combined progress reaches the full size
 *   - a failed part is retried
 *   - parts that finished are kept, and the retry skips them
 *   - the cached merge matches the original bytes and the part cache is cleared
 *   - a second launch reads that cache
 *   - an unsplit ROM (doubledr.zip) still boots
 *   - batcir boots with the load-time CPS2 key
 *
 *   node scripts/test-split-load.mjs
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const romDir = path.join(root, 'public/roms');
const zipName = 'splittest.zip';
const zipPath = path.join(romDir, zipName);
const heldZip = '/tmp/streetgame-splittest.zip';
const gamesPath = path.join(root, 'public/games.json');
const shots = path.join(root, 'tmp/split-load');
const size = 26 * 1024 * 1024 + 123;
const port = 4173;
const origin = `http://127.0.0.1:${port}`;
const chrome = process.env.CHROME_PATH || '/usr/local/bin/google-chrome';

let preview = null;
let originalGames = null;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeSynthetic(file, total) {
  await mkdir(path.dirname(file), { recursive: true });
  const hash = createHash('sha256');
  const stream = createWriteStream(file);
  let left = total;
  while (left > 0) {
    const take = Math.min(1024 * 1024, left);
    const chunk = randomBytes(take);
    hash.update(chunk);
    if (!stream.write(chunk)) await new Promise((resolve) => stream.once('drain', resolve));
    left -= take;
  }
  await new Promise((resolve, reject) => {
    stream.end(() => resolve());
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}`));
    });
  });
}

async function waitForPreview(child) {
  const deadline = Date.now() + 30000;
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk.toString(); });
  child.stderr.on('data', (chunk) => { log += chunk.toString(); });
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`preview exited\n${log}`);
    try {
      const response = await fetch(`${origin}/streetgame/`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`preview did not start\n${log}`);
}

async function stopPreview() {
  if (!preview || preview.exitCode != null) return;
  preview.kill('SIGTERM');
  await new Promise((resolve) => preview.on('exit', resolve));
}

async function restoreWorkspace() {
  if (originalGames != null) await writeFile(gamesPath, originalGames);
  await rm(zipPath, { force: true });
  await rm(path.join(romDir, 'parts', `${zipName}.000`), { force: true });
  await rm(path.join(romDir, 'parts', `${zipName}.001`), { force: true });
  await rm(path.join(romDir, 'parts', `${zipName}.002`), { force: true });
  await run('node', ['scripts/split-roms.mjs']);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  await mkdir(shots, { recursive: true });
  originalGames = await readFile(gamesPath, 'utf8');
  console.log(`writing ${size} byte synthetic zip`);
  const expected = await writeSynthetic(zipPath, size);
  await run('node', ['scripts/split-roms.mjs']);
  await rename(zipPath, heldZip);
  const games = JSON.parse(originalGames);
  games.games.unshift({
    id: 'splittest',
    title: 'Split Test',
    subtitle: 'Synthetic',
    system: 'cps1',
    year: '2026',
    developer: 'Street Game',
    description: 'Temporary split-loader fixture.',
    rom: 'roms/splittest.zip',
    bundled: true,
    fbneo: 'splittest',
    hint: 'synthetic split rom',
  });
  await writeFile(gamesPath, `${JSON.stringify(games, null, 2)}\n`);

  console.log('building');
  await run('npm', ['run', 'build']);
  const sw = await readFile(path.join(root, 'dist/sw.js'), 'utf8');
  assert(sw.includes('isSplitTransport'), 'service worker does not bypass split parts');
  await access(path.join(root, 'dist/roms/parts/splittest.zip.000'));
  await access(path.join(root, 'dist/roms/parts/splittest.zip.001'));
  await access(path.join(root, 'dist/roms/parts/splittest.zip.002'));
  await access(path.join(root, 'dist/roms/doubledr.zip'));
  const wholeInDist = await access(path.join(root, 'dist/roms/splittest.zip')).then(() => true).catch(() => false);
  assert(!wholeInDist, 'dist still contains the unsplit synthetic zip');
  const builtManifest = JSON.parse(await readFile(path.join(root, 'dist/roms/manifest.json'), 'utf8'));
  const synthetic = builtManifest.files['splittest.zip'];
  assert(Array.isArray(synthetic.partSha256) && synthetic.partSha256.length === synthetic.parts.length, 'manifest is missing per-part sha256');

  preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForPreview(preview);

  const part = await fetch(`${origin}/streetgame/roms/parts/splittest.zip.000`);
  assert(part.ok, `part fetch ${part.status}`);
  const partType = part.headers.get('content-type') || '';
  assert(!partType.includes('text/html'), `part content-type ${partType}`);
  await part.body?.cancel();
  const missing = await fetch(`${origin}/streetgame/roms/splittest.zip`);
  const missingType = missing.headers.get('content-type') || '';
  assert(!missing.ok || missingType.includes('text/html'), `whole synthetic zip was served as ${missing.status} ${missingType}`);
  await missing.body?.cancel();

  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--mute-audio', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(90000);
    const logs = [];
    page.on('console', (msg) => logs.push(`${msg.type()}: ${msg.text()}`));
    page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));
    await page.setViewport({ width: 1100, height: 760, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('streetgame.volume', '0');
    });

    await page.goto(`${origin}/streetgame/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.innerText.includes('双截龙') && document.body.innerText.includes('Split Test'));
    await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return;
      await navigator.serviceWorker.ready;
    });
    const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    if (!controlled) await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.innerText.includes('Split Test'));
    const controlling = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    assert(controlling, 'service worker is not controlling the page');

    const requests = [];
    let failedPart = 0;
    let holdZero = true;
    const finishedParts = new Set();
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      requests.push(`${request.method()} ${url}`);
      if (request.method() === 'GET' && holdZero && url.includes('/roms/parts/splittest.zip.000')) {
        const waitForSiblings = async () => {
          const deadline = Date.now() + 30000;
          while (Date.now() < deadline) {
            const ready = [...finishedParts].filter((item) => item.includes('splittest.zip.001') || item.includes('splittest.zip.002'));
            if (ready.length >= 2) return;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        };
        waitForSiblings().then(async () => {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          failedPart += 1;
          request.abort('failed').catch(() => {});
        }).catch(() => {
          request.abort('failed').catch(() => {});
        });
        return;
      }
      request.continue().catch(() => {});
    });
    const client = await page.createCDPSession();
    const requestUrls = new Map();
    await client.send('Network.enable');
    client.on('Network.requestWillBeSent', (event) => {
      requestUrls.set(event.requestId, event.request.url);
    });
    client.on('Network.loadingFinished', (event) => {
      const url = requestUrls.get(event.requestId) || '';
      if (url.includes('/roms/parts/splittest.zip.001') || url.includes('/roms/parts/splittest.zip.002')) {
        finishedParts.add(url);
      }
    });
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 30,
      downloadThroughput: 8 * 1024 * 1024,
      uploadThroughput: 256 * 1024,
    });

    await page.goto(`${origin}/streetgame/#/play/splittest`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const status = document.querySelector('.stage-status')?.textContent || '';
      return status.includes('分片');
    }, { timeout: 90000 });
    const failedStatus = await page.evaluate(() => document.querySelector('.stage-status')?.textContent || '');
    console.log('interrupted status:', failedStatus);
    assert(failedPart >= 3, `part 000 was not retried to exhaustion (${failedPart})`);
    const parked = await page.evaluate(async () => {
      const cache = await caches.open('streetgame-rom-parts');
      const keys = (await cache.keys()).map((key) => key.url);
      const sizes = {};
      for (const key of keys) {
        const hit = await cache.match(key);
        sizes[key] = hit ? (await hit.arrayBuffer()).byteLength : 0;
      }
      return { keys, sizes };
    });
    console.log('parked parts:');
    for (const key of parked.keys) console.log(' ', key.replace(origin, ''), parked.sizes[key]);
    assert(parked.keys.some((key) => key.includes('splittest.zip.001')), 'part 001 was not kept');
    assert(parked.keys.some((key) => key.includes('splittest.zip.002')), 'part 002 was not kept');
    assert(!parked.keys.some((key) => key.includes('splittest.zip.000')), 'failed part 000 was cached');
    const beforeResume = requests.length;
    holdZero = false;

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const status = document.querySelector('.stage-status')?.textContent || '';
      return !status.includes('分片下载失败');
    });
    const samples = [];
    let shot = false;
    const deadline = Date.now() + 90000;
    let finalStatus = '';
    while (Date.now() < deadline) {
      const snap = await page.evaluate(() => ({
        meta: document.querySelector('li[data-stage="rom"] .load-stage-meta')?.textContent || '',
        title: document.querySelector('.load-title')?.textContent || '',
        status: document.querySelector('.stage-status')?.textContent || '',
        width: document.querySelector('.load-bar')?.getAttribute('style') || '',
      }));
      samples.push(snap);
      finalStatus = snap.status;
      const percent = Number((snap.meta.match(/(\d+)%/) || [])[1]);
      if (!shot && percent >= 8 && percent <= 92) {
        shot = true;
        await page.screenshot({ path: path.join(shots, 'split-progress.png') });
      }
      if (snap.status.includes('认不出来') || snap.status.includes('校验') || snap.status.includes('分片') || snap.status.includes('已开台')) break;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    console.log('progress samples:');
    for (const snap of samples.filter((item, index) => index % 3 === 0)) {
      console.log(`  ${snap.meta} | ${snap.status}`);
    }
    console.log('final status:', finalStatus);
    console.log('part 000 failures injected:', failedPart);
    const partGets = requests.filter((line) => line.startsWith('GET ') && line.includes('/roms/parts/splittest.zip.'));
    console.log('part requests:', partGets.length);
    for (const line of partGets) console.log(' ', line.replace(origin, ''));
    assert(shot, `progress never showed a mid-download percent\n${samples.map((item) => item.meta).join('\n')}`);
    assert(samples.some((item) => item.meta.includes('/ 26 MB')), `progress total was not the merged ROM\n${samples.map((item) => item.meta).join('\n')}`);
    assert(finalStatus.includes('认不出来'), `expected the merged bytes to reach the emulator, got ${finalStatus}\n${logs.slice(-20).join('\n')}`);
    assert(failedPart >= 3, 'did not exhaust part retries');
    const resumeGets = requests.slice(beforeResume).filter((line) => line.startsWith('GET ') && line.includes('/roms/parts/splittest.zip.'));
    console.log('resume part requests:');
    for (const line of resumeGets) console.log(' ', line.replace(origin, ''));
    assert(resumeGets.some((line) => line.includes('splittest.zip.000')), 'resume did not fetch the missing part');
    assert(!resumeGets.some((line) => line.includes('splittest.zip.001')), 'resume refetched part 001');
    assert(!resumeGets.some((line) => line.includes('splittest.zip.002')), 'resume refetched part 002');
    assert(!requests.some((line) => line.startsWith('GET ') && /\/roms\/splittest\.zip(\?|$)/.test(line)), 'page fetched the missing whole zip');

    const cached = await page.evaluate(async () => {
      const cache = await caches.open('streetgame-media');
      const keys = (await cache.keys()).map((key) => key.url);
      const hit = await cache.match('/streetgame/roms/splittest.zip');
      if (!hit) return { keys, size: 0, sha: '' };
      const bytes = new Uint8Array(await hit.arrayBuffer());
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const sha = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      return { keys, size: bytes.byteLength, sha };
    });
    console.log('media cache keys:');
    for (const key of cached.keys) console.log(' ', key.replace(origin, ''));
    assert(cached.sha === expected, `merged sha ${cached.sha} != original ${expected}`);
    assert(cached.size === size, `merged size ${cached.size} != ${size}`);
    assert(!cached.keys.some((key) => key.includes('/roms/parts/')), 'service worker stored split parts in the merged ROM cache');
    assert(!cached.keys.some((key) => key.endsWith('/roms/manifest.json')), 'manifest was stored in the ROM cache');
    const partsLeft = await page.evaluate(async () => {
      const cache = await caches.open('streetgame-rom-parts');
      return (await cache.keys()).map((key) => key.url);
    });
    assert(partsLeft.length === 0, `part cache was not cleared after the merge: ${partsLeft.join(', ')}`);

    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: 100 * 1024 * 1024,
      uploadThroughput: 50 * 1024 * 1024,
    });
    const beforeReload = requests.length;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const status = document.querySelector('.stage-status')?.textContent || '';
      const meta = document.querySelector('li[data-stage="rom"] .load-stage-meta')?.textContent || '';
      return status.includes('认不出来') && meta.length > 0;
    });
    const romMeta = await page.evaluate(() => document.querySelector('li[data-stage="rom"] .load-stage-meta')?.textContent || '');
    console.log('second launch rom stage:', romMeta);
    await page.screenshot({ path: path.join(shots, 'split-from-cache.png') });
    const after = requests.slice(beforeReload);
    if (!romMeta.includes('缓存')) {
      const debug = await page.evaluate(async () => {
        const cache = await caches.open('streetgame-media');
        const keys = (await cache.keys()).map((key) => key.url);
        const abs = new URL('/streetgame/roms/splittest.zip', location.href).href;
        const hit = await cache.match(abs, { ignoreVary: true });
        const size = hit ? (await hit.arrayBuffer()).byteLength : 0;
        return { keys, abs, size };
      });
      console.log('cache debug', JSON.stringify(debug, null, 2));
    }
    assert(romMeta.includes('缓存'), `second launch did not use the cache: ${romMeta}`);
    assert(!after.some((line) => line.includes('/roms/parts/')), `second launch redownloaded parts\n${after.join('\n')}`);

    await page.goto(`${origin}/streetgame/#/play/doubledr`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => (document.querySelector('.stage-status')?.textContent || '').includes('已开台'),
      { timeout: 90000 },
    );
    await page.screenshot({ path: path.join(shots, 'doubledr-loaded.png') });
    const doubledrCached = await page.evaluate(async () => {
      const cache = await caches.open('streetgame-media');
      const hit = await cache.match('/streetgame/roms/doubledr.zip');
      if (!hit) return '';
      const bytes = new Uint8Array(await hit.arrayBuffer());
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    });
    const doubledrFile = sha256(await readFile(path.join(romDir, 'doubledr.zip')));
    assert(doubledrCached === doubledrFile, 'unsplit doubledr.zip bytes did not match the file');
    assert(!requests.some((line) => line.includes('/roms/parts/doubledr')), 'unsplit ROM was fetched as parts');
    console.log('doubledr booted and matched', doubledrFile);

    await page.goto(`${origin}/streetgame/#/play/batcir`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => (document.querySelector('.stage-status')?.textContent || '').includes('已开台'),
      { timeout: 90000 },
    );
    const batcirStatus = await page.evaluate(() => document.querySelector('.stage-status')?.textContent || '');
    await page.screenshot({ path: path.join(shots, 'batcir-loaded.png') });
    assert(batcirStatus.includes('batcir'), `batcir did not boot as batcir: ${batcirStatus}`);
    console.log('batcir booted', batcirStatus);
  } finally {
    await browser.close();
  }
}

try {
  await main();
  console.log('E2E PASSED');
} finally {
  await stopPreview();
  await restoreWorkspace();
  await rm(heldZip, { force: true });
}
