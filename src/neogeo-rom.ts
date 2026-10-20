import { basename, readZip, writeStoredZip } from './neogeo-bios';

// TatoEmu's game-ROM check is an exact filename match (plus size and CRC).
// The comment in validateROM mentions .bin, but the comparison does not
// rewrite extensions. MAME packs use 082-p1.bin where FBNeo wants 082-p1.p1.
const MAME_BIN = /^(\d{3})-([a-z]+\d+)\.bin$/i;

export interface PreparedGameZip {
  bytes: Uint8Array;
  renamed: string[];
}

export async function prepareNeoGeoGameZip(bytes: Uint8Array): Promise<PreparedGameZip> {
  const entries = await readZip(bytes);
  const present = new Set(entries.map((entry) => basename(entry.name).toLowerCase()));
  const renamed: string[] = [];
  const next = entries.map((entry) => {
    const name = basename(entry.name);
    const target = fbneoName(name);
    if (!target || present.has(target)) return { name, data: entry.data };
    renamed.push(`${name} → ${target}`);
    return { name: target, data: entry.data };
  });
  if (renamed.length === 0) return { bytes, renamed };
  return { bytes: writeStoredZip(next), renamed };
}

function fbneoName(name: string): string | null {
  const match = basename(name).match(MAME_BIN);
  if (!match) return null;
  const token = match[2].toLowerCase();
  return `${match[1]}-${token}.${token}`;
}
