import { ARCADE_SETS } from './arcade-romsets';
import { basename, crc32, readZip, writeStoredZip } from './neogeo-bios';

// TatoEmu matches a game zip by exact filename, size, and CRC.
// MAME dumps usually use NNN-p1.bin where FBNeo wants NNN-p1.p1. The second
// program ROM is not one extension: kof98 wants 242-p2.sp2, kof2000 wants
// 257-p2.p2, mslug3 wants 256-pg2.p2, and mslugx wants 250-p2.ep1. Matching
// the emulator catalog by CRC picks the right name, including files that were
// stored under a different label (kof98's 242-p1.p1 is yz98-p1.160 in this
// dump, and 242-m1.m1 is 242-m1a.bin). A same-stem .bin with the wrong CRC,
// such as the 1MB 242-p1.bin, is left out.
//
// Kawaks / pre-MAME layouts that still contain the FBNeo bytes:
//   * C ROMs loaded with ROM_CONTINUE stored the high bank first. Swapping
//     the two halves produces the linear file (mslug_c1.rom → 201-c1.c1).
//   * A short M1 or Z80 dump is the real chip followed by erased 0xFF
//     (261-m1.bin 128KB → 261-m1.m1 512KB, 263-m1.bin 64KB → 263-m1.m1).
//   * Old mslug4 encrypted C dumps differ by four bytes, at offset 0 and
//     0x400000. Patching those bytes yields the current catalog CRC.
//   * sengoku3's 2MB 261-p1.bin is decrypted P2 followed by decrypted P1.
//     Together with sen3n_* C/S that already match sengk3fd, that split
//     boots the decrypted driver. This WASM rejects the encrypted driver
//     (CMC42 / CMC50 / SMA / encrypted M1) before it reads the zip.
// The transformed bytes are kept only when their CRC is the catalog CRC.
// A random or corrupt file still fails with the missing name and both CRCs.

const MAME_BIN = /^(\d{3})-(.+)\.bin$/i;

// TatoEmu returns "Encrypted NeoGeo games are not supported yet" for these
// drivers. The sibling is the decrypted catalog set to try first.
const DECRYPTED_SIBLING: Record<string, string> = {
  sengoku3: 'sengk3fd',
};

interface HeaderPatch {
  size: number;
  fromCrc: string;
  toCrc: string;
  words: ReadonlyArray<readonly [number, number, number]>;
}

// Verified on the bundled WinKawaks mslug4 C dumps: old CRC, then the two
// bytes at 0 and the two bytes at 0x400000, then the current FBNeo CRC.
const MSLUG4_C_PATCHES: HeaderPatch[] = [
  { size: 0x800000, fromCrc: '6c2b0856', toCrc: '84865f8a', words: [[0, 0x11, 0x5c], [0x400000, 0x11, 0x5c]] },
  { size: 0x800000, fromCrc: 'c6035792', toCrc: '81df97f2', words: [[0, 0xf5, 0xac], [0x400000, 0xf5, 0xac]] },
  { size: 0x800000, fromCrc: '0721d112', toCrc: '1a343323', words: [[0, 0x17, 0x22], [0x400000, 0x11, 0x5c]] },
  { size: 0x800000, fromCrc: '6aa688dd', toCrc: '942cfb44', words: [[0, 0xf4, 0x2c], [0x400000, 0xf5, 0xac]] },
  { size: 0x800000, fromCrc: '794bc2d6', toCrc: 'a748854f', words: [[0, 0xee, 0xa3], [0x400000, 0xee, 0xa3]] },
  { size: 0x800000, fromCrc: 'f85eae54', toCrc: '5c8ba116', words: [[0, 0x0a, 0x53], [0x400000, 0x0a, 0xac]] },
];

const PATCH_BY_CRC = new Map(MSLUG4_C_PATCHES.map((patch) => [patch.fromCrc, patch]));

export interface PreparedGameZip {
  bytes: Uint8Array;
  renamed: string[];
  driver: string;
  matched: boolean;
}

interface ZipFile {
  name: string;
  data: Uint8Array;
  size: number;
  crc: string;
}

