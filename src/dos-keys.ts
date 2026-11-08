/** js-dos key codes. Latin letters match ASCII. Arrows and modifiers use the DOSBox virtual map. */
const CODE: Record<string, number> = {
  Escape: 256,
  Enter: 257,
  NumpadEnter: 335,
  Tab: 258,
  Backspace: 259,
  Space: 32,
  ArrowLeft: 263,
  ArrowRight: 262,
  ArrowUp: 265,
  ArrowDown: 264,
  ShiftLeft: 340,
  ShiftRight: 344,
  ControlLeft: 341,
  ControlRight: 345,
  AltLeft: 342,
  AltRight: 346,
  CapsLock: 280,
  Insert: 260,
  Delete: 261,
  Home: 268,
  End: 269,
  PageUp: 266,
  PageDown: 267,
  Minus: 45,
  Equal: 61,
  BracketLeft: 91,
  BracketRight: 93,
  Backslash: 92,
  Semicolon: 59,
  Quote: 39,
  Comma: 44,
  Period: 46,
  Slash: 47,
  Backquote: 96,
};

const SDL: Record<string, number> = {
  Up: 265,
  Down: 264,
  Left: 263,
  Right: 262,
  Return: 257,
  Escape: 256,
  Space: 32,
  Tab: 258,
  Backspace: 259,
  'Left Shift': 340,
  'Right Shift': 344,
  'Left Ctrl': 341,
  'Right Ctrl': 345,
  'Left Alt': 342,
  'Right Alt': 346,
};

for (let index = 0; index < 26; index += 1) {
  const letter = String.fromCharCode(65 + index);
  CODE[`Key${letter}`] = 65 + index;
  SDL[letter] = 65 + index;
}

for (let digit = 0; digit <= 9; digit += 1) {
  CODE[`Digit${digit}`] = 48 + digit;
  CODE[`Numpad${digit}`] = 320 + digit;
  SDL[String(digit)] = 48 + digit;
  SDL[`Keypad ${digit}`] = 320 + digit;
}

for (let fn = 1; fn <= 12; fn += 1) {
  CODE[`F${fn}`] = 289 + fn;
  SDL[`F${fn}`] = 289 + fn;
}

export function dosCodeFromEvent(event: KeyboardEvent): number | null {
  return CODE[event.code] ?? null;
}

export function dosCodeFromSdl(name: string): number | null {
  return SDL[name] ?? null;
}
