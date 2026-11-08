/**
 * DOS pack memory budget.
 *
 * Proves the 仙剑 loader never materialises the 333 MB archive or its
 * AVI/MP3 payload. Ranges come from the shipped parts.
 *
 *   node --experimental-strip-types scripts/test-dos-memory.mjs
 */
import { createHash } from 'node:crypto';
import { openSync, readSync, closeSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { memorySource } from '../src/byte-source.ts';
import {
  readZipEntries,
  readZipFile,
  selectDosFiles,
  skippedMediaSummary,
} from '../src/dos-pack.ts';
import { writeStoredZip } from '../src/neogeo-bios.ts';
import { createSha256, sha256Hex } from '../src/sha256.ts';

const root = process.cwd();
const partsDir = path.join(root, 'public/roms/parts');
const PALADIN_SIZE = 349634587;
const PALADIN_SHA = 'a41b3bcbbc0cdd879e4987a70a1010e49e05d0fde2c11638ea588448177ab22e';
const CHUNK = 10485760;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function partsSource() {
  const names = readdirSync(partsDir).filter((name) => name.startsWith('paladin.dosz.')).sort();
  assert(names.length === 34, `expected 34 paladin parts, got ${names.length}`);
  const fds = names.map((name) => openSync(path.join(partsDir, name), 'r'));
  const stats = { largest: 0, total: 0 };
  return {
    size: PALADIN_SIZE,
    stats,
    release() {
      for (const fd of fds) closeSync(fd);
    },
    async read(start, length) {
      assert(start >= 0 && length >= 0 && start + length <= PALADIN_SIZE, 'range outside paladin');
      stats.largest = Math.max(stats.largest, length);
      stats.total += length;
      const out = Buffer.alloc(length);
      let done = 0;
      while (done < length) {
        const pos = start + done;
        const index = Math.floor(pos / CHUNK);
        const inner = pos % CHUNK;
        const take = Math.min(length - done, CHUNK - inner);
        const n = readSync(fds[index], out, done, take, inner);
        assert(n === take, `short read at ${pos}`);
        done += n;
      }
      return new Uint8Array(out);
    },
  };
}

function testSha256() {
  assert(sha256Hex(new Uint8Array()) === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'empty sha');
  assert(sha256Hex(new TextEncoder().encode('abc')) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'abc sha');
  const payload = new Uint8Array(1000);
  for (let i = 0; i < payload.length; i += 1) payload[i] = i & 0xff;
  const hasher = createSha256();
  for (let offset = 0; offset < payload.length; offset += 3) {
    hasher.update(payload.subarray(offset, Math.min(payload.length, offset + 3)));
  }
  const incremental = hasher.digestHex();
  const once = sha256Hex(payload);
  const node = createHash('sha256').update(payload).digest('hex');
  assert(incremental === once && once === node, `incremental sha ${incremental} ${once} ${node}`);
  console.log('sha256 ok');
}

async function testSyntheticBudget() {
  const exe = new TextEncoder().encode('@echo off\r\nPAL\r\n');
  const avi = new Uint8Array(8000);
  avi.fill(7);
  const zip = writeStoredZip([
    { name: 'PLAY.BAT', data: exe },
    { name: 'movie.avi', data: avi },
    { name: 'Pal.exe', data: new Uint8Array([0x4d, 0x5a, 1, 2, 3]) },
  ]);
  const source = memorySource(zip);
  const entries = await readZipEntries(source);
  const selected = selectDosFiles(entries, 1000);
  const keptNames = selected.kept.map((entry) => entry.name).sort();
  assert(keptNames.includes('PLAY.BAT') && keptNames.includes('Pal.exe'), `kept ${keptNames.join(',')}`);
  assert(selected.skipped.some((entry) => entry.name === 'movie.avi'), 'avi was not skipped');
  assert(skippedMediaSummary(selected.skipped)?.includes('动画'), 'summary did not mention video');
  const reads = [];
  const counting = {
    size: source.size,
    async read(start, length) {
      reads.push(length);
      return source.read(start, length);
    },
  };
  for (const entry of selected.kept) {
    const data = await readZipFile(counting, entry);
    if (entry.name === 'PLAY.BAT') assert(new TextDecoder().decode(data) === '@echo off\r\nPAL\r\n', 'bat bytes changed');
  }
  assert(Math.max(...reads) < 8000, `synthetic read pulled the avi (${Math.max(...reads)})`);
  console.log('synthetic budget ok', { kept: keptNames, maxRead: Math.max(...reads) });
}

async function testPaladinParts() {
  const source = partsSource();
  try {
    const entries = await readZipEntries(source);
    const selected = selectDosFiles(entries);
    const kept = new Set(selected.kept.map((entry) => entry.name.toLowerCase()));
    assert(kept.has('play.bat'), 'PLAY.BAT missing');
    assert(kept.has('pal.exe'), 'Pal.exe missing');
    assert(kept.has('midi.mkf'), 'Midi.mkf missing');
    assert(![...kept].some((name) => name.endsWith('.avi') || name.endsWith('.mp3')), 'media stayed in the kept set');
    const keptBytes = selected.kept.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
    const skippedBytes = selected.skipped.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
    assert(keptBytes < 80 * 1024 * 1024, `kept ${keptBytes} is still too large`);
    assert(skippedBytes > 390 * 1024 * 1024, `skipped only ${skippedBytes}`);
    const before = process.memoryUsage().heapUsed;
    let bat = '';
    for (const entry of selected.kept) {
      const data = await readZipFile(source, entry);
      if (entry.name.toLowerCase() === 'play.bat') bat = new TextDecoder().decode(data);
    }
    const after = process.memoryUsage().heapUsed;
    assert(bat.replaceAll('\r', '') === '@echo off\nPAL\n' || bat.includes('PAL'), `unexpected PLAY.BAT ${JSON.stringify(bat)}`);
    assert(source.stats.largest <= 12 * 1024 * 1024, `largest read ${source.stats.largest}`);
    assert(source.stats.total < 80 * 1024 * 1024, `total read ${source.stats.total} pulled too much of the archive`);
    assert(after - before < 120 * 1024 * 1024, `heap grew by ${after - before}`);
    console.log('paladin selection ok', {
      files: entries.length,
      kept: selected.kept.length,
      skipped: selected.skipped.length,
      keptBytes,
      skippedBytes,
      largestRead: source.stats.largest,
      totalRead: source.stats.total,
      heapDelta: after - before,
    });
  } finally {
    source.release();
  }

  const hashing = partsSource();
  try {
    const hasher = createSha256();
    const node = createHash('sha256');
    for (let offset = 0; offset < PALADIN_SIZE; offset += 8 * 1024 * 1024) {
      const length = Math.min(8 * 1024 * 1024, PALADIN_SIZE - offset);
      const chunk = await hashing.read(offset, length);
      hasher.update(chunk);
      node.update(chunk);
    }
    const digest = hasher.digestHex();
    assert(digest === node.digest('hex'), 'incremental sha diverged from node');
    assert(digest === PALADIN_SHA, `paladin sha ${digest}`);
    assert(hashing.stats.largest <= 8 * 1024 * 1024, `hash read ${hashing.stats.largest}`);
    console.log('paladin sha256 ok', digest);
  } finally {
    hashing.release();
  }
}

testSha256();
await testSyntheticBudget();
await testPaladinParts();
console.log('DOS MEMORY CHECKS PASSED');
