/**
 * Game state machine + update/render loop.
 * States: title | playing | reward | paused | win | lose
 */
import {
  worldToScreen, TILE_W, TILE_H, dist, clamp,
  groundDir, groundDirFromKeys, groundDirFromAngle, groundAim, groundVelocity, integrateGround,
} from './iso.js';
import { createPlayer, createProjectile, createVfx } from './entities.js';
import { startMelee, resolveMelee, castLantern, damagePlayer, updateProjectiles, updateFlames } from './combat.js';
import { makeRoom, spawnEnemiesForRoom, spawnRoom1Extra, tryMove } from './rooms.js';
import { rollRewardChoices } from './baxian.js';
import { UI } from './ui.js';
import { createSfx } from './audio.js';
import { drawPlayHUD, drawIntroHint, drawAimGuide, drawHurtOverlay } from './hud.js';

const TOTAL_COMBAT_ROOMS = 2; // then boss = room 3

export class Game {
  constructor(canvas, overlay) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = canvas.width;
    this.H = canvas.height;

    this.keys = Object.create(null);
    this.mouse = { x: 0, y: 0, downL: false, downR: false, worldX: 0, worldY: 0 };

    this.ui = new UI(overlay, (type, payload) => this.onUI(type, payload));
    this.sfx = createSfx();
    this._sfxQ = new Set();
    this.hitStop = 0;
    this.shake = 0;
    this.introT = 0;
    this.hintFade = 0;
    this.spawnQueue = [];
    this.feel = {
      note: (kind) => {
        this._sfxQ.add(kind);
        if (kind === 'hurt') {
          this.hitStop = Math.max(this.hitStop, 0.05);
          this.shake = Math.max(this.shake, 8);
        } else if (kind === 'kill') {
          this.hitStop = Math.max(this.hitStop, 0.072);
          this.shake = Math.max(this.shake, 6);
        } else if (kind === 'hit') {
          this.hitStop = Math.max(this.hitStop, 0.042);
          this.shake = Math.max(this.shake, 3.6);
        }
      },
      hitStop: (s) => {
        this.hitStop = Math.max(this.hitStop, s);
      },
    };
    this.state = 'title';
    this.player = null;
    this.room = null;
    this.enemies = [];
    this.projectiles = [];
    this.flames = [];
    this.vfx = [];
    this.roomIndex = 0;
    this.camera = { x: 0, y: 0 };
    this.meleeResolved = false;
    this._last = 0;
    this._raf = 0;

