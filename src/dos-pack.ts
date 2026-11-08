import { writeStoredZip } from './neogeo-bios';

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
