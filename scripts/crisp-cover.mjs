/**
 * Integer-scale a native emulator frame into a library cover.
 * Nearest-neighbor only: the pixels stay the game's own pixels.
 *
 *   node scripts/crisp-cover.mjs tmp/covers/doubledr/best.png public/covers/doubledr.png
 */
import sharp from 'sharp';

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) {
  console.error('usage: node scripts/crisp-cover.mjs <native.png> <cover.png>');
  process.exit(1);
}

const image = sharp(input);
const meta = await image.metadata();
const width = meta.width ?? 1;
const height = meta.height ?? 1;
const factor = Math.max(1, Math.min(4, Math.floor(1280 / width)));
await image
  .resize({
    width: width * factor,
    height: height * factor,
    kernel: 'nearest',
  })
  .png({ compressionLevel: 9 })
  .toFile(output);
console.log(JSON.stringify({ input, output, width, height, factor, outWidth: width * factor, outHeight: height * factor }));
