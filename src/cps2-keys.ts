// Public MAME/FBNeo CPS2 key ROMs (20 bytes). These are the files FBNeo names
// batcir.key (CRC e316ae67) and batcirj.key (CRC 9f9fb965), as published in the
// ArcadeHacker CPS2 key table and checked against the FBNeo ROM catalog.
// TatoEmu unscrambles them into the historical caps:
//   batcir  d195e597 / 3cbce2b5 over 0x000000..0x200000
//   batcirj 00ff4dd8 / 000008e8 over 0x000000..0x200000
// Bytes are injected at load time. The split ROM parts stay untouched.

const KEY_HEX: Record<string, string> = {
  'batcir.key': '07000240000a04c3a4023202b51cf4f3a69ea62c',
  'batcirj.key': '07000240000a04c3a40232005c4000006ecbfc00',
};

export function cps2KeyBytes(name: string, crc: string): Uint8Array | null {
  const hex = KEY_HEX[name.toLowerCase()];
  if (!hex) return null;
  const bytes = fromHex(hex);
  if (!bytes || crc32Hex(bytes) !== crc.toLowerCase()) return null;
  return bytes;
}

/** Same bit unscramble as TatoEmu Cartridge::load for a 20-byte CPS2 key. */
export function decodeCps2Key(bytes: Uint8Array): { key1: number; key2: number; start: number; end: number } | null {
  if (bytes.length < 20) return null;
  const decoded = new Uint16Array(10);
  for (let bitIndex = 0; bitIndex < 160; bitIndex += 1) {
    const bit = (317 - bitIndex) % 160;
    const byteIndex = bit >> 3;
    const bitPos = (bit ^ 7) % 8;
    if ((bytes[byteIndex] >> bitPos) & 1) decoded[bitIndex >> 4] |= 0x8000 >> (bitIndex % 16);
  }
  const key1 = ((decoded[0] << 16) | decoded[1]) >>> 0;
  const key2 = ((decoded[2] << 16) | decoded[3]) >>> 0;
  if (decoded[9] === 0xffff) return { key1, key2, start: 0xff0000, end: 0xffffff };
  const end = (((~decoded[9] & 0x3ff) << 14) | 0x3fff) + 1;
  return { key1, key2, start: 0, end };
}

function fromHex(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return out;
}

function crc32Hex(data: Uint8Array): string {
  let table = crcTable;
  if (!table) {
    table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let crc = index;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
      table[index] = crc >>> 0;
    }
    crcTable = table;
  }
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) crc = table[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  return ((~crc) >>> 0).toString(16).padStart(8, '0');
}

let crcTable: Uint32Array | null = null;
