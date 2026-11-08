import { type ByteSource } from './byte-source';
import { DosSpeaker } from './dos-audio';
import { dosDiag, noteDosRead, noteDosStdout, setDosStage } from './dos-diag';
import { dosCodeFromEvent, dosCodeFromSdl } from './dos-keys';
import {
  dosLaunch,
  isDosBundle,
  isZipBytes,
  readZipEntries,
  readZipFile,
  selectDosFiles,
  skippedMediaSummary,
  type DosLaunch,
  type ZipEntry,
} from './dos-pack';
import { writeStoredZip } from './neogeo-bios';
import type { LoadProgress } from './progress';

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
    onStdout(consumer: (message: string) => void): void;
    onExit(consumer: () => void): void;
  };
}

type DosInit =
  | Uint8Array
  | { path: string; contents: Uint8Array }
  | { dosboxConf: string; jsdosConf: { version: string } };

interface EmulatorsGlobal {
  pathPrefix: string;
  pathSuffix: string;
  dosboxXWorker(
    bundle: DosInit | DosInit[],
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
  private source: ByteSource | null = null;
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
    if (!this.source || !this.canvas) throw new Error('还没有开着的 DOS 游戏。');
    await this.boot(this.canvas, this.source, this.gameName, changes, report, signal);
  }

  async restart(report: Report, signal: AbortSignal): Promise<void> {
    if (!this.source || !this.canvas) throw new Error('还没开台');
    await this.boot(this.canvas, this.source, this.gameName, null, report, signal);
  }

  async start(
    canvas: HTMLCanvasElement,
    source: ByteSource,
    name: string,
    report: Report,
    signal: AbortSignal,
  ): Promise<string> {
    return this.boot(canvas, source, name, null, report, signal);
  }

