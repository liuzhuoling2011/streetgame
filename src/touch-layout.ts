/** Per-orientation on-screen control positions. Portrait and landscape are stored apart. */

export type ScreenOrientation = 'portrait' | 'landscape';

export interface Placement {
  /** Center X as a fraction of the player shell, 0–1. */
  x: number;
  /** Center Y as a fraction of the player shell, 0–1. */
  y: number;
  /** 1 is the default control size. Only the stick and face buttons use this. */
  scale: number;
  hidden: boolean;
}

export type LayoutMap = Record<string, Placement>;

export const STICK_ID = 'stick';
export const MIN_SCALE = 0.65;
export const MAX_SCALE = 1.8;

const STORAGE_KEY = 'streetgame.touchLayout';

export function faceControlId(binding: string): string {
  return `face:${binding}`;
}

export function systemControlId(binding: string): string {
  return `sys:${binding}`;
}

export function comboControlId(id: string): string {
  return `combo:${id}`;
}

export function isResizableControl(id: string): boolean {
  return id === STICK_ID || id.startsWith('face:');
}

export function currentOrientation(): ScreenOrientation {
  return window.matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait';
}

export function clampScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
  return Math.round(clamped * 100) / 100;
}

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

/** Keep enough of the control inside the shell that it can still be grabbed. */
export function clampPlacementPoint(
  x: number,
  y: number,
  shellW: number,
  shellH: number,
  controlW: number,
  controlH: number,
): { x: number; y: number } {
  if (shellW < 2 || shellH < 2) return { x: clampUnit(x), y: clampUnit(y) };
  const insetX = Math.min(shellW * 0.45, Math.max(12, controlW * 0.22));
  const insetY = Math.min(shellH * 0.45, Math.max(12, controlH * 0.22));
  return {
    x: Math.min(1 - insetX / shellW, Math.max(insetX / shellW, clampUnit(x))),
    y: Math.min(1 - insetY / shellH, Math.max(insetY / shellH, clampUnit(y))),
  };
}

export function placementFromRect(shell: DOMRect, node: DOMRect, scale = 1): Placement {
  const width = shell.width || 1;
  const height = shell.height || 1;
  return {
    x: clampUnit((node.left + node.width / 2 - shell.left) / width),
    y: clampUnit((node.top + node.height / 2 - shell.top) / height),
    scale: clampScale(scale),
    hidden: false,
  };
}

export function cloneLayout(map: LayoutMap | null | undefined): LayoutMap {
  const next: LayoutMap = {};
  if (!map) return next;
  for (const [id, placement] of Object.entries(map)) next[id] = { ...placement };
  return next;
}

interface StoredLayouts {
  portrait?: LayoutMap;
  landscape?: LayoutMap;
}

function sanitizeMap(value: unknown): LayoutMap | null {
  if (!value || typeof value !== 'object') return null;
  const map: LayoutMap = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!id || !raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const x = Number(item.x);
    const y = Number(item.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    map[id] = {
      x: clampUnit(x),
      y: clampUnit(y),
      scale: clampScale(typeof item.scale === 'number' ? item.scale : Number(item.scale ?? 1)),
      hidden: item.hidden === true,
    };
  }
  return Object.keys(map).length > 0 ? map : null;
}

function readStore(): StoredLayouts {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredLayouts;
    return {
      portrait: sanitizeMap(parsed?.portrait) ?? undefined,
      landscape: sanitizeMap(parsed?.landscape) ?? undefined,
    };
  } catch {
    return {};
  }
}

function writeStore(store: StoredLayouts): void {
  try {
    if (!store.portrait && !store.landscape) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* private mode */
  }
}

export function loadTouchLayout(orientation: ScreenOrientation): LayoutMap | null {
  return readStore()[orientation] ?? null;
}

export function saveTouchLayout(orientation: ScreenOrientation, map: LayoutMap): void {
  const store = readStore();
  const clean = sanitizeMap(map);
  if (clean) store[orientation] = clean;
  else delete store[orientation];
  writeStore(store);
}

export function clearTouchLayout(orientation: ScreenOrientation): void {
  const store = readStore();
  delete store[orientation];
  writeStore(store);
}

/** Pixel size for the stick or a round face button. System keys and combos keep their text size. */
export function controlPixelSize(
  id: string,
  scale: number,
  face: 'diamond' | 'square' | 'grid',
  landscape: boolean,
  landscapeStick: number,
  landscapeButton: number,
  viewportWidth: number,
): { w: number; h: number } | null {
  const safeScale = clampScale(scale);
  if (id === STICK_ID) {
    const base = landscape && landscapeStick > 0
      ? landscapeStick
      : Math.min(viewportWidth * 0.34, 148);
    const px = Math.round(Math.max(72, Math.min(220, base * safeScale)));
    return { w: px, h: px };
  }
  if (id.startsWith('face:')) {
    let base = Math.min(viewportWidth * 0.135, 54);
    if (face === 'grid') base = Math.min(viewportWidth * 0.13, 52);
    if (face === 'square') base = (Math.min(viewportWidth * 0.34, 148) - 8) / 2;
    if (landscape && landscapeButton > 0) base = landscapeButton;
    const px = Math.round(Math.max(36, Math.min(104, base * safeScale)));
    return { w: px, h: px };
  }
  return null;
}
