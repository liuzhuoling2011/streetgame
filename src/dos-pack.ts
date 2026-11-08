import { type ByteSource } from './byte-source';
import { crc32, writeStoredZip } from './neogeo-bios';
import { formatBytes } from './progress';

const LAUNCHERS = ['play.bat', 'run.bat', 'start.bat', 'go.bat'];
const PREFERRED = ['pal.exe', 'pals.exe', 'game.exe', 'start.exe', 'main.exe', 'run.exe'];
const SKIP = /^(install|setup|uninst|readme|dosbox|config)/i;

export interface DosLaunch {
  dir: string;
  program: string;
}

export function isZipBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export function listZipNames(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes, view);
  if (eocd < 0) throw new Error('这个压缩包打不开。');
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  if (offset === 0xffffffff) throw new Error('这个压缩包用了 ZIP64，当前 DOS 装载还不认识。');
  const names: string[] = [];
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) break;
    const flags = view.getUint16(offset + 8, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    names.push(decodeZipName(nameBytes, (flags & 0x800) !== 0));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

export function dosLaunch(names: string[]): DosLaunch | null {
  const files = names
    .map((name) => name.replaceAll('\\', '/'))
    .filter((name) => name.length > 0 && !name.endsWith('/') && !name.startsWith('__MACOSX/') && !name.split('/').includes('.jsdos'));
  if (files.length === 0) return null;
  const tops = new Set(files.map((name) => name.split('/')[0]));
  const nested = tops.size === 1 && files.every((name) => name.includes('/'));
  const dir = nested ? [...tops][0] : '';
  const prefix = dir ? `${dir}/` : '';
  const here = files.filter((name) => {
    const rest = dir ? name.slice(prefix.length) : name;
    return rest.length > 0 && !rest.includes('/');
  });
  const program = pickProgram(here.map((name) => name.split('/').pop() || ''));
  if (!program) return null;
  return { dir, program };
}

export function isDosBundle(names: string[]): boolean {
  return names.some((name) => name.replaceAll('\\', '/').toLowerCase() === '.jsdos/dosbox.conf');
}

export function wrapProgram(name: string, bytes: Uint8Array): Uint8Array {
  const base = name.split(/[/\\]/).pop() || 'game.exe';
  return writeStoredZip([{ name: base, data: bytes }]);
}

function pickProgram(names: string[]): string | null {
  const files = names.filter((name) => name.length > 0);
  const byLower = new Map(files.map((name) => [name.toLowerCase(), name]));
  for (const launcher of LAUNCHERS) {
    const found = byLower.get(launcher);
    if (found) return found;
  }
  const programs = files.filter((name) => /\.(exe|com|bat)$/i.test(name) && !SKIP.test(name));
  if (programs.length === 1) return programs[0];
  for (const preferred of PREFERRED) {
    const found = byLower.get(preferred);
    if (found && programs.includes(found)) return found;
  }
  return programs[0] ?? null;
}

function findEocd(bytes: Uint8Array, view: DataView): number {
  const signature = 0x06054b50;
  const start = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === signature) return offset;
  }
  return -1;
}

