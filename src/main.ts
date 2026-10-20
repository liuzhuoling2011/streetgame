import './styles.css';
import { audioNeedsGesture, installAudioUnlock, resumeAudio } from './audio';
import { biosUrls, loadSiteConfig, resolveRomUrl } from './config';
import { emulator, statePath } from './emulator';
import { BINDING_ROWS, BROWSER_KEY_TO_SDL, loadBindings, saveBindings, sectionForCore, touchLayout } from './keys';
import { prepareNeoGeoBios } from './neogeo-bios';
import { prepareNeoGeoGameZip } from './neogeo-rom';
import { fetchBytes, formatBytes, isAbortError, probeUrl, readBlob, type LoadProgress } from './progress';
import { listSlots, writeSlot } from './saves';
import type { Catalog, CoreType, GameEntry, KeyBindings, SaveSlot, SystemId } from './types';

installAudioUnlock();

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
let romBaseUrl = '';
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
let loadAbort: AbortController | null = null;
let audioWatch: AbortController | null = null;

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
    const [response, config] = await Promise.all([
      fetch(`${import.meta.env.BASE_URL}games.json`),
      loadSiteConfig(),
    ]);
    romBaseUrl = config.romBaseUrl;
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
  loadAbort?.abort();
  audioWatch?.abort();
  const token = ++renderToken;
  const id = playId();
  if (!id) {
    document.body.classList.remove('playing');
    renderLibrary();
    return;
  }
  document.body.classList.add('playing');
  const controller = new AbortController();
  loadAbort = controller;
  await renderPlayer(id, token, controller);
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
  search.type = 'search';
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
    const exists = await probeUrl(resolveRomUrl(game.rom, false, romBaseUrl));
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
  const url = resolveRomUrl(game.rom, game.bundled, romBaseUrl);
  article.append(
    el('h3', '', game.title),
    el('p', 'hint', game.hint || '把合法的 FBNeo 非合并 zip 放到 public/roms/ 后重新构建。'),
    el('p', 'hint', `期望文件：${game.rom.replace(/^roms\//, '')}`),
  );
  if (romBaseUrl) {
    article.append(
      el('p', 'hint', `已按远程目录查找：${url}`),
      el('p', 'hint', '远程主机要允许这个网页跨域读取。网盘分享链接一般不能直接拿来用。'),
    );
  }
  if (game.system === 'neogeo') {
    article.append(el('p', 'hint', 'Neo Geo 还要 neogeo.zip。页面上如果已经有这份 BIOS，选本地游戏 zip 就会用它。MAME 那种 64KB 的 000-lo.lo 也可以。'));
  }
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

