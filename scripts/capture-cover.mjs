/**
 * Capture a native emulator frame for a library cover.
 *
 * FBNeo/MAME zip packages ship ROM binaries only. They do not include the
 * title, marquee, or snap art that frontends keep in a separate pack.
 * This script boots a local Street Game page and keeps an attract frame whose
 * upper half has the title art and whose bottom rows still show the CREDIT HUD.
 * WebGL has to keep the drawing buffer or the canvas reads back black.
 *
 *   CHROME_PATH=/usr/local/bin/google-chrome \
 *     node scripts/capture-cover.mjs doubledr http://127.0.0.1:5173/streetgame/
 *
 * Then:
 *   node scripts/crisp-cover.mjs tmp/covers/doubledr/best.png public/covers/doubledr.png
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const game = process.argv[2] || 'doubledr';
const pageUrl = process.argv[3] || `http://127.0.0.1:5173/streetgame/#/play/${game}`;
const chrome = process.env.CHROME_PATH || '/usr/local/bin/google-chrome';
const outDir = path.resolve('tmp/covers', game);
const seconds = Number(process.env.COVER_SECONDS || 36);

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--mute-audio', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

await mkdir(outDir, { recursive: true });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 700, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('streetgame.volume', '0');
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
      const next = Object.assign({}, attrs, { preserveDrawingBuffer: true });
      return original.call(this, type, next);
    }
    return original.call(this, type, attrs);
  };
});
await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => document.title.includes('FPS'), { timeout: 90000 });

const started = Date.now();
let best = null;
let seen = 0;
while (Date.now() - started < seconds * 1000) {
  const sample = await page.evaluate(() => {
    const canvas = document.querySelector('#canvas');
    if (!(canvas instanceof HTMLCanvasElement) || canvas.width < 16) return null;
    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(canvas, 0, 0);
    const image = ctx.getImageData(0, 0, off.width, off.height);
    const data = image.data;
    let upper = 0;
    let hud = 0;
    let all = 0;
    const samples = (off.width * off.height) / 4;
    for (let y = 0; y < off.height; y += 2) {
      for (let x = 0; x < off.width; x += 2) {
        const i = (y * off.width + x) * 4;
        const bright = data[i] + data[i + 1] + data[i + 2];
        if (bright <= 70) continue;
        all += 1;
        if (y > 50 && y < off.height * 0.55) upper += 1;
        if (y > off.height - 24) hud += 1;
      }
    }
    return {
      width: off.width,
      height: off.height,
      upper,
      hud,
      full: all / samples,
      png: off.toDataURL('image/png'),
    };
  });
  seen += 1;
  if (sample && sample.hud > 15 && sample.upper > 200 && sample.upper < 6000 && sample.full < 0.45) {
    const score = sample.hud * 4 + Math.min(sample.upper, 2200);
    if (!best || score > best.score) {
      best = { score, ...sample };
      await writeFile(path.join(outDir, 'best.png'), Buffer.from(sample.png.split(',')[1], 'base64'));
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

if (!best) {
  await browser.close();
  throw new Error(`no title frame with a credit HUD in ${seen} samples`);
}
const summary = {
  out: path.join(outDir, 'best.png'),
  width: best.width,
  height: best.height,
  hud: best.hud,
  upper: best.upper,
  full: best.full,
  score: best.score,
};
await writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
await browser.close();
