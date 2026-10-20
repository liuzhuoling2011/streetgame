import type { CoreType, KeyBindings } from './types';

export interface BindingRow {
  section: string;
  key: string;
  label: string;
  defaultValue: string;
}

const row = (section: string, key: string, label: string, defaultValue: string): BindingRow => ({
  section,
  key,
  label,
  defaultValue,
});

const pad = [
  row('', 'Up', '上', 'Up'),
  row('', 'Down', '下', 'Down'),
  row('', 'Left', '左', 'Left'),
  row('', 'Right', '右', 'Right'),
];

export const BINDING_ROWS: BindingRow[] = [
  row('Common', 'Pause', '暂停', 'P'),
  row('Common', 'SaveState', '快速存档', 'F5'),
  row('Common', 'LoadState', '快速读档', 'F9'),
  ...pad.map((item) => ({ ...item, section: 'NES' })),
  row('NES', 'A', 'A', 'Z'),
  row('NES', 'B', 'B', 'X'),
  row('NES', 'Start', 'Start', 'Return'),
  row('NES', 'Select', 'Select', 'Right Shift'),
  ...pad.map((item) => ({ ...item, section: 'GB' })),
  row('GB', 'A', 'A', 'Z'),
  row('GB', 'B', 'B', 'X'),
  row('GB', 'Start', 'Start', 'Return'),
  row('GB', 'Select', 'Select', 'Right Shift'),
  ...pad.map((item) => ({ ...item, section: 'GBA' })),
  row('GBA', 'A', 'A', 'Z'),
  row('GBA', 'B', 'B', 'X'),
  row('GBA', 'L', 'L', 'A'),
  row('GBA', 'R', 'R', 'S'),
  row('GBA', 'Start', 'Start', 'Return'),
  row('GBA', 'Select', 'Select', 'Right Shift'),
  ...pad.map((item) => ({ ...item, section: 'MD' })),
  row('MD', 'A', 'A', 'Z'),
  row('MD', 'B', 'B', 'X'),
  row('MD', 'C', 'C', 'C'),
  row('MD', 'X', 'X', 'A'),
  row('MD', 'Y', 'Y', 'S'),
  row('MD', 'Z', 'Z', 'D'),
  row('MD', 'Start', 'Start', 'Return'),
  row('MD', 'Mode', 'Mode', 'Right Shift'),
  row('CPS', 'P1_Up', '上', 'Up'),
  row('CPS', 'P1_Down', '下', 'Down'),
  row('CPS', 'P1_Left', '左', 'Left'),
  row('CPS', 'P1_Right', '右', 'Right'),
  row('CPS', 'P1_Punch1', '轻拳', 'A'),
  row('CPS', 'P1_Punch2', '中拳', 'S'),
  row('CPS', 'P1_Punch3', '重拳', 'D'),
  row('CPS', 'P1_Kick1', '轻脚', 'Z'),
  row('CPS', 'P1_Kick2', '中脚', 'X'),
  row('CPS', 'P1_Kick3', '重脚', 'C'),
  row('CPS', 'P1_Start', '开始', '1'),
  row('CPS', 'P1_Coin', '投币', '5'),
  row('CPS', 'P2_Up', '上', 'Keypad 8'),
  row('CPS', 'P2_Down', '下', 'Keypad 5'),
  row('CPS', 'P2_Left', '左', 'Keypad 4'),
  row('CPS', 'P2_Right', '右', 'Keypad 6'),
  row('CPS', 'P2_Punch1', '轻拳', 'J'),
  row('CPS', 'P2_Punch2', '中拳', 'K'),
  row('CPS', 'P2_Punch3', '重拳', 'L'),
  row('CPS', 'P2_Kick1', '轻脚', 'M'),
  row('CPS', 'P2_Kick2', '中脚', ','),
  row('CPS', 'P2_Kick3', '重脚', '.'),
  row('CPS', 'P2_Start', '开始', '2'),
  row('CPS', 'P2_Coin', '投币', '6'),
  row('NeoGeo', 'P1_Up', '上', 'Up'),
  row('NeoGeo', 'P1_Down', '下', 'Down'),
  row('NeoGeo', 'P1_Left', '左', 'Left'),
  row('NeoGeo', 'P1_Right', '右', 'Right'),
  row('NeoGeo', 'P1_A', 'A', 'A'),
  row('NeoGeo', 'P1_B', 'B', 'S'),
  row('NeoGeo', 'P1_C', 'C', 'D'),
  row('NeoGeo', 'P1_D', 'D', 'F'),
  row('NeoGeo', 'P1_Start', '开始', '1'),
  row('NeoGeo', 'P1_Select', '选择', '3'),
  row('NeoGeo', 'P1_Coin', '投币', '5'),
  row('NeoGeo', 'P2_Up', '上', 'Keypad 8'),
  row('NeoGeo', 'P2_Down', '下', 'Keypad 5'),
  row('NeoGeo', 'P2_Left', '左', 'Keypad 4'),
  row('NeoGeo', 'P2_Right', '右', 'Keypad 6'),
  row('NeoGeo', 'P2_A', 'A', 'J'),
  row('NeoGeo', 'P2_B', 'B', 'K'),
  row('NeoGeo', 'P2_C', 'C', 'L'),
  row('NeoGeo', 'P2_D', 'D', ';'),
  row('NeoGeo', 'P2_Start', '开始', '2'),
  row('NeoGeo', 'P2_Select', '选择', '4'),
  row('NeoGeo', 'P2_Coin', '投币', '6'),
];

