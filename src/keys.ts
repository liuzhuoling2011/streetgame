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

export interface TouchLayout {
  directions: Record<'up' | 'down' | 'left' | 'right', string>;
  actions: Array<{ binding: string; label: string }>;
  system: Array<{ binding: string; label: string }>;
}

const STANDARD_DIRECTIONS = { up: 'Up', down: 'Down', left: 'Left', right: 'Right' };

export function touchLayout(core: CoreType): TouchLayout | null {
  switch (core) {
    case 'nes':
    case 'gb':
      return {
        directions: STANDARD_DIRECTIONS,
        actions: [
          { binding: 'B', label: 'B' },
          { binding: 'A', label: 'A' },
        ],
        system: [
          { binding: 'Select', label: 'Select' },
          { binding: 'Start', label: 'Start' },
        ],
      };
    case 'gba':
      return {
        directions: STANDARD_DIRECTIONS,
        actions: [
          { binding: 'L', label: 'L' },
          { binding: 'R', label: 'R' },
          { binding: 'B', label: 'B' },
          { binding: 'A', label: 'A' },
        ],
        system: [
          { binding: 'Select', label: 'Select' },
          { binding: 'Start', label: 'Start' },
        ],
      };
    case 'md':
      return {
        directions: STANDARD_DIRECTIONS,
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
      };
    case 'cps':
      return {
        directions: { up: 'P1_Up', down: 'P1_Down', left: 'P1_Left', right: 'P1_Right' },
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
      };
    case 'neogeo':
      return {
        directions: { up: 'P1_Up', down: 'P1_Down', left: 'P1_Left', right: 'P1_Right' },
        actions: [
          { binding: 'P1_A', label: 'A' },
          { binding: 'P1_B', label: 'B' },
          { binding: 'P1_C', label: 'C' },
          { binding: 'P1_D', label: 'D' },
        ],
        system: [
          { binding: 'P1_Coin', label: '投币' },
          { binding: 'P1_Select', label: '选择' },
          { binding: 'P1_Start', label: '开始' },
        ],
      };
    default:
      return null;
  }
}
