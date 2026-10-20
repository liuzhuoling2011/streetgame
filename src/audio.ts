const contexts = new Set<AudioContext>();

type AudioCtor = typeof AudioContext;

export function installAudioUnlock(): void {
  const root = window as Window & { webkitAudioContext?: AudioCtor };
  const Original = window.AudioContext || root.webkitAudioContext;
  if (!Original || (Original as AudioCtor & { __streetgame?: boolean }).__streetgame) return;

  function Patched(this: AudioContext, ...args: ConstructorParameters<AudioCtor>): AudioContext {
    const ctx = new Original(...args);
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
