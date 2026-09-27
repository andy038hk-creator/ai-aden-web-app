/**
 * Combat: melee arc, lantern cast, damage application.
 */
import { dist, normalize } from './iso.js';
import { createProjectile, createFlame, createVfx } from './entities.js';

/** Start a melee swing. Facing should already be set. */
export function startMelee(player) {
  if (player.meleeCd > 0 || player.meleeActive > 0) return false;
  player.meleeActive = player.meleeDuration;
  player.meleeCd = player.meleeCdMax;
  return true;
}

/**
 * Check melee hits against enemies list. Returns hit count.
 * facing = unit vector; arc = total radians.
 */
export function resolveMelee(player, enemies, vfx) {
  let hits = 0;
  const half = player.meleeArc / 2;
  const faceAng = Math.atan2(player.facing.y, player.facing.x);

  for (const e of enemies) {
    if (!e.alive) continue;
    const d = dist(player, e);
    if (d > player.meleeRange + e.radius) continue;
    const ang = Math.atan2(e.y - player.y, e.x - player.x);
    let diff = ang - faceAng;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) <= half) {
      damageEntity(e, player.meleeDamage, vfx);
      hits++;
    }
  }
  return hits;
}

/** Fire 寶蓮燈 radial burst (and optional upgrades). */
export function castLantern(player, enemies, projectiles, flames, vfx) {
  if (player.lanternCd > 0) return false;
  player.lanternCd = player.lanternCdMax;

  // Radial burst — 8 bolts outward
  const bolts = 8;
  for (let i = 0; i < bolts; i++) {
    const a = (i / bolts) * Math.PI * 2;
    const n = { x: Math.cos(a), y: Math.sin(a) };
    projectiles.push(
      createProjectile(
        player.x, player.y,
        n.x * 6.5, n.y * 6.5,
        player.lanternDamage,
        'player',
        '#3ecf9a',
        0.55,
        0.22
      )
    );
  }

  // Also a directed stronger beam toward facing
  const f = player.facing;
  projectiles.push(
    createProjectile(
      player.x, player.y,
      f.x * 9, f.y * 9,
      player.lanternDamage * 1.4,
      'player',
      '#d4a017',
      0.7,
      0.28
    )
  );

  vfx.push(createVfx('burst', player.x, player.y, 0.35, { color: '#3ecf9a', r: player.lanternRange }));

  if (player.flags.lingeringFlame) {
    flames.push(createFlame(player.x, player.y, 2.4, 0.85));
  }
  if (player.flags.lanternHeal) {
    player.hp = Math.min(player.maxHp, player.hp + 1);
    vfx.push(createVfx('heal', player.x, player.y, 0.5));
  }
  if (player.flags.castDash) {
    player.dashTimer = 0.18;
    player.dashVel = { x: f.x * 14, y: f.y * 14 };
    player.iframe = Math.max(player.iframe, 0.28);
  }

  // Instant radial damage in close range
  for (const e of enemies) {
    if (!e.alive) continue;
    if (dist(player, e) <= player.lanternRange * 0.55 + e.radius) {
      damageEntity(e, player.lanternDamage * 0.6, vfx);
    }
  }
  return true;
}

export function damageEntity(e, amount, vfx) {
  if (!e.alive) return;
  e.hp -= amount;
  e.hitFlash = 0.12;
  if (vfx) vfx.push(createVfx('hit', e.x, e.y, 0.2, { color: '#c42b2b' }));
  if (e.hp <= 0) {
    e.hp = 0;
    e.alive = false;
    if (vfx) vfx.push(createVfx('death', e.x, e.y, 0.45, { color: e.accent || '#c42b2b' }));
  }
}

export function damagePlayer(player, amount, vfx) {
  if (!player.alive || player.iframe > 0) return false;
  player.hp -= amount;
  player.iframe = 0.55;
  if (vfx) vfx.push(createVfx('hurt', player.x, player.y, 0.3));
  if (player.hp <= 0) {
    player.hp = 0;
    player.alive = false;
  }
  return true;
}

/** Tick projectiles; return list of collisions handled. */
export function updateProjectiles(projectiles, player, enemies, vfx, dt) {
  for (const p of projectiles) {
    if (!p.alive) continue;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) {
      p.alive = false;
      continue;
    }
    if (p.owner === 'enemy') {
      if (player.alive && dist(p, player) < p.radius + player.radius) {
        damagePlayer(player, p.damage, vfx);
        p.alive = false;
      }
    } else if (p.owner === 'player') {
      for (const e of enemies) {
        if (!e.alive) continue;
        if (dist(p, e) < p.radius + e.radius) {
          damageEntity(e, p.damage, vfx);
          p.alive = false;
          break;
        }
      }
    }
  }
}

export function updateFlames(flames, enemies, vfx, dt) {
  for (const f of flames) {
    if (!f.alive) continue;
    f.life -= dt;
    f.tick -= dt;
    if (f.life <= 0) {
      f.alive = false;
      continue;
    }
    if (f.tick <= 0) {
      f.tick = 0.35;
      for (const e of enemies) {
        if (!e.alive) continue;
        if (dist(f, e) < f.radius + e.radius) {
          damageEntity(e, f.damage, vfx);
        }
      }
    }
  }
}
