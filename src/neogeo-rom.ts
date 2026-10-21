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

interface ScoredSet {
  driver: string;
  matches: Array<{ name: string; from: string; data: Uint8Array }>;
  missing: string[];
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

  const requested = scoreSet(hint, files);
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
    if (match.from.toLowerCase() !== match.name.toLowerCase()) renamed.push(`${match.from} → ${match.name}`);
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

function scoreSet(driver: string, files: ZipFile[]): ScoredSet | null {
  const spec = ARCADE_SETS[driver];
  if (!spec) return null;
  const used = new Set<number>();
  const matches: ScoredSet['matches'] = [];
  const missing: string[] = [];
  for (const [name, size, crc] of spec) {
    const index = files.findIndex((file, fileIndex) => !used.has(fileIndex) && file.size === size && file.crc === crc);
    if (index < 0) {
      missing.push(name);
      continue;
    }
    used.add(index);
    matches.push({ name, from: files[index].name, data: files[index].data });
  }
  return { driver, matches, missing };
}

function bestComplete(files: ZipFile[], hint: string, requestedKnown: boolean): ScoredSet | null {
  let best: ScoredSet | null = null;
  for (const driver of Object.keys(ARCADE_SETS)) {
    if (driver === hint) continue;
    const scored = scoreSet(driver, files);
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

function formatMissing(driver: string, missing: string[], files: ZipFile[]): string {
  const listed = missing.slice(0, 6).join('、');
  const rest = missing.length > 6 ? `，等 ${missing.length} 个` : '';
  const odd = oddNames(files);
  const oddText = odd.length > 0 ? `包里的 ${odd.slice(0, 4).join('、')} 不是 FBNeo 要的文件名。` : '';
  return `${driver}.zip 对不上 FBNeo 非合并包。缺：${listed}${rest}。${oddText}请换一份干净的 ${driver}.zip。`;
}

function formatUnmatched(driver: string, files: ZipFile[]): string {
  const sample = files.map((file) => file.name).slice(0, 4).join('、');
  const who = driver || '这个包';
  return `${who}.zip 对不上模拟器里的完整游戏。包里有 ${sample}。请换一份干净的 FBNeo 非合并 zip。`;
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
