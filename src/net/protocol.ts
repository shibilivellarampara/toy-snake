export type Dir = "up" | "down" | "left" | "right";

export interface Point {
  x: number;
  y: number;
}

export interface PlayerInfo {
  id: string;
  name: string;
  color: string;
  slot: number;
  /** Locally simulated by the host as a bot rather than driven by a real connection. */
  isAI?: boolean;
}

export interface SnakeState {
  id: string;
  segments: Point[];
  dir: Dir;
  alive: boolean;
  score: number;
}

export interface StandingEntry {
  id: string;
  name: string;
  place: number;
  score: number;
  isLocal: boolean;
}

export type NetMessage =
  | { type: "hello"; player: PlayerInfo }
  | { type: "roster"; players: PlayerInfo[] }
  | { type: "countdown"; ms: number }
  /** Guest -> host only: a direction change. Infrequent (only sent on
   * actual turns), so it rides the reliable channel unlike the state feed. */
  | { type: "input"; id: string; dir: Dir }
  /** Host -> everyone: the full authoritative board, every tick. */
  | { type: "state"; tick: number; snakes: SnakeState[]; food: Point[] }
  | { type: "gameover"; standings: StandingEntry[] }
  | { type: "leave"; id: string };

export const PLAYER_COLORS = [
  "#ef4444", // red
  "#3b82f6", // blue
  "#eab308", // yellow
  "#22c55e", // green
  "#f97316", // orange
  "#a855f7", // purple
  "#06b6d4", // cyan
  "#ec4899", // pink
];

export function randomPlayerId() {
  return Math.random().toString(36).slice(2, 10);
}
