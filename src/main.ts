import './styles.css';
import { emulator, statePath } from './emulator';
import { BINDING_ROWS, BROWSER_KEY_TO_SDL, loadBindings, saveBindings, sectionForCore, touchLayout } from './keys';
import { listSlots, writeSlot } from './saves';
import type { Catalog, CoreType, GameEntry, KeyBindings, SaveSlot, SystemId } from './types';

const SYSTEM_LABEL: Record<SystemId | 'all' | 'demo', string> = {
  all: '全部',
  demo: '试玩',
  nes: 'NES',
  gb: 'Game Boy',
  gba: 'GBA',
  md: 'Mega Drive',
  cps1: 'CPS1',
  cps2: 'CPS2',
  neogeo: 'Neo Geo',
};

const FILTERS: Array<SystemId | 'all' | 'demo'> = ['all', 'demo', 'nes', 'gb', 'cps1', 'cps2', 'neogeo'];

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('missing app');

const canvas = document.createElement('canvas');
canvas.id = 'canvas';
canvas.tabIndex = -1;

let catalog: GameEntry[] = [];
let filter: SystemId | 'all' | 'demo' = 'all';
let query = '';
let bindings: KeyBindings = loadBindings();
let core: CoreType = 'unknown';
let romPath = '';
let gameId = '';
let paused = false;
let selectedSlot = 1;
let touchOn = window.matchMedia('(pointer: coarse)').matches;
let pendingFile: File | null = null;
let pickerGameId: string | null = null;
let toastTimer = 0;
let pauseTimer = 0;
let booted = false;
let renderToken = 0;

const filePicker = document.createElement('input');
filePicker.type = 'file';
filePicker.accept = '.nes,.gb,.gbc,.gba,.md,.bin,.zip,.gen,.smd';
filePicker.hidden = true;
document.body.append(filePicker);

filePicker.addEventListener('change', () => {
  const file = filePicker.files?.[0];
  filePicker.value = '';
  if (!file) return;
  pendingFile = file;
  const id = pickerGameId ?? currentGame()?.id ?? playId() ?? 'local';
  pickerGameId = null;
  const next = `#/play/${encodeURIComponent(id)}`;
  if (location.hash === next) void render();
  else location.hash = next;
});

window.addEventListener('hashchange', () => { void render(); });

void boot();

