import './styles.css';
import { audioNeedsGesture, installAudioUnlock, resumeAudio, setMasterGain } from './audio';
import { biosUrls, loadSiteConfig, resolveRomUrl } from './config';
import { emulator, statePath } from './emulator';
import { bindLetterbox } from './fit-canvas';
import { holds } from './holds';
import { icon, type IconName } from './icons';
import {
  BROWSER_KEY_TO_SDL,
  COMBO_IDS,
  comboLabel,
  comboStorageKey,
  comboTargets,
  loadBindings,
  loadCombos,
  rowsForPlayer,
  saveBindings,
  saveCombos,
  sectionForCore,
  sectionSupportsPlayer2,
  touchLayout,
  type ComboId,
  type ComboMap,
  type FaceLayout,
  type PlayerId,
} from './keys';
import { prepareNeoGeoBios } from './neogeo-bios';
import { prepareArcadeZip } from './neogeo-rom';
import { fetchBytes, formatBytes, isAbortError, readBlob, type LoadProgress } from './progress';
import { fetchGameRom, probeGameRom } from './rom-parts';
import { readyServiceWorker } from './register-sw';
import { deleteSlot, listSlots, writeSlot } from './saves';
import { neutralStick, StickSession, type StickState } from './stick';
import type { Catalog, CoreType, GameEntry, KeyBindings, SaveSlot, SystemId } from './types';

installAudioUnlock();
installZoomGuard();

const SYSTEM_LABEL: Record<SystemId, string> = {
  nes: 'NES',
  gb: 'Game Boy',
  gba: 'GBA',
  md: 'Mega Drive',
  cps1: 'CPS1',
  cps2: 'CPS2',
  neogeo: 'Neo Geo',
};

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('missing app');

const canvas = document.createElement('canvas');
canvas.id = 'canvas';
canvas.tabIndex = -1;

let catalog: GameEntry[] = [];
let romBaseUrl = '';
let available = new Set<string>();
let filter: SystemId | 'all' = 'all';
let query = '';
let bindings: KeyBindings = loadBindings();
let combos: ComboMap = loadCombos();
let core: CoreType = 'unknown';
let romPath = '';
let gameId = '';
let paused = false;
let selectedSlot = 1;
let touchOn = readPref('streetgame.touch', window.matchMedia('(pointer: coarse)').matches ? '1' : '0') === '1';
let showCombos = readPref('streetgame.showCombos', '1') !== '0';
let faceLayout: FaceLayout = readPref('streetgame.faceLayout', 'diamond') === 'square' ? 'square' : 'diamond';
let keyPlayer: PlayerId = readPref('streetgame.keyPlayer', '1') === '2' ? 2 : 1;
let volume = clampVolume(Number(readPref('streetgame.volume', '80')));
let volumeBeforeMute = volume || 80;
setMasterGain(volume);
let pendingFile: File | null = null;
let pickerGameId: string | null = null;
let toastTimer = 0;
let pauseTimer = 0;
let booted = false;
let renderToken = 0;
let loadAbort: AbortController | null = null;
let audioWatch: AbortController | null = null;
let capturingKey = false;

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
  void readyServiceWorker();
  try {
    const [response, config] = await Promise.all([
      fetch(`${import.meta.env.BASE_URL}games.json`),
      loadSiteConfig(),
    ]);
    romBaseUrl = config.romBaseUrl;
    if (!response.ok) throw new Error(`games.json ${response.status}`);
    const body = await response.json() as Catalog;
    catalog = body.games;
    const found = await Promise.all(catalog.map(async (game) => {
      const ok = await probeGameRom(resolveRomUrl(game.rom, game.bundled, romBaseUrl));
      return ok ? game.id : '';
    }));
    available = new Set(found.filter(Boolean));
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
  holds.releaseAll();
  loadAbort?.abort();
  audioWatch?.abort();
  window.clearInterval(pauseTimer);
  const token = ++renderToken;
  const id = playId();
  const playing = Boolean(id);
  document.body.classList.toggle('playing', playing);
  document.documentElement.classList.toggle('playing', playing);
  setViewport(playing ? PLAY_VIEWPORT : BROWSE_VIEWPORT);
  if (!id) {
    renderLibrary();
    return;
  }
  const controller = new AbortController();
  loadAbort = controller;
  await renderPlayer(id, token, controller);
}

function shownGames(): GameEntry[] {
  return catalog.filter((game) => available.has(game.id));
}

function renderLibrary(): void {
  if (booted && romPath) emulator.setPaused(true);
  app!.replaceChildren();
  const header = el('header', 'topbar');
  const brand = el('div', 'brand');
  brand.innerHTML = `<p class="eyebrow">Arcade</p><h1>Street Game</h1><p>浏览器里的街机。有 ROM 的游戏才会出现在这里，点开就玩。</p>`;
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
  search.placeholder = '搜索游戏、机种、短名';
  search.value = query;
  search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    paintCards(grid, empty);
  });

  const filters = el('div', 'filters');
  const systems = new Set(shownGames().map((game) => game.system));
  const chips: Array<SystemId | 'all'> = ['all', ...(['nes', 'gb', 'gba', 'md', 'cps1', 'cps2', 'neogeo'] as SystemId[]).filter((item) => systems.has(item))];
  if (filter !== 'all' && !systems.has(filter)) filter = 'all';
  for (const item of chips) {
    filters.append(button(item === 'all' ? '全部' : SYSTEM_LABEL[item], `chip${item === filter ? ' active' : ''}`, () => {
      filter = item;
      void render();
    }));
  }

  const grid = el('div', 'grid');
  const empty = el('p', 'empty hidden', '这里还没有可玩的游戏。把 ROM 放进 public/roms/ 后刷新。');
  market.append(search, filters, grid, empty);
  paintCards(grid, empty);
  app!.append(header, market);
}

