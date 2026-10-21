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
const { readZip, writeStoredZip, crc32 } = await vite.ssrLoadModule('/src/neogeo-bios.ts');
const { ARCADE_SETS } = await vite.ssrLoadModule('/src/arcade-romsets.ts');

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
await expectNames('kof2000.zip', 'kof2kfd', ['257-pg1.p1', '257-pg2.sp2', '257-c1d.c1', '257-m1d.m1']);
const kof2000 = await prepareArcadeZip(loadZip('kof2000.zip'), 'kof2000');
assert(!kof2000.blocked, 'kof2000 decrypted set should not be blocked');
const kof2000Names = await namesOf(kof2000.bytes);
assert(!kof2000Names.includes('neo-sma') && !kof2000Names.includes('257-c1.c1'), 'kof2000 must not keep the encrypted set');
const kof99 = await prepareArcadeZip(loadZip('kof99.zip'), 'kof99');
assert(kof99.matched && kof99.driver === 'kof99fd' && !kof99.blocked, `kof99 -> ${kof99.driver} ${kof99.blocked || ''}`);
const kof99Names = await namesOf(kof99.bytes);
for (const name of ['152-p1.p1', '152-p2.sp2', '251-c1d.c1', '251-s1d.s1', '251-m1.m1']) {
  assert(kof99Names.includes(name), `kof99 missing ${name}`);
}
console.log('ok kof99 decrypted set');
const kof2001 = await prepareArcadeZip(loadZip('kof2001.zip'), 'kof2001');
assert(kof2001.matched && kof2001.driver === 'kof2001' && kof2001.blocked && kof2001.blocked.includes('kof2k1fd'), kof2001.blocked || 'kof2001 not blocked');
console.log('ok kof2001 encrypted blocked');
await expectNames('mslug3.zip', 'mslug3', ['256-pg1.p1', '256-pg2.p2', 'green.neo-sma']);
const mslug3 = await prepareArcadeZip(loadZip('mslug3.zip'), 'mslug3');
assert(mslug3.blocked && mslug3.blocked.includes('256-s1d.s1'), mslug3.blocked || 'mslug3 not blocked');
const mslug3Names = await namesOf(mslug3.bytes);
assert(!mslug3Names.includes('256-p2.sp2'), 'mslug3 p2 is .p2');
await expectNames('mslug3nd.zip', 'mslug3fd', ['256-ph1.p1']);
const decrypted = await prepareArcadeZip(loadZip('mslug3nd.zip'), 'mslug3nd');
assert(decrypted.driver === 'mslug3fd', `mslug3nd should boot as mslug3fd, got ${decrypted.driver}`);

await expectNames('mslug.zip', 'mslug', ['201-p1.p1', '201-c1.c1', '201-c4.c4', '201-m1.m1']);
const mslug = await prepareArcadeZip(loadZip('mslug.zip'), 'mslug');
assert(mslug.renamed.some((line) => line.includes('mslug_c1.rom → 201-c1.c1') && line.includes('对调')), 'mslug c1 is half-swapped');
assert(mslug.renamed.some((line) => line.includes('mslug_p1.rom → 201-p1.p1') && !line.includes('对调')), 'mslug p1 is a plain rename');
const mslugNames = await namesOf(mslug.bytes);
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
assert(mslugxError.includes('只能换'), mslugxError);
console.log('ok mslugx error');