export const BROWSER_KEY_TO_SDL: Record<string, string> = {
  Escape: 'Escape',
  F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6',
  F7: 'F7', F8: 'F8', F9: 'F9', F10: 'F10', F11: 'F11', F12: 'F12',
  Backquote: '`', Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4',
  Digit5: '5', Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9', Digit0: '0',
  Minus: '-', Equal: '=', Backspace: 'Backspace', Tab: 'Tab',
  KeyA: 'A', KeyB: 'B', KeyC: 'C', KeyD: 'D', KeyE: 'E', KeyF: 'F',
  KeyG: 'G', KeyH: 'H', KeyI: 'I', KeyJ: 'J', KeyK: 'K', KeyL: 'L',
  KeyM: 'M', KeyN: 'N', KeyO: 'O', KeyP: 'P', KeyQ: 'Q', KeyR: 'R',
  KeyS: 'S', KeyT: 'T', KeyU: 'U', KeyV: 'V', KeyW: 'W', KeyX: 'X',
  KeyY: 'Y', KeyZ: 'Z', Semicolon: ';', Quote: "'", Enter: 'Return',
  Comma: ',', Period: '.', Slash: '/', Space: 'Space',
  ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Numpad0: 'Keypad 0', Numpad1: 'Keypad 1', Numpad2: 'Keypad 2',
  Numpad3: 'Keypad 3', Numpad4: 'Keypad 4', Numpad5: 'Keypad 5',
  Numpad6: 'Keypad 6', Numpad7: 'Keypad 7', Numpad8: 'Keypad 8',
  Numpad9: 'Keypad 9',
};

export function defaultBindings(): KeyBindings {
  const bindings: KeyBindings = {};
  for (const item of BINDING_ROWS) {
    bindings[item.section] ??= {};
    bindings[item.section][item.key] = item.defaultValue;
  }
  return bindings;
}

const STORAGE_KEY = 'streetgame.keys';

export function loadBindings(): KeyBindings {
  const bindings = defaultBindings();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return bindings;
    const saved = JSON.parse(raw) as KeyBindings;
    for (const [section, values] of Object.entries(saved)) {
      if (!bindings[section]) continue;
      for (const [key, value] of Object.entries(values)) {
        if (typeof value === 'string' && bindings[section][key]) {
          bindings[section][key] = value;
        }
      }
    }
  } catch {
    /* keep defaults */
  }
  return bindings;
}

export function saveBindings(bindings: KeyBindings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
}

export type PlayerId = 1 | 2;

export const COMBO_IDS = ['AB', 'AC', 'AD', 'BC', 'BD', 'CD', 'ABCD'] as const;
export type ComboId = (typeof COMBO_IDS)[number];

