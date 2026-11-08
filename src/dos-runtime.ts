import { DosSpeaker } from './dos-audio';
import { dosCodeFromEvent, dosCodeFromSdl } from './dos-keys';
import { dosLaunch, isDosBundle, isZipBytes, listZipNames, wrapProgram, type DosLaunch } from './dos-pack';
import { writeStoredZip } from './neogeo-bios';
import type { LoadProgress } from './progress';

interface DosBundle {
  dosboxConf: string;
  autoexec(...lines: string[]): DosBundle;
  extractAll(sources: Array<{ url: string; path: string; type?: 'zip' }>): DosBundle;
  toUint8Array(overwriteConfig?: boolean): Promise<Uint8Array>;
}

interface DosCommand {
  width(): number;
  height(): number;
  pause(): void;
  resume(): void;
  mute(): void;
  unmute(): void;
  exit(): Promise<void>;
  sendKeyEvent(keyCode: number, pressed: boolean): void;
  sendMouseMotion(x: number, y: number): void;
  sendMouseButton(button: number, pressed: boolean): void;
  soundFrequency(): number;
  persist(onlyChanges?: boolean): Promise<Uint8Array | null>;
  events(): {
    onFrameSize(consumer: (width: number, height: number) => void): void;
    onFrame(consumer: (rgb: Uint8Array | null, rgba: Uint8Array | null) => void): void;
    onSoundPush(consumer: (samples: Float32Array) => void): void;
    onExit(consumer: () => void): void;
  };
}

interface EmulatorsGlobal {
  pathPrefix: string;
  pathSuffix: string;
  bundle(): Promise<DosBundle>;
  dosboxXWorker(
    bundle: Uint8Array,
    options?: { onExtractProgress?: (index: number, file: string, extracted: number, total: number) => void },
  ): Promise<DosCommand>;
}

type Report = (label: string, progress: LoadProgress | null) => void;

class DosRuntime {
  private token = 0;
  private ci: DosCommand | null = null;
  private paused = false;
  private audible = true;
  private level = 80;
  private speaker = new DosSpeaker();
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private image: ImageData | null = null;
  private rgba: Uint8ClampedArray | null = null;
  private paintQueued = false;
  private gameBytes: Uint8Array | null = null;
  private gameName = '';
  private ready: Promise<EmulatorsGlobal> | null = null;
  private input: AbortController | null = null;

  running(): boolean {
    return this.ci !== null;
  }