interface RomSpec {
  name: string;
  size: number;
  crc: string;
}

interface RomMatch {
  name: string;
  from: string;
  data: Uint8Array;
  note: string;
}

interface ScoredSet {
  driver: string;
  matches: RomMatch[];
  missing: RomSpec[];
}

export async function prepareArcadeZip(bytes: Uint8Array, driver: string): Promise<PreparedGameZip> {
  const hint = driver.toLowerCase();
  let entries: Array<{ name: string; data: Uint8Array }>;
  try {
    entries = await readZip(bytes);
  } catch {
    return { bytes, renamed: [], driver: hint, matched: false };
  }
  const files = entries
    .map((entry) => {
      const name = basename(entry.name);
      return { name, data: entry.data, size: entry.data.length, crc: crcHex(entry.data) };
    })
    .filter((file) => file.name.length > 0);

  const requested = scoreSet(hint, files, true);
  const siblingName = DECRYPTED_SIBLING[hint];
  if (siblingName && siblingName !== hint) {
    const sibling = scoreSet(siblingName, files, true);
    if (sibling && sibling.missing.length === 0) return finish(bytes, files, sibling);
  }
  if (requested && requested.missing.length === 0) return finish(bytes, files, requested);
  const alternate = bestComplete(files, hint, Boolean(requested));
  if (alternate) return finish(bytes, files, alternate);
  if (requested) throw new Error(formatMissing(hint, requested.missing, files));
  return fallback(bytes, files, hint);
}

export function prepareNeoGeoGameZip(bytes: Uint8Array, driver = ''): Promise<PreparedGameZip> {
  return prepareArcadeZip(bytes, driver);
}

function finish(original: Uint8Array, files: ZipFile[], scored: ScoredSet): PreparedGameZip {
  const renamed: string[] = [];
  const next = scored.matches.map((match) => {
    if (match.from.toLowerCase() !== match.name.toLowerCase() || match.note) {
      renamed.push(match.note ? `${match.from} → ${match.name}（${match.note}）` : `${match.from} → ${match.name}`);
    }
    return { name: match.name, data: match.data };
  });
  const unchanged = files.length === next.length
    && files.every((file, index) => file.name === next[index].name && file.data === next[index].data);
  return {
    bytes: unchanged ? original : writeStoredZip(next),
    renamed,
    driver: scored.driver,
    matched: true,
  };
}

function scoreSet(driver: string, files: ZipFile[], allowLayout: boolean): ScoredSet | null {
  const spec = ARCADE_SETS[driver];
  if (!spec) return null;
  const roms: RomSpec[] = spec.map(([name, size, crc]) => ({ name, size, crc }));
  const used = new Set<number>();
  const parts = new Set<string>();
  const matches: RomMatch[] = [];
  const missing: RomSpec[] = [];
  for (const rom of roms) {
    const index = files.findIndex((file, fileIndex) => !used.has(fileIndex) && file.size === rom.size && file.crc === rom.crc);
    if (index < 0) {
      missing.push(rom);
      continue;
    }
    used.add(index);
    matches.push({ name: rom.name, from: files[index].name, data: files[index].data, note: '' });
  }
  if (allowLayout) fillLayout(files, used, parts, matches, missing);
  return { driver, matches, missing };
}

function fillLayout(
  files: ZipFile[],
  used: Set<number>,
  parts: Set<string>,
  matches: RomMatch[],
  missing: RomSpec[],
): void {
  for (let slot = 0; slot < missing.length;) {
    const rom = missing[slot];
    const hit = layoutMatch(files, used, parts, rom);
    if (!hit) {
      slot += 1;
      continue;
    }
    if (hit.part === undefined) used.add(hit.index);
    else parts.add(`${hit.index}:${hit.part}`);
    matches.push({ name: rom.name, from: hit.from, data: hit.data, note: hit.note });
    missing.splice(slot, 1);
  }
}

function wholeFree(used: Set<number>, parts: Set<string>, index: number): boolean {
  return !used.has(index) && !parts.has(`${index}:0`) && !parts.has(`${index}:1`);
}

