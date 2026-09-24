export type FrameCallback = (dt: number) => void;

const MAX_DT = 1 / 20; // clamp huge gaps (tab backgrounded, etc.)

export class GameLoop {
  private running = false;
  private lastTime = 0;
  private rafId = 0;

  private onFrame: FrameCallback;

  constructor(onFrame: FrameCallback) {
    this.onFrame = onFrame;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private tick = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(MAX_DT, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.onFrame(dt);
    this.rafId = requestAnimationFrame(this.tick);
  };
}