const sengoku3 = await prepareArcadeZip(loadZip('sengoku3.zip'), 'sengoku3');
assert(sengoku3.matched && sengoku3.driver === 'sengk3fd', `sengoku3 should boot as sengk3fd, got ${sengoku3.driver}`);
assert(sengoku3.renamed.some((line) => line.includes('261-p1.bin → 261-p2d.sp2') && line.includes('取前半')), 'sengoku3 p2 is the first half');
assert(sengoku3.renamed.some((line) => line.includes('261-p1.bin → 261-ph1d.p1') && line.includes('取后半')), 'sengoku3 p1 is the second half');
assert(sengoku3.renamed.some((line) => line.includes('sen3n_c1.rom → 261-c1d.c1')), 'sengoku3 uses decrypted c1');
assert(sengoku3.renamed.some((line) => line.includes('sen3n_s1.rom → 261-s1d.s1')), 'sengoku3 uses decrypted s1');
assert(sengoku3.renamed.some((line) => line.includes('261-m1.bin → 261-m1.m1') && line.includes('0xFF')), 'sengoku3 m1 is padded');
const sengoku3Entries = await readZip(sengoku3.bytes);
const sengoku3Names = new Set(sengoku3Entries.map((entry) => entry.name));
for (const name of ['261-ph1d.p1', '261-p2d.sp2', '261-s1d.s1', '261-c1d.c1', '261-m1.m1']) {
  assert(sengoku3Names.has(name), `sengoku3 missing ${name}`);
}
assert(!sengoku3Names.has('261-ph1.p1') && !sengoku3Names.has('261-c1.c1'), 'sengoku3 must not keep the encrypted names');
const sengokuCrc = (name) => {
  const entry = sengoku3Entries.find((item) => item.name === name);
  assert(entry, name);
  return (crc32(entry.data) >>> 0).toString(16).padStart(8, '0');
};
assert(sengokuCrc('261-ph1d.p1') === '9295cc2c', 'sengoku3 ph1d crc');
assert(sengokuCrc('261-p2d.sp2') === 'c74e374c', 'sengoku3 p2d crc');
assert(sengoku3Entries.find((entry) => entry.name === '261-ph1d.p1').data.length === 1048576, 'sengoku3 ph1d size');
const m1 = sengoku3Entries.find((entry) => entry.name === '261-m1.m1');
assert(m1 && m1.data.length === 524288, 'sengoku3 m1 size');
assert((crc32(m1.data) >>> 0).toString(16).padStart(8, '0') === '7d501c39', 'sengoku3 m1 crc');
console.log('ok sengoku3 decrypted set');

const encryptedOnly = (await readZip(loadZip('sengoku3.zip'))).filter((entry) => !entry.name.toLowerCase().startsWith('sen3n'));
const encryptedZip = await prepareArcadeZip(writeStoredZip(encryptedOnly), 'sengoku3');
assert(encryptedZip.matched && encryptedZip.driver === 'sengoku3', `encrypted-only sengoku3 got ${encryptedZip.driver}`);
const encryptedM1 = (await readZip(encryptedZip.bytes)).find((entry) => entry.name === '261-m1.m1');
assert(encryptedM1 && encryptedM1.data.length === 524288, 'encrypted sengoku3 m1 size');
assert((crc32(encryptedM1.data) >>> 0).toString(16).padStart(8, '0') === '7d501c39', 'encrypted sengoku3 m1 crc');
console.log('ok sengoku3 encrypted fallback');

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

await expectReject('1941.zip', '1941', ['41em_30.11f', '4249ec61', '修订']);
await expectReject('captcomm.zip', 'captcomm', ['cce_23f.8f', '修订']);
await expectReject('wof.zip', 'wof', ['tk2e_23c.8f', 'tk2e_22c.7f', '修订']);
if (!ARCADE_SETS.batcirj) {
  await expectReject('batcirj.zip', 'batcirj', ['batcirj', '9f9fb965']);
} else {
  await expectReject('batcirj.zip', 'batcirj', ['btc.13m', '父集']);
  const merged = await prepareArcadeZip(loadZip('batcirj.zip'), 'batcirj', [loadZip('batcir.zip')]);
  assert(merged.matched && merged.driver === 'batcirj' && !merged.blocked, `batcirj merge ${merged.driver} blocked=${merged.blocked || ''}`);
  const mergedEntries = await readZip(merged.bytes);
  const mergedCrc = (fileName) => {
    const entry = mergedEntries.find((item) => item.name === fileName);
    assert(entry, fileName);
    return (crc32(entry.data) >>> 0).toString(16).padStart(8, '0');
  };
  assert(mergedCrc('btcj.03') === '6b7e168d', 'batcirj program crc');
  assert(mergedCrc('btc.13m') === 'dc705bad', 'batcirj gfx from parent');
  assert(mergedCrc('batcirj.key') === '9f9fb965', 'batcirj key crc');
  const mergedNames = new Set(mergedEntries.map((entry) => entry.name));
  assert(!mergedNames.has('btcjx.03') && !mergedNames.has('btce.03'), 'batcirj drops the other program revision');
  assert(merged.renamed.some((line) => line.includes('batcirj.key') && line.includes('密钥')), 'batcirj key injected');
  console.log('ok batcirj parent merge');
}
await expectReject('mslug5nd.zip', 'mslug5', ['mslug5fd', 'CMC50']);

