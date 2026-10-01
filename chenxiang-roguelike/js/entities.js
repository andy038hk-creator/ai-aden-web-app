/**
 * Entities: player (沉香), enemies (天兵), boss (二郎神), projectiles, VFX.
 */
import { dist, normalize, clamp } from './iso.js';

export function createPlayer(x, y) {
  return {
    type: 'player',
    name: '沉香',
    x, y,
    radius: 0.35,
    maxHp: 6,
    hp: 6,
    speed: 4.2,
    facing: { x: 1, y: 0 },
    // Melee
    meleeDamage: 1,
    meleeRange: 1.35,
    meleeArc: Math.PI * 0.85,
    meleeCd: 0,
    meleeCdMax: 0.38,
    meleeActive: 0,       // remaining swing duration
    meleeDuration: 0.18,
    // Lantern
    lanternCd: 0,
    lanternCdMax: 2.4,
    lanternDamage: 1.5,
    lanternRange: 2.6,
    // Dodge / i-frames
    iframe: 0,
    dashTimer: 0,
    dashVel: { x: 0, y: 0 },
    // Boons
    flags: {
      lingeringFlame: false,
      lanternHeal: false,
      castDash: false,
    },
    boons: [], // ids
    alive: true,
    hitFlash: 0,
    kb: 0,
    kx: 0,
    ky: 0,
    hurtT: 0,
    hurtFrom: null,
    hurtLabel: '',
    lastHit: null,
  };
}

export function createMeleeSoldier(x, y, opts = {}) {
  const hp = opts.hp ?? 3;
  return {
    type: 'melee',
    name: opts.name || '天兵',
    en: opts.en || 'Heavenly Soldier',
    x, y,
    radius: 0.32,
    maxHp: hp,
    hp,
    speed: opts.speed ?? 2.4,
    damage: opts.damage ?? 1,
    attackCd: opts.attackCd ?? 0,
    attackCdMax: opts.attackCdMax ?? 1.1,
    attackRange: opts.attackRange ?? 0.85,
    windupMax: opts.windupMax ?? 0,
    winding: 0,
    trainer: !!opts.trainer,
    color: opts.trainer ? '#5c4048' : '#6a3038',
    accent: '#c42b2b',
    alive: true,
    hitFlash: 0,
    kb: 0,
    kx: 0,
    ky: 0,
    dying: 0,
  };
}

export function createRangedSoldier(x, y, opts = {}) {
  const hp = opts.hp ?? 2;
  return {
    type: 'ranged',
    name: opts.name || '天弓',
    en: opts.en || 'Sky Archer',
    x, y,
    radius: 0.3,
    maxHp: hp,
    hp,
    speed: opts.speed ?? 1.6,
    damage: opts.damage ?? 1,
    attackCd: opts.attackCd ?? (0.5 + Math.random()),
    attackCdMax: opts.attackCdMax ?? 1.8,
    preferDist: opts.preferDist ?? 4.5,
    shotSpeed: opts.shotSpeed ?? 5.5,
    color: '#3a4a6a',
    accent: '#d4a017',
    alive: true,
    hitFlash: 0,
    kb: 0,
    kx: 0,
    ky: 0,
    dying: 0,
  };
}

export function createErlang(x, y) {
  return {
    type: 'boss',
    name: '二郎神',
    en: 'Erlang Shen',
    x, y,
    radius: 0.55,
    maxHp: 28,
    hp: 28,
    speed: 2.0,
    damage: 1,
    phase: 0,          // attack pattern index
    phaseTimer: 1.5,
    attackCd: 0,
    spearCd: 0,
    color: '#4a1a2a',
    accent: '#d4a017',
    alive: true,
    hitFlash: 0,
    kb: 0,
    kx: 0,
    ky: 0,
    dying: 0,
    dog: createDog(x + 1.2, y + 0.4),
  };
}

function createDog(x, y) {
  return {
    type: 'dog',
    name: '哮天犬',
    en: 'Howling Celestial Dog',
    x, y,
    radius: 0.28,
    maxHp: 8,
    hp: 8,
    speed: 3.6,
    damage: 1,
    attackCd: 0,
    attackCdMax: 0.9,
    attackRange: 0.7,
    color: '#2a2030',
    accent: '#8b1a1a',
    alive: true,
    hitFlash: 0,
    kb: 0,
    kx: 0,
    ky: 0,
    dying: 0,
  };
}

export function createProjectile(x, y, vx, vy, damage, owner, color, life = 2.5, radius = 0.18, source = null) {
  return {
    type: 'projectile',
    x, y, vx, vy,
    damage,
    owner, // 'enemy' | 'player'
    color,
    life,
    radius,
    source,
    alive: true,
  };
}

export function createFlame(x, y, duration = 2.2, radius = 0.7) {
  return {
    type: 'flame',
    x, y,
    radius,
    life: duration,
    maxLife: duration,
    damage: 0.4,
    tick: 0,
    alive: true,
  };
}

export function createVfx(kind, x, y, life, extra = {}) {
  return { type: 'vfx', kind, x, y, life, maxLife: life, alive: true, ...extra };
}

/** Keep entity inside room bounds (world coords, open floor). */
export function clampToRoom(e, room) {
  const m = 0.4;
  e.x = clamp(e.x, m, room.w - m);
  e.y = clamp(e.y, m, room.h - m);
}

/** Simple steering toward a target. */
export function moveToward(e, tx, ty, dt, speedMul = 1) {
  const n = normalize(tx - e.x, ty - e.y);
  e.x += n.x * e.speed * speedMul * dt;
  e.y += n.y * e.speed * speedMul * dt;
  return n;
}

export function moveAway(e, tx, ty, dt, speedMul = 1) {
  return moveToward(e, e.x - (tx - e.x), e.y - (ty - e.y), dt, speedMul);
}

export { dist, normalize };
