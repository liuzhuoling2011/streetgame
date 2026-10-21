/**
 * Branded library covers for games that do not have an attract-frame capture.
 * Title, system, and year only. Real frames still come from capture-cover.mjs.
 *
 *   node scripts/placeholder-covers.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const font = 'WenQuanYi Micro Hei';
const accent = {
  cps1: '#e85d4c',
  cps2: '#3d9aad',
  neogeo: '#f0b429',
};
const systemLabel = {
  cps1: 'CPS1',
  cps2: 'CPS2',
  neogeo: 'NEO GEO',
};

const keep = new Set(['doubledr']);
const catalog = JSON.parse(await readFile('public/games.json', 'utf8'));

for (const game of catalog.games) {
  if (keep.has(game.id)) continue;
  const svg = coverSvg(game);
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  const out = `public/covers/${game.id}.png`;
  await writeFile(out, png);
  console.log(`${out} ${png.length}`);
}

function coverSvg(game) {
  const color = accent[game.system] || '#f4f1ea';
  const label = systemLabel[game.system] || game.system;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
  <rect width="1280" height="800" fill="#101014"/>
  <rect width="1280" height="800" fill="url(#grid)" opacity="0.45"/>
  <rect x="0" y="0" width="16" height="800" fill="${color}"/>
  <text x="72" y="168" fill="${color}" font-family="${font}, sans-serif" font-size="28" letter-spacing="6">STREET GAME</text>
  <text x="72" y="360" fill="#f4f1ea" font-family="${font}, sans-serif" font-size="92">${escapeXml(game.title)}</text>
  <text x="72" y="440" fill="#b7b1a6" font-family="${font}, sans-serif" font-size="36">${escapeXml(game.subtitle || '')}</text>
  <text x="72" y="700" fill="${color}" font-family="${font}, sans-serif" font-size="32">${escapeXml(label)}  ·  ${escapeXml(game.year || '')}</text>
  <defs>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
      <path d="M32 0H0V32" fill="none" stroke="#1c1c22" stroke-width="1"/>
    </pattern>
  </defs>
</svg>`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
