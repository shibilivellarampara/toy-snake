import type { Dir, NetMessage, Point, PlayerInfo, SnakeState, StandingEntry } from "../net/protocol";
import { addPoint, cellKey, dirVector, inBounds, pointsEqual, randomEmptyCell, SPAWN_TABLE } from "./grid";
import { Snake } from "./snake";
import { aiDirection } from "./ai";

const COUNTDOWN_MS = 3000;
const BASE_TICK_MS = 150;
const MIN_TICK_MS = 80;
const SPEEDUP_PER_APPLE_MS = 1.5;
const MAX_GAME_MS = 3 * 60 * 1000;

export interface DeathEvent {
  id: string;
  x: number;
  y: number;
  atMs: number;
}

/** A snapshot of just the fields the renderer needs to interpolate between
 * two ticks — decoupled from Snake so guests (who never build a Snake) can
 * hold the exact same shape straight from the wire. */
export interface RenderSnapshot {
  segments: Point[];
  dir: Dir;
  alive: boolean;
  score: number;
}

export class GameSession {
  readonly isHost: boolean;
  readonly localId: string;
  readonly roster: PlayerInfo[];
  food: Point[] = [];

  countdownMs = 0;
  started = false;
  over = false;
  elapsedMs = 0;
  tick = 0;
  standings: StandingEntry[] = [];
  deathEvents: DeathEvent[] = [];

  /** Host-only authoritative state. */
  private snakes = new Map<string, Snake>();
  private tickIntervalMs = BASE_TICK_MS;
  private tickAccumulator = 0;
  private applesEaten = 0;

  /** Render-facing snapshots, kept on both host and guest so the renderer
   * never needs to know which side it's running on. */
  private prevSnapshot = new Map<string, RenderSnapshot>();
  private currSnapshot = new Map<string, RenderSnapshot>();
  private stateArrivedAt = performance.now();
  private estimatedTickMs = BASE_TICK_MS;

  private readonly sendFn: (msg: NetMessage) => void;

  constructor(localId: string, roster: PlayerInfo[], isHost: boolean, sendFn: (msg: NetMessage) => void) {
    this.localId = localId;
    this.roster = roster;
    this.isHost = isHost;
    this.sendFn = sendFn;

    if (isHost) {
      for (const p of roster) {
        const spawn = SPAWN_TABLE[p.slot % SPAWN_TABLE.length];
        this.snakes.set(p.id, new Snake(p.id, spawn.start, spawn.dir, !!p.isAI));
      }
      this.ensureFoodCount();
      this.captureSnapshot();
    }
  }

  nameFor(id: string): string {
    return this.roster.find((p) => p.id === id)?.name ?? "Player";
  }

  startCountdown() {
    this.countdownMs = COUNTDOWN_MS;
    this.started = false;
    if (this.isHost) {
      this.sendFn({ type: "countdown", ms: COUNTDOWN_MS });
      // So guests can render the starting layout during the countdown
      // instead of a blank board until the first real tick lands.
      this.broadcastState();
    }
  }

  beginCountdown(ms: number) {
    this.countdownMs = ms;
    this.started = false;
  }

  setDirection(id: string, dir: Dir) {
    this.snakes.get(id)?.setDirection(dir);
  }

  handleNetMessage(msg: NetMessage) {
    switch (msg.type) {
      case "input":
        if (this.isHost) this.setDirection(msg.id, msg.dir);
        return;
      case "state":
        if (!this.isHost) this.applyState(msg.tick, msg.snakes, msg.food);
        return;
      case "countdown":
        if (!this.isHost) this.beginCountdown(msg.ms);
        return;
      case "gameover":
        if (!this.isHost) {
          this.over = true;
          this.standings = msg.standings;
        }
        return;
    }
  }

