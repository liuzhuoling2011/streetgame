// TatoEmu's Neo Geo core does not load BIOS through loadBootromFile.
// It opens /roms/neogeo.zip beside the game and matches entries by filename
// plus exact size. The default 68K slot is uni-bios_4_0.rom. Common MAME packs
// use different names and a 64KB 000-lo.lo, so this rewrites the zip in memory.
// CRCs below are the public FBNeo/TatoEmu catalog, not ROM bytes.

interface BiosSlot {
  index: number;
  name: string;
  size: number;
}

const BIOS_68K: BiosSlot[] = [
  { index: 19, name: 'uni-bios_4_0.rom', size: 0x20000 },
  { index: 20, name: 'uni-bios_3_3.rom', size: 0x20000 },
  { index: 21, name: 'uni-bios_3_2.rom', size: 0x20000 },
  { index: 22, name: 'uni-bios_3_1.rom', size: 0x20000 },
  { index: 23, name: 'uni-bios_3_0.rom', size: 0x20000 },
  { index: 24, name: 'uni-bios_2_3.rom', size: 0x20000 },
  { index: 25, name: 'uni-bios_2_3o.rom', size: 0x20000 },
  { index: 26, name: 'uni-bios_2_2.rom', size: 0x20000 },
  { index: 27, name: 'uni-bios_2_1.rom', size: 0x20000 },
  { index: 28, name: 'uni-bios_2_0.rom', size: 0x20000 },
  { index: 29, name: 'uni-bios_1_3.rom', size: 0x20000 },
  { index: 30, name: 'uni-bios_1_2.rom', size: 0x20000 },
  { index: 31, name: 'uni-bios_1_2o.rom', size: 0x20000 },
  { index: 32, name: 'uni-bios_1_1.rom', size: 0x20000 },
  { index: 33, name: 'uni-bios_1_0.rom', size: 0x20000 },
  { index: 0, name: 'sp-s3.sp1', size: 0x20000 },
  { index: 1, name: 'sp-s2.sp1', size: 0x20000 },
  { index: 2, name: 'sp-s.sp1', size: 0x20000 },
  { index: 3, name: 'sp-u2.sp1', size: 0x20000 },
  { index: 8, name: 'vs-bios.rom', size: 0x20000 },
  { index: 9, name: 'sp-j2.sp1', size: 0x20000 },
  { index: 5, name: 'sp-e.sp1', size: 0x20000 },
  { index: 16, name: 'neo-epo.bin', size: 0x20000 },
  { index: 15, name: 'neo-po.bin', size: 0x20000 },
  { index: 17, name: 'neodebug.bin', size: 0x20000 },
  { index: 4, name: 'sp1-u2', size: 0x20000 },
  { index: 6, name: 'sp1-u4.bin', size: 0x20000 },
  { index: 7, name: 'sp1-u3.bin', size: 0x20000 },
  { index: 10, name: 'sp1.jipan.1024', size: 0x20000 },
  { index: 11, name: 'sp-45.sp1', size: 0x80000 },
  { index: 12, name: 'sp-j3.sp1', size: 0x80000 },
  { index: 13, name: 'japan-j3.bin', size: 0x20000 },
  { index: 14, name: 'sp1-j3.bin', size: 0x20000 },
  { index: 18, name: 'sp-1v1_3db8c.bin', size: 0x20000 },
  { index: 34, name: 'neopen.sp1', size: 0x20000 },
];

const CRC_ALIAS: Record<string, string> = {
  '91b64be3': 'sp-s3.sp1',
  '9036d879': 'sp-s2.sp1',
  c7f2fa45: 'sp-s.sp1',
  e72943de: 'sp-u2.sp1',
  '62f021f4': 'sp1-u2',
  '2723a5b5': 'sp-e.sp1',
  '1179a30f': 'sp1-u4.bin',
  '2025b7a2': 'sp1-u3.bin',
  f0e8f27d: 'vs-bios.rom',
  acede59c: 'sp-j2.sp1',
  '9fb0abe4': 'sp1.jipan.1024',
  '03cc9f6a': 'sp-45.sp1',
  '486cb450': 'sp-j3.sp1',
  dff6d41f: 'japan-j3.bin',
  fbc6d469: 'sp1-j3.bin',
  '16d0c132': 'neo-po.bin',
  d27a71f1: 'neo-epo.bin',
  '698ebb7d': 'neodebug.bin',
  '162f0ebe': 'sp-1v1_3db8c.bin',
  a7aab458: 'uni-bios_4_0.rom',
  '24858466': 'uni-bios_3_3.rom',
  a4e8b9b3: 'uni-bios_3_2.rom',
  '0c58093f': 'uni-bios_3_1.rom',
  a97c89a9: 'uni-bios_3_0.rom',
  '27664eb5': 'uni-bios_2_3.rom',
  '601720ae': 'uni-bios_2_3o.rom',
  '2d50996a': 'uni-bios_2_2.rom',
  '8dabf76b': 'uni-bios_2_1.rom',
  '0c12c2ad': 'uni-bios_2_0.rom',
  b24b44a0: 'uni-bios_1_3.rom',
  '4fa698e9': 'uni-bios_1_2.rom',
  e19d3ce9: 'uni-bios_1_2o.rom',
  '5dda0d84': 'uni-bios_1_1.rom',
  '0ce453a0': 'uni-bios_1_0.rom',
  cb915e76: 'neopen.sp1',
  '94416d67': 'sm1.sm1',
  c2ea0cfd: 'sfix.sfix',
  '5a86cff2': '000-lo.lo',
};