function layoutMatch(
  files: ZipFile[],
  used: Set<number>,
  parts: Set<string>,
  rom: RomSpec,
): { index: number; part?: number; from: string; data: Uint8Array; note: string } | null {
  for (let index = 0; index < files.length; index += 1) {
    if (!wholeFree(used, parts, index)) continue;
    const file = files[index];
    if (file.size !== rom.size) continue;
    const patch = PATCH_BY_CRC.get(file.crc);
    if (!patch || patch.size !== file.size || patch.toCrc !== rom.crc) continue;
    const patched = applyHeaderPatch(file.data, patch);
    if (crcHex(patched) !== rom.crc) continue;
    return { index, from: file.name, data: patched, note: '补 4 字节加密头' };
  }
  for (let index = 0; index < files.length; index += 1) {
    if (!wholeFree(used, parts, index)) continue;
    const file = files[index];
    if (file.size !== rom.size || file.size < 2 || file.size % 2 !== 0) continue;
    const swapped = swapHalves(file.data);
    if (crcHex(swapped) !== rom.crc) continue;
    return { index, from: file.name, data: swapped, note: '前后两半对调' };
  }
  for (let index = 0; index < files.length; index += 1) {
    if (!wholeFree(used, parts, index)) continue;
    const file = files[index];
    if (file.size === 0 || file.size >= rom.size || rom.size % file.size !== 0) continue;
    const ratio = rom.size / file.size;
    if (ratio !== 2 && ratio !== 4 && ratio !== 8) continue;
    const padded = padFF(file.data, rom.size);
    if (crcHex(padded) !== rom.crc) continue;
    return { index, from: file.name, data: padded, note: `用 0xFF 补到 ${sizeText(rom.size)}` };
  }
  for (let index = 0; index < files.length; index += 1) {
    if (used.has(index) || rom.size === 0 || files[index].size !== rom.size * 2) continue;
    const file = files[index];
    const mid = rom.size;
    if (!parts.has(`${index}:0`)) {
      const first = file.data.subarray(0, mid);
      if (crcHex(first) === rom.crc) {
        return { index, part: 0, from: file.name, data: new Uint8Array(first), note: '取前半' };
      }
    }
    if (!parts.has(`${index}:1`)) {
      const second = file.data.subarray(mid);
      if (crcHex(second) === rom.crc) {
        return { index, part: 1, from: file.name, data: new Uint8Array(second), note: '取后半' };
      }
    }
  }
  return null;
}

function applyHeaderPatch(data: Uint8Array, patch: HeaderPatch): Uint8Array {
  const out = new Uint8Array(data);
  for (const [offset, first, second] of patch.words) {
    if (offset < 0 || offset + 1 >= out.length) continue;
    out[offset] = first;
    out[offset + 1] = second;
  }
  return out;
}

export function swapHalves(data: Uint8Array): Uint8Array {
  const half = data.length >>> 1;
  const out = new Uint8Array(data.length);
  out.set(data.subarray(half), 0);
  out.set(data.subarray(0, half), half);
  return out;
}

export function padFF(data: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  out.fill(0xff);
  out.set(data, 0);
  return out;
}

function bestComplete(files: ZipFile[], hint: string, requestedKnown: boolean): ScoredSet | null {
  let best: ScoredSet | null = null;
  for (const driver of Object.keys(ARCADE_SETS)) {
    if (driver === hint) continue;
    const scored = scoreSet(driver, files, false);
    if (!scored || scored.missing.length > 0) continue;
    if (requestedKnown && !related(hint, driver)) continue;
    if (!best || scored.matches.length > best.matches.length || (scored.matches.length === best.matches.length && driver.length < best.driver.length)) {
      best = scored;
    }
  }
  return best;
}

function related(hint: string, driver: string): boolean {
  const width = Math.min(4, hint.length, driver.length);
  return width >= 3 && hint.slice(0, width) === driver.slice(0, width);
}