function decodeZipName(bytes: Uint8Array, utf8: boolean): string {
  const encoding = utf8 ? 'utf-8' : 'gbk';
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/**
 * Unpacked bytes kept in DOSBox. Phone tabs die when the renderer is asked
 * for several hundred megabytes at once. The DOS 仙剑 executable is small;
 * the AVI and MP3 files in that pack are not what PLAY.BAT launches.
 */
export const DOS_UNPACKED_BUDGET = 96 * 1024 * 1024;

const BULK_MEDIA = /\.(avi|mp3|mp4|mkv|wav|flac|ogg|wmv|mpg|mpeg)$/i;
const ESSENTIAL = new Set([
  'exe', 'com', 'bat', 'mkf', 'msg', 'fon', 'dat', 'cfg', 'conf', 'txt', 'asc',
  'drv', 'ini', 'sys', 'ovl', 'dll', 'bbx', 'pal', 'js3', 'c',
]);

export interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

export function isBulkMedia(name: string): boolean {
  const parts = name.replaceAll('\\', '/').split('/');
  const base = parts[parts.length - 1] || name;
  if (BULK_MEDIA.test(base)) return true;
  return parts.some((part) => part.toLowerCase() === 'mp3');
}

export function selectDosFiles(entries: readonly ZipEntry[], budget = DOS_UNPACKED_BUDGET): {
  kept: ZipEntry[];
  skipped: ZipEntry[];
} {
  const files = entries.filter((entry) => entry.name.length > 0 && !entry.name.endsWith('/'));
  const total = files.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  if (total <= budget) return { kept: files, skipped: [] };

  const skipped: ZipEntry[] = [];
  const kept: ZipEntry[] = [];
  for (const entry of files) {
    if (isBulkMedia(entry.name)) skipped.push(entry);
    else kept.push(entry);
  }
  let keptBytes = kept.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  if (keptBytes <= budget) return { kept, skipped };

  const essential: ZipEntry[] = [];
  const optional: ZipEntry[] = [];
  for (const entry of kept) {
    if (isEssential(entry.name)) essential.push(entry);
    else optional.push(entry);
  }
  const still: ZipEntry[] = [];
  let bytes = essential.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  for (const entry of optional.sort((a, b) => a.uncompressedSize - b.uncompressedSize)) {
    if (bytes + entry.uncompressedSize <= budget) {
      still.push(entry);
      bytes += entry.uncompressedSize;
    } else {
      skipped.push(entry);
    }
  }
  return { kept: [...essential, ...still], skipped };
}

export function skippedMediaSummary(skipped: readonly ZipEntry[]): string | null {
  if (skipped.length === 0) return null;
  const bytes = skipped.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  const avi = skipped.filter((entry) => /\.avi$/i.test(entry.name)).length;
  const mp3 = skipped.filter((entry) => /\.mp3$/i.test(entry.name)).length;
  const parts: string[] = [];
  if (avi > 0) parts.push(`${avi} 个动画`);
  if (mp3 > 0) parts.push(`${mp3} 首 MP3`);
  const rest = skipped.length - avi - mp3;
  if (rest > 0) parts.push(`${rest} 个大文件`);
  const what = parts.length > 0 ? parts.join('、') : `${skipped.length} 个文件`;
  return `留在包里不装进内存：${what}，约 ${formatBytes(bytes)}。DOS 版按 MIDI 开，避免把手机页面撑崩。`;
}

export async function sourceLooksLikeDos(source: ByteSource): Promise<boolean> {
  try {
    if (source.size < 4) return false;
    const head = await source.read(0, 4);
    if (!isZipBytes(head)) return false;
    const entries = await readZipEntries(source);
    const names = entries.map((entry) => entry.name);
    return isDosBundle(names) || dosLaunch(names) !== null;
  } catch {
    return false;
  }
}

export async function readZipEntries(source: ByteSource): Promise<ZipEntry[]> {
  const tailSize = Math.min(source.size, 22 + 0xffff);
  const tail = await source.read(source.size - tailSize, tailSize);
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  const eocd = findEocd(tail, view);
  if (eocd < 0) throw new Error('这个压缩包打不开。');
  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    throw new Error('这个压缩包用了 ZIP64，当前 DOS 装载还不认识。');
  }
  if (cdOffset + cdSize > source.size) throw new Error('这个压缩包的目录读不出来。');
  const directory = await source.read(cdOffset, cdSize);
  const dir = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const entries: ZipEntry[] = [];
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > directory.length || dir.getUint32(offset, true) !== 0x02014b50) break;
    const flags = dir.getUint16(offset + 8, true);
    const method = dir.getUint16(offset + 10, true);
    const crc = dir.getUint32(offset + 16, true);
    const compressedSize = dir.getUint32(offset + 20, true);
    const uncompressedSize = dir.getUint32(offset + 24, true);
    const nameLength = dir.getUint16(offset + 28, true);
    const extraLength = dir.getUint16(offset + 30, true);
    const commentLength = dir.getUint16(offset + 32, true);
    const localOffset = dir.getUint32(offset + 42, true);
    const nameBytes = directory.subarray(offset + 46, offset + 46 + nameLength);
    entries.push({
      name: decodeZipName(nameBytes, (flags & 0x800) !== 0).replaceAll('\\', '/'),
      method,
      flags,
      crc,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export async function readZipFile(source: ByteSource, entry: ZipEntry): Promise<Uint8Array> {
  if ((entry.flags & 0x1) !== 0) throw new Error(`${entry.name} 加了密码，浏览器读不了。`);
  if (entry.method !== 0 && entry.method !== 8) {
    throw new Error(`${entry.name} 的压缩方式（${entry.method}）读不了。`);
  }
  if (entry.localOffset + 30 > source.size) throw new Error(`${entry.name} 的本地头不对。`);
  const local = await source.read(entry.localOffset, 30);
  const view = new DataView(local.buffer, local.byteOffset, local.byteLength);
  if (view.getUint32(0, true) !== 0x04034b50) throw new Error(`${entry.name} 的本地头不对。`);
  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  const dataOffset = entry.localOffset + 30 + nameLength + extraLength;
  if (dataOffset + entry.compressedSize > source.size) throw new Error(`${entry.name} 的数据超出了压缩包。`);
  const compressed = await source.read(dataOffset, entry.compressedSize);
  const data = entry.method === 0 ? new Uint8Array(compressed) : await inflateRaw(compressed);
  if (data.byteLength !== entry.uncompressedSize) throw new Error(`${entry.name} 解压后的大小不对。`);
  if (crc32(data) !== entry.crc) throw new Error(`${entry.name} 校验不对。`);
  return data;
}

function isEssential(name: string): boolean {
  const base = (name.split('/').pop() || name).toLowerCase();
  if (base === 'readme') return true;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return base.length > 0 && base.length <= 12;
  return ESSENTIAL.has(base.slice(dot + 1));
}

async function inflateRaw(compressed: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([compressed as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