async function boot(): Promise<void> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}games.json`);
    if (!response.ok) throw new Error(`games.json ${response.status}`);
    const body = await response.json() as Catalog;
    catalog = body.games;
  } catch (error) {
    toast(error instanceof Error ? error.message : '目录读不出来');
  }
  await render();
}

function currentGame(): GameEntry | null {
  const id = playId();
  if (!id || id === 'local') return null;
  return catalog.find((game) => game.id === id) ?? null;
}

function playId(): string | null {
  const hash = decodeURIComponent(location.hash || '#/');
  if (!hash.startsWith('#/play/')) return null;
  return hash.slice('#/play/'.length) || null;
}

async function render(): Promise<void> {
  const token = ++renderToken;
  const id = playId();
  if (!id) {
    renderLibrary();
    return;
  }
  await renderPlayer(id, token);
}

function renderLibrary(): void {
  window.clearInterval(pauseTimer);
  if (booted && romPath) emulator.setPaused(true);
  app!.replaceChildren();
  const header = el('header', 'skyline');
  const brand = el('div', 'brand');
  brand.innerHTML = `<h1>街机<span>夜市</span></h1><p>摊位亮着，模拟器在浏览器里。点一张封面就开打。原创试玩直接能玩；CPS 和 Neo Geo 只留目录，ROM 请自己合法放进来，不会上传到服务器。</p>`;
  const actions = el('div', 'brand-actions');
  actions.append(
    button('打开本地 ROM', 'btn primary', () => filePicker.click()),
    linkButton('怎么加 ROM', `${import.meta.env.BASE_URL}roms/README.md`),
  );
  header.append(brand, actions);

  const market = el('main', 'market');
  const search = document.createElement('input');
  search.className = 'search';
  search.placeholder = '搜索摊位、机种、短名…';
  search.value = query;
  search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    paintCards(grid, empty);
  });

  const filters = el('div', 'filters');
  for (const item of FILTERS) {
    const chip = button(SYSTEM_LABEL[item], `chip${item === filter ? ' active' : ''}`, () => {
      filter = item;
      void render();
    });
    filters.append(chip);
  }

  const grid = el('div', 'grid');
  const empty = el('p', 'empty hidden', '这条街上没有这个摊位。');
  market.append(search, filters, grid, empty);
  paintCards(grid, empty);
  app!.append(header, market);
}

function paintCards(grid: HTMLElement, empty: HTMLElement): void {
  grid.replaceChildren();
  const games = catalog.filter((game) => {
    if (filter === 'demo' && !game.bundled) return false;
    if (filter !== 'all' && filter !== 'demo' && game.system !== filter) return false;
    if (!query) return true;
    const hay = [game.title, game.subtitle, game.description, game.developer, game.fbneo, game.system]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(query);
  });
  empty.classList.toggle('hidden', games.length > 0);
  for (const game of games) {
    const card = document.createElement('button');
    card.className = `card${game.bundled ? '' : ' missing'}`;
    const cover = el('div', 'cover');
    cover.style.backgroundColor = coverColor(game.system);
    cover.append(el('span', 'mark', game.title.slice(0, 1)), el('span', 'seal', SYSTEM_LABEL[game.system]));
    const title = el('h2', '', game.title);
    const meta = el('p', 'meta', game.subtitle || game.description);
    const badge = el('div', 'badge', game.bundled ? '可直接玩' : `自备 ${game.fbneo ?? 'ROM'}.zip`);
    card.append(cover, title, meta, badge);
    card.addEventListener('click', () => { void openGame(game); });
    grid.append(card);
  }
}

async function openGame(game: GameEntry): Promise<void> {
  if (!game.bundled) {
    const exists = await probe(game.rom);
    if (!exists) {
      showSheet(game);
      return;
    }
  }
  pendingFile = null;
  location.hash = `#/play/${encodeURIComponent(game.id)}`;
}

function showSheet(game: GameEntry): void {
  const overlay = el('div', 'sheet');
  const article = el('article');
  article.append(
    el('h3', '', game.title),
    el('p', 'hint', game.hint || '把合法的 FBNeo 非合并 zip 放到 public/roms/ 后重新构建。'),
    el('p', 'hint', `期望文件名：${game.rom.replace(/^roms\//, '')}`),
  );
  const row = el('div', 'brand-actions');
  row.append(
    button('选择本地 ROM', 'btn primary', () => {
      pickerGameId = game.id;
      overlay.remove();
      filePicker.click();
    }),
    button('先不玩', 'btn', () => overlay.remove()),
  );
  article.append(row);
  overlay.append(article);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  app!.append(overlay);
}