function paintCards(grid: HTMLElement, empty: HTMLElement): void {
  grid.replaceChildren();
  const games = shownGames().filter((game) => {
    if (filter !== 'all' && game.system !== filter) return false;
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
    card.type = 'button';
    card.className = 'card';
    const cover = el('div', 'cover');
    const skeleton = el('div', 'cover-skel');
    cover.append(skeleton);
    if (game.cover) {
      const image = document.createElement('img');
      image.src = assetUrl(game.cover);
      image.alt = game.title;
      image.decoding = 'async';
      const reveal = () => {
        image.classList.add('is-ready');
        skeleton.remove();
      };
      if (image.complete && image.naturalWidth > 0) reveal();
      else {
        image.addEventListener('load', reveal, { once: true });
        image.addEventListener('error', () => skeleton.remove(), { once: true });
      }
      cover.append(image);
    } else {
      skeleton.remove();
      cover.append(el('span', 'mark', game.title.slice(0, 1)));
    }
    cover.append(el('span', 'seal', SYSTEM_LABEL[game.system]));
    const copy = el('div', 'card-copy');
    copy.append(el('h2', '', game.title), el('p', 'meta', [game.subtitle, game.year].filter(Boolean).join(' · ')));
    card.append(cover, copy);
    card.addEventListener('click', () => { void openGame(game); });
    grid.append(card);
  }
}

async function openGame(game: GameEntry): Promise<void> {
  if (!available.has(game.id)) {
    showSheet(game);
    return;
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
  if (romBaseUrl) article.append(el('p', 'hint', `已按远程目录查找：${url}`));
  if (game.system === 'neogeo') {
    article.append(el('p', 'hint', 'Neo Geo 还要 neogeo.zip。页面上如果已经有这份 BIOS，选本地游戏 zip 就会用它。'));
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
  const shell = el('section', 'player');
  const frame = el('div', 'play-frame');
  const stage = el('div', 'stage');
  const status = el('div', 'stage-status hidden', '');
  const overlay = createLoadOverlay(() => controller.abort());
  const audioChip = button('点一下开声', 'btn audio-chip hidden', () => { void unlockAudio(); });
  stage.append(canvas, status, overlay, audioChip);
  const fit = bindLetterbox(stage, canvas, controller.signal);

  const dock = el('div', 'touchdock hidden');
  const bar = el('div', 'emu-bar');
  const title = el('div', 'emu-title', game?.title ?? (pendingFile?.name ?? '本地 ROM'));
  const left = el('div', 'emu-group');
  const right = el('div', 'emu-group');

  let releaseTouch = (): void => { holds.replace('stick', []); };
  let stickListen: AbortController | null = null;
  window.addEventListener('blur', () => releaseTouch(), { signal: controller.signal });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') releaseTouch();
  }, { signal: controller.signal });
  window.addEventListener('pagehide', () => releaseTouch(), { signal: controller.signal });
  controller.signal.addEventListener('abort', () => {
    stickListen?.abort();
    releaseTouch();
  });
  const pauseBtn = iconButton(paused ? 'play' : 'pause', paused ? '继续' : '暂停', () => {
    if (!romPath) return;
    paused = !emulator.isPaused();
    emulator.setPaused(paused);
    if (paused) releaseTouch();
    setPauseIcon(pauseBtn, paused);
    focusGame();
  });

  const restartBtn = iconButton('restart', '重新开始', () => { void restartGame(); });
  const keysBtn = iconButton('gamepad', '按键', () => { closePops(); showKeys(() => buildTouch()); });
  const storageBtn = iconButton('storage', '存档数据', () => { closePops(); void showStorage(); });

  left.append(restartBtn, pauseBtn, keysBtn, storageBtn);

  const volumeWrap = el('div', 'vol');
  const volumeBtn = iconButton(volume > 0 ? 'volume' : 'muted', volume > 0 ? '音量' : '静音', () => {
    if (volume > 0) {
      volumeBeforeMute = volume;
      applyVolume(0);
    } else {
      applyVolume(volumeBeforeMute || 80);
    }
    volumeSlider.value = String(volume);
    setVolumeIcon(volumeBtn);
  });
  const volumeSlider = document.createElement('input');
  volumeSlider.type = 'range';
  volumeSlider.className = 'vol-slider';
  volumeSlider.min = '0';
  volumeSlider.max = '100';
  volumeSlider.value = String(volume);
  volumeSlider.setAttribute('aria-label', '音量');
  const paintVolume = () => {
    applyVolume(Number(volumeSlider.value));
    setVolumeIcon(volumeBtn);
  };
  volumeSlider.addEventListener('input', paintVolume);
  volumeSlider.addEventListener('change', paintVolume);
  const scrubVolume = (event: PointerEvent) => {
    const rect = volumeSlider.getBoundingClientRect();
    const ratio = rect.width <= 0 ? 0 : (event.clientX - rect.left) / rect.width;
    const next = Math.round(Math.min(100, Math.max(0, ratio * 100)));
    volumeSlider.value = String(next);
    paintVolume();
  };
  volumeSlider.addEventListener('pointerdown', (event) => {
    frame.classList.add('bar-on', 'bar-hold');
    try { volumeSlider.setPointerCapture(event.pointerId); } catch { /* the input event still updates */ }
    scrubVolume(event);
  });
  volumeSlider.addEventListener('pointermove', (event) => {
    if (!volumeSlider.hasPointerCapture(event.pointerId)) return;
    scrubVolume(event);
  });
  const endVolume = () => {
    const popOpen = [...frame.querySelectorAll('.emu-pop')].some((node) => !node.classList.contains('hidden'));
    if (!popOpen) frame.classList.remove('bar-hold');
  };
  volumeSlider.addEventListener('pointerup', endVolume);
  volumeSlider.addEventListener('pointercancel', endVolume);
  volumeSlider.addEventListener('lostpointercapture', endVolume);
  volumeWrap.append(volumeBtn, volumeSlider);

  const menuWrap = el('div', 'emu-slot');
  const menuPop = el('div', 'emu-pop menu-pop hidden');
  menuPop.append(
    el('p', 'menu-title', game?.title ?? '本地 ROM'),
    el('p', 'hint', '方向键移动。街机 A / S / D / F 是攻击，5 投币，1 开始。P 暂停。'),
    button('换一个 ROM', 'btn', () => { closePops(); filePicker.click(); }),
  );
  const menuBtn = iconButton('menu', '菜单', () => togglePop(menuPop));
  menuWrap.append(menuBtn, menuPop);

  const settingsBtn = iconButton('gear', '设置', () => { closePops(); showSettings(() => buildTouch()); });
  const fsBtn = iconButton('fullscreen', '全屏', () => { void toggleFullscreen(shell, fsBtn); });
  const exitBtn = iconButton('exit', '退出', () => { location.hash = '#/'; });
  right.append(volumeWrap, menuWrap, settingsBtn, fsBtn, exitBtn);
  bar.append(left, title, right);
  frame.append(stage, bar);
  shell.append(frame, dock);
  app!.append(shell);
  watchAudio(shell, audioChip);

  const armBar = () => {
    frame.classList.add('bar-on');
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      if (!frame.classList.contains('bar-hold')) frame.classList.remove('bar-on');
    }, 2500);
  };
  let hideTimer = 0;
  controller.signal.addEventListener('abort', () => window.clearTimeout(hideTimer));

  const closePops = () => {
    frame.querySelectorAll('.emu-pop').forEach((node) => node.classList.add('hidden'));
    frame.classList.remove('bar-hold');
  };
  const togglePop = (pop: HTMLElement) => {
    const willOpen = pop.classList.contains('hidden');
    closePops();
    if (!willOpen) return;
    pop.classList.remove('hidden');
    frame.classList.add('bar-on', 'bar-hold');
  };

  frame.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    armBar();
  }, { signal: controller.signal });
  frame.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'touch') return;
    window.clearTimeout(hideTimer);
    if (!frame.classList.contains('bar-hold')) frame.classList.remove('bar-on');
  }, { signal: controller.signal });
  frame.addEventListener('pointerdown', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (event.pointerType === 'mouse') {
      if (!target?.closest('.emu-bar, input, button, a')) canvas.focus();
      return;
    }
    if (target?.closest('.emu-bar, .emu-pop, .modal, .sheet')) return;
    frame.classList.toggle('bar-on');
  }, { signal: controller.signal });
  document.addEventListener('pointerdown', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.emu-slot, .vol')) closePops();
  }, { signal: controller.signal, capture: true });

  function buildTouch(): void {
    stickListen?.abort();
    stickListen = new AbortController();
    releaseTouch = () => { holds.replace('stick', []); };
    holds.replace('stick', []);
    dock.replaceChildren();
    const layout = touchLayout(core, 1, showCombos, faceLayout);
    const active = Boolean(layout) && touchOn;
    shell.classList.toggle('touching', active);
    dock.classList.toggle('hidden', !active);
    if (!layout || !active) return;
    fit();

    const section = sectionForCore(core);
    const sdlFor = (binding: string) => (section ? bindings[section]?.[binding] : undefined) || binding;
    const stick = el('div', 'stick');
    const knob = document.createElement('i');
    stick.append(knob);
    const face = el('div', `face-pad ${layout.face}`);
    const system = el('div', 'touch-system');
    const comboPad = el('div', 'combo-pad');
    const mid = el('div', 'touch-mid');
    const bottom = el('div', 'touch-bottom');

    let stickState: StickState = neutralStick();
    const session = new StickSession();
    const paintKnob = (state: StickState) => {
      const travel = Math.max(8, stick.clientWidth / 2 - (knob.offsetWidth || 48) / 2);
      knob.style.transform = `translate(calc(-50% + ${state.knobX * travel}px), calc(-50% + ${state.knobY * travel}px))`;
    };
    const applyStick = (state: StickState) => {
      const names: string[] = [];
      const axes = [
        ['up', layout.directions.up],
        ['down', layout.directions.down],
        ['left', layout.directions.left],
        ['right', layout.directions.right],
      ] as const;
      for (const [axis, binding] of axes) {
        if (state.axes[axis]) names.push(sdlFor(binding));
      }
      holds.replace('stick', names);
      paintKnob(state);
    };
    const releaseStick = () => {
      stickState = session.release();
      applyStick(stickState);
    };
    releaseTouch = releaseStick;
    const moveStick = (event: PointerEvent) => {
      if (!session.owns(event.pointerId)) return;
      const rect = stick.getBoundingClientRect();
      stickState = session.move(
        event.pointerId,
        event.clientX - (rect.left + rect.width / 2),
        event.clientY - (rect.top + rect.height / 2),
        rect.width / 2,
      );
      applyStick(stickState);
    };
    const endStick = (event: PointerEvent) => {
      if (!session.owns(event.pointerId)) return;
      const id = event.pointerId;
      stickState = session.end(id) ?? session.state;
      applyStick(stickState);
      try {
        if (stick.hasPointerCapture(id)) stick.releasePointerCapture(id);
      } catch { /* the pointer is already gone */ }
    };
    stick.addEventListener('pointerdown', (event) => {
      if (!session.down(event.pointerId)) return;
      event.preventDefault();
      try { stick.setPointerCapture(event.pointerId); } catch { /* window pointerup still releases */ }
      moveStick(event);
    });
    const stickSignal = stickListen.signal;
    window.addEventListener('pointermove', moveStick, { capture: true, signal: stickSignal });
    window.addEventListener('pointerup', endStick, { capture: true, signal: stickSignal });
    window.addEventListener('pointercancel', endStick, { capture: true, signal: stickSignal });
    stick.addEventListener('lostpointercapture', (event) => {
      if (session.owns(event.pointerId)) releaseStick();
      else if (session.pointerId !== null && !stick.hasPointerCapture(session.pointerId)) releaseStick();
    });

    const bindHold = (node: HTMLElement, owner: string, names: () => string[]) => {
      const pointers = new Set<number>();
      node.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        node.setPointerCapture(event.pointerId);
        if (pointers.size === 0) {
          holds.replace(owner, names());
          node.classList.add('pressed');
        }
        pointers.add(event.pointerId);
      });
      const end = (event: PointerEvent) => {
        if (!pointers.delete(event.pointerId)) return;
        if (pointers.size === 0) {
          holds.replace(owner, []);
          node.classList.remove('pressed');
        }
      };
      node.addEventListener('pointerup', end);
      node.addEventListener('pointercancel', end);
      node.addEventListener('lostpointercapture', end);
      node.addEventListener('contextmenu', (event) => event.preventDefault());
    };

    for (const action of layout.actions) {
      const control = document.createElement('button');
      control.type = 'button';
      control.textContent = action.label;
      if (action.place) control.dataset.place = action.place;
      bindHold(control, `touch-${action.binding}`, () => [sdlFor(action.binding)]);
      face.append(control);
    }
    for (const action of layout.system) {
      const control = document.createElement('button');
      control.type = 'button';
      control.textContent = action.label;
      bindHold(control, `touch-${action.binding}`, () => [sdlFor(action.binding)]);
      system.append(control);
    }
    for (const combo of layout.combos) {
      const control = document.createElement('button');
      control.type = 'button';
      control.textContent = combo.label;
      bindHold(control, `touch-combo-1-${combo.id}`, () => comboNames(section, 1, combo.id));
      comboPad.append(control);
    }
    mid.append(stick, face);
    bottom.append(system);
    if (layout.combos.length > 0) bottom.append(comboPad);
    dock.append(mid, bottom);
    paintKnob(stickState);
  }

  async function restartGame(): Promise<void> {
    if (!romPath) return toast('还没开台');
    closePops();
    emulator.drainLogs();
    paused = false;
    if (!emulator.loadRom(romPath)) {
      toast('重开失败');
      return;
    }
    emulator.setPaused(false);
    setPauseIcon(pauseBtn, false);
    toast('已重新开始');
    focusGame();
  }

  const report = (stage: LoadStage, label: string, progress: LoadProgress | null) => {
    if (token !== renderToken) return;
    paintProgress(overlay, stage, label, progress);
  };

  try {
    if (!booted) {
      report('wasm', '正在下载模拟器…', null);
      await readyServiceWorker();
      await emulator.initialize(canvas, (progress) => {
        report('wasm', progress.fromCache ? '模拟器来自缓存' : progress.label, progress);
      }, controller.signal);
      if (token !== renderToken) return;
      emulator.applyBindings(bindings);
      setMasterGain(volume);
      booted = true;
    }
    if (controller.signal.aborted) throw abortNow();
    const loaded = await loadCurrent(id, game, controller.signal, report);
    if (token !== renderToken) return;
    romPath = loaded.path;
    core = loaded.core;
    gameId = game?.id ?? `local:${loaded.name}`;
    paused = false;
    setPauseIcon(pauseBtn, false);
    canvas.focus();
    overlay.classList.add('hidden');
    status.textContent = `${loaded.name} 已开台。`;
    status.classList.remove('hidden');
    window.setTimeout(() => status.classList.add('hidden'), 1600);
    fit();
    buildTouch();
    installComboKeys(controller.signal);
    window.clearInterval(pauseTimer);
    pauseTimer = window.setInterval(() => {
      if (!romPath) return;
      const now = emulator.isPaused();
      if (now !== paused) {
        paused = now;
        if (paused) releaseTouch();
        setPauseIcon(pauseBtn, paused);
      }
    }, 300);
    controller.signal.addEventListener('abort', () => window.clearInterval(pauseTimer));
  } catch (error) {
    if (token !== renderToken) return;
    overlay.classList.add('hidden');
    status.classList.remove('hidden');
    status.textContent = isAbortError(error) || controller.signal.aborted
      ? '已取消'
      : (error instanceof Error ? error.message : String(error));
    buildTouch();
  }
}