const COMBO_PARTS: Record<ComboId, Array<'A' | 'B' | 'C' | 'D'>> = {
  AB: ['A', 'B'],
  AC: ['A', 'C'],
  AD: ['A', 'D'],
  BC: ['B', 'C'],
  BD: ['B', 'D'],
  CD: ['C', 'D'],
  ABCD: ['A', 'B', 'C', 'D'],
};

const CPS_PART: Record<'A' | 'B' | 'C' | 'D', string> = {
  A: 'Punch1',
  B: 'Punch2',
  C: 'Punch3',
  D: 'Kick1',
};

export function comboLabel(id: ComboId): string {
  return COMBO_PARTS[id].join('+');
}

export function comboStorageKey(section: string, player: PlayerId, id: ComboId): string {
  return `${section}:${player}:${id}`;
}

/** Binding names the combo should hold together. Null when this core has no A–D layer. */
export function comboTargets(section: string, player: PlayerId, id: ComboId): string[] | null {
  const prefix = player === 1 ? 'P1' : 'P2';
  if (section === 'NeoGeo') return COMBO_PARTS[id].map((part) => `${prefix}_${part}`);
  if (section === 'CPS') return COMBO_PARTS[id].map((part) => `${prefix}_${CPS_PART[part]}`);
  return null;
}

export type ComboMap = Record<string, string>;

const COMBO_STORAGE = 'streetgame.combos';

export function loadCombos(): ComboMap {
  try {
    const raw = localStorage.getItem(COMBO_STORAGE);
    if (!raw) return {};
    const saved = JSON.parse(raw) as Record<string, unknown>;
    const combos: ComboMap = {};
    for (const [key, value] of Object.entries(saved)) {
      if (typeof value === 'string' && value) combos[key] = value;
    }
    return combos;
  } catch {
    return {};
  }
}

export function saveCombos(combos: ComboMap): void {
  localStorage.setItem(COMBO_STORAGE, JSON.stringify(combos));
}

export function sectionSupportsPlayer2(section: string | null): boolean {
  if (!section) return false;
  return BINDING_ROWS.some((item) => item.section === section && item.key.startsWith('P2_'));
}

export function rowsForPlayer(section: string | null, player: PlayerId): BindingRow[] {
  return BINDING_ROWS.filter((item) => {
    if (item.section !== 'Common' && item.section !== section) return false;
    if (player === 2) return item.section === 'Common' || item.key.startsWith('P2_');
    return !item.key.startsWith('P2_');
  });
}

export function sectionForCore(core: CoreType): string | null {
  switch (core) {
    case 'nes': return 'NES';
    case 'gb': return 'GB';
    case 'gba': return 'GBA';
    case 'md': return 'MD';
    case 'cps': return 'CPS';
    case 'neogeo': return 'NeoGeo';
    default: return null;
  }
}

/** Diamond slots. Neo Geo arcade pads use D top, C left, B right, A bottom. */
export type FacePlace = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export interface TouchAction {
  binding: string;
  label: string;
  place?: FacePlace;
}

export interface TouchLayout {
  directions: Record<'up' | 'down' | 'left' | 'right', string>;
  /**
   * Diamond is the Neo Geo cross (D top, C left, B right, A bottom).
   * Square is those same four circles in a 2×2. Grid is the 6-button arcade row.
   */
  face: 'diamond' | 'square' | 'grid';
  actions: TouchAction[];
  system: Array<{ binding: string; label: string }>;
  combos: Array<{ id: ComboId; label: string }>;
}

/** How the four A/B/C/D circles sit. Six-button rows ignore this. */
export type FaceLayout = 'diamond' | 'square';

const STANDARD_DIRECTIONS = { up: 'Up', down: 'Down', left: 'Left', right: 'Right' };

export function touchLayout(
  core: CoreType,
  player: PlayerId = 1,
  showCombos = false,
  faceLayout: FaceLayout = 'diamond',
): TouchLayout | null {
  const layout = layoutFor(core);
  if (!layout) return null;
  if (player === 2 && (core === 'cps' || core === 'neogeo')) {
    const swap = (binding: string) => binding.replace(/^P1_/, 'P2_');
    layout.directions = {
      up: swap(layout.directions.up),
      down: swap(layout.directions.down),
      left: swap(layout.directions.left),
      right: swap(layout.directions.right),
    };
    for (const button of [...layout.actions, ...layout.system]) button.binding = swap(button.binding);
  }
  if (showCombos && sectionForCore(core) && comboTargets(sectionForCore(core) as string, player, 'AB')) {
    layout.combos = COMBO_IDS.map((id) => ({ id, label: comboLabel(id) }));
  }
  if (faceLayout === 'square') applySquareFace(layout);
  return layout;
}

