/**
 * Isometric helpers — ground (x,y) ↔ screen, diamond tiles.
 *
 * Gameplay lives on the ground plane. World X and Y are the diamond
 * edges of the floor (classic 2:1 iso), not screen pixels:
 *   +X → screen southeast, down-right along a tile edge
 *   +Y → screen southwest, down-left along a tile edge
 * Drawing is the only step that projects to the screen.
 *
 * Keyboard axes sit on those edges: D/Right = +X, A/Left = −X,
 * S/Down = +Y, W/Up = −Y. Two keys combine on the ground and
 * normalize there, so a diagonal heads toward a diamond corner.
 */

export const TILE_W = 64;
export const TILE_H = 32;

/** World → screen (origin at canvas center-ish, caller offsets). */
export function worldToScreen(wx, wy) {
  return {
    x: (wx - wy) * (TILE_W / 2),
    y: (wx + wy) * (TILE_H / 2),
  };
}

/** Screen → world. Inverse of worldToScreen (mouse aim, same ground plane). */
export function screenToWorld(sx, sy) {
  const a = sx / (TILE_W / 2);
  const b = sy / (TILE_H / 2);
  return {
    x: (a + b) / 2,
    y: (b - a) / 2,
  };
}

/** Draw a filled isometric diamond tile. */
export function drawTile(ctx, wx, wy, ox, oy, fill, stroke) {
  const { x, y } = worldToScreen(wx, wy);
  const cx = ox + x;
  const cy = oy + y;
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy - hh);
  ctx.lineTo(cx + hw, cy);
  ctx.lineTo(cx, cy + hh);
  ctx.lineTo(cx - hw, cy);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/** Draw a standing "pillar" / wall block on a tile. */
export function drawPillar(ctx, wx, wy, ox, oy, h, fill, topFill) {
  const { x, y } = worldToScreen(wx, wy);
  const cx = ox + x;
  const cy = oy + y;
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;

  // Left face
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(cx - hw, cy);
  ctx.lineTo(cx, cy + hh);
  ctx.lineTo(cx, cy + hh - h);
  ctx.lineTo(cx - hw, cy - h);
  ctx.closePath();
  ctx.fill();

  // Right face (darker)
  ctx.fillStyle = shade(fill, 0.7);
  ctx.beginPath();
  ctx.moveTo(cx + hw, cy);
  ctx.lineTo(cx, cy + hh);
  ctx.lineTo(cx, cy + hh - h);
  ctx.lineTo(cx + hw, cy - h);
  ctx.closePath();
  ctx.fill();

  // Top
  ctx.fillStyle = topFill || shade(fill, 1.15);
  ctx.beginPath();
  ctx.moveTo(cx, cy - hh - h);
  ctx.lineTo(cx + hw, cy - h);
  ctx.lineTo(cx, cy + hh - h);
  ctx.lineTo(cx - hw, cy - h);
  ctx.closePath();
  ctx.fill();
}

function shade(hex, factor) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const r = Math.min(255, Math.round(parseInt(m[1], 16) * factor));
  const g = Math.min(255, Math.round(parseInt(m[2], 16) * factor));
  const b = Math.min(255, Math.round(parseInt(m[3], 16) * factor));
  return `rgb(${r},${g},${b})`;
}

/** Distance between two world points. */
export function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/** Normalize a 2D vector. Zero input becomes {0,0}. */
export function normalize(dx, dy) {
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/**
 * Unit vector on the ground. Returns null when there is no direction
 * so aim / steering can keep the previous facing.
 */
export function groundDir(dx, dy) {
  if (Math.hypot(dx, dy) < 1e-8) return null;
  return normalize(dx, dy);
}

/**
 * Keyboard cardinals → ground-space unit vector along the floor edges.
 * `north` is W/Up, `east` is D/Right. Returns null when nothing is held.
 * Diagonals are normalized in ground space (not screen pixels).
 */
export function groundDirFromKeys({ north = false, south = false, west = false, east = false } = {}) {
  const gx = (east ? 1 : 0) - (west ? 1 : 0);
  const gy = (south ? 1 : 0) - (north ? 1 : 0);
  return groundDir(gx, gy);
}

/**
 * Ground-space unit vector from a world point toward a screen point.
 * `sx`/`sy` are pixels relative to the same origin as worldToScreen.
 */
export function groundAim(originX, originY, sx, sy) {
  const w = screenToWorld(sx, sy);
  return groundDir(w.x - originX, w.y - originY);
}

/** Unit ground vector from a ground-plane angle (0 = +X, screen southeast). */
export function groundDirFromAngle(angle) {
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/** Scale a ground direction by a speed in tiles / second. */
export function groundVelocity(dir, speed) {
  return { x: dir.x * speed, y: dir.y * speed };
}

/** Integrate a ground-space velocity over dt (tiles). */
export function integrateGround(vx, vy, dt) {
  return { x: vx * dt, y: vy * dt };
}

/** Clamp value. */
export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Random int [lo, hi] inclusive. */
export function randInt(lo, hi) {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/** Pick n unique random items from array. */
export function pickN(arr, n) {
  const copy = arr.slice();
  const out = [];
  while (out.length < n && copy.length) {
    const i = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(i, 1)[0]);
  }
  return out;
}