const { cps2KeyBytes, decodeCps2Key } = await vite.ssrLoadModule('/src/cps2-keys.ts');
const batcirKey = cps2KeyBytes('batcir.key', 'e316ae67');
const batcirjKey = cps2KeyBytes('batcirj.key', '9f9fb965');
assert(batcirKey && batcirKey.length === 20, 'batcir key bytes');
assert(batcirjKey && batcirjKey.length === 20, 'batcirj key bytes');
assert(cps2KeyBytes('batcir.key', '00000000') === null, 'batcir key crc gate');
const batcirDecoded = decodeCps2Key(batcirKey);
const batcirjDecoded = decodeCps2Key(batcirjKey);
assert(batcirDecoded && batcirDecoded.key1 === 0xd195e597 && batcirDecoded.key2 === 0x3cbce2b5, 'batcir key decode');
assert(batcirDecoded.start === 0 && batcirDecoded.end === 0x200000, 'batcir key range');
assert(batcirjDecoded && batcirjDecoded.key1 === 0x00ff4dd8 && batcirjDecoded.key2 === 0x000008e8, 'batcirj key decode');
console.log('ok cps2 key tables');

const batcir = await prepareArcadeZip(loadZip('batcir.zip'), 'batcir');
assert(batcir.matched && batcir.driver === 'batcir' && !batcir.blocked, `batcir ${batcir.driver} blocked=${batcir.blocked || ''}`);
assert(batcir.renamed.some((line) => line.includes('batcir.key') && line.includes('密钥')), 'batcir key injected');
const batcirEntries = await readZip(batcir.bytes);
const batcirKeyEntry = batcirEntries.find((entry) => entry.name === 'batcir.key');
assert(batcirKeyEntry && batcirKeyEntry.data.length === 20, 'batcir.key size');
assert((crc32(batcirKeyEntry.data) >>> 0).toString(16).padStart(8, '0') === 'e316ae67', 'batcir.key crc');
console.log('ok batcir key inject');

const mslug4 = await prepareArcadeZip(loadZip('mslug4.zip'), 'mslug4');
assert(mslug4.matched && mslug4.driver === 'mslug4', `mslug4 driver ${mslug4.driver}`);
assert(mslug4.blocked && mslug4.blocked.includes('CMC50') && mslug4.blocked.includes('mslug4fd'), mslug4.blocked || 'mslug4 not blocked');
assert(mslug4.renamed.some((line) => line.includes('263-c1.bin → 263-c1.c1') && line.includes('4 字节')), 'mslug4 c1 patched');
assert(mslug4.renamed.some((line) => line.includes('263-c6.bin → 263-c6.c6') && line.includes('4 字节')), 'mslug4 c6 patched');
assert(mslug4.renamed.some((line) => line.includes('263-m1.bin → 263-m1.m1') && line.includes('0xFF')), 'mslug4 m1 padded');
const mslug4Entries = await readZip(mslug4.bytes);
const mslug4Crc = (name) => {
  const entry = mslug4Entries.find((item) => item.name === name);
  assert(entry, name);
  return (crc32(entry.data) >>> 0).toString(16).padStart(8, '0');
};
const mslug4Expect = {
  '263-c1.c1': '84865f8a',
  '263-c2.c2': '81df97f2',
  '263-c3.c3': '1a343323',
  '263-c4.c4': '942cfb44',
  '263-c5.c5': 'a748854f',
  '263-c6.c6': '5c8ba116',
  '263-m1.m1': '46ac8228',
};
for (const [name, crc] of Object.entries(mslug4Expect)) {
  assert(mslug4Crc(name) === crc, `${name} crc ${mslug4Crc(name)} !== ${crc}`);
}
assert(mslug4Entries.find((entry) => entry.name === '263-m1.m1').data.length === 131072, 'mslug4 m1 size');
console.log('ok mslug4 c patch and m1 pad');

const wrongC = writeStoredZip([{ name: '263-c1.bin', data: new Uint8Array(0x800000).fill(0x11) }]);
let wrongCError = '';
try {
  const prepared = await prepareArcadeZip(wrongC, 'mslug4');
  assert(prepared.matched === false, 'wrong mslug4 c1 must not match');
  wrongCError = prepared.renamed.join(' ');
} catch (error) {
  wrongCError = error instanceof Error ? error.message : String(error);
}
assert(wrongCError.includes('263-c1.c1'), wrongCError);
assert(wrongCError.includes('84865f8a'), wrongCError);
assert(!wrongCError.includes('补 4 字节'), wrongCError);
console.log('ok mslug4 patch refused');

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