async function renderPlayer(id: string, token: number): Promise<void> {
  const game = id === 'local' ? null : catalog.find((item) => item.id === id) ?? null;
  app!.replaceChildren();
  const player = el('section', 'player');
  const top = el('div', 'play-top');
  top.append(
    button('回夜市', 'btn', () => { location.hash = '#/'; }),
    el('h2', '', game?.title ?? (pendingFile?.name ?? '本地 ROM')),
    el('span', 'badge', game ? SYSTEM_LABEL[game.system] : '本地'),
  );

  const actions = el('div', 'play-actions');
  const pauseBtn = button(paused ? '继续' : '暂停', 'btn', () => {
    if (!romPath) return;
    paused = !emulator.isPaused();
    emulator.setPaused(paused);
    pauseBtn.textContent = paused ? '继续' : '暂停';
  });
  const slots = el('div', 'slot-row');
  const slotButtons: HTMLButtonElement[] = [];
  for (const slot of [1, 2, 3, 4]) {
    const chip = button(String(slot), `chip${slot === selectedSlot ? ' active' : ''}`, () => {
      selectedSlot = slot;
      slotButtons.forEach((item, index) => item.classList.toggle('active', index + 1 === slot));
      void refreshSlotLabel(slotLabel);
    });
    slotButtons.push(chip);
    slots.append(chip);
  }
  const slotLabel = el('span', 'slot-time', '');
  actions.append(
    pauseBtn,
    slots,
    button('存档', 'btn', () => { void saveToSlot(); }),
    button('读档', 'btn', () => { void loadFromSlot(); }),
    button('按键', 'btn', () => showKeys()),
    button(touchOn ? '隐藏触控' : '触控按键', 'btn', () => {
      touchOn = !touchOn;
      dock.classList.toggle('hidden', !(touchOn && core !== 'unknown'));
    }),
    button('全屏', 'btn', () => { void toggleFullscreen(player); }),
    button('换 ROM', 'btn', () => filePicker.click()),
  );

  const stage = el('div', 'stage');
  const status = el('div', 'stage-status', '摊位还在点灯…');
  stage.append(canvas, status);
  const dock = el('div', `touchdock${touchOn ? '' : ' hidden'}`);
  const foot = el('p', 'status-line', '键盘：方向键移动，Z / X 是 A / B，Enter 开始，P 暂停，F5 / F9 是模拟器自带的单槽存读。上面四个号码是存在这台浏览器里的存档。');
  player.append(top, actions, slotLabel, stage, dock, foot);
  app!.append(player);

  try {
    if (!booted) {
      await emulator.initialize(canvas, (text) => { status.textContent = text || status.textContent; });
      emulator.applyBindings(bindings);
      booted = true;
    }
    if (token !== renderToken) return;
    status.textContent = '正在把卡带塞进机台…';
    const loaded = await loadCurrent(id, game);
    if (token !== renderToken) return;
    romPath = loaded.path;
    core = loaded.core;
    gameId = game?.id ?? `local:${loaded.name}`;
    paused = false;
    canvas.focus();
    status.textContent = `${loaded.name} 已开台。`;
    window.setTimeout(() => status.classList.add('hidden'), 1600);
    buildTouch(dock);
    void refreshSlotLabel(slotLabel);
    window.clearInterval(pauseTimer);
    pauseTimer = window.setInterval(() => {
      if (!romPath) return;
      const now = emulator.isPaused();
      if (now !== paused) {
        paused = now;
        pauseBtn.textContent = paused ? '继续' : '暂停';
      }
    }, 300);
  } catch (error) {
    status.classList.remove('hidden');
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function loadCurrent(id: string, game: GameEntry | null): Promise<{ path: string; core: CoreType; name: string }> {
  let name = 'rom.bin';
  let bytes: Uint8Array;
  if (pendingFile && (id === 'local' || game?.id === id)) {
    name = safeName(pendingFile.name);
    bytes = new Uint8Array(await pendingFile.arrayBuffer());
    pendingFile = null;
  } else if (game) {
    const response = await fetch(`${import.meta.env.BASE_URL}${game.rom}`);
    if (!response.ok) {
      throw new Error(game.hint || `找不到 ${game.rom}。请放入合法 ROM 或改用本地文件。`);
    }
    name = safeName(game.rom.split('/').pop() || 'rom.bin');
    bytes = new Uint8Array(await response.arrayBuffer());
  } else {
    throw new Error('没有选中的 ROM。回夜市选一张卡，或打开本地文件。');
  }

  const path = emulator.writeRom(name, bytes);
  const kind = emulator.coreType(path);
  if (kind === 'unknown') throw new Error('这个文件认不出来。NES / GB / GBA / MD / CPS / Neo Geo 的常见扩展名都可以。');
  if (kind === 'gba') {
    const bios = await ensureBios('gba_bios.bin');
    if (!bios) throw new Error('GBA 需要你自己的 gba_bios.bin。放到 public/bios/ 后重新构建，或先用「换 ROM」旁边的方式把 BIOS 留在浏览器里再开游戏。');
    if (!emulator.loadBootrom(bios)) throw new Error('GBA BIOS 读失败。');
  }
  if (kind === 'neogeo') {
    const bios = await ensureBios('neogeo.zip');
    if (!bios) throw new Error('Neo Geo 需要你自己的 neogeo.zip，和游戏 zip 放在一起。放到 public/bios/neogeo.zip 后重新构建，文件不会被上传。');
  }
  emulator.applyBindings(bindings);
  if (!emulator.loadRom(path)) throw new Error(`机台拒绝了 ${name}。如果是街机 zip，请确认它是 FBNeo 非合并包。`);
  void emulator.persist();
  return { path, core: kind, name };
}

async function ensureBios(name: string): Promise<string | null> {
  const path = `/roms/${name}`;
  if (emulator.exists(path)) return path;
  const response = await fetch(`${import.meta.env.BASE_URL}bios/${name}`);
  if (!response.ok) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  emulator.writeRom(name, bytes);
  return path;
}

function buildTouch(dock: HTMLElement): void {
  dock.replaceChildren();
  const layout = touchLayout(core);
  if (!layout) {
    dock.classList.add('hidden');
    return;
  }
  if (touchOn) dock.classList.remove('hidden');
  const section = sectionForCore(core);
  const stick = el('div', 'stick');
  const knob = document.createElement('i');
  stick.append(knob);
  const pad = el('div', 'pad');
  const system = el('div', 'touch-system');
  const keyName = (binding: string) => (section ? bindings[section]?.[binding] : undefined) ?? binding;

  const held = new Set<string>();
  const setHeld = (name: string, down: boolean) => {
    if (!name) return;
    if (down && !held.has(name)) {
      held.add(name);
      emulator.setVirtualKey(name, true);
    } else if (!down && held.has(name)) {
      held.delete(name);
      emulator.setVirtualKey(name, false);
    }
  };

  const dirs = [
    ['up', layout.directions.up],
    ['down', layout.directions.down],
    ['left', layout.directions.left],
    ['right', layout.directions.right],
  ] as const;
  const releaseDirs = () => {
    for (const [, binding] of dirs) setHeld(keyName(binding), false);
    knob.style.left = '43px';
    knob.style.top = '43px';
  };
  stick.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    stick.setPointerCapture(event.pointerId);
    moveStick(event);
  });
  stick.addEventListener('pointermove', (event) => {
    if (!stick.hasPointerCapture(event.pointerId)) return;
    moveStick(event);
  });
  const endStick = (event: PointerEvent) => {
    if (stick.hasPointerCapture(event.pointerId)) stick.releasePointerCapture(event.pointerId);
    releaseDirs();
  };
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);

  function moveStick(event: PointerEvent): void {
    const rect = stick.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const limit = rect.width / 2 - 16;
    const clampedX = Math.max(-limit, Math.min(limit, dx));
    const clampedY = Math.max(-limit, Math.min(limit, dy));
    knob.style.left = `${43 + clampedX * 0.45}px`;
    knob.style.top = `${43 + clampedY * 0.45}px`;
    const threshold = 18;
    setHeld(keyName(layout!.directions.left), dx < -threshold);
    setHeld(keyName(layout!.directions.right), dx > threshold);
    setHeld(keyName(layout!.directions.up), dy < -threshold);
    setHeld(keyName(layout!.directions.down), dy > threshold);
  }

  for (const action of [...layout.actions, ...layout.system]) {
    const target = layout.system.includes(action) ? system : pad;
    const control = document.createElement('button');
    control.type = 'button';
    control.textContent = action.label;
    const press = (down: boolean) => {
      control.classList.toggle('pressed', down);
      emulator.setVirtualKey(keyName(action.binding), down);
    };
    control.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      control.setPointerCapture(event.pointerId);
      press(true);
    });
    const release = () => press(false);
    control.addEventListener('pointerup', release);
    control.addEventListener('pointercancel', release);
    control.addEventListener('contextmenu', (event) => event.preventDefault());
    target.append(control);
  }
  dock.append(stick, pad, system);
}