  isPaused(): boolean {
    return this.paused;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!this.ci) return;
    if (paused) this.ci.pause();
    else this.ci.resume();
  }

  primeAudio(): void {
    this.speaker.prime();
  }

  setVolume(level: number): void {
    this.level = Math.max(0, Math.min(100, level));
    this.audible = this.level > 0;
    this.speaker.setLevel(this.level);
    if (!this.ci) return;
    if (this.audible) this.ci.unmute();
    else this.ci.mute();
  }

  holdSdl(name: string, down: boolean): void {
    const code = dosCodeFromSdl(name);
    if (code === null || !this.ci) return;
    this.ci.sendKeyEvent(code, down);
  }

  async snapshot(): Promise<Uint8Array | null> {
    if (!this.ci) return null;
    return this.ci.persist(true);
  }

  async restore(changes: Uint8Array, report: Report, signal: AbortSignal): Promise<void> {
    if (!isZipBytes(changes)) throw new Error('这份 DOS 存档读不出来。');
    if (!this.gameBytes || !this.canvas) throw new Error('还没有开着的 DOS 游戏。');
    await this.boot(this.canvas, this.gameBytes, this.gameName, changes, report, signal);
  }

  async restart(report: Report, signal: AbortSignal): Promise<void> {
    if (!this.gameBytes || !this.canvas) throw new Error('还没开台');
    await this.boot(this.canvas, this.gameBytes, this.gameName, null, report, signal);
  }

  async start(
    canvas: HTMLCanvasElement,
    bytes: Uint8Array,
    name: string,
    report: Report,
    signal: AbortSignal,
  ): Promise<string> {
    return this.boot(canvas, bytes, name, null, report, signal);
  }

  async stop(): Promise<void> {
    this.token += 1;
    this.input?.abort();
    this.input = null;
    const ci = this.ci;
    this.ci = null;
    this.paused = false;
    this.image = null;
    this.rgba = null;
    if (!ci) return;
    try {
      await ci.exit();
    } catch {
      /* the worker is already gone */
    }
  }

  private async boot(
    canvas: HTMLCanvasElement,
    bytes: Uint8Array,
    name: string,
    changes: Uint8Array | null,
    report: Report,
    signal: AbortSignal,
  ): Promise<string> {
    await this.stop();
    if (signal.aborted) throw abortError();
    const token = this.token;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (!this.ctx) throw new Error('浏览器没有给 DOS 画面准备画布。');

    report('正在装载 DOSBox…', null);
    const emulators = await this.engine();
    if (token !== this.token || signal.aborted) throw abortError();

    const packed = normalize(bytes, name);
    const names = listZipNames(packed.bytes);
    const bundled = isDosBundle(names);
    const launch = bundled ? { dir: '', program: 'js-dos' } : dosLaunch(names);
    if (!launch) throw new Error('这个包里没有 EXE、COM 或 BAT。DOS 游戏用 .dosz，或把游戏目录打成 zip。');
    this.gameBytes = packed.bytes;
    this.gameName = packed.name;

    const cacheKey = `${packed.name}:${packed.bytes.byteLength}:${launch.program}:midi`;
    let bundle: Uint8Array | null = null;
    if (bundled && !changes) bundle = packed.bytes;
    else if (!changes) bundle = await readBundleCache(cacheKey);
    if (!bundle) {
      report(changes ? '正在读回 DOS 存档…' : `正在装入 ${launch.program}…`, null);
      await paintSoon();
      bundle = await this.makeBundle(emulators, packed.bytes, launch, changes);
      if (!changes) void writeBundleCache(cacheKey, bundle);
    } else if (!bundled) {
      report('用上次装好的 DOS 包…', { loaded: bundle.byteLength, total: bundle.byteLength, fromCache: true });
    }
    if (token !== this.token || signal.aborted) throw abortError();

    report('正在开 DOS…', null);
    const ci = await emulators.dosboxXWorker(bundle, {
      onExtractProgress: (index, file, extracted, total) => {
        void index;
        if (token !== this.token) return;
        report(`正在展开 ${file}`, { loaded: extracted, total: total || null });
      },
    });
    if (token !== this.token || signal.aborted) {
      await ci.exit();
      throw abortError();
    }
    this.attachScreen(ci);
    this.attachAudio(ci);
    this.ci = ci;
    this.speaker.setLevel(this.level);
    if (!this.audible) ci.mute();
    else ci.unmute();
    signal.addEventListener('abort', () => { void this.stop(); }, { once: true });
    return launch.program;
  }

  private attachScreen(ci: DosCommand): void {
    ci.events().onFrameSize((width, height) => {
      const canvas = this.canvas;
      const ctx = this.ctx;
      if (!canvas || !ctx || width < 2 || height < 2) return;
      canvas.width = width;
      canvas.height = height;
      const pixels = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
      this.rgba = pixels;
      this.image = new ImageData(pixels, width, height);
    });
    ci.events().onFrame((rgb, rgba) => {
      const image = this.image;
      const destination = this.rgba;
      if (!image || !destination) return;
      if (rgba && rgba.length === destination.length) destination.set(rgba);
      else if (rgb) copyRgb(rgb, destination);
      else return;
      if (this.paintQueued) return;
      this.paintQueued = true;
      requestAnimationFrame(() => {
        this.paintQueued = false;
        if (this.image && this.ctx) this.ctx.putImageData(this.image, 0, 0);
      });
    });
  }

  attachInput(canvas: HTMLCanvasElement, ignore: () => boolean, signal: AbortSignal): void {
    this.input?.abort();
    const input = new AbortController();
    this.input = input;
    const linked = new AbortController();
    const stop = () => linked.abort();
    signal.addEventListener('abort', stop, { once: true });
    input.signal.addEventListener('abort', stop, { once: true });

    const down = (event: KeyboardEvent) => {
      this.speaker.resume();
      if (ignore() || event.repeat) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const code = dosCodeFromEvent(event);
      if (code === null || !this.ci) return;
      event.preventDefault();
      event.stopPropagation();
      this.ci.sendKeyEvent(code, true);
    };
    const up = (event: KeyboardEvent) => {
      const code = dosCodeFromEvent(event);
      if (code === null || !this.ci) return;
      event.preventDefault();
      event.stopPropagation();
      this.ci.sendKeyEvent(code, false);
    };
    window.addEventListener('keydown', down, { capture: true, signal: linked.signal });
    window.addEventListener('keyup', up, { capture: true, signal: linked.signal });

    const motion = (event: PointerEvent) => {
      if (!this.ci) return;
      const point = this.pointer(canvas, event);
      if (!point) return;
      this.ci.sendMouseMotion(point.x, point.y);
    };
    canvas.addEventListener('pointermove', motion, { signal: linked.signal });
    canvas.addEventListener('pointerdown', (event) => {
      this.speaker.resume();
      if (!this.ci) return;
      canvas.focus();
      motion(event);
      this.ci.sendMouseButton(event.button, true);
    }, { signal: linked.signal });
    const release = (event: PointerEvent) => {
      this.ci?.sendMouseButton(event.button, false);
    };
    canvas.addEventListener('pointerup', release, { signal: linked.signal });
    canvas.addEventListener('pointercancel', release, { signal: linked.signal });
  }

  private attachAudio(ci: DosCommand): void {
    const freq = ci.soundFrequency();
    if (freq > 0) this.speaker.setFrequency(freq);
    ci.events().onSoundPush((samples) => {
      if (!this.audible) return;
      const rate = ci.soundFrequency();
      if (rate > 0) this.speaker.setFrequency(rate);
      this.speaker.push(samples);
    });
  }

  private pointer(canvas: HTMLCanvasElement, event: PointerEvent): { x: number; y: number } | null {
    if (!this.ci) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    const width = this.ci.width() || canvas.width;
    const height = this.ci.height() || canvas.height;
    const x = Math.round(((event.clientX - rect.left) / rect.width) * width);
    const y = Math.round(((event.clientY - rect.top) / rect.height) * height);
    return {
      x: Math.max(0, Math.min(width - 1, x)),
      y: Math.max(0, Math.min(height - 1, y)),
    };
  }

  private async makeBundle(
    emulators: EmulatorsGlobal,
    bytes: Uint8Array,
    launch: DosLaunch,
    changes: Uint8Array | null,
  ): Promise<Uint8Array> {
    const gameUrl = URL.createObjectURL(new Blob([bytes as BlobPart]));
    const changesUrl = changes ? URL.createObjectURL(new Blob([changes as BlobPart])) : '';
    try {
      const bundle = await emulators.bundle();
      const lines = [];
      if (launch.dir) lines.push(`cd ${quoteDos(launch.dir)}`);
      if (launch.program !== 'js-dos') lines.push(quoteDos(launch.program));
      if (lines.length > 0) bundle.autoexec(...lines);
      bundle.dosboxConf = withMidi(bundle.dosboxConf);
      const sources = [{ url: gameUrl, path: '/', type: 'zip' as const }];
      if (changesUrl) sources.push({ url: changesUrl, path: '/', type: 'zip' });
      const font = await soundfontZip();
      if (font) sources.push({ url: font.url, path: '/', type: 'zip' });
      return await bundle.extractAll(sources).toUint8Array(true);
    } finally {
      URL.revokeObjectURL(gameUrl);
      if (changesUrl) URL.revokeObjectURL(changesUrl);
    }
  }

  private engine(): Promise<EmulatorsGlobal> {
    if (!this.ready) this.ready = loadEmulators();
    return this.ready;
  }
}

