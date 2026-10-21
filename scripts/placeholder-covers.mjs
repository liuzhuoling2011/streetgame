/**
 * Library covers for public/games.json.
 *
 * Matched titles download flyer art from ArcadeGameBox (https://arcadegamebox.com/zh/)
 * and fit it to the 16:10 library card. Titles with no page on that site keep the
 * bright title plate. Do not hotlink: this writes public/covers/<id>.png.
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

const CARD_W = 960;
const CARD_H = 600;
const MAX_BYTES = 280 * 1024;

// Page slugs are under https://arcadegamebox.com/zh/games/<slug>/
// Image URLs are the og:image on that page (2026-10-21).
const ARCADE_GAMEBOX = {
  kof94: 'https://arcadegamebox.com/upload/attachment/image/202607/18/the-king-of-fighters-94.webp',
  kof95: 'https://arcadegamebox.com/upload/attachment/image/202607/18/the-king-of-fighters-95.webp',
  kof96: 'https://arcadegamebox.com/upload/attachment/image/202607/18/the-king-of-fighters-96.webp',
  kof97: 'https://arcadegamebox.com/upload/attachment/image/202607/17/kof97.webp',
  kof98: 'https://arcadegamebox.com/upload/attachment/image/202607/17/kof98-2.webp',
  kof99: 'https://arcadegamebox.com/upload/attachment/image/202607/17/the-king-of-fighters-99.webp',
  kof2000: 'https://arcadegamebox.com/upload/attachment/image/202607/17/the-king-of-fighters-2000.webp',
  kof2001: 'https://arcadegamebox.com/upload/attachment/image/202607/18/the-king-of-fighters-2001.webp',
  kof2002: 'https://arcadegamebox.com/upload/attachment/image/202607/17/the-king-of-fighters-2002.webp',
  kof2003: 'https://arcadegamebox.com/upload/attachment/image/202607/18/the-king-of-fighters-2003.webp',
  mslug: 'https://arcadegamebox.com/upload/attachment/image/202607/17/mslug.webp',
  mslug2: 'https://arcadegamebox.com/upload/attachment/image/202607/17/mslug2.webp',
  mslugx: 'https://arcadegamebox.com/upload/attachment/image/202607/17/mslugx.webp',
  mslug3: 'https://arcadegamebox.com/upload/attachment/image/202607/17/mslug3.webp',
  mslug3nd: 'https://arcadegamebox.com/upload/attachment/image/202607/17/mslug3.webp',
  mslug4: 'https://arcadegamebox.com/upload/attachment/image/202607/17/mslug4.webp',
  mslug5nd: 'https://arcadegamebox.com/upload/attachment/image/202607/17/mslug5.webp',
  doubledr: 'https://arcadegamebox.com/upload/attachment/image/202607/18/double-dragon-arcade.webp',
  '1941': 'https://arcadegamebox.com/upload/attachment/image/202607/26/1941-counter-attack_1.webp',
  captcomm: 'https://arcadegamebox.com/upload/attachment/image/202607/17/captain-commando.webp',
  dino: 'https://arcadegamebox.com/upload/attachment/image/202607/17/cadillacs-and-dinosaurs-1.webp',
  dynwar: 'https://arcadegamebox.com/upload/attachment/image/202607/17/dynasty-wars.webp',
  punisher: 'https://arcadegamebox.com/upload/attachment/image/202607/17/the-punisher.webp',
  wof: 'https://arcadegamebox.com/upload/attachment/image/202607/17/warriors-of-fate.webp',
};

const catalog = JSON.parse(await readFile('public/games.json', 'utf8'));
const notes = ['# Cover art', '', 'Matched flyers are copied from [ArcadeGameBox](https://arcadegamebox.com/zh/) for this site\'s own library cards. They are not hotlinked.', ''];

for (const game of catalog.games) {
  const out = `public/covers/${game.id}.png`;
  const source = ARCADE_GAMEBOX[game.id];
  let png;
  let label;
  if (source) {
    const bytes = await download(source);
    png = await flyerCard(bytes);
    label = 'arcadegamebox';
    notes.push(`- \`${game.id}\`: ${source}`);
  } else {
    png = await plate(game);
    label = 'plate';
    notes.push(`- \`${game.id}\`: bright title plate (no ArcadeGameBox match)`);
  }
  if (png.length > 300 * 1024) throw new Error(`${game.id} cover is ${png.length} bytes`);
  await writeFile(out, png);
  console.log(`${out} ${png.length} ${label}`);
}

notes.push('', '战国传 3 and 战斗回路 are not in the ArcadeGameBox catalog, so those cards stay on the title plate.');
await writeFile('public/covers/README.md', `${notes.join('\n')}\n`);

async function download(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'streetgame-covers' } });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1000) throw new Error(`${url} is only ${bytes.length} bytes`);
  return bytes;
}

async function flyerCard(bytes) {
  let last = null;
  for (const [width, height] of [[CARD_W, CARD_H], [800, 500], [720, 450]]) {
    const fitted = await containCard(bytes, width, height);
    last = fitted;
    if (fitted.length <= MAX_BYTES) return fitted;
    const paletted = await sharp(fitted).png({ compressionLevel: 9, palette: true, quality: 75, effort: 10, colors: 128 }).toBuffer();
    if (paletted.length <= MAX_BYTES) return paletted;
    last = paletted.length < fitted.length ? paletted : fitted;
  }
  return last;
}

async function containCard(bytes, width, height) {
  const background = await sharp(bytes)
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .blur(18)
    .modulate({ brightness: 0.45 })
    .toBuffer();
  const foreground = await sharp(bytes)
    .resize(width, height, { fit: 'inside', withoutEnlargement: false })
    .toBuffer();
  const meta = await sharp(foreground).metadata();
  const left = Math.round((width - (meta.width ?? width)) / 2);
  const top = Math.round((height - (meta.height ?? height)) / 2);
  return sharp(background)
    .composite([{ input: foreground, left, top }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function plate(game) {
  const png = await sharp(Buffer.from(coverSvg(game))).png({ compressionLevel: 9 }).toBuffer();
  const stats = await sharp(png).stats();
  const mean = stats.channels.slice(0, 3).reduce((sum, channel) => sum + channel.mean, 0) / 3;
  if (mean < 140) throw new Error(`${game.id} plate is still dark (mean ${mean.toFixed(1)})`);
  if (png.length > 180 * 1024) throw new Error(`${game.id} plate is ${png.length} bytes`);
  return png;
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