function fallback(original: Uint8Array, files: ZipFile[], hint: string): PreparedGameZip {
  const present = new Set(files.map((file) => file.name.toLowerCase()));
  const renamed: string[] = [];
  const next = files.map((file) => {
    const target = fbneoName(file.name);
    if (!target || present.has(target.toLowerCase())) return { name: file.name, data: file.data };
    renamed.push(`${file.name} → ${target}`);
    return { name: target, data: file.data };
  });
  if (renamed.length > 0) {
    return { bytes: writeStoredZip(next), renamed, driver: hint, matched: false };
  }
  if (looksArcade(files)) throw new Error(formatUnmatched(hint, files));
  return { bytes: original, renamed, driver: hint, matched: false };
}

function formatMissing(driver: string, missing: RomSpec[], files: ZipFile[]): string {
  const lines = missing.slice(0, 4).map((rom) => describeGap(driver, rom, files));
  const more = missing.length > 4 ? `另外还有 ${missing.length - 4} 个对不上。` : '';
  const key = missing.find((rom) => rom.name.endsWith('.key'));
  const keyNote = key
    ? `${key.name} 是 CPS2 密钥（${key.size} 字节）。WinKawaks 把密钥做在程序里，zip 里没有这份文件就开不了。`
    : '';
  return `${driver}.zip 对不上 FBNeo。${lines.join('；')}。${more}${keyNote}这些字节和模拟器目录不一致，不能当成这套游戏开。`;
}

function describeGap(driver: string, rom: RomSpec, files: ZipFile[]): string {
  const spec = ARCADE_SETS[driver] ?? [];
  const claimed = (file: ZipFile) => spec.some(([, size, crc]) => file.size === size && file.crc === crc);
  const same = files.filter((file) => file.size === rom.size && !claimed(file));
  if (same.length === 0) return `缺 ${rom.name}（${sizeText(rom.size)}，CRC ${rom.crc}），包里没有这个大小的文件`;
  const sample = same.slice(0, 2).map((file) => `${file.name} 的 CRC 是 ${file.crc}`).join('，');
  return `${rom.name} 要 CRC ${rom.crc}，同大小的 ${sample}`;
}

function formatUnmatched(driver: string, files: ZipFile[]): string {
  const sample = files.map((file) => file.name).filter(Boolean).slice(0, 4).join('、');
  const who = driver || '这个包';
  return `${who}.zip 对不上模拟器里的完整游戏。包里有 ${sample}。请换一份干净的 FBNeo 非合并 zip。`;
}

function sizeText(size: number): string {
  if (size % 1048576 === 0) return `${size / 1048576}MB`;
  if (size % 1024 === 0) return `${size / 1024}KB`;
  return `${size} 字节`;
}

function oddNames(files: ZipFile[]): string[] {
  return files
    .map((file) => file.name)
    .filter((name) => /_(p|c|s|m|v)\d/i.test(name) || /\.160$/i.test(name) || /m1[a-z]\.bin$/i.test(name) || /^yz/i.test(name));
}

function looksArcade(files: ZipFile[]): boolean {
  return files.some((file) => Boolean(fbneoName(file.name)) || oddNames([file]).length > 0 || /^btc/i.test(file.name));
}

export function fbneoName(name: string): string | null {
  const match = basename(name).match(MAME_BIN);
  if (!match || !/^[a-z0-9][a-z0-9.-]*$/i.test(match[2])) return null;
  return `${match[1]}-${match[2]}.${extensionFor(match[2])}`;
}

function extensionFor(token: string): string {
  const lower = token.toLowerCase();
  // Second 68K ROM. Real sets that want .p2 or .ep1 are chosen from ARCADE_SETS
  // before this fallback runs.
  if (/^(p2|ph2|pg2)(-|$)/.test(lower)) return 'sp2';
  const kind = lower.match(/^(p1|s\d+|c\d+|m\d+|v\d+)/);
  if (kind) return kind[1];
  return lower.split('-').pop() ?? lower;
}

function crcHex(data: Uint8Array): string {
  return (crc32(data) >>> 0).toString(16).padStart(8, '0');
}