function comboNames(section: string | null, player: PlayerId, id: ComboId): string[] {
  if (!section) return [];
  const targets = comboTargets(section, player, id) ?? [];
  return targets.map((binding) => bindings[section]?.[binding] || binding);
}

function installComboKeys(signal: AbortSignal): void {
  const section = sectionForCore(core);
  if (!section || !comboTargets(section, 1, 'AB')) return;
  const held = new Set<string>();
  const hitsFor = (sdl: string) => {
    const hits: Array<{ player: PlayerId; id: ComboId }> = [];
    for (const player of [1, 2] as const) {
      for (const id of COMBO_IDS) {
        if (combos[comboStorageKey(section, player, id)] === sdl) hits.push({ player, id });
      }
    }
    return hits;
  };
  const clear = () => {
    for (const owner of held) holds.replace(owner, []);
    held.clear();
  };
  window.addEventListener('keydown', (event) => {
    if (event.repeat || capturingKey) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const sdl = BROWSER_KEY_TO_SDL[event.code];
    if (!sdl) return;
    for (const hit of hitsFor(sdl)) {
      const owner = `key-combo-${hit.player}-${hit.id}`;
      if (held.has(owner)) continue;
      held.add(owner);
      holds.replace(owner, comboNames(section, hit.player, hit.id));
    }
  }, { capture: true, signal });
  window.addEventListener('keyup', (event) => {
    const sdl = BROWSER_KEY_TO_SDL[event.code];
    if (!sdl) return;
    for (const hit of hitsFor(sdl)) {
      const owner = `key-combo-${hit.player}-${hit.id}`;
      if (!held.delete(owner)) continue;
      holds.replace(owner, []);
    }
  }, { capture: true, signal });
  window.addEventListener('blur', clear, { signal });
  signal.addEventListener('abort', clear);
}