    this._bindInput();
    this.ui.showTitle();
  }

  onUI(type, payload) {
    this.sfx.unlock().then(() => {
      if (type === 'start' || type === 'restart' || type === 'pickBoon' || type === 'resume') {
        this.sfx.ui();
      }
    });
    if (type === 'start' || type === 'restart') this.startRun();
    else if (type === 'pickBoon') this.applyBoon(payload);
    else if (type === 'resume') this.resume();
  }

  startRun() {
    this.ui.clear();
    this.player = createPlayer(0, 0);
    this.roomIndex = 0;
    this.projectiles = [];
    this.flames = [];
    this.vfx = [];
    this.state = 'playing';
    this.enterRoom(0);
    this._last = performance.now();
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame((t) => this.loop(t));
  }

  enterRoom(index) {
    const isBoss = index >= TOTAL_COMBAT_ROOMS;
    this.room = makeRoom(index, isBoss);
    this.roomIndex = index;
    this.player.x = this.room.playerSpawn.x;
    this.player.y = this.room.playerSpawn.y;
    this.player.iframe = index === 0 ? 0.9 : 0.4;
    this.introT = 0;
    this.hintFade = 0;
    this.spawnQueue = [];
    this.hitStop = 0;
    this.shake = 0;
    this.enemies = spawnEnemiesForRoom(this.room);
    this.projectiles = [];
    this.flames = [];
    this.vfx = [];
    this.room.exitOpen = false;
    this.room.cleared = false;
    this.meleeResolved = false;
  }

  applyBoon(id) {
    const boon = UI.getBoon(id);
    if (!boon || !this.player) return;
    boon.apply(this.player);
    this.player.boons.push(id);
    this.ui.clear();
    this.state = 'playing';
    this.enterRoom(this.roomIndex + 1);
    this._last = performance.now();
  }

  resume() {
    this.ui.clear();
    this.state = 'playing';
    this._last = performance.now();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.ui.showPause();
  }

  /* ——— Input ——— */
  _bindInput() {
    const mapKey = (e, down) => {
      const k = e.key.toLowerCase();
      this.keys[k] = down;
      if (down) this.sfx.unlock();
      if (down && k === 'm' && !e.repeat) this.sfx.toggleMute();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'j', 'k', 'f'].includes(k)) {
        e.preventDefault();
      }
      if (down && k === 'escape') {
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused') this.resume();
      }
      if (down && this.state === 'playing') {
        if (k === ' ' || k === 'j') this.tryMelee();
        if (k === 'k' || k === 'f') this.tryCast();
      }
    };
    window.addEventListener('keydown', (e) => mapKey(e, true));
    window.addEventListener('keyup', (e) => mapKey(e, false));

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('mousedown', (e) => {
      this.sfx.unlock();
      if (this.state !== 'playing') return;
      if (e.button === 0) {
        this.mouse.downL = true;
        this.tryMelee();
      }
      if (e.button === 2) {
        this.mouse.downR = true;
        this.tryCast();
      }
    });
    this.canvas.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.downL = false;
      if (e.button === 2) this.mouse.downR = false;
    });
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.W / rect.width;
      const scaleY = this.H / rect.height;
      this.mouse.x = (e.clientX - rect.left) * scaleX;
      this.mouse.y = (e.clientY - rect.top) * scaleY;
      this.mouse.seen = true;
    });
  }

  tryMelee() {
    if (!this.player || !this.player.alive) return;
    this._aimFromMouse();
    if (startMelee(this.player)) {
      this.sfx.axe();
      this.meleeResolved = false;
      this.vfx.push(createVfx('swing', this.player.x, this.player.y, this.player.meleeDuration, {
        facing: { ...this.player.facing },
        arc: this.player.meleeArc,
        range: this.player.meleeRange,
      }));
    }
  }

  tryCast() {
    if (!this.player || !this.player.alive) return;
    this._aimFromMouse();
    if (castLantern(this.player, this.aliveEnemies(), this.projectiles, this.flames, this.vfx, this.feel)) {
      this.sfx.lantern();
    }
  }

  _aimFromMouse() {
    const p = this.player;
    const ox = this.W / 2 - this.camera.x;
    const oy = this.H / 2 - this.camera.y + 40;
    const n = groundAim(p.x, p.y, this.mouse.x - ox, this.mouse.y - oy);
    if (n) p.facing = n;
  }

  aliveEnemies() {
    return this.enemies.filter((e) => e.alive);
  }

  /* ——— Loop ——— */
  loop(t) {
    const dt = Math.min(0.05, (t - this._last) / 1000);
    this._last = t;
    if (this.state === 'playing') {
      this.update(dt);
      this.render();
    } else if (this.state === 'paused') {
      this.render();
    }
    this._raf = requestAnimationFrame((nt) => this.loop(nt));
  }

  update(dt) {
    this.flushSfx();
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 36);
    // Hit-stop freezes the sim; particles still play so the impact reads.
    if (this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - dt);
      this.decayVfx(dt);
      return;
    }

    const p = this.player;
    if (!p.alive) {
      this.finishLose();
      return;
    }

    // Cooldowns
    p.meleeCd = Math.max(0, p.meleeCd - dt);
    p.lanternCd = Math.max(0, p.lanternCd - dt);
    p.iframe = Math.max(0, p.iframe - dt);
    if (p.hitFlash) p.hitFlash = Math.max(0, p.hitFlash - dt);
    if (p.hurtT) p.hurtT = Math.max(0, p.hurtT - dt);

    this.tickIntro(dt);

    // Aim
    this._aimFromMouse();

    // Knockback, dash, then walk — all in ground space (diamond edges).
    if (p.kb > 0) {
      const step = integrateGround(p.kx, p.ky, dt);
      tryMove(p, step.x, step.y, this.room);
      p.kb = Math.max(0, p.kb - dt);
    } else if (p.dashTimer > 0) {
      p.dashTimer -= dt;
      const step = integrateGround(p.dashVel.x, p.dashVel.y, dt);
      tryMove(p, step.x, step.y, this.room);
    } else {
      // W/Up = −Y (NE edge), S/Down = +Y (SW edge),
      // A/Left = −X (NW edge), D/Right = +X (SE edge).
      const n = groundDirFromKeys({
        north: this.keys['w'] || this.keys['arrowup'],
        south: this.keys['s'] || this.keys['arrowdown'],
        west: this.keys['a'] || this.keys['arrowleft'],
        east: this.keys['d'] || this.keys['arrowright'],
      });
      if (n) {
        const step = groundVelocity(n, p.speed * dt);
        tryMove(p, step.x, step.y, this.room);
        if (p.meleeActive <= 0) p.facing = n;
      }
    }

    // Melee active window
    if (p.meleeActive > 0) {
      p.meleeActive -= dt;
      if (!this.meleeResolved && p.meleeActive <= p.meleeDuration * 0.55) {
        resolveMelee(p, this.enemies, this.vfx, this.feel);
        this.meleeResolved = true;
      }
      if (p.meleeActive < 0) p.meleeActive = 0;
    }

    // Enemies AI
    this.updateEnemies(dt);

    // Projectiles & flames
    updateProjectiles(this.projectiles, p, this.enemies, this.vfx, dt, this.feel);
    updateFlames(this.flames, this.enemies, this.vfx, dt);

    this.flushSfx();
    if (!p.alive) return;

    this.decayVfx(dt);
    this.projectiles = this.projectiles.filter((x) => x.alive);
    this.flames = this.flames.filter((x) => x.alive);
    this.enemies = this.enemies.filter((e) => e.alive || e.dying > 0);

    // Room clear — hold the exit while the Room 1 drill or its delayed spawns are pending
    const living = this.aliveEnemies();
    const wavePending = this.room.intro || this.spawnQueue.length > 0;
    if (!this.room.cleared && living.length === 0 && !wavePending) {
      this.room.cleared = true;
      this.room.exitOpen = true;
      this.vfx.push(createVfx('exitOpen', this.room.exit.x + 0.5, this.room.exit.y + 0.5, 0.8));
    }

    // Exit / win / reward
    if (this.room.exitOpen) {
      const ex = this.room.exit.x + 0.5;
      const ey = this.room.exit.y + 0.5;
      if (dist(p, { x: ex, y: ey }) < 0.85) {
        if (this.room.isBoss) {
          this.state = 'win';
          this.sfx.win();
          this.ui.showWin();
          return;
        }
        // Go to reward then next room
        this.state = 'reward';
        const choices = rollRewardChoices(this.player.boons);
        this.ui.showRewards(choices);
        return;
      }
    }

    // Camera follow
    const scr = worldToScreen(p.x, p.y);
    this.camera.x += (scr.x - this.camera.x) * Math.min(1, 8 * dt);
    this.camera.y += (scr.y - this.camera.y) * Math.min(1, 8 * dt);
  }

  tickIntro(dt) {
    if (!this.room || this.room.isBoss || this.room.index !== 0) return;
    if (this.room.intro) {
      this.introT += dt;
      const trainerUp = this.enemies.some((e) => e.alive && e.trainer);
      const release = (!trainerUp && this.introT >= 3.0) || this.introT >= 7.5;
      if (release) this.releaseIntro(trainerUp);
    } else if (this.hintFade > 0) {
      this.hintFade = Math.max(0, this.hintFade - dt);
    }

    for (const q of this.spawnQueue) q.t -= dt;
    const due = this.spawnQueue.filter((q) => q.t <= 0);
    this.spawnQueue = this.spawnQueue.filter((q) => q.t > 0);
    for (const q of due) {
      const e = spawnRoom1Extra(this.room, q.kind, this.enemies);
      this.enemies.push(e);
      this.vfx.push(createVfx('burst', e.x, e.y, 0.35, { color: '#d4a017', r: 0.9 }));
    }
  }

  /** End the Room 1 drill. One melee threat, then a late archer — never both at the opening. */
  releaseIntro(trainerStillAlive) {
    this.room.intro = false;
    this.hintFade = 1.15;
    if (trainerStillAlive) {
      const t = this.enemies.find((e) => e.alive && e.trainer);
      if (t) {
        t.trainer = false;
        t.damage = 1;
        t.speed = 1.55;
        t.attackCd = 1.2;
        t.attackCdMax = 2.05;
        t.windupMax = 0.42;
      }
    } else {
      this.spawnQueue.push({ t: 0.9, kind: 'melee' });
    }
    this.spawnQueue.push({ t: 8.0, kind: 'ranged' });
  }

  flushSfx() {
    for (const k of this._sfxQ) {
      if (k === 'hit') this.sfx.hit();
      else if (k === 'kill') this.sfx.enemyDie();
      else if (k === 'hurt') this.sfx.hurt();
    }
    this._sfxQ.clear();
  }

  decayVfx(dt) {
    for (const v of this.vfx) {
      v.life -= dt;
      if (v.life <= 0) v.alive = false;
    }
    this.vfx = this.vfx.filter((x) => x.alive);
  }

  finishLose() {
    if (this.state === 'lose') return;
    this.state = 'lose';
    this.sfx.playerDown();
    this.ui.showLose(this.player && this.player.lastHit);
  }

  hurtSource(e, kind) {
    return { name: e.name, en: e.en || '', kind, x: e.x, y: e.y };
  }

  updateEnemies(dt) {
    const p = this.player;
    for (const e of this.enemies) {
      if (e.dying > 0) e.dying = Math.max(0, e.dying - dt);
      e.hitFlash = Math.max(0, (e.hitFlash || 0) - dt);
      if (e.kb > 0) {
        const step = integrateGround(e.kx, e.ky, dt);
        tryMove(e, step.x, step.y, this.room);
        e.kb = Math.max(0, e.kb - dt);
      }
      if (!e.alive) continue;
      e.attackCd = Math.max(0, e.attackCd - dt);

      if (e.type === 'melee' || e.type === 'dog') {
        const d = dist(e, p);
        const kind = e.type === 'dog' ? 'bite' : 'melee';
        if (e.winding > 0) {
          e.winding -= dt;
          if (e.winding <= 0) {
            e.winding = 0;
            if (e.damage > 0 && d < e.attackRange + 0.22) {
              damagePlayer(p, e.damage, this.vfx, this.hurtSource(e, kind), this.feel);
            }
            e.attackCd = e.attackCdMax;
          }
        } else if (e.kb > 0) {
          // slide plays out before the next step
        } else if (d > e.attackRange) {
          const n = groundDir(p.x - e.x, p.y - e.y);
          if (n) {
            const step = groundVelocity(n, e.speed * dt);
            tryMove(e, step.x, step.y, this.room);
          }
        } else if (e.attackCd <= 0) {
          if (e.windupMax > 0) {
            e.winding = e.windupMax;
          } else if (e.damage > 0) {
            damagePlayer(p, e.damage, this.vfx, this.hurtSource(e, kind), this.feel);
            e.attackCd = e.attackCdMax;
          } else {
            e.attackCd = e.attackCdMax;
          }
        }
      } else if (e.type === 'ranged') {
        const d = dist(e, p);
        if (e.kb <= 0 && d < e.preferDist - 1) {
          const n = groundDir(e.x - p.x, e.y - p.y);
          if (n) {
            const step = groundVelocity(n, e.speed * dt);
            tryMove(e, step.x, step.y, this.room);
          }
        } else if (e.kb <= 0 && d > e.preferDist + 1) {
          const n = groundDir(p.x - e.x, p.y - e.y);
          if (n) {
            const step = groundVelocity(n, e.speed * 0.7 * dt);
            tryMove(e, step.x, step.y, this.room);
          }
        }
        if (e.attackCd <= 0 && d < 9) {
          const n = groundDir(p.x - e.x, p.y - e.y) || { x: 1, y: 0 };
          const spd = e.shotSpeed || 5.5;
          const vel = groundVelocity(n, spd);
          this.projectiles.push(
            createProjectile(e.x, e.y, vel.x, vel.y, e.damage, 'enemy', '#d4a017', 2.2, 0.16, {
              name: e.name,
              en: e.en,
              kind: 'arrow',
              x: e.x,
              y: e.y,
            })
          );
          e.attackCd = e.attackCdMax;
        }
      } else if (e.type === 'boss') {
        this.updateBoss(e, dt);
      }
    }
  }

  updateBoss(boss, dt) {
    const p = this.player;
    boss.phaseTimer -= dt;
    boss.spearCd = Math.max(0, (boss.spearCd || 0) - dt);

    // Slowly drift toward player
    const d = dist(boss, p);
    if (d > 1.8) {
      const n = groundDir(p.x - boss.x, p.y - boss.y);
      if (n) {
        const step = groundVelocity(n, boss.speed * 0.7 * dt);
        tryMove(boss, step.x, step.y, this.room);
      }
    }

    if (boss.phaseTimer <= 0) {
      boss.phase = (boss.phase + 1) % 3;
      boss.phaseTimer = 2.2 + Math.random() * 0.8;
      // Trigger pattern
      if (boss.phase === 0) {
        // Spear volley — 5 projectiles in fan
        const base = Math.atan2(p.y - boss.y, p.x - boss.x);
        for (let i = -2; i <= 2; i++) {
          const vel = groundVelocity(groundDirFromAngle(base + i * 0.22), 6);
          this.projectiles.push(
            createProjectile(
              boss.x, boss.y,
              vel.x, vel.y,
              1, 'enemy', '#c42b2b', 2.5, 0.2,
              { name: boss.name, en: boss.en, kind: 'spear', x: boss.x, y: boss.y }
            )
          );
        }
        this.vfx.push(createVfx('bossCast', boss.x, boss.y, 0.4, { color: '#c42b2b' }));
      } else if (boss.phase === 1) {
        // Charge / slam telegraph then damage
        boss._slam = 0.45;
        this.vfx.push(createVfx('telegraph', boss.x, boss.y, 0.45, { r: 2.2, color: '#8b1a1a' }));
      } else {
        // Ring spears
        for (let i = 0; i < 10; i++) {
          const vel = groundVelocity(groundDirFromAngle((i / 10) * Math.PI * 2), 4.5);
          this.projectiles.push(
            createProjectile(
              boss.x, boss.y,
              vel.x, vel.y,
              1, 'enemy', '#d4a017', 2.0, 0.18,
              { name: boss.name, en: boss.en, kind: 'ring', x: boss.x, y: boss.y }
            )
          );
        }
      }
    }

    if (boss._slam != null) {
      boss._slam -= dt;
      if (boss._slam <= 0) {
        boss._slam = null;
        if (dist(boss, p) < 2.4) {
          damagePlayer(p, 1, this.vfx, this.hurtSource(boss, 'slam'), this.feel);
        }
        // Leap closer
        const n = groundDir(p.x - boss.x, p.y - boss.y);
        if (n) {
          const step = groundVelocity(n, 1.8);
          tryMove(boss, step.x, step.y, this.room);
        }
        this.vfx.push(createVfx('burst', boss.x, boss.y, 0.3, { color: '#c42b2b', r: 2.0 }));
      }
    }

    // Contact damage
    if (dist(boss, p) < boss.radius + p.radius + 0.1 && boss.attackCd <= 0) {
      damagePlayer(p, 1, this.vfx, this.hurtSource(boss, 'strike'), this.feel);
      boss.attackCd = 0.8;
    }
    boss.attackCd = Math.max(0, boss.attackCd - dt);
  }

  /* ——— Render ——— */
  render() {
    const ctx = this.ctx;
    const W = this.W, H = this.H;
    ctx.clearRect(0, 0, W, H);

    // Background wash
    const g = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, H * 0.75);
    g.addColorStop(0, '#1a1012');
    g.addColorStop(1, '#0a0708');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    if (!this.room || !this.player) return;

    const shx = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    const shy = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    const ox = W / 2 - this.camera.x + shx;
    const oy = H / 2 - this.camera.y + 40 + shy;

    // Collect drawables for depth sort (by wx+wy)
    const drawList = [];

    // Tiles
    for (let y = 0; y < this.room.h; y++) {
      for (let x = 0; x < this.room.w; x++) {
        const t = this.room.tiles[y][x];
        if (t === 0) continue;
        drawList.push({ depth: x + y - 0.5, kind: 'tile', x, y, t });
      }
    }

    // Exit glow
    if (this.room.exitOpen) {
      drawList.push({
        depth: this.room.exit.x + this.room.exit.y + 0.1,
        kind: 'exit',
        x: this.room.exit.x + 0.5,
        y: this.room.exit.y + 0.5,
      });
    }

    // Flames
    for (const f of this.flames) {
      drawList.push({ depth: f.x + f.y, kind: 'flame', e: f });
    }

    // Entities
    if (this.player.alive || this.hitStop > 0) {
      drawList.push({ depth: this.player.x + this.player.y, kind: 'player', e: this.player });
    }
    for (const e of this.enemies) {
      if (!e.alive && !(e.dying > 0)) continue;
      drawList.push({ depth: e.x + e.y, kind: 'enemy', e });
    }
    for (const p of this.projectiles) {
      drawList.push({ depth: p.x + p.y + 10, kind: 'proj', e: p });
    }
    for (const v of this.vfx) {
      if (v.kind === 'dmg') continue;
      drawList.push({ depth: v.x + v.y + 20, kind: 'vfx', e: v });
    }

    drawList.sort((a, b) => a.depth - b.depth);

    for (const d of drawList) {
      if (d.kind === 'tile') this.drawTile(ctx, d.x, d.y, d.t, ox, oy);
      else if (d.kind === 'exit') this.drawExit(ctx, d.x, d.y, ox, oy);
      else if (d.kind === 'flame') this.drawFlame(ctx, d.e, ox, oy);
      else if (d.kind === 'player') this.drawPlayer(ctx, d.e, ox, oy);
      else if (d.kind === 'enemy') this.drawEnemy(ctx, d.e, ox, oy);
      else if (d.kind === 'proj') this.drawProj(ctx, d.e, ox, oy);
      else if (d.kind === 'vfx') this.drawVfx(ctx, d.e, ox, oy);
    }

    for (const v of this.vfx) {
      if (v.kind === 'dmg') this.drawVfx(ctx, v, ox, oy);
    }

    const p = this.player;
    let angle = null;
    if (p.hurtT > 0 && p.hurtFrom) {
      const rel = worldToScreen(p.hurtFrom.x - p.x, p.hurtFrom.y - p.y);
      if (Math.hypot(rel.x, rel.y) > 2) angle = Math.atan2(rel.y, rel.x);
    }
    drawHurtOverlay(ctx, W, H, {
      hp: p.hp,
      maxHp: p.maxHp,
      hurtT: p.hurtT || 0,
      angle,
      label: p.hurtLabel || '',
    });

    const hintA = this.room.intro ? 1 : (this.hintFade > 0 ? this.hintFade / 1.15 : 0);
    const drillUp = !!(this.room.intro && this.enemies.some((e) => e.alive && e.trainer));
    if (hintA > 0 && drillUp && this.mouse.seen) {
      const ps = worldToScreen(p.x, p.y);
      drawAimGuide(ctx, ox + ps.x, oy + ps.y - 16, this.mouse.x, this.mouse.y, hintA);
    }
    drawIntroHint(ctx, W, H, hintA, drillUp ? 'aim' : 'next');
    this.drawHUD(ctx);
  }

  drawTile(ctx, tx, ty, t, ox, oy) {
    const { x, y } = worldToScreen(tx, ty);
    const cx = ox + x;
    const cy = oy + y;
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;

    const checker = (tx + ty) % 2 === 0;
    let fill = checker ? '#1e1618' : '#181214';
    if (t === 2) fill = '#2a1a1c';

    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = 'rgba(154,117,16,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (t === 2) {
      // Mini wall pillar
      const h = 18;
      ctx.fillStyle = '#3a2228';
      ctx.beginPath();
      ctx.moveTo(cx - hw + 4, cy);
      ctx.lineTo(cx, cy + hh - 4);
      ctx.lineTo(cx, cy + hh - 4 - h);
      ctx.lineTo(cx - hw + 4, cy - h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#2a181c';
      ctx.beginPath();
      ctx.moveTo(cx + hw - 4, cy);
      ctx.lineTo(cx, cy + hh - 4);
      ctx.lineTo(cx, cy + hh - 4 - h);
      ctx.lineTo(cx + hw - 4, cy - h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#5a3038';
      ctx.beginPath();
      ctx.moveTo(cx, cy - hh + 4 - h);
      ctx.lineTo(cx + hw - 4, cy - h);
      ctx.lineTo(cx, cy + hh - 4 - h);
      ctx.lineTo(cx - hw + 4, cy - h);
      ctx.closePath();
      ctx.fill();
    }
  }

  drawExit(ctx, wx, wy, ox, oy) {
    const { x, y } = worldToScreen(wx, wy);
    const cx = ox + x;
    const cy = oy + y;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 200);
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.25 * pulse;
    ctx.fillStyle = '#3ecf9a';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 28, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#d4a017';
    ctx.font = '12px serif';
    ctx.textAlign = 'center';
    ctx.fillText('出口 EXIT', cx, cy - 18);
    ctx.restore();
  }

  drawPlayer(ctx, p, ox, oy) {
    const { x, y } = worldToScreen(p.x, p.y);
    const cx = ox + x;
    const cy = oy + y;
    const iframeBlink = p.iframe > 0 && Math.floor(performance.now() / 60) % 2 === 0;
    const flash = iframeBlink || p.hitFlash > 0;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 4, 14, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillStyle = p.hitFlash > 0 ? '#fff6e4' : (flash ? 'rgba(232,213,163,0.5)' : '#8b1a1a');
    ctx.beginPath();
    ctx.ellipse(cx, cy - 10, 11, 16, 0, 0, Math.PI * 2);
    ctx.fill();

    // Headband / gold
    ctx.fillStyle = '#d4a017';
    ctx.fillRect(cx - 8, cy - 26, 16, 4);

    // Head
    ctx.fillStyle = p.hitFlash > 0 ? '#fff6e4' : (flash ? '#e8d5a3' : '#c4a070');
    ctx.beginPath();
    ctx.arc(cx, cy - 28, 8, 0, Math.PI * 2);
    ctx.fill();

    // Axe (facing)
    const fx = p.facing.x;
    const fy = p.facing.y;
    const { x: ax, y: ay } = worldToScreen(p.x + fx * 0.55, p.y + fy * 0.55);
    ctx.strokeStyle = '#9a7510';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 12);
    ctx.lineTo(ox + ax, oy + ay - 8);
    ctx.stroke();
    ctx.fillStyle = '#c42b2b';
    ctx.beginPath();
    ctx.arc(ox + ax, oy + ay - 8, 6, 0, Math.PI * 2);
    ctx.fill();

    // Lantern glow at side
    ctx.fillStyle = 'rgba(62,207,154,0.55)';
    ctx.beginPath();
    ctx.arc(cx - 12, cy - 8, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#d4a017';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Melee arc indicator while swinging
    if (p.meleeActive > 0) {
      const faceAng = Math.atan2(p.facing.y, p.facing.x);
      // Approximate arc in screen space as ellipse wedge
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#d4a017';
      ctx.lineWidth = 3;
      ctx.beginPath();
      const steps = 10;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const a = faceAng - p.meleeArc / 2 + t * p.meleeArc;
        const wx2 = p.x + Math.cos(a) * p.meleeRange;
        const wy2 = p.y + Math.sin(a) * p.meleeRange;
        const s = worldToScreen(wx2, wy2);
        if (i === 0) ctx.moveTo(ox + s.x, oy + s.y);
        else ctx.lineTo(ox + s.x, oy + s.y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  drawEnemy(ctx, e, ox, oy) {
    const { x, y } = worldToScreen(e.x, e.y);
    const cx = ox + x;
    const cy = oy + y;
    const flash = e.hitFlash > 0;
    const dying = !e.alive && e.dying > 0;
    const deathT = dying ? 1 - e.dying / (e.deathDur || 0.55) : 0;

    ctx.save();
    if (dying) ctx.globalAlpha = Math.max(0, 1 - deathT);

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 3, e.type === 'boss' ? 22 : 12, e.type === 'boss' ? 11 : 6, 0, 0, Math.PI * 2);
    ctx.fill();

    if (e.winding > 0 && e.windupMax) {
      const charge = 1 - e.winding / e.windupMax;
      ctx.save();
      ctx.globalAlpha = (dying ? ctx.globalAlpha : 1) * (0.35 + 0.45 * charge);
      ctx.strokeStyle = '#ff4a4a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy + 2, 16 + charge * 14, 8 + charge * 6, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const pop = 1 + (e.hitFlash || 0) * 2.1 + (dying ? deathT * 0.55 : 0);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(pop, pop);
    ctx.translate(-cx, -cy);

    if (e.type === 'boss') {
      ctx.fillStyle = flash ? '#e8d5a3' : e.color;
      ctx.beginPath();
      ctx.ellipse(cx, cy - 18, 20, 28, 0, 0, Math.PI * 2);
      ctx.fill();
      // Third eye
      ctx.fillStyle = '#d4a017';
      ctx.beginPath();
      ctx.arc(cx, cy - 40, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c42b2b';
      ctx.beginPath();
      ctx.arc(cx, cy - 40, 2.5, 0, Math.PI * 2);
      ctx.fill();
      // HP bar
      this.drawBar(ctx, cx - 30, cy - 58, 60, 6, e.hp / e.maxHp, '#c42b2b', '#3a1010');
      ctx.fillStyle = '#d4a017';
      ctx.font = '11px serif';
      ctx.textAlign = 'center';
      ctx.fillText('二郎神', cx, cy - 64);
    } else if (e.type === 'dog') {
      ctx.fillStyle = flash ? '#e8d5a3' : e.color;
      ctx.beginPath();
      ctx.ellipse(cx, cy - 6, 14, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = e.accent;
      ctx.beginPath();
      ctx.arc(cx + 10, cy - 8, 5, 0, Math.PI * 2);
      ctx.fill();
      this.drawBar(ctx, cx - 14, cy - 22, 28, 4, e.hp / e.maxHp, '#c42b2b', '#3a1010');
    } else {
      ctx.fillStyle = flash ? '#e8d5a3' : e.color;
      ctx.beginPath();
      ctx.ellipse(cx, cy - 10, 10, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = e.accent;
      // Helmet
      ctx.beginPath();
      ctx.moveTo(cx - 9, cy - 20);
      ctx.lineTo(cx, cy - 30);
      ctx.lineTo(cx + 9, cy - 20);
      ctx.closePath();
      ctx.fill();
      if (e.type === 'ranged') {
        ctx.strokeStyle = '#d4a017';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx + 8, cy - 12, 8, -0.5, 0.5);
        ctx.stroke();
      }
      this.drawBar(ctx, cx - 12, cy - 36, 24, 3, e.hp / e.maxHp, '#c42b2b', '#3a1010');
    }

    if (flash) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.85, e.hitFlash * 4.5);
      ctx.fillStyle = '#fff8ea';
      const rw = e.type === 'boss' ? 22 : e.type === 'dog' ? 16 : 12;
      const rh = e.type === 'boss' ? 30 : e.type === 'dog' ? 12 : 16;
      const ry = e.type === 'boss' ? 18 : e.type === 'dog' ? 6 : 10;
      ctx.beginPath();
      ctx.ellipse(cx, cy - ry, rw, rh, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore(); // pop scale

    if (e.trainer && e.alive) {
      ctx.fillStyle = '#f0d48a';
      ctx.font = '12px serif';
      ctx.textAlign = 'center';
      ctx.fillText('弱 · weak', cx, cy - 44);
    }
    ctx.restore(); // death alpha
  }

  drawProj(ctx, p, ox, oy) {
    const { x, y } = worldToScreen(p.x, p.y);
    const cx = ox + x;
    const cy = oy + y;
    ctx.save();
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 10;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(cx, cy - 6, p.owner === 'player' ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawFlame(ctx, f, ox, oy) {
    const { x, y } = worldToScreen(f.x, f.y);
    const cx = ox + x;
    const cy = oy + y;
    const a = f.life / f.maxLife;
    ctx.save();
    ctx.globalAlpha = 0.25 + 0.35 * a;
    ctx.fillStyle = '#c42b2b';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 22 * (f.radius / 0.7), 11 * (f.radius / 0.7), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d4a017';
    ctx.globalAlpha = 0.4 * a;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 10, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawVfx(ctx, v, ox, oy) {
    const { x, y } = worldToScreen(v.x, v.y);
    const cx = ox + x;
    const cy = oy + y;
    const t = 1 - v.life / v.maxLife;
    ctx.save();
    if (v.kind === 'burst' || v.kind === 'bossCast') {
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = v.color || '#3ecf9a';
      ctx.lineWidth = 2;
      const r = (v.r || 1.5) * 18 * (0.4 + t);
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (v.kind === 'death') {
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = v.color || '#d4a017';
      ctx.lineWidth = 3;
      const ring = (v.r || 1) * (12 + t * 34);
      ctx.beginPath();
      ctx.ellipse(cx, cy, ring, ring * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#fff1c9';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + t * 2;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * ring * 0.75, cy - 6 + Math.sin(a) * ring * 0.38, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (v.kind === 'dmg') {
      ctx.globalAlpha = Math.min(1, (1 - t) * 1.35);
      ctx.fillStyle = v.color || '#fff6df';
      ctx.font = v.big ? 'bold 20px serif' : 'bold 16px serif';
      ctx.textAlign = 'center';
      ctx.fillText(v.text, cx, cy - 28 - t * 34);
    } else if (v.kind === 'hit' || v.kind === 'hurt') {
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = v.color || '#c42b2b';
      ctx.beginPath();
      ctx.arc(cx, cy - 10 - t * 20, 4 + t * 6, 0, Math.PI * 2);
      ctx.fill();
    } else if (v.kind === 'heal') {
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = '#3ecf9a';
      ctx.font = '14px serif';
      ctx.textAlign = 'center';
      ctx.fillText('+HP', cx, cy - 30 - t * 20);
    } else if (v.kind === 'telegraph') {
      ctx.globalAlpha = 0.25 + 0.25 * Math.sin(t * 20);
      ctx.fillStyle = v.color || '#8b1a1a';
      const r = (v.r || 2) * 16;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (v.kind === 'swing') {
      // drawn on player
    } else if (v.kind === 'exitOpen') {
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = '#3ecf9a';
      ctx.font = '13px serif';
      ctx.textAlign = 'center';
      ctx.fillText('清場 · EXIT OPEN', cx, cy - 40);
    }
    ctx.restore();
  }

  drawBar(ctx, x, y, w, h, pct, fg, bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = fg;
    ctx.fillRect(x, y, w * clamp(pct, 0, 1), h);
    ctx.strokeStyle = 'rgba(212,160,23,0.4)';
    ctx.strokeRect(x, y, w, h);
  }

  drawHUD(ctx) {
    const p = this.player;
    const boons = p.boons.map((id) => {
      const b = UI.getBoon(id);
      if (!b) return null;
      return { glyph: b.glyph || b.name.slice(0, 1), kind: b.kind, name: b.name };
    }).filter(Boolean);
    drawPlayHUD(ctx, this.W, this.H, {
      label: this.room.label,
      isBoss: this.room.isBoss,
      roomIndex: this.roomIndex,
      totalRooms: TOTAL_COMBAT_ROOMS,
      alive: this.aliveEnemies().length,
      wavePending: !!(this.room.intro || this.spawnQueue.length),
      exitOpen: this.room.exitOpen,
      hp: p.hp,
      maxHp: p.maxHp,
      lanternCd: p.lanternCd,
      lanternCdMax: p.lanternCdMax,
      boons,
      muted: this.sfx.muted,
    });
  }
}
