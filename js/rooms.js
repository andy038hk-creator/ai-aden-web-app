/**
 * Room layouts — isometric combat arenas.
 * Grid: walls around, open floor, spawn markers, exit pad.
 */
import { createMeleeSoldier, createRangedSoldier, createErlang } from './entities.js';
import { randInt } from './iso.js';

/** Floor tile kinds: 0 empty/void, 1 floor, 2 wall, 3 exit, 4 spawn-hint */
export function makeRoom(index, isBoss = false) {
  const w = isBoss ? 14 : 11;
  const h = isBoss ? 14 : 11;
  const tiles = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      row.push(edge ? 2 : 1);
    }
    tiles.push(row);
  }

  // Decorative pillars / obstacles (not on edges, not center)
  const pillars = [];
  if (!isBoss) {
    const layouts = [
      [[3, 3], [7, 3], [3, 7], [7, 7]],
      [[5, 2], [2, 5], [8, 5], [5, 8]],
      [[4, 4], [6, 6], [4, 6], [6, 4]],
    ];
    const L = layouts[index % layouts.length];
    for (const [px, py] of L) {
      if (tiles[py] && tiles[py][px] === 1) {
        tiles[py][px] = 2;
        pillars.push({ x: px, y: py });
      }
    }
  } else {
    // Boss arena — corner pillars only
    for (const [px, py] of [[3, 3], [10, 3], [3, 10], [10, 10]]) {
      tiles[py][px] = 2;
      pillars.push({ x: px, y: py });
    }
  }

  // Exit near north edge (high y for iso "back") — opens when cleared
  const exit = { x: Math.floor(w / 2), y: h - 2 };
  tiles[exit.y][exit.x] = 1;

  // Player spawn near south
  const playerSpawn = { x: w / 2, y: 2.5 };

  return {
    index,
    isBoss,
    w, h,
    tiles,
    pillars,
    exit,
    playerSpawn,
    exitOpen: false,
    cleared: false,
    label: isBoss ? '華山巔 · 二郎神' : `天庭走廊 · 第 ${index + 1} 室`,
  };
}

export function spawnEnemiesForRoom(room) {
  const enemies = [];
  if (room.isBoss) {
    const boss = createErlang(room.w / 2, room.h / 2 + 1.5);
    enemies.push(boss);
    if (boss.dog) enemies.push(boss.dog);
    return enemies;
  }

  const meleeCount = 2 + room.index;       // 2, 3, ...
  const rangedCount = 1 + Math.floor(room.index / 1); // 1, 2, ...

  const spots = openSpots(room).filter(
    (s) => Math.hypot(s.x - room.playerSpawn.x, s.y - room.playerSpawn.y) > 3.5
  );
  shuffle(spots);

  let si = 0;
  for (let i = 0; i < meleeCount && si < spots.length; i++, si++) {
    enemies.push(createMeleeSoldier(spots[si].x + 0.5, spots[si].y + 0.5));
  }
  for (let i = 0; i < rangedCount && si < spots.length; i++, si++) {
    enemies.push(createRangedSoldier(spots[si].x + 0.5, spots[si].y + 0.5));
  }
  return enemies;
}

function openSpots(room) {
  const spots = [];
  for (let y = 1; y < room.h - 1; y++) {
    for (let x = 1; x < room.w - 1; x++) {
      if (room.tiles[y][x] === 1) spots.push({ x, y });
    }
  }
  return spots;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Is world position blocked by a wall tile? */
export function isBlocked(room, wx, wy, radius = 0.3) {
  const checks = [
    [wx - radius, wy],
    [wx + radius, wy],
    [wx, wy - radius],
    [wx, wy + radius],
    [wx, wy],
  ];
  for (const [cx, cy] of checks) {
    const tx = Math.floor(cx);
    const ty = Math.floor(cy);
    if (ty < 0 || tx < 0 || ty >= room.h || tx >= room.w) return true;
    if (room.tiles[ty][tx] === 2) return true;
  }
  return false;
}

/** Try move entity with simple slide against walls. */
export function tryMove(e, dx, dy, room) {
  const nx = e.x + dx;
  const ny = e.y + dy;
  if (!isBlocked(room, nx, ny, e.radius)) {
    e.x = nx;
    e.y = ny;
    return;
  }
  if (!isBlocked(room, nx, e.y, e.radius)) {
    e.x = nx;
    return;
  }
  if (!isBlocked(room, e.x, ny, e.radius)) {
    e.y = ny;
  }
}

export { randInt };