async function loadCurrent(
  id: string,
  game: GameEntry | null,
  signal: AbortSignal,
  report: (stage: LoadStage, label: string, progress: LoadProgress | null) => void,
): Promise<{ path: string; core: CoreType; name: string }> {
  const biosName = biosForGame(game);
  if (biosName) {
    /* Catalog games fetch BIOS before the larger ROM so a missing BIOS fails fast. */
  } else if (game) {
    skipStage(report, 'bios', '不需要');
  }

  let biosBytes: Uint8Array | null = null;
  if (biosName) {
    biosBytes = await loadBiosBytes(biosName, signal, (label, progress) => report('bios', label, progress));
    if (!biosBytes) throw new Error(biosName === 'neogeo.zip'
      ? 'Neo Geo 需要你自己的 neogeo.zip。放到 public/bios/ 或远程目录的 bios/，不要提交进这个仓库。'
      : 'GBA 需要你自己的 gba_bios.bin。放到 public/bios/ 或远程目录的 bios/ 后重新打开。文件不会提交进这个仓库。');
  }

  let name = 'rom.bin';
  let bytes: Uint8Array;
  if (pendingFile && (id === 'local' || game?.id === id)) {
    const file = pendingFile;
    pendingFile = null;
    name = safeName(file.name);
    report('rom', `正在读取 ${name}…`, { loaded: 0, total: file.size || null });
    bytes = await readBlob(file, (progress) => report('rom', `正在读取 ${name}…`, progress), signal);
  } else if (game) {
    name = safeName(game.rom.split('/').pop() || 'rom.bin');
    const url = resolveRomUrl(game.rom, game.bundled, romBaseUrl);
    report('rom', `正在下载 ${name}…`, null);
    try {
      bytes = await fetchGameRom(url, {
        signal,
        onProgress: (progress) => report('rom', progress.fromCache ? `${name} 来自缓存` : `正在下载 ${name}…`, progress),
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (error instanceof Error && /分片|校验|清单/.test(error.message)) throw error;
      throw new Error(game.hint || `找不到 ${game.rom}。请放入合法 ROM 或改用本地文件。`);
    }
  } else {
    throw new Error('没有选中的 ROM。回首页选一张卡，或打开本地文件。');
  }

  if (signal.aborted) throw abortNow();
  let path = emulator.writeRom(name, bytes);
  let kind = emulator.coreType(path);
  if (kind === 'unknown' && game?.fbneo && /\.zip$/i.test(name)) {
    name = `${game.fbneo}.zip`;
    path = emulator.writeRom(name, bytes);
    kind = emulator.coreType(path);
  }
  const arcade = kind === 'neogeo' || kind === 'cps'
    || game?.system === 'neogeo' || game?.system === 'cps1' || game?.system === 'cps2';
  if (!biosName && kind !== 'gba' && kind !== 'neogeo') skipStage(report, 'bios', '不需要');
  if (kind === 'gba' && !biosBytes) {
    biosBytes = await loadBiosBytes('gba_bios.bin', signal, (label, progress) => report('bios', label, progress));
    if (!biosBytes) throw new Error('GBA 需要你自己的 gba_bios.bin。放到 public/bios/ 或远程目录的 bios/ 后重新打开。文件不会提交进这个仓库。');
  }
  if (kind === 'neogeo' && !biosBytes) {
    biosBytes = await loadBiosBytes('neogeo.zip', signal, (label, progress) => report('bios', label, progress));
    if (!biosBytes) throw new Error('Neo Geo 需要你自己的 neogeo.zip。放到 public/bios/ 或远程目录的 bios/，不要提交进这个仓库。');
  }

  report('boot', '正在开台…', null);
  if (kind === 'gba' && biosBytes) {
    const bios = emulator.writeRom('gba_bios.bin', biosBytes);
    if (!emulator.loadBootrom(bios)) throw new Error('GBA BIOS 读失败。');
  }
  if (kind === 'neogeo' && biosBytes) {
    report('boot', '正在整理 Neo Geo BIOS…', null);
    const prepared = await prepareNeoGeoBios(biosBytes);
    const bios = emulator.writeRom('neogeo.zip', prepared.bytes);
    emulator.setNeoBios(prepared.biosIndex);
    if (!emulator.loadBootrom(bios)) throw new Error('Neo Geo BIOS 没能交给模拟器。');
  }
  if (arcade && /\.zip$/i.test(name)) {
    report('boot', '正在整理卡带…', null);
    const driverHint = (game?.fbneo || name.replace(/\.zip$/i, '')).toLowerCase();
    const supplements = await parentSupplements(driverHint, signal, (label) => report('boot', label, null));
    const gameZip = await prepareArcadeZip(bytes, driverHint, supplements);
    if (gameZip.blocked) throw new Error(gameZip.blocked);
    if (gameZip.matched) {
      name = `${gameZip.driver}.zip`;
      path = emulator.writeRom(name, gameZip.bytes);
      kind = emulator.coreType(path);
    } else if (gameZip.renamed.length > 0) {
      path = emulator.writeRom(name, gameZip.bytes);
    }
  }
  if (kind === 'unknown') throw new Error('这个文件认不出来。NES / GB / GBA / MD / CPS / Neo Geo 的常见扩展名都可以。街机 zip 要用 FBNeo 短名，例如 kof98.zip。');
  if (signal.aborted) throw abortNow();
  emulator.applyBindings(bindings);
  report('boot', '正在开台…', { loaded: 1, total: 1 });
  emulator.drainLogs();
  if (!emulator.loadRom(path)) throw new Error(explainLoadFailure(name, kind, emulator.drainLogs()));
  void emulator.persist();
  return { path, core: kind, name };
}

// Japan Battle Circuit ships as program ROMs. Graphics, sound, and the
// shared 68K tail live in the Euro parent, the same way FBNeo merges them.
const PARENT_ZIP: Record<string, string> = {
  batcirj: 'roms/batcir.zip',
};

async function parentSupplements(
  driver: string,
  signal: AbortSignal,
  report: (label: string) => void,
): Promise<Uint8Array[]> {
  const rom = PARENT_ZIP[driver];
  if (!rom) return [];
  report('正在并入 batcir 父集…');
  try {
    return [await fetchGameRom(resolveRomUrl(rom, true, romBaseUrl), { signal })];
  } catch (error) {
    if (isAbortError(error)) throw error;
    return [];
  }
}

function biosForGame(game: GameEntry | null): string | null {
  if (game?.system === 'neogeo') return 'neogeo.zip';
  if (game?.system === 'gba') return 'gba_bios.bin';
  return null;
}

async function loadBiosBytes(
  name: string,
  signal: AbortSignal,
  report: (label: string, progress: LoadProgress | null) => void,
): Promise<Uint8Array | null> {
  for (const url of biosUrls(name, romBaseUrl)) {
    try {
      report(`正在下载 ${name}…`, null);
      return await fetchBytes(url, {
        signal,
        onProgress: (progress) => report(progress.fromCache ? `${name} 来自缓存` : `正在下载 ${name}…`, progress),
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
    }
  }
  const cached = `/roms/${name}`;
  if (emulator.exists(cached)) {
    const bytes = emulator.readFile(cached);
    report(`${name} 来自本机`, { loaded: bytes.byteLength, total: bytes.byteLength, fromCache: true });
    return bytes;
  }
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
  toast(`已存进槽 ${selectedSlot}`);
}

async function loadFromSlot(): Promise<void> {
  if (!romPath || !gameId) return toast('还没开台');
  const slots = await listSlots(gameId);
  const record = slots[selectedSlot - 1];
  if (!record) return toast(`槽 ${selectedSlot} 是空的`);
  emulator.fs.writeFile(statePath(romPath), new Uint8Array(record.data));
  if (!emulator.quickLoad()) return toast('读档失败');
  toast(`已读取槽 ${selectedSlot}`);
}

function slotText(record: SaveSlot): string {
  const when = new Date(record.savedAt);
  const stamp = `${when.getMonth() + 1}/${when.getDate()} ${when.getHours().toString().padStart(2, '0')}:${when.getMinutes().toString().padStart(2, '0')}`;
  return `槽 ${record.slot} · ${stamp}`;
}

function showKeys(onChange: () => void): void {
  const section = sectionForCore(core);
  const overlay = el('div', 'modal');
  const article = el('article');
  article.append(el('h3', '', '按键'), el('p', 'hint', '1P 和 2P 分开记在这台浏览器里。点一行，再按想用的键。'));
  const switcher = el('div', 'who');
  const list = el('div', 'keys');
  const paintSwitch = () => {
    switcher.replaceChildren();
    for (const player of [1, 2] as const) {
      switcher.append(button(`${player}P`, `chip${player === keyPlayer ? ' active' : ''}`, () => {
        keyPlayer = player;
        writePref('streetgame.keyPlayer', String(player));
        paintSwitch();
        paintRows();
      }));
    }
  };
  const paintRows = () => {
    list.replaceChildren();
    const arcade2p = Boolean(section && sectionSupportsPlayer2(section));
    if (keyPlayer === 2 && !arcade2p) {
      list.append(el('p', 'hint', '这个机种只有一套按键。CPS 和 Neo Geo 可以分别设置 1P / 2P。'));
      return;
    }
    const rows = rowsForPlayer(section, keyPlayer).filter((item) => keyPlayer === 1 || item.section !== 'Common' || arcade2p);
    for (const item of rows) {
      const line = el('div', 'key-row');
      const name = el('span', '', item.section === 'Common' ? item.label : `${keyPlayer}P ${item.label}`);
      const value = button(bindings[item.section][item.key], 'btn keycap', () => {
        capturingKey = true;
        value.textContent = '按下按键…';
        const listen = (event: KeyboardEvent) => {
          event.preventDefault();
          event.stopPropagation();
          window.removeEventListener('keydown', listen, true);
          capturingKey = false;
          if (event.code === 'Escape') {
            value.textContent = bindings[item.section][item.key];
            return;
          }
          const sdl = BROWSER_KEY_TO_SDL[event.code];
          if (!sdl) {
            value.textContent = bindings[item.section][item.key];
            toast('这个键暂时对不上');
            return;
          }
          bindings[item.section][item.key] = sdl;
          saveBindings(bindings);
          if (booted) emulator.applyBindings(bindings);
          value.textContent = sdl;
          onChange();
        };
        window.addEventListener('keydown', listen, true);
      });
      line.append(name, value);
      list.append(line);
    }
    if (section && comboTargets(section, keyPlayer, 'AB')) {
      list.append(el('h4', '', '连招'));
      list.append(el('p', 'hint', '一个键同时按住这些按钮。手机上的连招键用同一套，可以在设置里关掉。'));
      for (const id of COMBO_IDS) {
        const storageKey = comboStorageKey(section, keyPlayer, id);
        const line = el('div', 'key-row');
        line.append(el('span', '', `${keyPlayer}P ${comboLabel(id)}`));
        const actions = el('div', 'key-actions');
        const value = button(combos[storageKey] || '未设置', 'btn keycap', () => {
          capturingKey = true;
          value.textContent = '按下按键…';
          const listen = (event: KeyboardEvent) => {
            event.preventDefault();
            event.stopPropagation();
            window.removeEventListener('keydown', listen, true);
            capturingKey = false;
            if (event.code === 'Escape') {
              value.textContent = combos[storageKey] || '未设置';
              return;
            }
            const sdl = BROWSER_KEY_TO_SDL[event.code];
            if (!sdl) {
              value.textContent = combos[storageKey] || '未设置';
              toast('这个键暂时对不上');
              return;
            }
            combos[storageKey] = sdl;
            saveCombos(combos);
            value.textContent = sdl;
          };
          window.addEventListener('keydown', listen, true);
        });
        const clear = button('清除', 'btn', () => {
          delete combos[storageKey];
          saveCombos(combos);
          value.textContent = '未设置';
        });
        actions.append(value, clear);
        line.append(actions);
        list.append(line);
      }
    }
  };
  paintSwitch();
  paintRows();
  article.append(switcher, list, button('完成', 'btn primary', () => overlay.remove()));
  overlay.append(article);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  app!.append(overlay);
}

function showCheats(): void {
  if (!romPath || !booted) return toast('还没开台');
  const overlay = el('div', 'modal');
  const article = el('article');
  article.append(el('h3', '', '金手指'), el('p', 'hint', '地址和数值可以用十进制，也可以用 0x 开头的十六进制。'));
  const form = el('div', 'cheat-form');
  const name = textInput('名称', '无限时间');
  const address = textInput('地址', '0xFF');
  const value = textInput('数值', '99');
  const width = document.createElement('select');
  width.className = 'text-input';
  for (const item of [1, 2, 4]) {
    const option = document.createElement('option');
    option.value = String(item);
    option.textContent = `${item} 字节`;
    width.append(option);
  }
  form.append(name.label, address.label, value.label, width);
  const list = el('div', 'keys');
  const paint = () => {
    list.replaceChildren();
    const codes = emulator.cheatList();
    if (codes.length === 0) {
      list.append(el('p', 'hint', '还没有金手指。'));
      return;
    }
    codes.forEach((code, index) => {
      const line = el('div', 'key-row');
      line.append(el('span', '', `${code.name || '代码'} · ${code.address} = ${code.value}`));
      const actions = el('div', 'key-actions');
      actions.append(
        button(code.enabled ? '关闭' : '开启', 'btn', () => { emulator.cheatToggle(index); paint(); }),
        button('删除', 'btn', () => { emulator.cheatRemove(index); paint(); }),
      );
      line.append(actions);
      list.append(line);
    });
  };
  const add = button('添加', 'btn primary', () => {
    const addr = parseNum(address.input.value);
    const num = parseNum(value.input.value);
    if (addr == null || num == null) return toast('地址或数值不对');
    emulator.cheatAdd(name.input.value.trim() || '代码', addr, num, Number(width.value));
    name.input.value = '';
    paint();
  });
  article.append(form, add, list, button('清除全部', 'btn', () => { emulator.cheatClear(); paint(); }), button('完成', 'btn', () => overlay.remove()));
  overlay.append(article);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  paint();
  app!.append(overlay);
}

async function showStorage(): Promise<void> {
  if (!gameId) return toast('还没开台');
  const overlay = el('div', 'modal');
  const article = el('article');
  article.append(el('h3', '', '存档数据'), el('p', 'hint', '这四条存在这台浏览器里，不会上传。'));
  const list = el('div', 'keys');
  const paint = async () => {
    const slots = await listSlots(gameId);
    list.replaceChildren();
    for (const slot of [1, 2, 3, 4]) {
      const record = slots[slot - 1];
      const line = el('div', 'key-row');
      line.append(el('span', '', record ? slotText(record) : `槽 ${slot} · 空`));
      const actions = el('div', 'key-actions');
      actions.append(
        button('存入', 'btn', () => { selectedSlot = slot; void saveToSlot().then(paint); }),
        button('读取', 'btn', () => { selectedSlot = slot; void loadFromSlot(); }),
        button('清除', 'btn', () => { void deleteSlot(gameId, slot).then(paint); }),
      );
      line.append(actions);
      list.append(line);
    }
  };
  article.append(list, button('完成', 'btn primary', () => overlay.remove()));
  overlay.append(article);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  await paint();
  app!.append(overlay);
}

function showSettings(rebuild: () => void): void {
  const overlay = el('div', 'modal');
  const article = el('article');
  article.append(
    el('h3', '', '设置'),
    checkbox('显示触控按键', touchOn, (on) => {
      touchOn = on;
      writePref('streetgame.touch', on ? '1' : '0');
      rebuild();
    }),
    checkbox('触控显示连招键（A+B、A+C、A+D、B+C、B+D、C+D、A+B+C+D）', showCombos, (on) => {
      showCombos = on;
      writePref('streetgame.showCombos', on ? '1' : '0');
      rebuild();
    }),
    faceLayoutChoice(rebuild),
    el('p', 'hint', '触控是单人。摇杆在左，圆形按键在右，和摇杆同一条水平线。四个 A/B/C/D 可选菱形（D 上、C 左、B 右、A 下）或正方形（左上 C、右上 D、左下 A、右下 B，外框和摇杆一样高）。投币、选择、开始在下一排中间，连招在右下。画面按比例完整显示，按键留在画面外面。'),
    button('金手指', 'btn', () => {
      overlay.remove();
      showCheats();
    }),
    button('完成', 'btn primary', () => overlay.remove()),
  );
  overlay.append(article);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  app!.append(overlay);
}

function applyVolume(value: number): void {
  volume = clampVolume(value);
  writePref('streetgame.volume', String(volume));
  setMasterGain(volume);
}

function setVolumeIcon(node: HTMLButtonElement): void {
  const tip = volume > 0 ? '音量' : '静音';
  node.replaceChildren(icon(volume > 0 ? 'volume' : 'muted'));
  node.dataset.tip = tip;
  node.setAttribute('aria-label', tip);
}

function setPauseIcon(node: HTMLButtonElement, isPaused: boolean): void {
  const tip = isPaused ? '继续' : '暂停';
  node.replaceChildren(icon(isPaused ? 'play' : 'pause'));
  node.dataset.tip = tip;
  node.setAttribute('aria-label', tip);
}

async function toggleFullscreen(node: HTMLElement, buttonNode: HTMLButtonElement): Promise<void> {
  const target = node as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
  const doc = document as Document & {
    webkitFullscreenElement?: Element | null;
    webkitExitFullscreen?: () => Promise<void> | void;
  };
  try {
    if (document.fullscreenElement || doc.webkitFullscreenElement) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else await doc.webkitExitFullscreen?.();
    } else if (typeof target.requestFullscreen === 'function') await target.requestFullscreen();
    else if (target.webkitRequestFullscreen) await target.webkitRequestFullscreen();
    else toast('这个浏览器不能全屏');
  } catch {
    toast('全屏被浏览器拦住了，再点一次试试');
  }
  const active = Boolean(document.fullscreenElement || doc.webkitFullscreenElement);
  buttonNode.replaceChildren(icon(active ? 'fullscreenExit' : 'fullscreen'));
  buttonNode.dataset.tip = active ? '退出全屏' : '全屏';
  buttonNode.setAttribute('aria-label', buttonNode.dataset.tip);
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

type LoadStage = 'wasm' | 'bios' | 'rom' | 'boot';

const STAGE_ORDER: LoadStage[] = ['wasm', 'bios', 'rom', 'boot'];
const STAGE_NAME: Record<LoadStage, string> = {
  wasm: '模拟器',
  bios: 'BIOS',
  rom: 'ROM',
  boot: '开台',
};

interface StageView {
  state: 'wait' | 'active' | 'done' | 'skip';
  detail: string;
  network: number;
  cached: number;
}

const stageViews = new WeakMap<HTMLElement, Record<LoadStage, StageView>>();

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
  const stages = el('ol', 'load-stages');
  for (const stage of STAGE_ORDER) {
    const item = el('li', 'wait');
    item.dataset.stage = stage;
    item.append(el('span', '', STAGE_NAME[stage]), el('span', 'load-stage-meta', '等待'));
    stages.append(item);
  }
  const meta = el('p', 'load-meta', '已下载 0 MB');
  card.append(title, track, stages, meta, button('取消', 'btn', onCancel));
  overlay.append(card);
  ensureStages(overlay);
  return overlay;
}

function ensureStages(overlay: HTMLElement): Record<LoadStage, StageView> {
  let views = stageViews.get(overlay);
  if (!views) {
    views = {
      wasm: { state: 'wait', detail: '等待', network: 0, cached: 0 },
      bios: { state: 'wait', detail: '等待', network: 0, cached: 0 },
      rom: { state: 'wait', detail: '等待', network: 0, cached: 0 },
      boot: { state: 'wait', detail: '等待', network: 0, cached: 0 },
    };
    stageViews.set(overlay, views);
  }
  return views;
}

function skipStage(
  report: (stage: LoadStage, label: string, progress: LoadProgress | null) => void,
  stage: LoadStage,
  detail: string,
): void {
  report(stage, detail, { loaded: 0, total: 0 });
}

function paintProgress(overlay: HTMLElement, stage: LoadStage, label: string, progress: LoadProgress | null): void {
  const title = overlay.querySelector('.load-title');
  const bar = overlay.querySelector('.load-bar');
  const meta = overlay.querySelector('.load-meta');
  const track = overlay.querySelector('.load-track');
  if (!(title instanceof HTMLElement) || !(bar instanceof HTMLElement) || !(meta instanceof HTMLElement) || !(track instanceof HTMLElement)) return;
  const views = ensureStages(overlay);
  const index = STAGE_ORDER.indexOf(stage);
  for (let i = 0; i < index; i += 1) {
    const earlier = views[STAGE_ORDER[i]];
    if (earlier.state === 'skip') continue;
    if (earlier.state === 'wait' || earlier.state === 'active') {
      earlier.state = 'done';
      if (earlier.detail === '等待' || earlier.detail === '连接中…') {
        earlier.detail = earlier.network + earlier.cached > 0 ? formatBytes(earlier.network + earlier.cached) : '完成';
      }
    }
  }
  const view = views[stage];
  const bootDone = stage === 'boot' && progress?.loaded === 1 && progress.total === 1;
  if (progress && progress.total === 0 && progress.loaded === 0 && !progress.fromCache) {
    view.state = 'skip';
    view.detail = label || '不需要';
  } else if (bootDone) {
    view.state = 'done';
    view.detail = '完成';
    if (label) title.textContent = label;
  } else {
    const loaded = progress?.loaded ?? 0;
    const total = progress?.total ?? null;
    const fromCache = Boolean(progress?.fromCache);
    if (fromCache) {
      view.cached = loaded;
      view.network = 0;
      view.state = 'done';
      view.detail = `缓存 · ${formatBytes(loaded)}`;
    } else if (total == null || total <= 0) {
      view.network = loaded;
      view.state = 'active';
      view.detail = loaded > 0 ? `已传输 ${formatBytes(loaded)}` : '连接中…';
    } else {
      view.network = loaded;
      const pct = Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
      view.detail = `${formatBytes(loaded)} / ${formatBytes(total)} · ${pct}%`;
      view.state = loaded >= total ? 'done' : 'active';
    }
    if (label) title.textContent = label;
  }
  let network = 0;
  let cached = 0;
  for (const item of STAGE_ORDER) {
    network += views[item].network;
    cached += views[item].cached;
    const row = overlay.querySelector(`li[data-stage="${item}"]`);
    if (!(row instanceof HTMLElement)) continue;
    row.className = views[item].state;
    const detail = row.querySelector('.load-stage-meta');
    if (detail) detail.textContent = views[item].detail;
  }
  const parts = [`已下载 ${formatBytes(network)}`];
  if (cached > 0) parts.push(`缓存 ${formatBytes(cached)}`);
  meta.textContent = parts.join(' · ');

  const active = views[stage];
  const loaded = progress?.loaded ?? 0;
  const total = progress?.total ?? null;
  if (active.state === 'skip' || total == null || total <= 0 || progress?.fromCache) {
    if (progress?.fromCache) {
      bar.classList.remove('indeterminate');
      bar.style.width = '100%';
      track.setAttribute('aria-valuenow', '100');
      return;
    }
    bar.classList.add('indeterminate');
    bar.style.width = '';
    track.removeAttribute('aria-valuenow');
    return;
  }
  const pct = Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
  bar.classList.remove('indeterminate');
  bar.style.width = `${pct}%`;
  track.setAttribute('aria-valuenow', String(pct));
}

const BROWSE_VIEWPORT = 'width=device-width, initial-scale=1, viewport-fit=cover';
const PLAY_VIEWPORT = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

function setViewport(content: string): void {
  const current = document.querySelector('meta[name="viewport"]');
  if (current?.getAttribute('content') === content) return;
  const next = document.createElement('meta');
  next.name = 'viewport';
  next.content = content;
  if (current) current.replaceWith(next);
  else document.head.append(next);
}

function installZoomGuard(): void {
  const playing = () => document.body.classList.contains('playing');
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (event) => {
      if (playing()) event.preventDefault();
    }, { passive: false });
  }
  document.addEventListener('touchmove', (event) => {
    if (!playing() || event.touches.length < 2) return;
    event.preventDefault();
  }, { passive: false });
  let lastTap = 0;
  document.addEventListener('touchend', (event) => {
    if (!playing()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.player')) return;
    const now = Date.now();
    if (now - lastTap < 320) event.preventDefault();
    lastTap = now;
  }, { passive: false });
}

function focusGame(): void {
  if (document.querySelector('.modal, .sheet')) return;
  canvas.focus({ preventScroll: true });
}

function abortNow(): DOMException {
  return new DOMException('已取消', 'AbortError');
}

function safeName(name: string): string {
  const base = name.split(/[/\\]/).pop() || 'rom.bin';
  return base.replace(/[^\w.\-]+/g, '_');
}

function parseNum(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const hex = /^0x/i.test(trimmed);
  const value = hex ? Number.parseInt(trimmed.slice(2), 16) : Number(trimmed);
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 80;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function readPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

function assetUrl(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`, window.location.href).href;
}

function faceLayoutChoice(onChange: () => void): HTMLElement {
  const wrap = el('div', 'choice');
  const group = el('div', 'segment');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', '按键布局');
  const options: Array<[FaceLayout, string]> = [
    ['diamond', '菱形'],
    ['square', '正方形'],
  ];
  const paint = () => {
    for (const node of group.querySelectorAll('button')) {
      const selected = node.dataset.layout === faceLayout;
      node.classList.toggle('active', selected);
      node.setAttribute('aria-checked', selected ? 'true' : 'false');
    }
  };
  for (const [value, text] of options) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'chip';
    option.dataset.layout = value;
    option.textContent = text;
    option.setAttribute('role', 'radio');
    option.addEventListener('click', () => {
      if (faceLayout === value) return;
      faceLayout = value;
      writePref('streetgame.faceLayout', value);
      paint();
      onChange();
    });
    group.append(option);
  }
  paint();
  wrap.append(el('span', 'choice-label', '按键布局'), group);
  return wrap;
}

function checkbox(label: string, checked: boolean, onChange: (value: boolean) => void): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.className = 'check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  wrap.append(input, document.createTextNode(label));
  return wrap;
}

function textInput(label: string, placeholder: string): { label: HTMLLabelElement; input: HTMLInputElement } {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  wrap.append(el('span', '', label));
  const input = document.createElement('input');
  input.className = 'text-input';
  input.placeholder = placeholder;
  wrap.append(input);
  return { label: wrap, input };
}

function iconButton(name: IconName, tip: string, onClick: () => void): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'emu-btn';
  node.dataset.tip = tip;
  node.setAttribute('aria-label', tip);
  node.append(icon(name));
  node.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
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
