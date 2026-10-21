import { abortError, trackMatchingFetches, type LoadProgress } from './progress';
import type { CoreType, EmscriptenFS, KeyBindings, TatoFactory, TatoModule } from './types';

const ROM_DIR = '/roms';

export interface BootProgress extends LoadProgress {
  label: string;
}

export class EmulatorRuntime {
  private module: TatoModule | null = null;
  private starting: Promise<void> | null = null;
  private fsReady: Promise<void> = Promise.resolve();
  private logs: string[] = [];

  get ready(): boolean {
    return this.module !== null;
  }

  get fs(): EmscriptenFS {
    if (!this.module) throw new Error('模拟器还没准备好');
    return this.module.FS;
  }

  initialize(
    canvas: HTMLCanvasElement,
    onProgress: (progress: BootProgress) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.module) return Promise.resolve();
    if (signal?.aborted) return Promise.reject(abortError());
    if (!this.starting) {
      this.starting = this.boot(canvas, onProgress, signal).catch((error: unknown) => {
        this.starting = null;
        this.module = null;
        throw error;
      });
    }
    return this.starting;
  }

  private async boot(
    canvas: HTMLCanvasElement,
    onProgress: (progress: BootProgress) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const moduleUrl = new URL(`${import.meta.env.BASE_URL}emulator/tatoemu.js`, window.location.href);
    onProgress({ label: '正在下载模拟器…', loaded: 0, total: null });
    const stopTracking = trackMatchingFetches(
      (url) => url.includes('tatoemu.wasm'),
      (progress) => onProgress({ label: progress.fromCache ? '模拟器来自缓存' : '正在下载模拟器…', ...progress }),
      signal,
    );
    let imported: { default: TatoFactory };
    try {
      imported = await import(/* @vite-ignore */ moduleUrl.href) as { default: TatoFactory };
      if (signal?.aborted) throw abortError();
    } catch (error) {
      stopTracking();
      throw error;
    }

    let resolveFs!: () => void;
    let rejectFs!: (error: Error) => void;
    this.fsReady = new Promise<void>((resolve, reject) => {
      resolveFs = resolve;
      rejectFs = reject;
    });

    const options: Record<string, unknown> = {
      canvas,
      locateFile: (path: string) => {
        const url = new URL(path, moduleUrl);
        if (path.endsWith('.wasm')) url.searchParams.set('rev', __EMU_REV__);
        return url.href;
      },
      print: (text: string) => {
        console.log(text);
        this.note(text);
      },
      printErr: (text: string) => {
        console.error(text);
        this.note(text);
      },
      setStatus: () => {},
      preRun: [() => {
        const fs = options.FS as EmscriptenFS | undefined;
        // Older Emscripten puts IDBFS on FS.filesystems. Newer ones export it
        // on the module, which is this options object by the time preRun runs.
        const idbfs = fs?.filesystems?.IDBFS ?? (options as { IDBFS?: unknown }).IDBFS;
        if (!fs || !idbfs) {
          rejectFs(new Error('浏览器文件系统不可用'));
          return;
        }
        try {
          if (!fs.analyzePath(ROM_DIR).exists) fs.mkdir(ROM_DIR);
          fs.mount(idbfs, { autoPersist: true }, ROM_DIR);
          fs.syncfs(true, (error) => {
            if (error) rejectFs(error);
            else resolveFs();
          });
        } catch (error) {
          rejectFs(error instanceof Error ? error : new Error(String(error)));
        }
      }],
    };

    try {
      this.module = await imported.default(options);
      if (signal?.aborted) throw abortError();
      await this.fsReady;
      if (signal?.aborted) throw abortError();
      this.call('setScaleMode', null, ['string'], ['nearest']);
      // The core applies Config volume only while initializing a ROM.
      // The page gain node is the live control, so the core stays at full scale.
      this.call('setVolume', null, ['number'], [100]);
    } finally {
      stopTracking();
    }
  }

  call<T>(name: string, returnType: string | null, types: string[] = [], args: Array<string | number> = []): T {
    if (!this.module) throw new Error('模拟器还没准备好');
    return this.module.ccall(name, returnType, types, args) as T;
  }

  applyBindings(bindings: KeyBindings): void {
    for (const [section, values] of Object.entries(bindings)) {
      for (const [key, value] of Object.entries(values)) {
        this.call('setKeyBinding', null, ['string', 'string', 'string'], [section, key, value]);
      }
    }
  }

  writeRom(name: string, data: Uint8Array): string {
    const path = `${ROM_DIR}/${name}`;
    const copy = new Uint8Array(data);
    this.fs.writeFile(path, copy);
    return path;
  }

  readFile(path: string): Uint8Array {
    return this.fs.readFile(path);
  }

  exists(path: string): boolean {
    return this.fs.analyzePath(path).exists;
  }

  coreType(path: string): CoreType {
    return this.call<CoreType>('getCoreType', 'string', ['string'], [path]);
  }

  loadBootrom(path: string): boolean {
    return this.call<number>('loadBootromFile', 'number', ['string'], [path]) === 1;
  }

  setNeoBios(index: number): void {
    this.call('setNeoBios', null, ['string'], [String(index)]);
  }

  drainLogs(): string {
    const text = this.logs.join('\n');
    this.logs = [];
    return text;
  }

  private note(text: string): void {
    const line = text.trim();
    if (!line) return;
    this.logs.push(line);
    if (this.logs.length > 80) this.logs.shift();
  }

  loadRom(path: string): boolean {
    this.setVolume(100);
    return this.call<number>('loadROMFile', 'number', ['string'], [path]) === 1;
  }

  setVirtualKey(keyName: string, pressed: boolean): void {
    this.call('virtualKey', 'number', ['string', 'number'], [keyName, pressed ? 1 : 0]);
  }

  setPaused(paused: boolean): void {
    this.call('emuSetPaused', null, ['number'], [paused ? 1 : 0]);
  }

  isPaused(): boolean {
    return this.call<number>('emuIsPaused', 'number') === 1;
  }

  quickSave(): boolean {
    return this.call<number>('emuQuickSave', 'number') === 1;
  }

  quickLoad(): boolean {
    return this.call<number>('emuQuickLoad', 'number') === 1;
  }

  setVolume(volume: number): void {
    const level = Math.max(0, Math.min(100, Math.round(volume)));
    this.call('setVolume', null, ['number'], [level]);
  }

  cheatAdd(name: string, address: number, value: number, width: number): void {
    this.call('cheatAddCode', null, ['string', 'number', 'number', 'number'], [name, address >>> 0, value >>> 0, width]);
  }

  cheatRemove(index: number): void {
    this.call('cheatRemoveCode', null, ['number'], [index]);
  }

  cheatToggle(index: number): void {
    this.call('cheatToggleCode', null, ['number'], [index]);
  }

  cheatClear(): void {
    this.call('cheatClearCodes', null, [], []);
  }

  cheatList(): Array<{ name: string; address: number; value: number; width: number; enabled: boolean }> {
    const raw = this.call<string>('cheatGetCodesJson', 'string');
    try {
      const parsed = JSON.parse(raw) as Array<{ name: string; address: number; value: number; width: number; enabled: boolean }>;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  persist(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.fs.syncfs(false, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

export const emulator = new EmulatorRuntime();

export function statePath(romPath: string): string {
  return romPath.replace(/\.[^.]+$/, '.state');
}
