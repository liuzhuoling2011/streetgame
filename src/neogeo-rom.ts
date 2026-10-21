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
// Two Kawaks / pre-MAME-0.80 layouts still contain the FBNeo bytes:
//   * C ROMs loaded with ROM_CONTINUE stored the high bank first. Swapping
//     the two halves produces the linear file (mslug_c1.rom → 201-c1.c1).
//   * A short M1 or Z80 dump is the real chip followed by erased 0xFF
//     (261-m1.bin 128KB → 261-m1.m1 512KB, 263-m1.bin 64KB → 263-m1.m1).
// The transformed bytes are kept only when their CRC is the catalog CRC.
// A random or corrupt file still fails with the missing name and both CRCs.

const MAME_BIN = /^(\d{3})-(.+)\.bin$/i;

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
  if (allowLayout) fillLayout(files, used, matches, missing);
  return { driver, matches, missing };
}

function fillLayout(files: ZipFile[], used: Set<number>, matches: RomMatch[], missing: RomSpec[]): void {
  for (let slot = 0; slot < missing.length;) {
    const rom = missing[slot];
    const hit = layoutMatch(files, used, rom);
    if (!hit) {
      slot += 1;
      continue;
    }
    used.add(hit.index);
    matches.push({ name: rom.name, from: hit.from, data: hit.data, note: hit.note });
    missing.splice(slot, 1);
  }
}

function layoutMatch(
  files: ZipFile[],
  used: Set<number>,
  rom: RomSpec,
): { index: number; from: string; data: Uint8Array; note: string } | null {
  for (let index = 0; index < files.length; index += 1) {
    if (used.has(index)) continue;
    const file = files[index];
    if (file.size !== rom.size || file.size < 2 || file.size % 2 !== 0) continue;
    const swapped = swapHalves(file.data);
    if (crcHex(swapped) !== rom.crc) continue;
    return { index, from: file.name, data: swapped, note: '前后两半对调' };
  }
  for (let index = 0; index < files.length; index += 1) {
    if (used.has(index)) continue;
    const file = files[index];
    if (file.size === 0 || file.size >= rom.size || rom.size % file.size !== 0) continue;
    const ratio = rom.size / file.size;
    if (ratio !== 2 && ratio !== 4 && ratio !== 8) continue;
    const padded = padFF(file.data, rom.size);
    if (crcHex(padded) !== rom.crc) continue;
    return { index, from: file.name, data: padded, note: `用 0xFF 补到 ${sizeText(rom.size)}` };
  }
  return null;
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