async function saveToSlot(): Promise<void> {
  if (!romPath || !gameId) return toast('还没开台');
  if (!emulator.quickSave()) return toast('存档失败');
  const data = emulator.readFile(statePath(romPath));
  const copy = new Uint8Array(data).buffer;
  const record: SaveSlot = {
    gameId,
    slot: selectedSlot,
    romName: romPath,
    savedAt: Date.now(),
    data: copy,
  };
  await writeSlot(record);
  toast(`已存进浏览器槽 ${selectedSlot}`);
  const label = document.querySelector('.slot-time');
  if (label) label.textContent = slotText(record);
}

async function loadFromSlot(): Promise<void> {
  if (!romPath || !gameId) return toast('还没开台');
  const slots = await listSlots(gameId);
  const record = slots[selectedSlot - 1];
  if (!record) return toast(`槽 ${selectedSlot} 是空的`);
  emulator.fs.writeFile(statePath(romPath), new Uint8Array(record.data));
  if (!emulator.quickLoad()) return toast('读档失败');
  toast(`已读取浏览器槽 ${selectedSlot}`);
}

async function refreshSlotLabel(node: HTMLElement): Promise<void> {
  if (!gameId) {
    node.textContent = '';
    return;
  }
  const slots = await listSlots(gameId);
  const record = slots[selectedSlot - 1];
  node.textContent = record ? slotText(record) : `槽 ${selectedSlot} 还是空的`;
}