  private applyState(tick: number, snakes: SnakeState[], food: Point[]) {
    this.tick = tick;
    const previouslyAlive = new Set(
      [...this.currSnapshot.entries()].filter(([, snap]) => snap.alive).map(([id]) => id),
    );
    this.prevSnapshot = this.currSnapshot;
    this.currSnapshot = new Map(
      snakes.map((s) => [s.id, { segments: s.segments, dir: s.dir, alive: s.alive, score: s.score }]),
    );
    this.food = food;

    // Guests never run hostTick(), so this is the only place a guest can
    // notice a snake just died — diff against what we knew last state
    // message and synthesize the same death-burst event hostTick() would
    // have recorded, timed off our own clock rather than the host's.
    for (const s of snakes) {
      if (!s.alive && previouslyAlive.has(s.id)) {
        this.deathEvents.push({ id: s.id, x: s.segments[0].x, y: s.segments[0].y, atMs: this.elapsedMs });
      }
    }

    const now = performance.now();
    const gap = now - this.stateArrivedAt;
    if (gap > 30 && gap < 500) this.estimatedTickMs = gap;
    this.stateArrivedAt = now;
  }

  update(dt: number) {
    if (this.over) return;
    if (this.countdownMs > 0) {
      this.countdownMs = Math.max(0, this.countdownMs - dt * 1000);
      if (this.countdownMs === 0) {
        this.started = true;
        this.tickAccumulator = 0;
        this.stateArrivedAt = performance.now();
      }
      return;
    }
    if (!this.started) return;
    this.elapsedMs += dt * 1000;
    if (!this.isHost) return;

    this.tickAccumulator += dt * 1000;
    let guard = 0;
    while (this.tickAccumulator >= this.tickIntervalMs && guard < 5) {
      this.tickAccumulator -= this.tickIntervalMs;
      this.hostTick();
      guard++;
    }
  }

  get timeRemainingMs(): number {
    return Math.max(0, MAX_GAME_MS - this.elapsedMs);
  }

  /** Render interpolation factor 0..1 between prevSnapshot and currSnapshot,
   * derived from wall-clock time so it works identically whether this
   * session is the tick-driving host or a state-consuming guest. */
  getRenderT(): number {
    const elapsed = performance.now() - this.stateArrivedAt;
    const interval = this.isHost ? this.tickIntervalMs : this.estimatedTickMs;
    return Math.max(0, Math.min(1, elapsed / interval));
  }

  getSnapshots(): { prev: Map<string, RenderSnapshot>; curr: Map<string, RenderSnapshot> } {
    return { prev: this.prevSnapshot, curr: this.currSnapshot };
  }

  /** Segment-index-aligned lerp between the previous and current tick's
   * snapshot: since a non-growing move is just [newHead, ...old.slice(0,-1)],
   * segment[i]'s previous position is exactly what segment[i-1] used to
   * occupy, so this naturally reads as each body segment sliding forward
   * into the slot ahead of it — the classic smooth-snake trick. */
  getInterpolatedSnakes(): { id: string; segments: Point[]; dir: Dir; alive: boolean; score: number }[] {
    const t = this.getRenderT();
    const result: { id: string; segments: Point[]; dir: Dir; alive: boolean; score: number }[] = [];
    for (const [id, curr] of this.currSnapshot) {
      const prev = this.prevSnapshot.get(id);
      const segments = curr.segments.map((seg, i) => {
        const p = prev?.segments[i];
        if (!p || !curr.alive) return seg;
        return { x: lerp(p.x, seg.x, t), y: lerp(p.y, seg.y, t) };
      });
      result.push({ id, segments, dir: curr.dir, alive: curr.alive, score: curr.score });
    }
    return result;
  }

