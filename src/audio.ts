const contexts = new Set<AudioContext>();
const masters = new Set<GainNode>();

type AudioCtor = typeof AudioContext;

// TatoEmu squares the slider (pow(volume/100, 2)) once, inside Emulator::initialize,
// and setVolume only stores the config value. Later slider moves never reach the
// core. The core is pinned at 100 so this gain is the only attenuation.
export function volumeToGain(volume: number): number {
  const level = Math.max(0, Math.min(100, volume)) / 100;
  return level * level;
}

let gainLevel = volumeToGain(80);

export function setMasterGain(volume: number): void {
  gainLevel = volumeToGain(volume);
  for (const node of masters) node.gain.value = gainLevel;
}

export function installAudioUnlock(): void {
  const root = window as Window & { webkitAudioContext?: AudioCtor };
  const Original = window.AudioContext || root.webkitAudioContext;
  if (!Original || (Original as AudioCtor & { __streetgame?: boolean }).__streetgame) return;

  function Patched(this: AudioContext, ...args: ConstructorParameters<AudioCtor>): AudioContext {
    const ctx = new Original(...args);
    const realDestination = ctx.destination;
    const master = ctx.createGain();
    master.gain.value = gainLevel;
    master.connect(realDestination);
    try {
      Object.defineProperty(ctx, 'destination', { configurable: true, get: () => master });
    } catch {
      /* the core still plays at full level if the destination cannot be wrapped */
    }
    masters.add(master);
    contexts.add(ctx);
    return ctx;
  }

  Patched.prototype = Original.prototype;
  Object.defineProperty(Patched, '__streetgame', { value: true });
  const ctor = Patched as unknown as AudioCtor;
  window.AudioContext = ctor;
  root.webkitAudioContext = ctor;
}

export function audioNeedsGesture(): boolean {
  for (const ctx of contexts) {
    if (ctx.state === 'suspended') return true;
  }
  return false;
}

export async function resumeAudio(): Promise<void> {
  await Promise.all([...contexts].map(async (ctx) => {
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch { /* a later tap can try again */ }
    }
  }));
}
