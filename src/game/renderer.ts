import type { Accessory, Dir, Point } from "../net/protocol";
import type { DeathEvent } from "./session";

export interface RenderSnake {
  id: string;
  /** Interpolated float grid coordinates, head first. */
  segments: Point[];
  color: string;
  label: string;
  isLocal: boolean;
  alive: boolean;
  dir: Dir;
  score: number;
  accessory?: Accessory;
}

export interface BoardLayout {
  cellSize: number;
  originX: number;
  originY: number;
  boardW: number;
  boardH: number;
}

export function computeBoardLayout(
  canvasWidth: number,
  canvasHeight: number,
  cols: number,
  rows: number,
  reserveTop: number,
): BoardLayout {
  const availW = canvasWidth - 24;
  const availH = canvasHeight - reserveTop - 24;
  const cellSize = Math.max(6, Math.floor(Math.min(availW / cols, availH / rows)));
  const boardW = cellSize * cols;
  const boardH = cellSize * rows;
  const originX = (canvasWidth - boardW) / 2;
  const originY = reserveTop + (availH - boardH) / 2 + 12;
  return { cellSize, originX, originY, boardW, boardH };
}

function cellCenter(layout: BoardLayout, p: Point) {
  return {
    x: layout.originX + (p.x + 0.5) * layout.cellSize,
    y: layout.originY + (p.y + 0.5) * layout.cellSize,
  };
}

export function drawBoard(ctx: CanvasRenderingContext2D, cols: number, rows: number, layout: BoardLayout) {
  const { cellSize, originX, originY, boardW, boardH } = layout;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 24;
  roundRect(ctx, originX, originY, boardW, boardH, 16);
  ctx.fillStyle = "#173321";
  ctx.fill();
  ctx.shadowColor = "transparent";

  ctx.save();
  roundRect(ctx, originX, originY, boardW, boardH, 16);
  ctx.clip();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if ((x + y) % 2 === 0) continue;
      ctx.fillStyle = "rgba(255,255,255,0.025)";
      ctx.fillRect(originX + x * cellSize, originY + y * cellSize, cellSize, cellSize);
    }
  }
  ctx.restore();

  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 2;
  roundRect(ctx, originX, originY, boardW, boardH, 16);
  ctx.stroke();
  ctx.restore();
}

