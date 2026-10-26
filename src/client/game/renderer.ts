import { CLEAR_DELAY, COLS, HIDDEN_ROWS, ROWS, SHAPES, VISIBLE_ROWS, type Game, type PieceType } from '../../engine';

/** ブロックごとのネオンカラー（オリジナル配色） */
export const PIECE_COLORS: Record<number, string> = {
  1: '#22e4ff', // I
  2: '#ffe14d', // O
  3: '#c56bff', // T
  4: '#3dff8f', // S
  5: '#ff3d71', // Z
  6: '#4d7dff', // J
  7: '#ff9a3d', // L
};

/** 発光付きブロックのスプライトを事前に描いておく（毎フレームの shadowBlur は重いため） */
const spriteCache = new Map<string, HTMLCanvasElement>();

function blockSprite(color: string, size: number, dpr: number, variant: 'solid' | 'ghost'): HTMLCanvasElement {
  const key = `${color}|${size}|${dpr}|${variant}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;
  const pad = Math.ceil(size * 0.5);
  const c = document.createElement('canvas');
  c.width = Math.ceil((size + pad * 2) * dpr);
  c.height = c.width;
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const x = pad + 1;
  const y = pad + 1;
  const s = size - 2;
  const r = Math.max(2, size * 0.14);

  if (variant === 'ghost') {
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = color;
    ctx.shadowBlur = size * 0.35;
    roundRect(ctx, x + 1, y + 1, s - 2, s - 2, r);
    ctx.stroke();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = color;
    ctx.fill();
  } else {
    ctx.shadowColor = color;
    ctx.shadowBlur = size * 0.55;
    const grad = ctx.createLinearGradient(x, y, x + s, y + s);
    grad.addColorStop(0, lighten(color, 0.45));
    grad.addColorStop(0.5, color);
    grad.addColorStop(1, darken(color, 0.35));
    ctx.fillStyle = grad;
    roundRect(ctx, x, y, s, s, r);
    ctx.fill();
    ctx.shadowBlur = 0;
    // 内側のハイライト
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    roundRect(ctx, x + 2.5, y + 2.5, s - 5, s - 5, r * 0.6);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(x + s * 0.2, y + s * 0.16, s * 0.35, Math.max(1.5, s * 0.08));
  }
  spriteCache.set(key, c);
  return c;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}
const lighten = (hex: string, a: number) => shade(hex, a);
const darken = (hex: string, a: number) => shade(hex, -a);

export function drawBlock(
  ctx: CanvasRenderingContext2D,
  type: number,
  px: number,
  py: number,
  size: number,
  dpr: number,
  variant: 'solid' | 'ghost' = 'solid',
): void {
  const sprite = blockSprite(PIECE_COLORS[type] ?? '#ffffff', size, dpr, variant);
  const pad = Math.ceil(size * 0.5);
  ctx.drawImage(sprite, px - pad, py - pad, sprite.width / dpr, sprite.height / dpr);
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

export interface RenderState {
  particles: Particle[];
  /** 画面の揺れ（ハードドロップ時） */
  shake: number;
}

/** メインフィールドを描画する */
export function drawBoard(
  ctx: CanvasRenderingContext2D,
  game: Game,
  cell: number,
  dpr: number,
  fx: RenderState,
  showGhost: boolean,
): void {
  const w = COLS * cell;
  const h = VISIBLE_ROWS * cell;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (fx.shake > 0.1) {
    ctx.translate(0, fx.shake);
    fx.shake *= 0.82;
  } else fx.shake = 0;

  // 背景グリッド
  ctx.fillStyle = 'rgba(8, 10, 30, 0.85)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(80, 120, 255, 0.09)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 1; x < COLS; x++) {
    ctx.moveTo(x * cell + 0.5, 0);
    ctx.lineTo(x * cell + 0.5, h);
  }
  for (let y = 1; y < VISIBLE_ROWS; y++) {
    ctx.moveTo(0, y * cell + 0.5);
    ctx.lineTo(w, y * cell + 0.5);
  }
  ctx.stroke();

  const clearingRows = new Set(game.clearing?.rows ?? []);
  const clearProgress = game.clearing ? 1 - game.clearing.timer / CLEAR_DELAY : 0;

  // 固定済みブロック
  for (let y = HIDDEN_ROWS; y < ROWS; y++) {
    const vy = (y - HIDDEN_ROWS) * cell;
    if (clearingRows.has(y)) continue;
    for (let x = 0; x < COLS; x++) {
      const t = game.cell(x, y);
      if (t) drawBlock(ctx, t, x * cell, vy, cell, dpr);
    }
  }

  // ライン消去エフェクト：白く光って中央から消える
  if (game.clearing) {
    for (const y of clearingRows) {
      const vy = (y - HIDDEN_ROWS) * cell;
      const shrink = Math.min(1, clearProgress * 1.4);
      const half = (w / 2) * (1 - shrink);
      for (let x = 0; x < COLS; x++) {
        const t = game.cell(x, y);
        const cx = x * cell + cell / 2;
        if (t && Math.abs(cx - w / 2) <= half + cell / 2) drawBlock(ctx, t, x * cell, vy, cell, dpr);
      }
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - clearProgress) * 0.9;
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#7df9ff';
      ctx.shadowBlur = cell;
      ctx.fillRect(w / 2 - half, vy + cell * 0.1, half * 2, cell * 0.8);
      ctx.restore();
    }
  }

  // ゴーストとアクティブブロック
  const p = game.active;
  if (p) {
    const cells = SHAPES[p.type][p.rot]!;
    if (showGhost) {
      const gy = game.ghostY();
      if (gy !== p.y) {
        for (const [cx, cy] of cells) {
          const y = gy + cy - HIDDEN_ROWS;
          if (y >= 0) drawBlock(ctx, p.type, (p.x + cx) * cell, y * cell, cell, dpr, 'ghost');
        }
      }
    }
    for (const [cx, cy] of cells) {
      const y = p.y + cy - HIDDEN_ROWS;
      if (y >= 0) drawBlock(ctx, p.type, (p.x + cx) * cell, y * cell, cell, dpr);
    }
  }

  // パーティクル
  ctx.globalCompositeOperation = 'lighter';
  fx.particles = fx.particles.filter((pt) => pt.life > 0);
  for (const pt of fx.particles) {
    pt.x += pt.vx;
    pt.y += pt.vy;
    pt.vy += 0.12;
    pt.vx *= 0.98;
    pt.life -= 0.022;
    ctx.globalAlpha = Math.max(0, pt.life);
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x, pt.y, 3, 3);
  }
  ctx.restore();
}

/** ライン消去時の火花を生成する */
export function spawnClearParticles(fx: RenderState, game: Game, rows: number[], cell: number): void {
  for (const y of rows) {
    const vy = (y - HIDDEN_ROWS) * cell + cell / 2;
    for (let x = 0; x < COLS; x++) {
      const color = PIECE_COLORS[game.cell(x, y)] ?? '#ffffff';
      for (let k = 0; k < 4; k++) {
        fx.particles.push({
          x: x * cell + cell / 2,
          y: vy,
          vx: (Math.random() - 0.5) * 7,
          vy: (Math.random() - 0.9) * 5,
          life: 0.7 + Math.random() * 0.4,
          color,
        });
      }
    }
  }
  if (fx.particles.length > 900) fx.particles.splice(0, fx.particles.length - 900);
}

/** NEXT / HOLD 用の小さなプレビュー */
export function drawPreview(
  ctx: CanvasRenderingContext2D,
  type: PieceType | null,
  width: number,
  height: number,
  dpr: number,
  dimmed = false,
): void {
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (type) {
    const cells = SHAPES[type][0]!;
    const xs = cells.map((c) => c[0]);
    const ys = cells.map((c) => c[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const size = Math.floor(Math.min(width / 4.6, height / 2.8));
    const ox = (width - (maxX - minX + 1) * size) / 2;
    const oy = (height - (maxY - minY + 1) * size) / 2;
    if (dimmed) ctx.globalAlpha = 0.35;
    for (const [cx, cy] of cells) drawBlock(ctx, type, ox + (cx - minX) * size, oy + (cy - minY) * size, size, dpr);
  }
  ctx.restore();
}
