import type { CoreType, EmscriptenFS, KeyBindings, TatoFactory, TatoModule } from './types';

const ROM_DIR = '/roms';

export class EmulatorRuntime {
  private module: TatoModule | null = null;
  private starting: Promise<void> | null = null;
  private fsReady: Promise<void> = Promise.resolve();

  get ready(): boolean {
    return this.module !== null;
  }

  get fs(): EmscriptenFS {
    if (!this.module) throw new Error('模拟器还没准备好');
    return this.module.FS;
  }

  initialize(canvas: HTMLCanvasElement, onStatus: (text: string) => void): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = this.boot(canvas, onStatus);
    return this.starting;
  }

  private async boot(canvas: HTMLCanvasElement, onStatus: (text: string) => void): Promise<void> {
    const moduleUrl = new URL(`${import.meta.env.BASE_URL}emulator/tatoemu.js`, window.location.href);
    onStatus('正在搬出街机箱子…');
    const imported = await import(/* @vite-ignore */ moduleUrl.href) as { default: TatoFactory };

    let resolveFs!: () => void;
    let rejectFs!: (error: Error) => void;
    this.fsReady = new Promise<void>((resolve, reject) => {
      resolveFs = resolve;
      rejectFs = reject;
    });

    const options: Record<string, unknown> = {
      canvas,
      locateFile: (path: string) => new URL(path, moduleUrl).href,
      print: (text: string) => console.log(text),
      printErr: (text: string) => console.error(text),
      setStatus: (text: string) => {
        if (text) onStatus(text);
      },
      preRun: [() => {
        const fs = options.FS as EmscriptenFS | undefined;
        if (!fs) {
          rejectFs(new Error('浏览器文件系统不可用'));
          return;
        }
        try {
          if (!fs.analyzePath(ROM_DIR).exists) fs.mkdir(ROM_DIR);
          fs.mount(fs.filesystems.IDBFS, { autoPersist: true }, ROM_DIR);
          fs.syncfs(true, (error) => {
            if (error) rejectFs(error);
            else resolveFs();
          });
        } catch (error) {
          rejectFs(error instanceof Error ? error : new Error(String(error)));
        }
      }],
    };

    this.module = await imported.default(options);
    await this.fsReady;
    this.call('setScaleMode', null, ['string'], ['nearest']);
    this.call('setVolume', null, ['number'], [80]);
    onStatus('');
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

  loadRom(path: string): boolean {
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
