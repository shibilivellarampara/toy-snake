import type { Dir, Point } from "../net/protocol";
import { addPoint, cellKey, dirVector, inBounds, isOpposite } from "./grid";
import type { Snake } from "./snake";

const ALL_DIRS: Dir[] = ["up", "down", "left", "right"];
const FLOOD_LIMIT = 40;

/**
 * Greedy-with-a-safety-net bot: among moves that don't immediately kill it,
 * prefers the one that gets closer to the nearest apple, tie-broken by how
 * much open floor that move leaves to escape into (so it doesn't drive
 * itself into a dead-end just to shave one cell off the apple distance).
 */
export function aiDirection(snake: Snake, allSnakes: Iterable<Snake>, food: Point[]): Dir {
  const occupied = new Set<string>();
  for (const s of allSnakes) {
    for (const seg of s.segments) occupied.add(cellKey(seg));
  }
  // The snake's own current tail cell is about to vacate (unless it's
  // eating this move, which we can't know yet) — treat it as free so bots
  // don't refuse to ever turn toward their own tail.
  const tail = snake.segments[snake.segments.length - 1];
  occupied.delete(cellKey(tail));

  const head = snake.head;
  const candidates = ALL_DIRS.filter((d) => !isOpposite(d, snake.dir));
  const safe = candidates.filter((d) => {
    const next = addPoint(head, dirVector(d));
    return inBounds(next) && !occupied.has(cellKey(next));
  });
  if (safe.length === 0) return snake.dir; // boxed in, nothing to do but continue

  let nearestFood: Point | null = null;
  let bestFoodDist = Infinity;
  for (const f of food) {
    const dist = Math.abs(f.x - head.x) + Math.abs(f.y - head.y);
    if (dist < bestFoodDist) {
      bestFoodDist = dist;
      nearestFood = f;
    }
  }

  let best = safe[0];
  let bestScore = -Infinity;
  for (const d of safe) {
    const next = addPoint(head, dirVector(d));
    const foodDist = nearestFood ? Math.abs(nearestFood.x - next.x) + Math.abs(nearestFood.y - next.y) : 0;
    const space = floodFillCount(next, occupied);
    const score = -foodDist * 3 + Math.min(space, FLOOD_LIMIT);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** Counts reachable empty cells from `start` up to FLOOD_LIMIT, so a bot
 * can tell "leads into a big open room" apart from "leads into a 1-cell
 * pocket" without a full board-wide search every tick. */
function floodFillCount(start: Point, occupied: Set<string>): number {
  const seen = new Set<string>([cellKey(start)]);
  const queue: Point[] = [start];
  let count = 0;
  while (queue.length > 0 && count < FLOOD_LIMIT) {
    const p = queue.shift()!;
    count++;
    for (const d of ALL_DIRS) {
      const next = addPoint(p, dirVector(d));
      if (!inBounds(next)) continue;
      const key = cellKey(next);
      if (seen.has(key) || occupied.has(key)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return count;
}
