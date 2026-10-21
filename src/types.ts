export type SystemId = 'nes' | 'gb' | 'gba' | 'md' | 'cps1' | 'cps2' | 'neogeo';

export type CoreType = 'gb' | 'gba' | 'nes' | 'cps' | 'neogeo' | 'md' | 'unknown';

export interface GameEntry {
  id: string;
  title: string;
  subtitle?: string;
  system: SystemId;
  year?: string;
  developer?: string;
  description: string;
  rom: string;
  bundled: boolean;
  fbneo?: string;
  hint?: string;
  cover?: string;
}

export interface Catalog {
  games: GameEntry[];
}

export interface EmscriptenFS {
  filesystems?: { IDBFS?: unknown };
  analyzePath(path: string): { exists: boolean };
  mkdir(path: string): void;
  mount(type: unknown, opts: Record<string, unknown>, mountpoint: string): void;
  readFile(path: string): Uint8Array;
  readdir(path: string): string[];
  stat(path: string): { size: number };
  syncfs(populate: boolean, callback: (error: Error | null) => void): void;
  unlink(path: string): void;
  writeFile(path: string, data: Uint8Array): void;
}

export interface TatoModule {
  FS: EmscriptenFS;
  ccall(
    name: string,
    returnType: string | null,
    argumentTypes: string[],
    args: Array<string | number>,
  ): unknown;
}

export type TatoFactory = (options: Record<string, unknown>) => Promise<TatoModule>;

export interface KeyBindings {
  [section: string]: Record<string, string>;
}

export interface SaveSlot {
  gameId: string;
  slot: number;
  romName: string;
  savedAt: number;
  data: ArrayBuffer;
}
