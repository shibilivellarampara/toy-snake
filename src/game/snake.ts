import type { Dir, Point } from "../net/protocol";
import { isOpposite, spawnSegments } from "./grid";

export class Snake {
  readonly id: string;
  readonly isAI: boolean;
  segments: Point[];
  dir: Dir;
  pendingDir: Dir;
  alive = true;
  score = 0;
  /** Tick number this snake died on; Infinity while alive, used for ranking. */
  deathTick = Infinity;

  constructor(id: string, start: Point, dir: Dir, isAI: boolean) {
    this.id = id;
    this.isAI = isAI;
    this.segments = spawnSegments(start, dir);
    this.dir = dir;
    this.pendingDir = dir;
  }

  get head(): Point {
    return this.segments[0];
  }

  /** Ignores 180-degree reversals — turning directly into your own neck is
   * never a valid move in classic snake, so the last queued turn wins. */
  setDirection(dir: Dir) {
    if (!this.alive) return;
    if (isOpposite(dir, this.dir)) return;
    this.pendingDir = dir;
  }

  /** Called once per tick: commits the queued turn (still refusing a
   * reversal against whatever direction we actually moved last tick) so a
   * turn queued a moment too late can't undo itself into the snake's body. */
  resolveTurn() {
    if (!isOpposite(this.pendingDir, this.dir)) this.dir = this.pendingDir;
    else this.pendingDir = this.dir;
  }
}
