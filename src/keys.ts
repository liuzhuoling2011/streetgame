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
  ...pad.map((item) => ({ ...item, section: 'DOS' })),
  row('DOS', 'Confirm', '回车', 'Return'),
  row('DOS', 'Cancel', '取消', 'Escape'),
  row('DOS', 'Space', '空格', 'Space'),
  row('DOS', 'Ctrl', 'Ctrl', 'Left Ctrl'),
  row('DOS', 'Alt', 'Alt', 'Left Alt'),
  row('DOS', 'Shift', 'Shift', 'Left Shift'),
  row('CPS', 'P1_Up', '上', 'Up'),
  row('CPS', 'P1_Down', '下', 'Down'),
  row('CPS', 'P1_Left', '左', 'Left'),
  row('CPS', 'P1_Right', '右', 'Right'),
  row('CPS', 'P1_Punch1', 'A 轻拳', 'A'),
  row('CPS', 'P1_Punch2', 'B 中拳', 'B'),
  row('CPS', 'P1_Punch3', 'C 重拳', 'C'),
  row('CPS', 'P1_Kick1', 'D 轻脚', 'D'),
  row('CPS', 'P1_Kick2', 'E 中脚', 'E'),
  row('CPS', 'P1_Kick3', 'F 重脚', 'F'),
  row('CPS', 'P1_Start', '开始', '1'),
  row('CPS', 'P1_Coin', '投币', '5'),
  row('CPS', 'P2_Up', '上', 'Keypad 8'),
  row('CPS', 'P2_Down', '下', 'Keypad 5'),
  row('CPS', 'P2_Left', '左', 'Keypad 4'),
  row('CPS', 'P2_Right', '右', 'Keypad 6'),
  row('CPS', 'P2_Punch1', 'A 轻拳', 'J'),
  row('CPS', 'P2_Punch2', 'B 中拳', 'K'),
  row('CPS', 'P2_Punch3', 'C 重拳', 'L'),
  row('CPS', 'P2_Kick1', 'D 轻脚', 'M'),
  row('CPS', 'P2_Kick2', 'E 中脚', ','),
  row('CPS', 'P2_Kick3', 'F 重脚', '.'),
  row('CPS', 'P2_Start', '开始', '2'),
  row('CPS', 'P2_Coin', '投币', '6'),
  row('NeoGeo', 'P1_Up', '上', 'Up'),
  row('NeoGeo', 'P1_Down', '下', 'Down'),
  row('NeoGeo', 'P1_Left', '左', 'Left'),
  row('NeoGeo', 'P1_Right', '右', 'Right'),
  row('NeoGeo', 'P1_A', 'A', 'A'),
  row('NeoGeo', 'P1_B', 'B', 'B'),
  row('NeoGeo', 'P1_C', 'C', 'C'),
  row('NeoGeo', 'P1_D', 'D', 'D'),
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
  ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt', AltRight: 'Right Alt',
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

/** Older defaults we should replace so C is heavy punch and 6-button games use E/F. */
const LEGACY_DEFAULTS: Record<string, Record<string, string>> = {
  NeoGeo: { P1_B: 'S', P1_C: 'D', P1_D: 'F' },
  CPS: {
    P1_Punch2: 'S',
    P1_Punch3: 'D',
    P1_Kick1: 'Z',
    P1_Kick2: 'X',
    P1_Kick3: 'C',
  },
};