export function drawFood(ctx: CanvasRenderingContext2D, food: Point[], layout: BoardLayout) {
  const pulse = 0.9 + 0.1 * Math.sin(performance.now() / 220);
  const r = layout.cellSize * 0.36 * pulse;
  for (const f of food) {
    const c = cellCenter(layout, f);
    ctx.save();
    ctx.translate(c.x, c.y);

    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(1.5, r * 0.55, r * 0.8, r * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#dc2626";
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.ellipse(-r * 0.32, -r * 0.32, r * 0.32, r * 0.2, -0.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#5c3d21";
    ctx.lineWidth = Math.max(1, r * 0.18);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.9);
    ctx.lineTo(0, -r * 1.3);
    ctx.stroke();
    ctx.fillStyle = "#16a34a";
    ctx.beginPath();
    ctx.ellipse(r * 0.35, -r * 1.15, r * 0.42, r * 0.24, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** Perpendicular sine wave along the body, amplitude tapering to zero at
 * the head so the head itself stays put on the grid path while everything
 * behind it slithers — a frozen (dead) snake gets no wave at all. */
function slitherPoints(pts: Point[], cellSize: number, alive: boolean): Point[] {
  if (!alive || pts.length < 2) return pts;
  const t = performance.now() / 1000;
  return pts.map((p, i) => {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const tlen = Math.hypot(tx, ty) || 1;
    const nx = -ty / tlen;
    const ny = tx / tlen;
    const amp = Math.min(1, i / 2) * cellSize * 0.16;
    const wave = Math.sin(t * 6 - i * 1.1) * amp;
    return { x: p.x + nx * wave, y: p.y + ny * wave };
  });
}

export function drawSnake(ctx: CanvasRenderingContext2D, rs: RenderSnake, layout: BoardLayout) {
  const cs = layout.cellSize;
  const pts = rs.segments.map((p) => cellCenter(layout, p));
  const wavyPts = slitherPoints(pts, cs, rs.alive);
  const bodyR = cs * 0.42;
  const alpha = rs.alive ? 1 : 0.45;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Body: a rounded "tube" traced through every segment center, drawn
  // beneath the per-segment scale highlights so joints look continuous
  // instead of a row of separate circles.
  if (wavyPts.length > 1) {
    ctx.strokeStyle = rs.color;
    ctx.lineWidth = bodyR * 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(wavyPts[0].x, wavyPts[0].y);
    for (let i = 1; i < wavyPts.length; i++) ctx.lineTo(wavyPts[i].x, wavyPts[i].y);
    ctx.stroke();
  }

  // Subtle scale bands along the body for a "toy" texture.
  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  ctx.lineWidth = 1.5;
  for (let i = 1; i < wavyPts.length; i++) {
    ctx.beginPath();
    ctx.arc(wavyPts[i].x, wavyPts[i].y, bodyR * 0.55, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Head, drawn last so it sits on top of the neck segment. Anchored at the
  // un-waved grid position (matches wavyPts[0], since amplitude is zero at
  // i=0) so eyes/label/accessory never jitter.
  const head = pts[0];
  ctx.fillStyle = rs.color;
  ctx.beginPath();
  ctx.arc(head.x, head.y, bodyR * 1.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const facing = dirAngle(rs.dir);
  const eyeOffset = bodyR * 0.5;
  const eyeForward = bodyR * 0.45;
  for (const side of [-1, 1] as const) {
    const perp = facing + (Math.PI / 2) * side;
    const ex = head.x + Math.cos(facing) * eyeForward + Math.cos(perp) * eyeOffset;
    const ey = head.y + Math.sin(facing) * eyeForward + Math.sin(perp) * eyeOffset;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(ex, ey, bodyR * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rs.alive ? "#111318" : "#7a1f1f";
    ctx.beginPath();
    ctx.arc(ex + Math.cos(facing) * bodyR * 0.1, ey + Math.sin(facing) * bodyR * 0.1, bodyR * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }

  drawAccessory(ctx, rs.accessory, head, bodyR);

  ctx.restore();

  // Name/score label above the head, always fully opaque so a dead snake's
  // tag stays legible.
  ctx.save();
  ctx.font = `${Math.max(10, cs * 0.5)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillStyle = rs.isLocal ? "#fde68a" : "rgba(255,255,255,0.92)";
  ctx.fillText(`${rs.label} · ${rs.score}`, head.x, head.y - bodyR * 1.6 - 4);
  ctx.restore();
}

/** A fixed screen-space position on the head, deliberately NOT rotated by
 * travel direction: rotating the artwork itself by heading looked fine
 * moving right/left but turned the crown on its side ("perpendicular")
 * whenever the snake faced up or down, since a crown's spikes have no
 * inherent "forward" to align with a top-down view's direction of travel.
 * Anchored snugly against the head (slight overlap) so it reads as worn
 * rather than floating above it. */
function drawAccessory(ctx: CanvasRenderingContext2D, accessory: Accessory | undefined, head: Point, bodyR: number) {
  if (!accessory || accessory === "none") return;
  ctx.save();
  if (accessory === "crown") {
    ctx.translate(head.x, head.y - bodyR * 0.85);
    const w = bodyR * 1.3;
    const h = bodyR * 0.75;
    ctx.fillStyle = "#facc15";
    ctx.beginPath();
    ctx.moveTo(-w / 2, h * 0.3);
    ctx.lineTo(-w / 2, -h * 0.1);
    ctx.lineTo(-w / 4, h * 0.15);
    ctx.lineTo(0, -h * 0.55);
    ctx.lineTo(w / 4, h * 0.15);
    ctx.lineTo(w / 2, -h * 0.1);
    ctx.lineTo(w / 2, h * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(120,80,10,0.6)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.arc(0, -h * 0.32, bodyR * 0.14, 0, Math.PI * 2);
    ctx.fill();
  } else if (accessory === "clip") {
    ctx.translate(head.x + bodyR * 0.5, head.y - bodyR * 0.5);
    ctx.rotate(-0.5);
    const s = bodyR * 0.5;
    ctx.fillStyle = "#f472b6";
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(side * s, -s * 0.65);
      ctx.lineTo(side * s, s * 0.65);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "#db2777";
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.32, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function dirAngle(dir: Dir): number {
  switch (dir) {
    case "up":
      return -Math.PI / 2;
    case "down":
      return Math.PI / 2;
    case "left":
      return Math.PI;
    case "right":
      return 0;
  }
}

export function drawDeathEffects(ctx: CanvasRenderingContext2D, deaths: DeathEvent[], elapsedMs: number, layout: BoardLayout) {
  for (const d of deaths) {
    const age = elapsedMs - d.atMs;
    const t = Math.max(0, Math.min(1, age / 600));
    if (t >= 1) continue;
    const c = cellCenter(layout, d);
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.globalAlpha = 1 - t;
    const spikes = 8;
    const outer = layout.cellSize * (0.4 + t * 1.4);
    const inner = layout.cellSize * (0.15 + t * 0.3);
    ctx.fillStyle = "#f87171";
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = (i / (spikes * 2)) * Math.PI * 2;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
