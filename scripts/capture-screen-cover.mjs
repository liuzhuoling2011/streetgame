/**
 * Capture a native canvas frame for a non-arcade library cover.
 *
 *   CHROME_PATH=/usr/bin/google-chrome \
 *     node scripts/capture-screen-cover.mjs battlecity http://127.0.0.1:5173/streetgame/
 *
 * Optional: COVER_SECONDS, COVER_START_AFTER (ms before sending Start), COVER_OUT
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const game = process.argv[2] || 'battlecity';
const base = process.argv[3] || 'http://127.0.0.1:5173/streetgame/';
const pageUrl = base.endsWith(game) ? base : `${base.replace(/\/?$/, '/')}#/play/${game}`;
const chrome = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const outDir = path.resolve(process.env.COVER_OUT || path.join('tmp/covers', game));
const seconds = Number(process.env.COVER_SECONDS || 24);
const startAfter = Number(process.env.COVER_START_AFTER || 0);

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
await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.title.includes('FPS'), { timeout: 180000 });

if (startAfter > 0) {
  await new Promise((resolve) => setTimeout(resolve, startAfter));
  await page.keyboard.press('Enter');
}

const started = Date.now();
let best = null;
let seen = 0;
while (Date.now() - started < seconds * 1000) {
  const sample = await page.evaluate(() => {
    const canvas = document.querySelector('#canvas, canvas');
    if (!(canvas instanceof HTMLCanvasElement) || canvas.width < 16) return null;
    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(canvas, 0, 0);
    const image = ctx.getImageData(0, 0, off.width, off.height);
    const data = image.data;
    let lit = 0;
    let unique = 0;
    const seen = new Set();
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const bright = r + g + b;
      if (bright > 70) lit += 1;
      const key = (r >> 3 << 10) | (g >> 3 << 5) | (b >> 3);
      if (!seen.has(key)) {
        seen.add(key);
        unique += 1;
      }
    }
    return {
      width: off.width,
      height: off.height,
      lit,
      unique,
      png: off.toDataURL('image/png'),
    };
  });
  seen += 1;
  if (sample && sample.lit > 80 && sample.unique > 8) {
    const score = sample.unique * 8 + Math.min(sample.lit, 4000);
    if (!best || score > best.score) {
      best = { score, ...sample };
      await writeFile(path.join(outDir, 'best.png'), Buffer.from(sample.png.split(',')[1], 'base64'));
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
}

if (!best) {
  await browser.close();
  throw new Error(`no usable frame in ${seen} samples`);
}
const summary = {
  out: path.join(outDir, 'best.png'),
  width: best.width,
  height: best.height,
  lit: best.lit,
  unique: best.unique,
  score: best.score,
  samples: seen,
};
await writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
await browser.close();