function slotText(record: SaveSlot): string {
  const when = new Date(record.savedAt);
  const stamp = `${when.getMonth() + 1}/${when.getDate()} ${when.getHours().toString().padStart(2, '0')}:${when.getMinutes().toString().padStart(2, '0')}`;
  return `槽 ${record.slot} · ${stamp}`;
}

function showKeys(): void {
  const section = sectionForCore(core);
  const overlay = el('div', 'modal');
  const article = el('article');
  article.append(el('h3', '', '按键'), el('p', 'hint', '点一行，再按键盘上想用的键。触控按钮会跟着新键位走。'));
  const list = el('div', 'keys');
  const rows = BINDING_ROWS.filter((item) => item.section === 'Common' || item.section === section);
  for (const item of rows) {
    const line = el('div', 'key-row');
    const name = el('span', '', item.label);
    const value = button(bindings[item.section][item.key], 'btn', () => {
      value.textContent = '按下按键…';
      const listen = (event: KeyboardEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const sdl = BROWSER_KEY_TO_SDL[event.code];
        window.removeEventListener('keydown', listen, true);
        if (!sdl) {
          value.textContent = bindings[item.section][item.key];
          toast('这个键暂时对不上');
          return;
        }
        bindings[item.section][item.key] = sdl;
        saveBindings(bindings);
        if (booted) emulator.applyBindings(bindings);
        value.textContent = sdl;
      };
      window.addEventListener('keydown', listen, true);
    });
    line.append(name, value);
    list.append(line);
  }
  article.append(list, button('完成', 'btn primary', () => overlay.remove()));
  overlay.append(article);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  app!.append(overlay);
}

async function toggleFullscreen(node: HTMLElement): Promise<void> {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await node.requestFullscreen();
}

async function probe(path: string): Promise<boolean> {
  const response = await fetch(`${import.meta.env.BASE_URL}${path}`, { method: 'HEAD' });
  if (!response.ok) return false;
  const type = response.headers.get('content-type') || '';
  return !type.includes('text/html');
}

function safeName(name: string): string {
  const base = name.split(/[/\\]/).pop() || 'rom.bin';
  return base.replace(/[^\w.\-]+/g, '_');
}

function coverColor(system: SystemId): string {
  switch (system) {
    case 'nes': return '#3b2418';
    case 'gb': return '#1d3324';
    case 'gba': return '#24324a';
    case 'md': return '#1b2d44';
    case 'cps1': return '#4a2218';
    case 'cps2': return '#4a1830';
    case 'neogeo': return '#3a2a12';
  }
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.textContent = label;
  node.addEventListener('click', onClick);
  return node;
}

function linkButton(label: string, href: string): HTMLAnchorElement {
  const node = document.createElement('a');
  node.className = 'btn';
  node.textContent = label;
  node.href = href;
  return node;
}

function el(tag: string, className = '', text = ''): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function toast(message: string): void {
  document.querySelector('.toast')?.remove();
  const node = el('div', 'toast', message);
  document.body.append(node);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.remove(), 3200);
}