export function loadBindings(): KeyBindings {
  const bindings = defaultBindings();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return bindings;
    const saved = JSON.parse(raw) as KeyBindings;
    let migrated = false;
    for (const [section, values] of Object.entries(saved)) {
      if (!bindings[section]) continue;
      for (const [key, value] of Object.entries(values)) {
        if (typeof value === 'string' && bindings[section][key]) {
          const legacy = LEGACY_DEFAULTS[section]?.[key];
          if (legacy && value === legacy) {
            migrated = true;
            continue;
          }
          bindings[section][key] = value;
        }
      }
    }
    if (migrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
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

const DEFAULT_COMBOS: ComboMap = {
  'CPS:1:AB': 'Q',
  'NeoGeo:1:AB': 'Q',
  'CPS:2:AB': 'U',
  'NeoGeo:2:AB': 'U',
  'NeoGeo:1:AC': 'E',
  'NeoGeo:1:BD': 'F',
};

const COMBO_REVISION_KEY = 'streetgame.combos.rev';
const COMBO_REVISION = 2;

/** Face extras that should appear in Neo Geo key settings and on the pad. */
export const NEOGEO_EXTRA_FACE: Array<{ letter: 'E' | 'F'; combo: ComboId; caption: string }> = [
  { letter: 'E', combo: 'AC', caption: 'A+C' },
  { letter: 'F', combo: 'BD', caption: 'B+D' },
];

export function loadCombos(): ComboMap {
  try {
    const raw = localStorage.getItem(COMBO_STORAGE);
    const combos: ComboMap = raw == null ? { ...DEFAULT_COMBOS } : {};
    if (raw) {
      const saved = JSON.parse(raw) as Record<string, unknown>;
      for (const [key, value] of Object.entries(saved)) {
        if (typeof value === 'string' && value) combos[key] = value;
      }
    }
    const revision = Number(localStorage.getItem(COMBO_REVISION_KEY) || '0');
    if (revision < COMBO_REVISION) {
      let filled = false;
      for (const [key, value] of Object.entries(DEFAULT_COMBOS)) {
        if (key.includes(':AC') || key.includes(':BD')) {
          if (!(key in combos)) {
            combos[key] = value;
            filled = true;
          }
        }
      }
      localStorage.setItem(COMBO_REVISION_KEY, String(COMBO_REVISION));
      if (filled) localStorage.setItem(COMBO_STORAGE, JSON.stringify(combos));
    }
    return combos;
  } catch {
    return { ...DEFAULT_COMBOS };
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
    case 'dos': return 'DOS';
    default: return null;
  }
}

/** Diamond slots. Neo Geo arcade pads use D top, C left, B right, A bottom. */
export type FacePlace = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw' | 'extra-n' | 'extra-s';

export interface TouchAction {
  binding: string;
  label: string;
  /** Short action name under the letter, such as 重拳. */
  caption?: string;
  place?: FacePlace;
  /** Extra buttons can hold several real bindings at once, such as E = A+C. */
  holds?: string[];
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

const KOF_CAPTION = { A: '弱拳', B: '弱脚', C: '重拳', D: '重脚' } as const;

const CPS_FACE: Record<string, { letter: string; caption: string }> = {
  Punch1: { letter: 'A', caption: '轻拳' },
  Punch2: { letter: 'B', caption: '中拳' },
  Punch3: { letter: 'C', caption: '重拳' },
  Kick1: { letter: 'D', caption: '轻脚' },
  Kick2: { letter: 'E', caption: '中脚' },
  Kick3: { letter: 'F', caption: '重脚' },
};

export function isKofGame(gameId?: string): boolean {
  return Boolean(gameId && /kof/i.test(gameId));
}

/** Extra name for a face button, such as 重拳 for KOF button C. */
export function faceCaption(section: string, key: string, gameId?: string): string | undefined {
  const part = key.replace(/^P[12]_/, '');
  if (section === 'NeoGeo' && isKofGame(gameId) && part in KOF_CAPTION) {
    return KOF_CAPTION[part as keyof typeof KOF_CAPTION];
  }
  if (section === 'CPS' && part in CPS_FACE) return CPS_FACE[part].caption;
  return undefined;
}

export function displayBindingLabel(item: BindingRow, gameId?: string): string {
  if (item.section === 'CPS' && item.key.replace(/^P[12]_/, '') in CPS_FACE) return item.label;
  const caption = faceCaption(item.section, item.key, gameId);
  if (!caption) return item.label;
  if (item.label === item.key.replace(/^P[12]_/, '')) return `${item.label} ${caption}`;
  return `${item.label} ${caption}`;
}

export function touchLayout(
  core: CoreType,
  player: PlayerId = 1,
  showCombos = false,
  faceLayout: FaceLayout = 'diamond',
  gameId = '',
): TouchLayout | null {
  const layout = layoutFor(core, gameId);
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
    for (const action of layout.actions) {
      if (action.holds) action.holds = action.holds.map(swap);
    }
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

function faceLetter(action: TouchAction): string | undefined {
  const match = action.binding.match(/(?:^|_)([ABCD])$/);
  if (match) return match[1];
  if ((['A', 'B', 'C', 'D'] as const).includes(action.label as 'A')) return action.label;
  return undefined;
}

function applySquareFace(layout: TouchLayout): void {
  const byLetter = new Map<string, TouchAction>();
  for (const action of layout.actions) {
    const letter = faceLetter(action);
    if (letter) byLetter.set(letter, action);
  }
  if (!(['A', 'B', 'C', 'D'] as const).every((letter) => byLetter.has(letter))) return;
  layout.face = 'square';
  for (const [letter, place] of Object.entries(SQUARE_PLACE)) {
    const action = byLetter.get(letter);
    if (action) action.place = place;
  }
  for (const action of layout.actions) {
    if (action.label === 'E' || /_E$/.test(action.binding)) action.place = 'extra-n';
    if (action.label === 'F' || /_F$/.test(action.binding)) action.place = 'extra-s';
  }
}

function layoutFor(core: CoreType, gameId = ''): TouchLayout | null {
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
          { binding: 'P1_Punch1', label: 'A', caption: '轻拳' },
          { binding: 'P1_Punch2', label: 'B', caption: '中拳' },
          { binding: 'P1_Punch3', label: 'C', caption: '重拳' },
          { binding: 'P1_Kick1', label: 'D', caption: '轻脚' },
          { binding: 'P1_Kick2', label: 'E', caption: '中脚' },
          { binding: 'P1_Kick3', label: 'F', caption: '重脚' },
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
          { binding: 'P1_D', label: 'D', caption: isKofGame(gameId) ? '重脚' : undefined, place: 'n' },
          { binding: 'P1_C', label: 'C', caption: isKofGame(gameId) ? '重拳' : undefined, place: 'w' },
          { binding: 'P1_B', label: 'B', caption: isKofGame(gameId) ? '弱脚' : undefined, place: 'e' },
          { binding: 'P1_A', label: 'A', caption: isKofGame(gameId) ? '弱拳' : undefined, place: 's' },
          { binding: 'P1_E', label: 'E', caption: 'A+C', holds: ['P1_A', 'P1_C'], place: 'ne' },
          { binding: 'P1_F', label: 'F', caption: 'B+D', holds: ['P1_B', 'P1_D'], place: 'se' },
        ],
        system: [
          { binding: 'P1_Coin', label: '投币' },
          { binding: 'P1_Select', label: '选择' },
          { binding: 'P1_Start', label: '开始' },
        ],
        combos: [],
      };
    case 'dos':
      return {
        directions: STANDARD_DIRECTIONS,
        face: 'grid',
        actions: [
          { binding: 'Cancel', label: 'Esc' },
          { binding: 'Confirm', label: '回车' },
          { binding: 'Space', label: '空格' },
          { binding: 'Ctrl', label: 'Ctrl' },
          { binding: 'Alt', label: 'Alt' },
          { binding: 'Shift', label: 'Shift' },
        ],
        system: [],
        combos: [],
      };
    default:
      return null;
  }
}
