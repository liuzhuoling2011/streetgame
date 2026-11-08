/** Plays DOSBox mixer samples on the page. The worker only hands over floats. */
export class DosSpeaker {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private next = 0;
  private freq = 44100;
  private level = 0.8;

  setFrequency(freq: number): void {
    if (freq >= 8000 && freq <= 96000) this.freq = freq;
  }

  setLevel(level: number): void {
    this.level = Math.max(0, Math.min(1, level / 100));
    if (this.gain) this.gain.gain.value = this.level;
  }

  prime(): void {
    const ctx = this.ensure();
    if (ctx.state === 'suspended') void ctx.resume();
  }

  push(samples: Float32Array): void {
    if (samples.length === 0 || this.level <= 0) return;
    const ctx = this.ensure();
    if (ctx.state === 'suspended') void ctx.resume();
    const buffer = ctx.createBuffer(1, samples.length, this.freq);
    buffer.getChannelData(0).set(samples);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain!);
    const now = ctx.currentTime;
    if (this.next < now + 0.02) this.next = now + 0.06;
    if (this.next > now + 0.35) this.next = now + 0.06;
    source.start(this.next);
    this.next += buffer.duration;
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  close(): void {
    const ctx = this.ctx;
    this.ctx = null;
    this.gain = null;
    this.next = 0;
    if (ctx) void ctx.close();
  }

  private ensure(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext({ sampleRate: this.freq, latencyHint: 'interactive' });
    const gain = ctx.createGain();
    gain.gain.value = this.level;
    gain.connect(ctx.destination);
    this.ctx = ctx;
    this.gain = gain;
    void ctx.resume();
    return ctx;
  }
}
