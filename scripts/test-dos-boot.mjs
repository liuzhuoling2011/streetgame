/**
 * Boot the shipped 仙剑 DOS pack and Battle City.
 *
 * Confirms the page reaches a title and a later screen without assembling the
 * 333 MB archive, then opens another catalog game.
 *
 *   node scripts/test-dos-boot.mjs
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const shots = path.join(root, 'tmp/dos-boot');
const port = 4175;
const origin = `http://127.0.0.1:${port}`;
const chrome = process.env.CHROME_PATH || '/usr/local/bin/google-chrome';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rssTree(pid) {
  const seen = new Set();
  const pending = [pid];
  let total = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    const ps = spawn('ps', ['-o', 'pid=,rss=', '--ppid', String(current)]);
    let text = '';
    ps.stdout.on('data', (chunk) => { text += chunk; });
    const self = spawn('ps', ['-o', 'rss=', '-p', String(current)]);
    let own = '';
    self.stdout.on('data', (chunk) => { own += chunk; });
    await Promise.all([
      new Promise((resolve) => ps.on('exit', resolve)),
      new Promise((resolve) => self.on('exit', resolve)),
    ]);
    total += Number(own.trim() || 0);
    for (const line of text.trim().split('\n')) {
      if (!line.trim()) continue;
      const child = Number(line.trim().split(/\s+/)[0]);
      if (child) pending.push(child);
    }
  }
  return total;
}

async function main() {
  await mkdir(shots, { recursive: true });
  const dev = spawn(process.execPath, [
    'node_modules/vite/bin/vite.js',
    '--host', '127.0.0.1',
    '--port', String(port),
    '--strictPort',
  ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  dev.stdout.on('data', (chunk) => { log += chunk; });
  dev.stderr.on('data', (chunk) => { log += chunk; });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (dev.exitCode != null) throw new Error(`vite exited\n${log}`);
    try {
      const response = await fetch(`${origin}/streetgame/`);
      if (response.ok) break;
    } catch {
      /* starting */
    }
    await sleep(200);
  }
  if (Date.now() >= deadline) throw new Error(`vite did not start\n${log}`);

  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--mute-audio', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const samples = [];
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(180000);
    const logs = [];
    page.on('console', (msg) => logs.push(`${msg.type()}: ${msg.text()}`));
    page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));
    await page.setViewport({ width: 420, height: 900, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('streetgame.volume', '0');
    });
    const client = await page.createCDPSession();
    await client.send('Performance.enable');
    let maxHeap = 0;
    let maxRss = 0;
    const chromePid = browser.process().pid;

    async function measure() {
      const { metrics } = await client.send('Performance.getMetrics');
      const heap = Number(metrics.find((item) => item.name === 'JSHeapUsedSize')?.value || 0);
      if (heap > maxHeap) maxHeap = heap;
      const rss = await rssTree(chromePid);
      if (rss > maxRss) maxRss = rss;
      return { heap, rss };
    }

    await page.goto(`${origin}/streetgame/#/play/paladin`, { waitUntil: 'domcontentloaded' });
    const started = Date.now();
    let failure = '';
    let diag = null;
    const frames = [];
    let lastHash = 0;
    let bootedGame = false;
    let lastKey = 0;
    while (Date.now() - started < 70000) {
      const snap = await page.evaluate(() => {
        const canvas = document.querySelector('#dos-canvas');
        let picture = null;
        if (canvas instanceof HTMLCanvasElement && canvas.width > 2 && canvas.height > 2 && !canvas.hidden) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let lit = 0;
            let hash = 0;
            for (let i = 0; i < data.length; i += 16) {
              const value = data[i] + data[i + 1] + data[i + 2];
              if (value > 24) lit += 1;
              hash = (hash * 33 + value) >>> 0;
            }
            picture = { width: canvas.width, height: canvas.height, lit, hash };
          }
        }
        const dos = window.__streetgameDos || null;
        return {
          status: document.querySelector('.stage-status')?.textContent || '',
          boot: document.querySelector('li[data-stage="boot"] .load-stage-meta')?.textContent || '',
          rom: document.querySelector('li[data-stage="rom"] .load-stage-meta')?.textContent || '',
          diag: dos,
          picture,
          launched: Boolean(dos?.stdout?.some((line) => line.includes('PLAY.BAT'))),
        };
      });
      const memory = await measure();
      diag = snap.diag;
      const row = {
        t: Math.round((Date.now() - started) / 1000),
        status: snap.status.slice(0, 80),
        rom: snap.rom,
        boot: snap.boot.slice(0, 60),
        stage: diag?.stage || '',
        heap: diag?.heapAtPeak || memory.heap,
        rss: memory.rss,
        lit: snap.picture?.lit || 0,
        size: snap.picture ? `${snap.picture.width}x${snap.picture.height}` : '',
      };
      samples.push(row);
      if (samples.length % 5 === 1) console.log(JSON.stringify(row));
      if (/DOS 启动失败|浏览器内存不够|校验失败|存不下/.test(snap.status)) {
        failure = snap.status;
        break;
      }
      if (snap.launched) bootedGame = true;
      if (bootedGame && snap.picture && snap.picture.lit > 200 && snap.picture.hash !== lastHash) {
        lastHash = snap.picture.hash;
        const file = path.join(shots, `paladin-${String(frames.length).padStart(2, '0')}.png`);
        await (await page.$('#dos-canvas')).screenshot({ path: file });
        frames.push({ ...snap.picture, file });
        console.log('frame', frames.length, snap.picture.width, snap.picture.height, snap.picture.lit);
      }
      const graphics = snap.picture && snap.picture.width === 640 && snap.picture.lit > 400;
      if (graphics && Date.now() - lastKey > 2200) {
        await page.keyboard.press('Enter');
        lastKey = Date.now();
      }
      if (frames.length >= 8 && Date.now() - started > 36000) break;
      await sleep(700);
    }
    assert(!failure, failure);
    assert(bootedGame, `PLAY.BAT never ran\n${logs.slice(-20).join('\n')}\n${JSON.stringify(diag?.stdout?.slice(-8))}`);
    assert(frames.length >= 2, `仙剑 did not get past the DOS prompt (${frames.length} frames)`);
    assert(frames.some((frame) => frame.width === 640 && frame.lit > 20000), '仙剑 did not reach the title');
    await page.click('#dos-canvas');
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press('Enter');
      await sleep(1600);
      const file = path.join(shots, `paladin-play-${step}.png`);
      await (await page.$('#dos-canvas')).screenshot({ path: file });
      console.log('play step', step);
    }
    const saveBytes = await page.evaluate(async () => {
      const save = window.__streetgameDosSave;
      return save ? save() : -1;
    });
    console.log('dos save bytes', saveBytes);
    assert(saveBytes >= 0 && saveBytes < 8 * 1024 * 1024, `DOS save snapshot is ${saveBytes} bytes`);
    assert(diag?.mode === 'parts', `expected part-backed ROM, got ${diag?.mode}`);
    assert(diag.assembledBytes === 0, `assembled ${diag.assembledBytes}`);
    assert(diag.skippedBytes > 390 * 1024 * 1024, `skipped only ${diag.skippedBytes}`);
    assert(diag.keptBytes < 80 * 1024 * 1024, `kept ${diag.keptBytes}`);
    assert(diag.largestRead < 12 * 1024 * 1024, `largest read ${diag.largestRead}`);
    assert(diag.peakHeldBytes < 80 * 1024 * 1024, `peak held ${diag.peakHeldBytes}`);
    assert(maxHeap < 250 * 1024 * 1024, `JS heap peaked at ${maxHeap}`);
    console.log('paladin frames', frames.map((frame) => frame.file));
    console.log('diag', {
      mode: diag.mode,
      keptBytes: diag.keptBytes,
      skippedBytes: diag.skippedBytes,
      largestRead: diag.largestRead,
      largestPart: diag.largestPart,
      peakHeldBytes: diag.peakHeldBytes,
      heapAtPeak: diag.heapAtPeak,
      totalRead: diag.totalRead,
      stage: diag.stage,
      maxHeap,
      maxRss,
    });

    await page.goto(`${origin}/streetgame/#/play/battlecity`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => (document.querySelector('.stage-status')?.textContent || '').includes('已开台'),
      { timeout: 60000 },
    );
    await sleep(1500);
    const battlePath = path.join(shots, 'battlecity.png');
    await page.screenshot({ path: battlePath });
    const battle = await page.evaluate(() => {
      const canvas = document.querySelector('#canvas');
      return {
        hidden: canvas instanceof HTMLCanvasElement ? canvas.hidden : true,
        width: canvas instanceof HTMLCanvasElement ? canvas.width : 0,
        height: canvas instanceof HTMLCanvasElement ? canvas.height : 0,
        status: document.querySelector('.stage-status')?.textContent || '',
      };
    });
    console.log('battle city', battle);
    assert(!battle.hidden && battle.width > 2 && battle.height > 2, `battle city canvas ${JSON.stringify(battle)}`);
    await writeFile(path.join(shots, 'memory.json'), JSON.stringify({
      maxHeap,
      maxRss,
      keptBytes: diag.keptBytes,
      skippedBytes: diag.skippedBytes,
      largestRead: diag.largestRead,
      largestPart: diag.largestPart,
      peakHeldBytes: diag.peakHeldBytes,
      heapAtPeak: diag.heapAtPeak,
      totalRead: diag.totalRead,
      mode: diag.mode,
      samples,
    }, null, 2));
    console.log('BOOT CHECKS PASSED', { maxHeap, maxRss });
  } finally {
    await browser.close();
    dev.kill('SIGTERM');
  }
}

await main();
