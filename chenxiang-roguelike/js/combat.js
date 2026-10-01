/**
 * Combat: melee arc, lantern cast, damage application.
 * `feel` is an optional juice bus: { note(kind), hitStop(seconds) }.
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

const HURT_KIND = {
  melee: '近戰',
  arrow: '箭',
  bite: '撲咬',
  slam: '震地',
  spear: '槍',
  strike: '近身',
  ring: '槍環',
};

function hurtLabel(source) {
  if (!source?.name) return '';
  const kind = HURT_KIND[source.kind];
  return kind ? `${source.name} · ${kind}` : source.name;
}

function dmgText(amount) {
  const n = Math.round(amount * 10) / 10;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Check melee hits against enemies list. Returns hit count.
 * facing = unit vector; arc = total radians.
 */
export function resolveMelee(player, enemies, vfx, feel) {
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
      damageEntity(e, player.meleeDamage, vfx, {
        dir: normalize(e.x - player.x, e.y - player.y),
        feel,
        mag: 9,
      });
      hits++;
    }
  }
  return hits;
}

/** Fire 寶蓮燈 radial burst (and optional upgrades). */
export function castLantern(player, enemies, projectiles, flames, vfx, feel) {
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
      damageEntity(e, player.lanternDamage * 0.6, vfx, {
        dir: normalize(e.x - player.x, e.y - player.y),
        feel,
        mag: 6,
      });
    }
  }
  return true;
}

export function damageEntity(e, amount, vfx, hit) {
  if (!e.alive) return false;
  const killed = e.hp - amount <= 0;
  e.hp -= amount;
  e.hitFlash = killed ? 0.22 : 0.16;
  if (hit?.dir && !hit.quiet) {
    const mag = (hit.mag ?? 7) * (killed ? 1.35 : 1);
    e.kx = hit.dir.x * mag;
    e.ky = hit.dir.y * mag;
    e.kb = killed ? 0.16 : 0.12;
  }
  if (vfx) {
    vfx.push(createVfx('hit', e.x, e.y, 0.16, { color: '#fff6df' }));
    vfx.push(createVfx('dmg', e.x + (Math.random() - 0.5) * 0.35, e.y, 0.7, {
      text: dmgText(amount),
      color: killed ? '#ffd76a' : '#fff1cf',
      big: killed || amount >= 1.5,
    }));
  }
  if (killed) {
    e.hp = 0;
    e.alive = false;
    e.dying = 0.55;
    e.deathDur = 0.55;
    if (vfx) {
      vfx.push(createVfx('death', e.x, e.y, 0.55, {
        color: e.accent || '#c42b2b',
        r: e.type === 'boss' ? 2.4 : 1.15,
      }));
    }
  } else {
    e.hp = Math.max(0, e.hp);
  }
  if (hit?.feel && !hit.quiet) {
    hit.feel.note(killed ? 'kill' : 'hit');
  }
  return true;
}

export function damagePlayer(player, amount, vfx, source, feel) {
  if (!player.alive || player.iframe > 0) return false;
  player.hp -= amount;
  player.iframe = 0.55;
  player.hitFlash = 0.2;
  player.hurtT = 0.8;
  player.hurtLabel = hurtLabel(source);
  if (source && source.x != null) {
    player.hurtFrom = { x: source.x, y: source.y };
    const n = normalize(player.x - source.x, player.y - source.y);
    player.kx = n.x * 6.5;
    player.ky = n.y * 6.5;
    player.kb = 0.1;
  }
  if (source && source.name) {
    player.lastHit = {
      name: source.name,
      en: source.en || '',
      kind: source.kind || '',
    };
  }
  if (vfx) {
    vfx.push(createVfx('hurt', player.x, player.y, 0.32, { color: '#c42b2b' }));
    vfx.push(createVfx('dmg', player.x, player.y, 0.75, {
      text: `-${dmgText(amount)}`,
      color: '#ff6d6d',
      big: true,
    }));
  }
  if (feel) {
    feel.note('hurt');
    if (player.hp <= 0) feel.hitStop(0.24);
  }
  if (player.hp <= 0) {
    player.hp = 0;
    player.alive = false;
  }
  return true;
}

/** Tick projectiles; return list of collisions handled. */
export function updateProjectiles(projectiles, player, enemies, vfx, dt, feel) {
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
        const src = p.source || {};
        damagePlayer(player, p.damage, vfx, {
          name: src.name || '飛彈',
          en: src.en || 'Projectile',
          kind: src.kind || 'arrow',
          x: src.x != null ? src.x : player.x - p.vx,
          y: src.y != null ? src.y : player.y - p.vy,
        }, feel);
        p.alive = false;
      }
    } else if (p.owner === 'player') {
      for (const e of enemies) {
        if (!e.alive) continue;
        if (dist(p, e) < p.radius + e.radius) {
          const dir = normalize(p.vx, p.vy);
          damageEntity(e, p.damage, vfx, { dir, feel, mag: 5.5 });
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
          // DoT: numbers + flash, no hit-stop spam.
          damageEntity(e, f.damage, vfx, { quiet: true });
        }
      }
    }
  }
}
