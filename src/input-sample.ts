import { holds } from './holds';
import {
  BROWSER_KEY_TO_SDL,
  COMBO_IDS,
  comboStorageKey,
  comboTargets,
  sectionForCore,
  type ComboMap,
} from './keys';
import type { CoreType, KeyBindings } from './types';

const PASSTHROUGH = new Set(['Escape', 'P', 'F5', 'F9', 'F10', 'F11', 'F12', '=', '-', '`']);

/** Keys that are down right now. Repeats never add or remove. */
const keyboard = new Set<string>();
/** Went down since the last emulated frame, even if already released. */
const pulsed = new Set<string>();

let bindings: KeyBindings = {};
let combos: ComboMap = {};
let core: CoreType = 'unknown';
let capturing = false;

export function setInputContext(next: {
  bindings: KeyBindings;
  combos: ComboMap;
  core: CoreType;
  capturing: boolean;
}): void {
  bindings = next.bindings;
  combos = next.combos;
  core = next.core;
  capturing = next.capturing;
}

export function clearLatchedKeys(): void {
  keyboard.clear();
  pulsed.clear();
}

function playing(): boolean {
  return document.body.classList.contains('playing');
}

function typingTarget(event: Event): boolean {
  const target = event.target instanceof HTMLElement ? event.target : null;
  return Boolean(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable));
}

function remember(sdl: string): void {
  if (!keyboard.has(sdl)) pulsed.add(sdl);
  keyboard.add(sdl);
}

export function installInputSample(): void {
  window.addEventListener('keydown', (event) => {
    if (capturing || !playing() || typingTarget(event)) return;
    const sdl = BROWSER_KEY_TO_SDL[event.code];
    if (!sdl || PASSTHROUGH.has(sdl)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    remember(sdl);
  }, true);
  window.addEventListener('keyup', (event) => {
    const sdl = BROWSER_KEY_TO_SDL[event.code];
    if (!sdl) return;
    keyboard.delete(sdl);
    if (capturing || !playing() || typingTarget(event) || PASSTHROUGH.has(sdl)) return;
    event.preventDefault();
    event.stopPropagation();
  }, true);
  window.addEventListener('blur', () => {
    keyboard.clear();
  });
}

function addBinding(names: Set<string>, section: string, key: string): void {
  const sdl = bindings[section]?.[key];
  if (sdl) names.add(sdl);
}

function addPad(names: Set<string>, section: string): void {
  const pads = navigator.getGamepads?.();
  if (!pads) return;
  const prefix = section === 'CPS' || section === 'NeoGeo' ? 'P1_' : '';
  const face = section === 'CPS'
    ? ['Punch1', 'Punch2', 'Punch3', 'Kick1', 'Kick2', 'Kick3']
    : section === 'NeoGeo'
      ? ['A', 'B', 'C', 'D']
      : section === 'MD'
        ? ['A', 'B', 'C', 'X', 'Y', 'Z']
        : section === 'GBA'
          ? ['A', 'B', 'L', 'R']
          : ['A', 'B'];
  for (const pad of pads) {
    if (!pad) continue;
    const down = (index: number) => Boolean(pad.buttons[index]?.pressed || (pad.buttons[index]?.value ?? 0) > 0.5);
    const axis = (index: number) => pad.axes[index] ?? 0;
    const dirs: Array<[boolean, string]> = [
      [down(12) || axis(1) < -0.5, 'Up'],
      [down(13) || axis(1) > 0.5, 'Down'],
      [down(14) || axis(0) < -0.5, 'Left'],
      [down(15) || axis(0) > 0.5, 'Right'],
    ];
    for (const [held, dir] of dirs) {
      if (held) addBinding(names, section, `${prefix}${dir}`);
    }
    face.forEach((name, index) => {
      if (down(index)) addBinding(names, section, prefix ? `${prefix}${name}` : name);
    });
    if (down(9)) addBinding(names, section, prefix ? `${prefix}Start` : 'Start');
    if (section === 'CPS' || section === 'NeoGeo') {
      if (down(8)) addBinding(names, section, `${prefix}Coin`);
    } else if (down(8)) {
      addBinding(names, section, 'Select');
    }
    if (section === 'NeoGeo' && down(6)) addBinding(names, section, `${prefix}Select`);
    if (section === 'MD' && down(6)) addBinding(names, section, 'Mode');
  }
}

/**
 * Called once per emulated frame, including each catch-up frame.
 * The string is every SDL key that should be down for that frame.
 */
export function sampleHeldKeys(): string {
  const names = new Set<string>(holds.names());
  for (const sdl of keyboard) names.add(sdl);
  for (const sdl of pulsed) names.add(sdl);
  const section = sectionForCore(core);
  const literalAB = (keyboard.has('A') || pulsed.has('A')) && (keyboard.has('B') || pulsed.has('B'));
  if (section && literalAB) {
    const targets = comboTargets(section, 1, 'AB') ?? [];
    for (const key of targets) addBinding(names, section, key);
  }
  if (section) {
    const down = new Set<string>([...keyboard, ...pulsed]);
    for (const player of [1, 2] as const) {
      for (const id of COMBO_IDS) {
        const sdl = combos[comboStorageKey(section, player, id)];
        if (!sdl || !down.has(sdl)) continue;
        for (const key of comboTargets(section, player, id) ?? []) addBinding(names, section, key);
      }
    }
  }
  if (section) addPad(names, section);
  pulsed.clear();
  return [...names].join(',');
}