  async stop(): Promise<void> {
    this.token += 1;
    this.input?.abort();
    this.input = null;
    this.source?.release?.();
    const hooked = globalThis as { __streetgameDosSave?: () => Promise<number> };
    delete hooked.__streetgameDosSave;
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
    source: ByteSource,
    name: string,
    changes: Uint8Array | null,
    report: Report,
    signal: AbortSignal,
  ): Promise<string> {
    await this.stop();
    if (signal.aborted) throw abortError();
    const token = this.token;
    this.canvas = canvas;
    this.source = source;
    this.gameName = name;
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (!this.ctx) throw new Error('浏览器没有给 DOS 画面准备画布。');
    dosDiag.notes = [];
    dosDiag.stdout = [];
    dosDiag.largestRead = 0;
    dosDiag.totalRead = 0;
    dosDiag.peakHeldBytes = 0;
    const measured = meter(source);
    const enginePromise = this.engine();

    try {
      setDosStage('list', '读取压缩包目录');
      report(changes ? '正在读回 DOS 存档…' : '正在读取游戏目录…', null);
      const plan = await planDos(measured, name);
      if (token !== this.token || signal.aborted) throw abortError();
      dosDiag.keptBytes = plan.keptBytes;
      dosDiag.skippedBytes = plan.skippedBytes;
      dosDiag.skippedFiles = plan.skippedFiles;
      if (plan.note) {
        dosDiag.notes.push(plan.note);
        report(plan.note, { loaded: plan.keptBytes, total: plan.keptBytes + plan.skippedBytes });
        await paintSoon();
      }

      setDosStage('read', `读取 ${plan.launch.program}`);
      const files: Array<{ path: string; contents: Uint8Array }> = [...plan.raw];
      let loaded = plan.raw.reduce((sum, file) => sum + file.contents.byteLength, 0);
      for (const entry of plan.entries) {
        if (token !== this.token || signal.aborted) throw abortError();
        const base = entry.name.split('/').pop() || entry.name;
        report(`正在读取 ${base}`, { loaded, total: plan.keptBytes || null });
        const contents = await readZipFile(measured, entry);
        files.push({ path: entry.name.replace(/^\/+/, ''), contents });
        loaded += contents.byteLength;
        await paintSoon();
      }
      if (!plan.bundled) {
        const font = await soundfontBytes();
        if (font) files.push({ path: 'gm.sf2', contents: font });
      }
      const held = files.reduce((sum, file) => sum + file.contents.byteLength, 0);
      dosDiag.peakHeldBytes = held;
      const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      dosDiag.heapAtPeak = heap?.usedJSHeapSize ?? 0;
      if (token !== this.token || signal.aborted) throw abortError();

      setDosStage('worker', '启动 DOSBox');
      report('正在开 DOS…', { loaded: held, total: held });
      const emulators = await enginePromise;
      if (token !== this.token || signal.aborted) throw abortError();
      const init: DosInit[] = [...files];
      if (!plan.bundled) {
        init.push({
          dosboxConf: dosboxConfFor(plan.launch),
          jsdosConf: { version: '8.5.2' },
        });
      }
      init.push(markerZip());
      if (changes) init.push(changes);
      const ci = await emulators.dosboxXWorker(init, {
        onExtractProgress: (index, file, extracted, total) => {
          void index;
          if (token !== this.token) return;
          report(`正在展开 ${file}`, { loaded: extracted, total: total || null });
        },
      });
      releaseInit(init);
      if (token !== this.token || signal.aborted) {
        await ci.exit();
        throw abortError();
      }
      setDosStage('started', 'DOSBox 已响应');
      this.attachScreen(ci);
      this.attachAudio(ci);
      ci.events().onStdout((line) => noteDosStdout(line));
      this.ci = ci;
      const hooked = globalThis as { __streetgameDosSave?: () => Promise<number> };
      hooked.__streetgameDosSave = async () => {
        const snap = await ci.persist(true);
        return snap?.byteLength ?? 0;
      };
      this.speaker.setLevel(this.level);
      if (!this.audible) ci.mute();
      else ci.unmute();
      signal.addEventListener('abort', () => { void this.stop(); }, { once: true });
      return plan.launch.program;
    } catch (error) {
      if (isAbort(error) || signal.aborted) throw abortError();
      const stage = dosDiag.detail || dosDiag.stage;
      setDosStage('failed', stage);
      const stdout = dosDiag.stdout.slice(-4).join(' ').trim();
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof RangeError || /out of memory|allocation failed/i.test(message)) {
        throw new Error(`浏览器内存不够（${stage}）。已经没有把整包装进内存，但这台设备还是装不下。`);
      }
      const tail = stdout ? ` ${stdout}` : '';
      throw new Error(`DOS 启动失败（${stage}）：${message}${tail}`);
    }
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
        if (dosDiag.stage !== 'running' && dosDiag.stage !== 'failed') setDosStage('running', '画面出来了');
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

  private engine(): Promise<EmulatorsGlobal> {
    if (!this.ready) this.ready = loadEmulators();
    return this.ready;
  }
}

export const dos = new DosRuntime();

interface DosPlan {
  launch: DosLaunch;
  entries: ZipEntry[];
  raw: Array<{ path: string; contents: Uint8Array }>;
  bundled: boolean;
  keptBytes: number;
  skippedBytes: number;
  skippedFiles: number;
  note: string | null;
}