export const dos = new DosRuntime();

function normalize(bytes: Uint8Array, name: string): { bytes: Uint8Array; name: string } {
  if (isZipBytes(bytes)) return { bytes, name };
  const base = name.split(/[/\\]/).pop() || 'game.exe';
  if (!/\.(exe|com|bat)$/i.test(base)) throw new Error('DOS 游戏用 .dosz、.zip，或单独的 EXE / COM / BAT。');
  return { bytes: wrapProgram(base, bytes), name: `${base}.zip` };
}

function quoteDos(name: string): string {
  return /[ "]/.test(name) ? `"${name}"` : name;
}

function copyRgb(rgb: Uint8Array, destination: Uint8ClampedArray): void {
  const pixels = Math.min(rgb.length / 3, destination.length / 4);
  for (let index = 0; index < pixels; index += 1) {
    destination[index * 4] = rgb[index * 3];
    destination[index * 4 + 1] = rgb[index * 3 + 1];
    destination[index * 4 + 2] = rgb[index * 3 + 2];
    destination[index * 4 + 3] = 255;
  }
}

function paintSoon(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function abortError(): DOMException {
  return new DOMException('已取消', 'AbortError');
}

async function loadEmulators(): Promise<EmulatorsGlobal> {
  const prefix = new URL(`${import.meta.env.BASE_URL}emulator/dos/`, window.location.href).href;
  await loadScript(`${prefix}emulators.js`);
  const root = window as Window & { emulators?: EmulatorsGlobal };
  const emulators = root.emulators;
  if (!emulators) throw new Error('DOS 模拟器没有装上。');
  emulators.pathPrefix = prefix;
  emulators.pathSuffix = '';
  return emulators;
}

function withMidi(conf: string): string {
  return conf
    .replace('memsize=16', 'memsize=32')
    .replace('mididevice=default', 'mididevice=fluidsynth')
    .replace('midiconfig=', 'midiconfig=/home/web_user/gm.sf2');
}

let fontZip: Promise<{ url: string } | null> | null = null;

function soundfontZip(): Promise<{ url: string } | null> {
  if (!fontZip) {
    fontZip = fetch(new URL(`${import.meta.env.BASE_URL}emulator/gm.sf2`, window.location.href).href)
      .then(async (response) => {
        if (!response.ok) return null;
        const bytes = new Uint8Array(await response.arrayBuffer());
        const zip = writeStoredZip([{ name: 'gm.sf2', data: bytes }]);
        return { url: URL.createObjectURL(new Blob([zip as BlobPart])) };
      })
      .catch(() => null);
  }
  return fontZip;
}

function bundleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('streetgame-dos', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('bundles');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readBundleCache(key: string): Promise<Uint8Array | null> {
  try {
    const db = await bundleDb();
    return await new Promise((resolve) => {
      const request = db.transaction('bundles').objectStore('bundles').get(key);
      request.onsuccess = () => {
        const value = request.result;
        resolve(value instanceof Uint8Array ? value : null);
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

function writeBundleCache(key: string, bytes: Uint8Array): Promise<void> {
  return bundleDb().then((db) => new Promise<void>((resolve) => {
    const request = db.transaction('bundles', 'readwrite').objectStore('bundles').put(bytes, key);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  })).catch(() => undefined);
}

function loadScript(src: string): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>('script[data-dos-emulators]');
  const root = window as Window & { emulators?: EmulatorsGlobal };
  if (existing && root.emulators) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.dosEmulators = '1';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('DOSBox 没有下载下来。'));
    document.head.append(script);
  });
}
