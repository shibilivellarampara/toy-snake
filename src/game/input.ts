import type { Dir } from "../net/protocol";
import { sound } from "./sound";

const KEY_MAP: Record<string, Dir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
};

/**
 * Snake turns are discrete events, not a continuous throttle/steer state
 * like a racing game — so unlike a polled getInput(), this fires a callback
 * exactly once per actual direction change (keypress or D-pad tap).
 */
export class InputManager {
  readonly element: HTMLDivElement;
  enabled = true;
  private handlers: ((dir: Dir) => void)[] = [];

  constructor() {
    window.addEventListener("keydown", this.onKeyDown);

    this.element = document.createElement("div");
    this.element.className = "touch-dpad";

    const makeBtn = (label: string, dir: Dir, cls: string) => {
      const el = document.createElement("div");
      el.className = `dpad-btn ${cls}`;
      el.textContent = label;
      el.style.touchAction = "none";
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.emit(dir);
      });
      el.addEventListener("contextmenu", (e) => e.preventDefault());
      return el;
    };

    this.element.append(
      makeBtn("▲", "up", "dpad-up"),
      makeBtn("◀", "left", "dpad-left"),
      makeBtn("▶", "right", "dpad-right"),
      makeBtn("▼", "down", "dpad-down"),
    );

    if (!isTouchDevice()) this.element.style.display = "none";
  }

  onDirection(fn: (dir: Dir) => void) {
    this.handlers.push(fn);
  }

  private emit(dir: Dir) {
    if (!this.enabled) return;
    sound.unlock();
    this.handlers.forEach((fn) => fn(dir));
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const dir = KEY_MAP[e.key];
    if (dir) this.emit(dir);
  };

  destroy() {
    window.removeEventListener("keydown", this.onKeyDown);
    this.element.remove();
  }
}

function isTouchDevice() {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}