/**
 * Square keeps each letter in the half it occupies on the diamond:
 * C left, D top, A bottom, B right → top-left C, top-right D, bottom-left A, bottom-right B.
 */
const SQUARE_PLACE: Record<string, FacePlace> = {
  C: 'nw',
  D: 'ne',
  A: 'sw',
  B: 'se',
};

function applySquareFace(layout: TouchLayout): void {
  if (layout.actions.length !== 4) return;
  const byLabel = new Map(layout.actions.map((action) => [action.label, action]));
  if (!(['A', 'B', 'C', 'D'] as const).every((label) => byLabel.has(label))) return;
  layout.face = 'square';
  for (const [label, place] of Object.entries(SQUARE_PLACE)) {
    const action = byLabel.get(label);
    if (action) action.place = place;
  }
}

function layoutFor(core: CoreType): TouchLayout | null {
  switch (core) {
    case 'nes':
    case 'gb':
      return {
        directions: STANDARD_DIRECTIONS,
        face: 'diamond',
        actions: [
          { binding: 'B', label: 'B', place: 'w' },
          { binding: 'A', label: 'A', place: 'e' },
        ],
        system: [
          { binding: 'Select', label: 'Select' },
          { binding: 'Start', label: 'Start' },
        ],
        combos: [],
      };
    case 'gba':
      return {
        directions: STANDARD_DIRECTIONS,
        face: 'diamond',
        actions: [
          { binding: 'L', label: 'L', place: 'nw' },
          { binding: 'R', label: 'R', place: 'ne' },
          { binding: 'B', label: 'B', place: 'w' },
          { binding: 'A', label: 'A', place: 'e' },
        ],
        system: [
          { binding: 'Select', label: 'Select' },
          { binding: 'Start', label: 'Start' },
        ],
        combos: [],
      };
    case 'md':
      return {
        directions: STANDARD_DIRECTIONS,
        face: 'grid',
        actions: [
          { binding: 'X', label: 'X' },
          { binding: 'Y', label: 'Y' },
          { binding: 'Z', label: 'Z' },
          { binding: 'A', label: 'A' },
          { binding: 'B', label: 'B' },
          { binding: 'C', label: 'C' },
        ],
        system: [
          { binding: 'Mode', label: 'Mode' },
          { binding: 'Start', label: 'Start' },
        ],
        combos: [],
      };
    case 'cps':
      return {
        directions: { up: 'P1_Up', down: 'P1_Down', left: 'P1_Left', right: 'P1_Right' },
        face: 'grid',
        actions: [
          { binding: 'P1_Punch1', label: '轻拳' },
          { binding: 'P1_Punch2', label: '中拳' },
          { binding: 'P1_Punch3', label: '重拳' },
          { binding: 'P1_Kick1', label: '轻脚' },
          { binding: 'P1_Kick2', label: '中脚' },
          { binding: 'P1_Kick3', label: '重脚' },
        ],
        system: [
          { binding: 'P1_Coin', label: '投币' },
          { binding: 'P1_Start', label: '开始' },
        ],
        combos: [],
      };
    case 'neogeo':
      return {
        directions: { up: 'P1_Up', down: 'P1_Down', left: 'P1_Left', right: 'P1_Right' },
        face: 'diamond',
        actions: [
          { binding: 'P1_D', label: 'D', place: 'n' },
          { binding: 'P1_C', label: 'C', place: 'w' },
          { binding: 'P1_B', label: 'B', place: 'e' },
          { binding: 'P1_A', label: 'A', place: 's' },
        ],
        system: [
          { binding: 'P1_Coin', label: '投币' },
          { binding: 'P1_Select', label: '选择' },
          { binding: 'P1_Start', label: '开始' },
        ],
        combos: [],
      };
    default:
      return null;
  }
}
