/**
 * Boot breadcrumbs for the DOS loader.
 * A phone tab killed by the OS does not run a JS catch. The last stage is
 * stored so the next open can say where the page died.
 */

const KEY = 'streetgame.dosMilestone';
const QUIET = new Set(['idle', 'running']);

export interface DosDiag {
  stage: string;
  detail: string;
  mode: string;
  keptBytes: number;
  skippedBytes: number;
  skippedFiles: number;
  largestRead: number;
  largestPart: number;
  totalRead: number;
  peakHeldBytes: number;
  assembledBytes: number;
  heapAtPeak: number;
  notes: string[];
  stdout: string[];
}

export const dosDiag: DosDiag = {
  stage: 'idle',
  detail: '',
  mode: '',
  keptBytes: 0,
  skippedBytes: 0,
  skippedFiles: 0,
  largestRead: 0,
  largestPart: 0,
  totalRead: 0,
  peakHeldBytes: 0,
  assembledBytes: 0,
  heapAtPeak: 0,
  notes: [],
  stdout: [],
};

export function resetDosDiag(): void {
  dosDiag.stage = 'idle';
  dosDiag.detail = '';
  dosDiag.mode = '';
  dosDiag.keptBytes = 0;
  dosDiag.skippedBytes = 0;
  dosDiag.skippedFiles = 0;
  dosDiag.largestRead = 0;
  dosDiag.largestPart = 0;
  dosDiag.totalRead = 0;
  dosDiag.peakHeldBytes = 0;
  dosDiag.assembledBytes = 0;
  dosDiag.heapAtPeak = 0;
  dosDiag.notes = [];
  dosDiag.stdout = [];
  publishDosDiag();
}

export function setDosStage(stage: string, detail = ''): void {
  dosDiag.stage = stage;
  dosDiag.detail = detail;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ stage, detail, at: Date.now() }));
  } catch {
    /* private mode */
  }
  publishDosDiag();
}

export function noteDosRead(length: number): void {
  dosDiag.totalRead += length;
  if (length > dosDiag.largestRead) dosDiag.largestRead = length;
}

export function noteDosPart(length: number): void {
  if (length > dosDiag.largestPart) dosDiag.largestPart = length;
}

export function noteDosStdout(line: string): void {
  if (!line) return;
  dosDiag.stdout.push(line);
  if (dosDiag.stdout.length > 40) dosDiag.stdout.shift();
}

export function consumeDosInterruption(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const body = JSON.parse(raw) as { stage?: string; detail?: string; at?: number };
    sessionStorage.removeItem(KEY);
    if (!body || typeof body.stage !== 'string' || QUIET.has(body.stage)) return null;
    if (typeof body.at === 'number' && Date.now() - body.at > 10 * 60 * 1000) return null;
    const where = body.detail || body.stage;
    return `上次 DOS 开到「${where}」时页面被关掉了。这一版不会把整包展开进内存。如果还是关掉，请先退出其他标签。`;
  } catch {
    return null;
  }
}

export function publishDosDiag(): void {
  const root = globalThis as { __streetgameDos?: DosDiag };
  root.__streetgameDos = dosDiag;
}
