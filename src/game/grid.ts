import type { Dir, Point } from "../net/protocol";

export const GRID_COLS = 30;
export const GRID_ROWS = 18;

export function cellKey(p: Point): string {
  return `${p.x},${p.y}`;
}

export function pointsEqual(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

export function dirVector(dir: Dir): Point {
  switch (dir) {
    case "up":
      return { x: 0, y: -1 };
    case "down":
      return { x: 0, y: 1 };
    case "left":
      return { x: -1, y: 0 };
    case "right":
      return { x: 1, y: 0 };
  }
}

export function isOpposite(a: Dir, b: Dir): boolean {
  return (
    (a === "up" && b === "down") ||
    (a === "down" && b === "up") ||
    (a === "left" && b === "right") ||
    (a === "right" && b === "left")
  );
}

export function addPoint(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function inBounds(p: Point): boolean {
  return p.x >= 0 && p.x < GRID_COLS && p.y >= 0 && p.y < GRID_ROWS;
}

/** Picks a uniformly random cell that isn't in `occupied`. Falls back to
 * scanning the whole grid if random sampling keeps missing on a nearly-full
 * board, so it can't spin forever. */
export function randomEmptyCell(occupied: Set<string>): Point | null {
  const total = GRID_COLS * GRID_ROWS;
  if (occupied.size >= total) return null;
  for (let attempt = 0; attempt < 60; attempt++) {
    const p = { x: Math.floor(Math.random() * GRID_COLS), y: Math.floor(Math.random() * GRID_ROWS) };
    if (!occupied.has(cellKey(p))) return p;
  }
  for (let y = 0; y < GRID_ROWS; y++) {
    for (let x = 0; x < GRID_COLS; x++) {
      const p = { x, y };
      if (!occupied.has(cellKey(p))) return p;
    }
  }
  return null;
}

/** Fixed spawn layout for up to 8 players, spread around a 30x18 board so
 * starting bodies never overlap regardless of who joins. */
export const SPAWN_TABLE: { start: Point; dir: Dir }[] = [
  { start: { x: 4, y: 4 }, dir: "right" },
  { start: { x: 25, y: 13 }, dir: "left" },
  { start: { x: 25, y: 4 }, dir: "left" },
  { start: { x: 4, y: 13 }, dir: "right" },
  { start: { x: 15, y: 3 }, dir: "down" },
  { start: { x: 15, y: 14 }, dir: "up" },
  { start: { x: 4, y: 9 }, dir: "right" },
  { start: { x: 25, y: 9 }, dir: "left" },
];

export function spawnSegments(start: Point, dir: Dir): Point[] {
  const back = dirVector(oppositeDir(dir));
  return [start, addPoint(start, back), addPoint(start, { x: back.x * 2, y: back.y * 2 })];
}

function oppositeDir(dir: Dir): Dir {
  switch (dir) {
    case "up":
      return "down";
    case "down":
      return "up";
    case "left":
      return "right";
    case "right":
      return "left";
  }
}