async function renderPlayer(id: string, token: number, controller: AbortController): Promise<void> {
  const game = id === 'local' ? null : catalog.find((item) => item.id === id) ?? null;
  app!.replaceChildren();
  const player = el('section', 'player');
  const top = el('div', 'play-top');
  const back = labeled('回夜市', '返回', 'btn', () => { location.hash = '#/'; });
  const title = el('h2', '', game?.title ?? (pendingFile?.name ?? '本地 ROM'));
  top.append(back, title, el('span', 'badge', game ? SYSTEM_LABEL[game.system] : '本地'));

  const pauseBtn = labeled(paused ? '继续' : '暂停', paused ? '继续' : '暂停', 'btn', () => {
    if (!romPath) return;
    paused = !emulator.isPaused();
    emulator.setPaused(paused);
    setPauseLabel(pauseBtn, paused);
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

  const dock = el('div', `touchdock${touchOn ? '' : ' hidden'}`);
  const touchDesk = labeled(touchOn ? '隐藏触控' : '触控按键', '触控', 'btn desk-only', () => toggleTouch());
  const touchMenu = button(touchOn ? '隐藏触控' : '触控按键', 'btn', () => {
    closeMenu();
    toggleTouch();
  });

  const actions = el('div', 'play-actions');
  actions.append(
    pauseBtn,
    slots,
    labeled('存档', '存', 'btn', () => { void saveToSlot(); }),
    labeled('读档', '读', 'btn', () => { void loadFromSlot(); }),
    labeled('按键', '键', 'btn desk-only', () => showKeys()),
    touchDesk,
    labeled('全屏', '全屏', 'btn', () => { void toggleFullscreen(player); }),
    labeled('换 ROM', 'ROM', 'btn desk-only', () => filePicker.click()),
  );

  const moreWrap = el('div', 'more-wrap');
  const menu = el('div', 'more-menu hidden');
  const closeMenu = () => menu.classList.add('hidden');
  moreWrap.append(
    button('更多', 'btn', () => menu.classList.toggle('hidden')),
    menu,
  );
  menu.append(
    button('按键', 'btn', () => { closeMenu(); showKeys(); }),
    touchMenu,
    button('换 ROM', 'btn', () => { closeMenu(); filePicker.click(); }),
  );
  const bar = el('div', 'play-bar');
  bar.append(actions, moreWrap);
  controller.signal.addEventListener('abort', () => {}, { once: true });
  document.addEventListener('pointerdown', (event) => {
    if (!moreWrap.contains(event.target as Node)) closeMenu();
  }, { signal: controller.signal, capture: true });

  function toggleTouch(): void {
    touchOn = !touchOn;
    const label = touchOn ? '隐藏触控' : '触控按键';
    setLabeled(touchDesk, label, '触控');
    touchMenu.textContent = label;
    dock.classList.toggle('hidden', !(touchOn && core !== 'unknown'));
  }

  const stage = el('div', 'stage');
  const status = el('div', 'stage-status hidden', '');
  const overlay = createLoadOverlay(() => controller.abort());
  const audioChip = button('点一下开声', 'btn audio-chip hidden', () => { void unlockAudio(); });
  stage.append(canvas, status, overlay, audioChip);
  const foot = el('p', 'status-line', '键盘：方向键移动，Z / X 是 A / B，Enter 开始，P 暂停，F5 / F9 是模拟器自带的单槽存读。上面四个号码是存在这台浏览器里的存档。');
  player.append(top, bar, slotLabel, stage, dock, foot);
  player.addEventListener('touchmove', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.play-actions, .more-menu, .keys')) return;
    event.preventDefault();
  }, { passive: false });
  app!.append(player);
  watchAudio(player, audioChip);

  const report = (label: string, progress: LoadProgress | null) => {
    if (token !== renderToken) return;
    paintProgress(overlay, label, progress);
  };

  try {
    if (!booted) {
      await emulator.initialize(canvas, (progress) => {
        report(progress.label, progress);
      }, controller.signal);
      if (token !== renderToken) return;
      emulator.applyBindings(bindings);
      booted = true;
    }
    if (controller.signal.aborted) throw abortNow();
    report('正在把卡带塞进机台…', null);
    const loaded = await loadCurrent(id, game, controller.signal, report);
    if (token !== renderToken) return;
    romPath = loaded.path;
    core = loaded.core;
    gameId = game?.id ?? `local:${loaded.name}`;
    paused = false;
    setPauseLabel(pauseBtn, false);
    canvas.focus();
    overlay.classList.add('hidden');
    status.textContent = `${loaded.name} 已开台。`;
    status.classList.remove('hidden');
    window.setTimeout(() => status.classList.add('hidden'), 1600);
    buildTouch(dock);
    void refreshSlotLabel(slotLabel);
    window.clearInterval(pauseTimer);
    pauseTimer = window.setInterval(() => {
      if (!romPath) return;
      const now = emulator.isPaused();
      if (now !== paused) {
        paused = now;
        setPauseLabel(pauseBtn, paused);
      }
    }, 300);
  } catch (error) {
    if (token !== renderToken) return;
    overlay.classList.add('hidden');
    status.classList.remove('hidden');
    status.textContent = isAbortError(error) || controller.signal.aborted
      ? '已取消'
      : (error instanceof Error ? error.message : String(error));
  }
}

async function loadCurrent(
  id: string,
  game: GameEntry | null,
  signal: AbortSignal,
  report: (label: string, progress: LoadProgress | null) => void,
): Promise<{ path: string; core: CoreType; name: string }> {
  let name = 'rom.bin';
  let bytes: Uint8Array;
  if (pendingFile && (id === 'local' || game?.id === id)) {
    const file = pendingFile;
    pendingFile = null;
    name = safeName(file.name);
    report(`正在读取 ${name}…`, { loaded: 0, total: file.size || null });
    bytes = await readBlob(file, (progress) => report(`正在读取 ${name}…`, progress), signal);
  } else if (game) {
    name = safeName(game.rom.split('/').pop() || 'rom.bin');
    const url = resolveRomUrl(game.rom, game.bundled, romBaseUrl);
    report(`正在读取 ${name}…`, null);
    try {
      bytes = await fetchBytes(url, {
        signal,
        onProgress: (progress) => report(`正在读取 ${name}…`, progress),
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new Error(game.hint || `找不到 ${game.rom}。请放入合法 ROM 或改用本地文件。`);
    }
  } else {
    throw new Error('没有选中的 ROM。回夜市选一张卡，或打开本地文件。');
  }

  if (signal.aborted) throw abortNow();
  let path = emulator.writeRom(name, bytes);
  let kind = emulator.coreType(path);
  if (kind === 'unknown' && game?.fbneo && /\.zip$/i.test(name)) {
    name = `${game.fbneo}.zip`;
    path = emulator.writeRom(name, bytes);
    kind = emulator.coreType(path);
  }
  if (kind === 'unknown') throw new Error('这个文件认不出来。NES / GB / GBA / MD / CPS / Neo Geo 的常见扩展名都可以。街机 zip 要用 FBNeo 短名，例如 kof98.zip。');
  if (kind === 'gba') {
    const biosBytes = await loadBiosBytes('gba_bios.bin', signal, report);
    if (!biosBytes) throw new Error('GBA 需要你自己的 gba_bios.bin。放到 public/bios/ 或远程目录的 bios/ 后重新打开。文件不会提交进这个仓库。');
    const bios = emulator.writeRom('gba_bios.bin', biosBytes);
    if (!emulator.loadBootrom(bios)) throw new Error('GBA BIOS 读失败。');
  }
  if (kind === 'neogeo') {
    const biosBytes = await loadBiosBytes('neogeo.zip', signal, report);
    if (!biosBytes) throw new Error('Neo Geo 需要你自己的 neogeo.zip。放到 public/bios/ 或远程目录的 bios/，不要提交进这个仓库。');
    report('正在整理 Neo Geo BIOS…', null);
    const prepared = await prepareNeoGeoBios(biosBytes);
    const bios = emulator.writeRom('neogeo.zip', prepared.bytes);
    emulator.setNeoBios(prepared.biosIndex);
    // The Neo Geo core ignores this file and opens /roms/neogeo.zip itself.
    // loadBootromFile still has to succeed, or the module is not ready.
    if (!emulator.loadBootrom(bios)) throw new Error('Neo Geo BIOS 没能交给模拟器。');
    report('正在整理 Neo Geo 卡带…', null);
    const gameZip = await prepareNeoGeoGameZip(bytes);
    if (gameZip.renamed.length > 0) path = emulator.writeRom(name, gameZip.bytes);
  }
  if (signal.aborted) throw abortNow();
  emulator.applyBindings(bindings);
  report('正在开台…', { loaded: 1, total: 1 });
  emulator.drainLogs();
  if (!emulator.loadRom(path)) throw new Error(explainLoadFailure(name, kind, emulator.drainLogs()));
  void emulator.persist();
  return { path, core: kind, name };
}

async function loadBiosBytes(
  name: string,
  signal: AbortSignal,
  report: (label: string, progress: LoadProgress | null) => void,
): Promise<Uint8Array | null> {
  for (const url of biosUrls(name, romBaseUrl)) {
    try {
      report(`正在读取 ${name}…`, null);
      return await fetchBytes(url, {
        signal,
        onProgress: (progress) => report(`正在读取 ${name}…`, progress),
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
    }
  }
  const cached = `/roms/${name}`;
  if (emulator.exists(cached)) return emulator.readFile(cached);
  return null;
}

function explainLoadFailure(name: string, kind: CoreType, logs: string): string {
  const lines = logs.split('\n').map((line) => line.trim()).filter(Boolean);
  if (/Encrypted NeoGeo/i.test(logs)) return '这个 Neo Geo 包是加密的，当前模拟器还不支持。';
  if (/Failed to open ZIP|Failed to initialize ZIP/i.test(logs)) return `${name} 这个 zip 打不开。`;
  if (/Unknown game/i.test(logs)) return `认不出 ${name} 这个短名。街机 zip 要用 FBNeo 短名，例如 kof98.zip。`;
  if (/Failed to load BIOS|Upload neogeo\.zip|ROM not found/i.test(logs)) {
    const detail = lines.find((line) => /ROM not found/i.test(line));
    return detail
      ? `Neo Geo BIOS 对不上：${detail.replace(/^Error:\s*/i, '')}。请换 FBNeo 的 neogeo.zip，或用带 sp-s2.sp1 / uni-bios 的常见包。`
      : '机台没有用上 neogeo.zip。它要和游戏 zip 放在同一个目录，并且含有 68K BIOS、sm1.sm1、sfix 和 000-lo.lo。';
  }
  if (/Missing ROMs/i.test(logs)) {
    const names = lines.filter((line) => line.startsWith('-')).map((line) => line.replace(/^-\s*/, '')).slice(0, 6);
    const listed = names.length > 0 ? `缺：${names.join('、')}。` : '';
    return `${name} 这套 ROM 不完整，或是合并包，父集里没有这些文件。${listed}请用 FBNeo 非合并 zip。`;
  }
  if (kind === 'cps' || kind === 'neogeo') {
    return `机台拒绝了 ${name}。请确认它是 FBNeo 非合并包，而不是合并父集或缺文件的包。`;
  }
  return `机台拒绝了 ${name}。`;
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
  const padCol = el('div', 'pad-col');
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
    knob.style.transform = 'translate(-50%, -50%)';
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
    const knobSize = knob.getBoundingClientRect().width || 46;
    const limit = rect.width / 2 - knobSize / 2;
    const clampedX = Math.max(-limit, Math.min(limit, dx));
    const clampedY = Math.max(-limit, Math.min(limit, dy));
    knob.style.transform = `translate(calc(-50% + ${clampedX * 0.62}px), calc(-50% + ${clampedY * 0.62}px))`;
    const threshold = Math.max(16, rect.width * 0.12);
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
  padCol.append(system, pad);
  dock.append(stick, padCol);
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
  const target = node as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
  const doc = document as Document & {
    webkitFullscreenElement?: Element | null;
    webkitExitFullscreen?: () => Promise<void> | void;
  };
  try {
    if (document.fullscreenElement || doc.webkitFullscreenElement) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else await doc.webkitExitFullscreen?.();
      return;
    }
    if (typeof target.requestFullscreen === 'function') await target.requestFullscreen();
    else if (target.webkitRequestFullscreen) await target.webkitRequestFullscreen();
    else toast('这个浏览器不能全屏');
  } catch {
    toast('全屏被浏览器拦住了，再点一次试试');
  }
}

function watchAudio(player: HTMLElement, chip: HTMLButtonElement): void {
  audioWatch?.abort();
  const watch = new AbortController();
  audioWatch = watch;
  const sync = () => chip.classList.toggle('hidden', !audioNeedsGesture());
  const unlock = () => { void resumeAudio().finally(sync); };
  player.addEventListener('pointerdown', unlock, { signal: watch.signal });
  window.addEventListener('keydown', unlock, { signal: watch.signal });
  const timer = window.setInterval(sync, 400);
  window.setTimeout(() => window.clearInterval(timer), 5000);
  watch.signal.addEventListener('abort', () => window.clearInterval(timer));
  sync();
}

async function unlockAudio(): Promise<void> {
  await resumeAudio();
  document.querySelector('.audio-chip')?.classList.toggle('hidden', !audioNeedsGesture());
}

function createLoadOverlay(onCancel: () => void): HTMLElement {
  const overlay = el('div', 'load-overlay');
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'load-title');
  const card = el('div', 'load-card');
  const title = el('p', 'load-title', '正在准备机台…');
  title.id = 'load-title';
  const track = el('div', 'load-track');
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  track.setAttribute('aria-label', '加载进度');
  const bar = el('div', 'load-bar indeterminate');
  track.append(bar);
  const meta = el('p', 'load-meta', '正在连接…');
  card.append(title, track, meta, button('取消', 'btn', onCancel));
  overlay.append(card);
  return overlay;
}

function paintProgress(overlay: HTMLElement, label: string, progress: LoadProgress | null): void {
  const title = overlay.querySelector('.load-title');
  const bar = overlay.querySelector('.load-bar');
  const meta = overlay.querySelector('.load-meta');
  const track = overlay.querySelector('.load-track');
  if (!(title instanceof HTMLElement) || !(bar instanceof HTMLElement) || !(meta instanceof HTMLElement) || !(track instanceof HTMLElement)) return;
  title.textContent = label;
  const loaded = progress?.loaded ?? 0;
  const total = progress?.total ?? null;
  if (total == null || total <= 0) {
    bar.classList.add('indeterminate');
    bar.style.width = '';
    track.removeAttribute('aria-valuenow');
    meta.textContent = loaded > 0 ? `已传输 ${formatBytes(loaded)}` : '正在连接…';
    return;
  }
  const pct = Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
  bar.classList.remove('indeterminate');
  bar.style.width = `${pct}%`;
  track.setAttribute('aria-valuenow', String(pct));
  meta.textContent = `${formatBytes(loaded)} / ${formatBytes(total)} · ${pct}%`;
}

function abortNow(): DOMException {
  return new DOMException('已取消', 'AbortError');
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

function setPauseLabel(node: HTMLButtonElement, isPaused: boolean): void {
  setLabeled(node, isPaused ? '继续' : '暂停', isPaused ? '继续' : '暂停');
}

function setLabeled(node: HTMLButtonElement, long: string, short: string): void {
  const full = node.querySelector('.long');
  const brief = node.querySelector('.short');
  if (full) full.textContent = long;
  if (brief) brief.textContent = short;
}

function labeled(long: string, short: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.append(el('span', 'long', long), el('span', 'short', short));
  node.addEventListener('click', onClick);
  return node;
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
