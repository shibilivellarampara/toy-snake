/**
 * Tiny procedural sound effects (no audio assets) via Web Audio oscillators.
 * Browsers require a user gesture before audio can play, so call unlock()
 * from a click handler before anything else tries to make noise.
 */
class SoundEngine {
  private ctx: AudioContext | null = null;
  private enabled = true;
  private muted = false;

  setMuted(muted: boolean) {
    this.muted = muted;
  }

  get isMuted() {
    return this.muted;
  }

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        this.enabled = false;
        return null;
      }
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) this.ctx?.resume().catch(() => {});
      });
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  unlock() {
    this.ensure();
  }

  private tone(
    freq: number,
    duration: number,
    opts: { type?: OscillatorType; volume?: number; glideTo?: number; delay?: number } = {},
  ) {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const start = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type ?? "sine";
    osc.frequency.setValueAtTime(freq, start);
    if (opts.glideTo) osc.frequency.exponentialRampToValueAtTime(opts.glideTo, start + duration);
    gain.gain.setValueAtTime(opts.volume ?? 0.2, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  countdownTick() {
    this.tone(440, 0.12, { type: "square", volume: 0.15 });
  }

  countdownGo() {
    this.tone(880, 0.28, { type: "square", volume: 0.2, glideTo: 1320 });
  }

  eat() {
    this.tone(520, 0.08, { type: "square", volume: 0.18, glideTo: 900 });
  }

  turn() {
    this.tone(300, 0.03, { type: "square", volume: 0.05 });
  }

  crash() {
    this.tone(160, 0.28, { type: "sawtooth", volume: 0.2, glideTo: 40 });
  }

  win() {
    this.tone(523, 0.15, { type: "triangle", volume: 0.22 });
    this.tone(659, 0.15, { type: "triangle", volume: 0.22, delay: 0.15 });
    this.tone(784, 0.15, { type: "triangle", volume: 0.22, delay: 0.3 });
    this.tone(1046, 0.35, { type: "triangle", volume: 0.24, delay: 0.45 });
  }
}

export const sound = new SoundEngine();