async function planDos(source: ByteSource, name: string): Promise<DosPlan> {
  const head = await source.read(0, Math.min(4, source.size));
  if (!isZipBytes(head)) {
    const base = name.split(/[/\\]/).pop() || 'game.exe';
    if (!/\.(exe|com|bat)$/i.test(base)) throw new Error('DOS 游戏用 .dosz、.zip，或单独的 EXE / COM / BAT。');
    if (source.size > 32 * 1024 * 1024) throw new Error('单个程序太大。请打成 zip 后再开。');
    const contents = await source.read(0, source.size);
    return {
      launch: { dir: '', program: base },
      entries: [],
      raw: [{ path: base, contents }],
      bundled: false,
      keptBytes: contents.byteLength,
      skippedBytes: 0,
      skippedFiles: 0,
      note: null,
    };
  }
  const entries = await readZipEntries(source);
  const names = entries.map((entry) => entry.name);
  const bundled = isDosBundle(names);
  const launch = dosLaunch(names) ?? (bundled ? { dir: '', program: 'js-dos' } : null);
  if (!launch) throw new Error('这个包里没有 EXE、COM 或 BAT。DOS 游戏用 .dosz，或把游戏目录打成 zip。');
  const selected = selectDosFiles(entries);
  const program = launch.program.toLowerCase();
  if (program !== 'js-dos' && !selected.kept.some((entry) => (entry.name.split('/').pop() || '').toLowerCase() === program)) {
    throw new Error(`${launch.program} 没能留在内存里，游戏开不了。`);
  }
  const keptBytes = selected.kept.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  const skippedBytes = selected.skipped.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  return {
    launch,
    entries: selected.kept,
    raw: [],
    bundled,
    keptBytes,
    skippedBytes,
    skippedFiles: selected.skipped.length,
    note: skippedMediaSummary(selected.skipped),
  };
}

function meter(source: ByteSource): ByteSource {
  return {
    size: source.size,
    release() {
      source.release?.();
    },
    async read(start, length) {
      noteDosRead(length);
      return source.read(start, length);
    },
  };
}

function quoteDos(name: string): string {
  return /[ "]/.test(name) ? `"${name}"` : name;
}

function dosboxConfFor(launch: DosLaunch): string {
  const lines = ['mount c .', 'c:'];
  if (launch.dir) lines.push(`cd ${quoteDos(launch.dir)}`);
  if (launch.program !== 'js-dos') lines.push(quoteDos(launch.program));
  return DOSBOX_CONF.replace('__AUTOEXEC__', lines.join('\r\n'));
}

function markerZip(): Uint8Array {
  return writeStoredZip([{ name: '.jsdos/keep.txt', data: new Uint8Array([1]) }]);
}

function releaseInit(init: DosInit[]): void {
  for (const part of init) {
    if (typeof part === 'object' && 'contents' in part) part.contents = new Uint8Array(0);
  }
  init.length = 0;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
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

const DOSBOX_CONF = [
  '[sdl]',
  'autolock=false',
  'fullscreen=false',
  'output=surface',
  'usescancodes=true',
  '[dosbox]',
  'machine=svga_s3',
  'memsize=32',
  'captures=capture',
  '[cpu]',
  'core=auto',
  'cputype=auto',
  'cycles=auto',
  '[mixer]',
  'nosound=false',
  'rate=44100',
  'blocksize=1024',
  'prebuffer=20',
  '[render]',
  'frameskip=0',
  'aspect=false',
  'scaler=none',
  '[midi]',
  'mpu401=intelligent',
  'mididevice=fluidsynth',
  'midiconfig=/home/web_user/gm.sf2',
  '[sblaster]',
  'sbtype=sb16',
  'sbbase=220',
  'irq=7',
  'dma=1',
  'hdma=5',
  'sbmixer=true',
  'oplmode=auto',
  'oplemu=default',
  'oplrate=44100',
  '[gus]',
  'gus=false',
  '[speaker]',
  'pcspeaker=true',
  '[dos]',
  'xms=true',
  'ems=true',
  'umb=true',
  'keyboardlayout=auto',
  '[autoexec]',
  '__AUTOEXEC__',
  '',
].join('\r\n');

let fontBytes: Promise<Uint8Array | null> | null = null;

function soundfontBytes(): Promise<Uint8Array | null> {
  if (!fontBytes) {
    fontBytes = fetch(new URL(`${import.meta.env.BASE_URL}emulator/gm.sf2`, window.location.href).href)
      .then(async (response) => (response.ok ? new Uint8Array(await response.arrayBuffer()) : null))
      .catch(() => null);
  }
  return fontBytes;
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
