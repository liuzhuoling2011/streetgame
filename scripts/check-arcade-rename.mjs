/**
 * Rename checks against the real ROM zips.
 *   node scripts/check-arcade-rename.mjs
 */
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

const { prepareArcadeZip, fbneoName } = await vite.ssrLoadModule('/src/neogeo-rom.ts');
const { readZip, writeStoredZip } = await vite.ssrLoadModule('/src/neogeo-bios.ts');

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function loadZip(name) {
  const direct = path.join('public/roms', name);
  try {
    const bytes = readFileSync(direct);
    if (bytes.length > 100) return bytes;
  } catch {
    /* split set */
  }
  const parts = readdirSync('public/roms/parts')
    .filter((file) => file.startsWith(`${name}.`))
    .sort();
  assert(parts.length > 0, `missing ${name}`);
  const chunks = parts.map((file) => readFileSync(path.join('public/roms/parts', file)));
  const out = Buffer.concat(chunks);
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

async function namesOf(bytes) {
  const entries = await readZip(bytes);
  return entries.map((entry) => entry.name);
}

async function expectNames(zipName, driver, required) {
  const prepared = await prepareArcadeZip(loadZip(zipName), driver);
  assert(prepared.matched, `${zipName} did not match ${driver}, got ${prepared.driver}`);
  assert(prepared.driver === driver, `${zipName} driver ${prepared.driver} !== ${driver}`);
  const names = new Set(await namesOf(prepared.bytes));
  for (const name of required) assert(names.has(name), `${zipName} missing ${name}`);
  for (const name of names) assert(!name.endsWith('.bin') && !name.endsWith('.rom') && !name.endsWith('.160'), `${zipName} still has ${name}`);
  console.log(`ok ${zipName} -> ${prepared.driver} (${names.size} files, renamed ${prepared.renamed.length})`);
  return names;
}

assert(fbneoName('242-p2.bin') === '242-p2.sp2', 'p2 extension');
assert(fbneoName('262-p2-08-e0.bin') === '262-p2-08-e0.sp2', 'p2-08-e0 extension');
assert(fbneoName('082-p1.bin') === '082-p1.p1', 'p1 extension');
assert(fbneoName('082-c1.bin') === '082-c1.c1', 'c1 extension');

const tiny = writeStoredZip([{ name: '242-p2.bin', data: new Uint8Array(32).fill(7) }]);
const fallback = await prepareArcadeZip(tiny, 'not-a-set');
assert(fallback.matched === false, 'fallback should not claim a catalog match');
assert((await namesOf(fallback.bytes)).includes('242-p2.sp2'), 'fallback p2.sp2');

await expectNames('kof98.zip', 'kof98', ['242-p1.p1', '242-p2.sp2', '242-m1.m1']);
const kof98 = await prepareArcadeZip(loadZip('kof98.zip'), 'kof98');
const kof98Entries = await readZip(kof98.bytes);
const byName = new Map(kof98Entries.map((entry) => [entry.name, entry.data.length]));
assert(byName.get('242-p1.p1') === 2097152, 'kof98 p1 size');
assert(byName.get('242-p2.sp2') === 4194304, 'kof98 p2 size');
assert(byName.get('242-m1.m1') === 262144, 'kof98 m1 size');
assert(!byName.has('242-p2.p2'), 'kof98 must not keep .p2');
assert(!byName.has('242-pn1.p1'), 'stock set must not keep the encrypted p1 name');
assert(kof98.renamed.some((line) => line.includes('yz98-p1.160')), 'p1 comes from yz98-p1.160');
assert(kof98.renamed.some((line) => line.includes('242-m1a.bin')), 'm1 comes from 242-m1a.bin');
assert(kof98.renamed.some((line) => line.includes('242-p2.sp2')), 'p2 renamed to sp2');

await expectNames('doubledr.zip', 'doubledr', ['082-p1.p1', '082-m1.m1']);
await expectNames('kof95.zip', 'kof95', ['084-p1.p1']);
const kof95 = await prepareArcadeZip(loadZip('kof95.zip'), 'kof95');
assert(kof95.renamed.some((line) => line.startsWith('084a-p1.bin → 084-p1.p1')), 'kof95 uses 084a-p1.bin');
await expectNames('mslug2.zip', 'mslug2', ['241-p1.p1', '241-p2.sp2']);
await expectNames('dino.zip', 'dino', ['cd-1m.3a', 'cde_23a.8f']);
await expectNames('kof2000.zip', 'kof2000', ['257-p2.p2', 'neo-sma']);
const kof2000Names = await namesOf((await prepareArcadeZip(loadZip('kof2000.zip'), 'kof2000')).bytes);
assert(!kof2000Names.includes('257-p2.sp2'), 'kof2000 p2 is .p2');
await expectNames('mslug3.zip', 'mslug3', ['256-pg1.p1', '256-pg2.p2', 'green.neo-sma']);
const mslug3Names = await namesOf((await prepareArcadeZip(loadZip('mslug3.zip'), 'mslug3')).bytes);
assert(!mslug3Names.includes('256-p2.sp2'), 'mslug3 p2 is .p2');
await expectNames('mslug3nd.zip', 'mslug3fd', ['256-ph1.p1']);
const decrypted = await prepareArcadeZip(loadZip('mslug3nd.zip'), 'mslug3nd');
assert(decrypted.driver === 'mslug3fd', `mslug3nd should boot as mslug3fd, got ${decrypted.driver}`);

await expectNames('mslug.zip', 'mslug', ['201-p1.p1', '201-c1.c1', '201-c4.c4', '201-m1.m1']);
const mslug = await prepareArcadeZip(loadZip('mslug.zip'), 'mslug');
assert(mslug.renamed.some((line) => line.includes('mslug_c1.rom → 201-c1.c1') && line.includes('对调')), 'mslug c1 is half-swapped');
assert(mslug.renamed.some((line) => line.includes('mslug_p1.rom → 201-p1.p1') && !line.includes('对调')), 'mslug p1 is a plain rename');
const mslugNames = await namesOf(mslug.bytes);
const { crc32 } = await vite.ssrLoadModule('/src/neogeo-bios.ts');
const mslugEntries = await readZip(mslug.bytes);
const c1 = mslugEntries.find((entry) => entry.name === '201-c1.c1');
assert(c1 && c1.data.length === 4194304, 'mslug c1 size');
assert((crc32(c1.data) >>> 0).toString(16).padStart(8, '0') === '72813676', 'mslug c1 crc');
console.log(`ok mslug half-swap (${mslugNames.length} files)`);

let mslugxError = '';
try {
  await prepareArcadeZip(loadZip('mslugx.zip'), 'mslugx');
} catch (error) {
  mslugxError = error instanceof Error ? error.message : String(error);
}
assert(mslugxError.includes('250-c2.c2'), mslugxError);
assert(mslugxError.includes('cff5d557'), mslugxError);
assert(mslugxError.includes('31679821'), mslugxError);
console.log('ok mslugx error');

await expectNames('sengoku3.zip', 'sengoku3', ['261-ph1.p1', '261-m1.m1', '261-c1.c1']);
const sengoku3 = await prepareArcadeZip(loadZip('sengoku3.zip'), 'sengoku3');
assert(sengoku3.renamed.some((line) => line.includes('261-m1.bin → 261-m1.m1') && line.includes('0xFF')), 'sengoku3 m1 is padded');
const m1 = (await readZip(sengoku3.bytes)).find((entry) => entry.name === '261-m1.m1');
assert(m1 && m1.data.length === 524288, 'sengoku3 m1 size');
assert((crc32(m1.data) >>> 0).toString(16).padStart(8, '0') === '7d501c39', 'sengoku3 m1 crc');
console.log('ok sengoku3 pad');

async function expectReject(zipName, driver, needles) {
  let message = '';
  try {
    const prepared = await prepareArcadeZip(loadZip(zipName), driver);
    assert(!prepared.matched, `${zipName} should not match`);
    message = prepared.renamed.join(' ');
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  for (const needle of needles) assert(message.includes(needle), `${zipName} message missing ${needle}: ${message}`);
  console.log(`ok ${zipName} reject`);
}

await expectReject('1941.zip', '1941', ['41em_30.11f', '4249ec61']);
await expectReject('captcomm.zip', 'captcomm', ['cce_23f.8f']);
await expectReject('wof.zip', 'wof', ['tk2e_23c.8f', 'tk2e_22c.7f']);
await expectReject('batcir.zip', 'batcir', ['batcir.key', '密钥']);
await expectReject('mslug4.zip', 'mslug4', ['263-c1.c1', '6c2b0856']);

const junk = writeStoredZip([{ name: 'mslug_c1.rom', data: new Uint8Array(32).fill(9) }]);
let junkError = '';
try {
  const prepared = await prepareArcadeZip(junk, 'mslug');
  assert(prepared.matched === false, 'corrupt mslug must not match');
} catch (error) {
  junkError = error instanceof Error ? error.message : String(error);
}
assert(junkError.includes('201-c1.c1'), junkError);
assert(!junkError.includes('72813676') || junkError.includes('没有这个大小'), junkError);
console.log('ok corrupt mslug');

const catalog = JSON.parse(readFileSync('public/games.json', 'utf8'));
const listed = new Set(catalog.games.map((game) => game.rom.split('/').pop()));
const manifest = JSON.parse(readFileSync('public/roms/manifest.json', 'utf8'));
for (const name of Object.keys(manifest.files)) {
  assert(listed.has(name), `manifest ${name} missing from games.json`);
}
for (const file of readdirSync('public/roms')) {
  if (!file.endsWith('.zip')) continue;
  assert(listed.has(file), `zip ${file} missing from games.json`);
}
for (const game of catalog.games) {
  assert(game.bundled === true, `${game.id} bundled`);
  assert(game.cover, `${game.id} cover`);
  const cover = path.join('public', game.cover);
  assert(readFileSync(cover).length > 32, `${game.id} cover file`);
}
const stubs = ['sf2', 'sf2ce', 'ffight', '3wonders', 'ssf2t', 'mvsc', 'sgemf', 'samsho', 'shocktro'];
for (const id of stubs) assert(!catalog.games.some((game) => game.id === id), `${id} stub remains`);
console.log(`ok catalog ${catalog.games.length} games`);

await vite.close();
console.log('all checks passed');