  private hostTick() {
    this.tick++;
    const alive = [...this.snakes.values()].filter((s) => s.alive);

    for (const s of alive) {
      if (s.isAI) s.setDirection(aiDirection(s, this.snakes.values(), this.food));
      s.resolveTurn();
    }

    const newHeads = new Map<string, Point>();
    for (const s of alive) newHeads.set(s.id, addPoint(s.head, dirVector(s.dir)));

    const willDie = new Set<string>();
    for (const s of alive) {
      const nh = newHeads.get(s.id)!;
      if (!inBounds(nh)) {
        willDie.add(s.id);
        continue;
      }
      const eatsFood = this.food.some((f) => pointsEqual(f, nh));
      const ownBody = eatsFood ? s.segments : s.segments.slice(0, -1);
      if (ownBody.some((seg) => pointsEqual(seg, nh))) {
        willDie.add(s.id);
        continue;
      }
      // Deliberately conservative: an alive other snake's about-to-vacate
      // tail cell still counts as solid this tick (only the mover's own
      // tail gets that exemption, above) — a rare false-death right at a
      // near-miss, traded for not having to simulate move order between
      // snakes.
      for (const other of this.snakes.values()) {
        if (other.id === s.id) continue;
        if (other.segments.some((seg) => pointsEqual(seg, nh))) {
          willDie.add(s.id);
          break;
        }
        const otherNext = newHeads.get(other.id);
        if (otherNext && pointsEqual(otherNext, nh)) {
          willDie.add(s.id);
          break;
        }
      }
    }

    for (const s of alive) {
      if (willDie.has(s.id)) {
        s.alive = false;
        s.deathTick = this.tick;
        this.deathEvents.push({ id: s.id, x: s.head.x, y: s.head.y, atMs: this.elapsedMs });
        continue;
      }
      const nh = newHeads.get(s.id)!;
      s.segments.unshift(nh);
      const idx = this.food.findIndex((f) => pointsEqual(f, nh));
      if (idx >= 0) {
        this.food.splice(idx, 1);
        s.score += 10;
        this.applesEaten++;
        this.tickIntervalMs = Math.max(MIN_TICK_MS, BASE_TICK_MS - this.applesEaten * SPEEDUP_PER_APPLE_MS);
      } else {
        s.segments.pop();
      }
    }

    this.ensureFoodCount();
    this.captureSnapshot();
    this.checkGameOver();
    this.broadcastState();
  }

  private ensureFoodCount() {
    const targetCount = Math.min(6, Math.max(3, this.roster.length + 1));
    const occupied = new Set<string>();
    for (const s of this.snakes.values()) for (const seg of s.segments) occupied.add(cellKey(seg));
    for (const f of this.food) occupied.add(cellKey(f));
    while (this.food.length < targetCount) {
      const cell = randomEmptyCell(occupied);
      if (!cell) break;
      this.food.push(cell);
      occupied.add(cellKey(cell));
    }
  }

  private captureSnapshot() {
    this.prevSnapshot = this.currSnapshot;
    this.currSnapshot = new Map(
      [...this.snakes.values()].map((s) => [
        s.id,
        { segments: s.segments.map((p) => ({ ...p })), dir: s.dir, alive: s.alive, score: s.score },
      ]),
    );
    this.stateArrivedAt = performance.now();
  }

  private checkGameOver() {
    const totalPlayers = this.snakes.size;
    const aliveList = [...this.snakes.values()].filter((s) => s.alive);
    const timeUp = this.elapsedMs >= MAX_GAME_MS;
    const decided = totalPlayers > 1 ? aliveList.length <= 1 : aliveList.length === 0;
    if (!decided && !timeUp) return;

    this.over = true;
    this.standings = this.computeStandings();
    this.sendFn({ type: "gameover", standings: this.standings });
  }

  private computeStandings(): StandingEntry[] {
    const entries = [...this.snakes.values()].map((s) => ({
      id: s.id,
      name: this.nameFor(s.id),
      score: s.score,
      alive: s.alive,
      deathTick: s.deathTick,
    }));
    // Score decides the ranking, full stop — surviving longest is only a
    // tiebreaker for equal scores, not an outright win. (An earlier version
    // ranked the last snake alive as #1 regardless of score, which put a
    // low-scoring survivor above a higher-scoring snake that died earlier.)
    entries.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      return b.deathTick - a.deathTick;
    });
    return entries.map((e, i) => ({ id: e.id, name: e.name, place: i + 1, score: e.score, isLocal: e.id === this.localId }));
  }

  private broadcastState() {
    const snakes: SnakeState[] = [...this.snakes.values()].map((s) => ({
      id: s.id,
      segments: s.segments,
      dir: s.dir,
      alive: s.alive,
      score: s.score,
    }));
    this.sendFn({ type: "state", tick: this.tick, snakes, food: this.food });
  }

  /** Live scoreboard while the game is still running (host and guests both
   * have this from the latest snapshot, no need to wait for game-over). */
  getLiveStandings(): { id: string; name: string; score: number; alive: boolean; isLocal: boolean }[] {
    const entries = [...this.currSnapshot.entries()].map(([id, snap]) => ({
      id,
      name: this.nameFor(id),
      score: snap.score,
      alive: snap.alive,
      isLocal: id === this.localId,
    }));
    entries.sort((a, b) => b.score - a.score);
    return entries;
  }
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
