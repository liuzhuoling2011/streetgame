/**
 * Bright library covers. Title, system, and year, large enough to read in the
 * card grid. Real gameplay frames can still replace one file via crisp-cover.mjs.
 *
 *   node scripts/placeholder-covers.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const font = 'WenQuanYi Micro Hei';
const theme = {
  neogeo: { bg: '#ffd56a', ink: '#1a1204', muted: '#5c4310', accent: '#e10600' },
  cps1: { bg: '#ffb59a', ink: '#2a100c', muted: '#6a3224', accent: '#c4321a' },
  cps2: { bg: '#9ee7f2', ink: '#04262b', muted: '#1a5560', accent: '#0b6e80' },
};
const systemLabel = {
  cps1: 'CPS1',
  cps2: 'CPS2',
  neogeo: 'NEO GEO',
};

const catalog = JSON.parse(await readFile('public/games.json', 'utf8'));

for (const game of catalog.games) {
  const svg = coverSvg(game);
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  const stats = await sharp(png).stats();
  const mean = stats.channels.slice(0, 3).reduce((sum, channel) => sum + channel.mean, 0) / 3;
  if (mean < 140) throw new Error(`${game.id} cover is still dark (mean ${mean.toFixed(1)})`);
  if (png.length > 180 * 1024) throw new Error(`${game.id} cover is ${png.length} bytes`);
  const out = `public/covers/${game.id}.png`;
  await writeFile(out, png);
  console.log(`${out} ${png.length} mean ${mean.toFixed(0)}`);
}

function coverSvg(game) {
  const color = theme[game.system] || theme.neogeo;
  const label = systemLabel[game.system] || String(game.system || '').toUpperCase();
  const title = String(game.title || game.id);
  const subtitle = String(game.subtitle || '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
  <rect width="1280" height="800" fill="${color.bg}"/>
  <circle cx="1100" cy="120" r="260" fill="${color.accent}" opacity="0.16"/>
  <circle cx="140" cy="700" r="180" fill="${color.accent}" opacity="0.10"/>
  <rect width="1280" height="22" fill="${color.accent}"/>
  <text x="72" y="150" fill="${color.accent}" font-family="${font}, sans-serif" font-size="34" letter-spacing="8" font-weight="700">STREET GAME</text>
  <text x="72" y="390" fill="${color.ink}" font-family="${font}, sans-serif" font-size="${titleSize(title)}" font-weight="700">${escapeXml(title)}</text>
  <text x="72" y="490" fill="${color.muted}" font-family="${font}, sans-serif" font-size="${subtitleSize(subtitle)}">${escapeXml(subtitle)}</text>
  <text x="72" y="700" fill="${color.ink}" font-family="${font}, sans-serif" font-size="36" font-weight="700">${escapeXml(label)}    ${escapeXml(game.year || '')}</text>
</svg>`;
}

function titleSize(title) {
  const width = [...title].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 255 ? 1 : 0.58), 0);
  return Math.max(72, Math.min(132, Math.floor(1080 / Math.max(width, 1))));
}

function subtitleSize(subtitle) {
  const width = [...subtitle].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 255 ? 1 : 0.55), 0);
  return Math.max(28, Math.min(40, Math.floor(1080 / Math.max(width, 1))));
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