const SUPPORTING = [
  { name: 'sm1.sm1', size: 0x20000, label: 'sm1.sm1' },
  { name: 'sfix.sfix', size: 0x20000, label: 'sfix.sfix（或 sfix.sfx）' },
  { name: '000-lo.lo', size: 0x20000, label: '000-lo.lo（128KB，64KB 的会自动拼成两份）' },
];

export interface PreparedBios {
  bytes: Uint8Array;
  biosIndex: number;
  biosName: string;
}

export async function prepareNeoGeoBios(bytes: Uint8Array): Promise<PreparedBios> {
  const entries = await readZip(bytes);
  const files = new Map<string, Uint8Array>();
  for (const entry of entries) {
    const name = basename(entry.name);
    if (!name) continue;
    files.set(name, entry.data);
  }
  if (files.size === 0) throw new Error('neogeo.zip 是空的。');

  for (const [name, data] of [...files.entries()]) {
    if (stem(name) === '000-lo' && data.length === 0x10000) {
      const doubled = new Uint8Array(0x20000);
      doubled.set(data, 0);
      doubled.set(data, 0x10000);
      files.set(name, doubled);
    }
  }

  for (const data of files.values()) {
    const canonical = CRC_ALIAS[crc32Hex(data)];
    if (!canonical) continue;
    if ([...files.keys()].some((key) => key.toLowerCase() === canonical)) continue;
    files.set(canonical, data);
  }

  const chosen = BIOS_68K.find((slot) => hasEntry(files, slot.name, slot.size));
  if (!chosen) {
    throw new Error('这个 neogeo.zip 里没有模拟器认得的 68K BIOS。常见名字是 sp-s2.sp1、sp-s3.sp1、asia-s3.rom 或 uni-bios。');
  }
  const missing = SUPPORTING.filter((item) => !hasEntry(files, item.name, item.size)).map((item) => item.label);
  if (missing.length > 0) {
    throw new Error(`这个 neogeo.zip 还缺：${missing.join('、')}。`);
  }

  return {
    bytes: writeStoredZip([...files.entries()].map(([name, data]) => ({ name, data }))),
    biosIndex: chosen.index,
    biosName: chosen.name,
  };
}

function hasEntry(files: Map<string, Uint8Array>, expectedName: string, size: number): boolean {
  const expectedStem = stem(expectedName);
  for (const [name, data] of files) {
    if (data.length !== size) continue;
    if (name.toLowerCase() === expectedName.toLowerCase() || stem(name) === expectedStem) return true;
  }
  return false;
}

export function basename(path: string): string {
  const name = path.split(/[/\\]/).pop() ?? '';
  return name.endsWith('/') ? '' : name;
}

function stem(name: string): string {
  const base = basename(name).toLowerCase();
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

function crc32Hex(data: Uint8Array): string {
  return (crc32(data) >>> 0).toString(16).padStart(8, '0');
}

let crcTable: Uint32Array | null = null;

export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let bit = 0; bit < 8; bit += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[i] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (~c) >>> 0;
}

export async function readZip(bytes: Uint8Array): Promise<Array<{ name: string; data: Uint8Array }>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const scanFrom = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= scanFrom; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('这个 zip 不是有效的压缩包。');
  const count = view.getUint16(eocd + 8, true);
  let ptr = view.getUint32(eocd + 16, true);
  const entries: Array<{ name: string; data: Uint8Array }> = [];
  for (let n = 0; n < count; n += 1) {
    if (ptr + 46 > bytes.length || view.getUint32(ptr, true) !== 0x02014b50) {
      throw new Error('这个 zip 的目录读不出来。');
    }
    const flags = view.getUint16(ptr + 8, true);
    const method = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const nameLength = view.getUint16(ptr + 28, true);
    const extraLength = view.getUint16(ptr + 30, true);
    const commentLength = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(ptr + 46, ptr + 46 + nameLength));
    ptr += 46 + nameLength + extraLength + commentLength;
    if (!name || name.endsWith('/')) continue;
    if (flags & 0x1) throw new Error('这个 zip 加了密码，浏览器读不了。');
    if (localOffset + 30 > bytes.length) throw new Error('这个 zip 的目录读不出来。');
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    let data: Uint8Array;
    if (method === 0) data = new Uint8Array(compressed);
    else if (method === 8) data = await inflateRaw(compressed);
    else throw new Error(`这个 zip 的压缩方式（${method}）读不了。`);
    entries.push({ name, data });
  }
  return entries;
}

async function inflateRaw(compressed: Uint8Array): Promise<Uint8Array> {
  const copy = new ArrayBuffer(compressed.byteLength);
  new Uint8Array(copy).set(compressed);
  const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function writeStoredZip(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name);
    const crc = crc32(entry.data);
    const local = new Uint8Array(30);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, entry.data.length, true);
    localView.setUint32(22, entry.data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    locals.push(local, nameBytes, entry.data);

    const record = new Uint8Array(46);
    const recordView = new DataView(record.buffer);
    recordView.setUint32(0, 0x02014b50, true);
    recordView.setUint16(4, 20, true);
    recordView.setUint16(6, 20, true);
    recordView.setUint32(16, crc, true);
    recordView.setUint32(20, entry.data.length, true);
    recordView.setUint32(24, entry.data.length, true);
    recordView.setUint16(28, nameBytes.length, true);
    recordView.setUint32(42, offset, true);
    central.push(record, nameBytes);
    offset += local.length + nameBytes.length + entry.data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);
  const parts = [...locals, ...central, eocd];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}
