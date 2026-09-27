/**
 * Game state machine + update/render loop.
 * States: title | playing | reward | paused | win | lose
 */
import { worldToScreen, screenToWorld, TILE_W, TILE_H, dist, normalize, clamp } from './iso.js';
import { createPlayer, createProjectile, createVfx, moveToward, moveAway } from './entities.js';
import { startMelee, resolveMelee, castLantern, damagePlayer, damageEntity, updateProjectiles, updateFlames } from './combat.js';
import { makeRoom, spawnEnemiesForRoom, tryMove, isBlocked } from './rooms.js';
import { rollRewardChoices } from './baxian.js';
import { UI } from './ui.js';

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
    this.player.iframe = 0.4;
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
    });
  }

  tryMelee() {
    if (!this.player || !this.player.alive) return;
    this._aimFromMouse();
    if (startMelee(this.player)) {
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
    castLantern(this.player, this.aliveEnemies(), this.projectiles, this.flames, this.vfx);
  }

  _aimFromMouse() {
    const p = this.player;
    const ox = this.W / 2 - this.camera.x;
    const oy = this.H / 2 - this.camera.y + 40;
    const wx = screenToWorld(this.mouse.x - ox, this.mouse.y - oy);
    const n = normalize(wx.x - p.x, wx.y - p.y);
    if (Math.hypot(n.x, n.y) > 0.01) p.facing = n;
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
    const p = this.player;
    if (!p.alive) {
      this.state = 'lose';
      this.ui.showLose();
      return;
    }

    // Cooldowns
    p.meleeCd = Math.max(0, p.meleeCd - dt);
    p.lanternCd = Math.max(0, p.lanternCd - dt);
    p.iframe = Math.max(0, p.iframe - dt);
    if (p.hitFlash) p.hitFlash = Math.max(0, (p.hitFlash || 0) - dt);

    // Aim
    this._aimFromMouse();

    // Dash override
    if (p.dashTimer > 0) {
      p.dashTimer -= dt;
      tryMove(p, p.dashVel.x * dt, p.dashVel.y * dt, this.room);
    } else {
      // WASD / arrows → isometric screen directions mapped to world
      // W = up-screen (-wx,-wy), S = down, A = left-screen, D = right-screen
      let mx = 0, my = 0;
      if (this.keys['w'] || this.keys['arrowup']) { mx -= 1; my -= 1; }
      if (this.keys['s'] || this.keys['arrowdown']) { mx += 1; my += 1; }
      if (this.keys['a'] || this.keys['arrowleft']) { mx += 1; my -= 1; }
      if (this.keys['d'] || this.keys['arrowright']) { mx -= 1; my += 1; }
      if (mx || my) {
        const n = normalize(mx, my);
        tryMove(p, n.x * p.speed * dt, n.y * p.speed * dt, this.room);
        if (p.meleeActive <= 0) p.facing = n;
      }
    }

    // Melee active window
    if (p.meleeActive > 0) {
      p.meleeActive -= dt;
      if (!this.meleeResolved && p.meleeActive <= p.meleeDuration * 0.55) {
        resolveMelee(p, this.enemies, this.vfx);
        // Also hit dog if separate — already in enemies list
        this.meleeResolved = true;
      }
      if (p.meleeActive < 0) p.meleeActive = 0;
    }

    // Enemies AI
    this.updateEnemies(dt);

    // Projectiles & flames
    updateProjectiles(this.projectiles, p, this.enemies, this.vfx, dt);
    updateFlames(this.flames, this.enemies, this.vfx, dt);

    // VFX
    for (const v of this.vfx) {
      v.life -= dt;
      if (v.life <= 0) v.alive = false;
    }
    this.projectiles = this.projectiles.filter((x) => x.alive);
    this.flames = this.flames.filter((x) => x.alive);
    this.vfx = this.vfx.filter((x) => x.alive);
    // Keep dead enemies briefly? filter only when room clear check needs alive

    // Room clear
    const living = this.aliveEnemies();
    if (!this.room.cleared && living.length === 0) {
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

  updateEnemies(dt) {
    const p = this.player;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.hitFlash = Math.max(0, (e.hitFlash || 0) - dt);
      e.attackCd = Math.max(0, e.attackCd - dt);

      if (e.type === 'melee' || e.type === 'dog') {
        const d = dist(e, p);
        if (d > e.attackRange) {
          const n = normalize(p.x - e.x, p.y - e.y);
          tryMove(e, n.x * e.speed * dt, n.y * e.speed * dt, this.room);
        } else if (e.attackCd <= 0) {
          damagePlayer(p, e.damage, this.vfx);
          e.attackCd = e.attackCdMax;
        }
      } else if (e.type === 'ranged') {
        const d = dist(e, p);
        if (d < e.preferDist - 1) {
          const n = normalize(e.x - p.x, e.y - p.y);
          tryMove(e, n.x * e.speed * dt, n.y * e.speed * dt, this.room);
        } else if (d > e.preferDist + 1) {
          const n = normalize(p.x - e.x, p.y - e.y);
          tryMove(e, n.x * e.speed * 0.7 * dt, n.y * e.speed * 0.7 * dt, this.room);
        }
        if (e.attackCd <= 0 && d < 9) {
          const n = normalize(p.x - e.x, p.y - e.y);
          this.projectiles.push(
            createProjectile(e.x, e.y, n.x * 5.5, n.y * 5.5, e.damage, 'enemy', '#d4a017', 2.2, 0.16)
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
      const n = normalize(p.x - boss.x, p.y - boss.y);
      tryMove(boss, n.x * boss.speed * 0.7 * dt, n.y * boss.speed * 0.7 * dt, this.room);
    }

    if (boss.phaseTimer <= 0) {
      boss.phase = (boss.phase + 1) % 3;
      boss.phaseTimer = 2.2 + Math.random() * 0.8;
      // Trigger pattern
      if (boss.phase === 0) {
        // Spear volley — 5 projectiles in fan
        const base = Math.atan2(p.y - boss.y, p.x - boss.x);
        for (let i = -2; i <= 2; i++) {
          const a = base + i * 0.22;
          this.projectiles.push(
            createProjectile(
              boss.x, boss.y,
              Math.cos(a) * 6, Math.sin(a) * 6,
              1, 'enemy', '#c42b2b', 2.5, 0.2
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
          const a = (i / 10) * Math.PI * 2;
          this.projectiles.push(
            createProjectile(
              boss.x, boss.y,
              Math.cos(a) * 4.5, Math.sin(a) * 4.5,
              1, 'enemy', '#d4a017', 2.0, 0.18
            )
          );
        }
      }
    }

    if (boss._slam != null) {
      boss._slam -= dt;
      if (boss._slam <= 0) {
        boss._slam = null;
        if (dist(boss, p) < 2.4) damagePlayer(p, 1, this.vfx);
        // Leap closer
        const n = normalize(p.x - boss.x, p.y - boss.y);
        tryMove(boss, n.x * 1.8, n.y * 1.8, this.room);
        this.vfx.push(createVfx('burst', boss.x, boss.y, 0.3, { color: '#c42b2b', r: 2.0 }));
      }
    }

    // Contact damage
    if (dist(boss, p) < boss.radius + p.radius + 0.1 && boss.attackCd <= 0) {
      damagePlayer(p, 1, this.vfx);
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

    const ox = W / 2 - this.camera.x;
    const oy = H / 2 - this.camera.y + 40;

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
    if (this.player.alive) {
      drawList.push({ depth: this.player.x + this.player.y, kind: 'player', e: this.player });
    }
    for (const e of this.enemies) {
      if (!e.alive) continue;
      drawList.push({ depth: e.x + e.y, kind: 'enemy', e });
    }
    for (const p of this.projectiles) {
      drawList.push({ depth: p.x + p.y + 10, kind: 'proj', e: p });
    }
    for (const v of this.vfx) {
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
    const flash = p.iframe > 0 && Math.floor(performance.now() / 60) % 2 === 0;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 4, 14, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillStyle = flash ? 'rgba(232,213,163,0.5)' : '#8b1a1a';
    ctx.beginPath();
    ctx.ellipse(cx, cy - 10, 11, 16, 0, 0, Math.PI * 2);
    ctx.fill();

    // Headband / gold
    ctx.fillStyle = '#d4a017';
    ctx.fillRect(cx - 8, cy - 26, 16, 4);

    // Head
    ctx.fillStyle = flash ? '#e8d5a3' : '#c4a070';
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

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 3, e.type === 'boss' ? 22 : 12, e.type === 'boss' ? 11 : 6, 0, 0, Math.PI * 2);
    ctx.fill();

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
    } else if (v.kind === 'hit' || v.kind === 'hurt' || v.kind === 'death') {
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
    const pad = 16;

    // Room label
    ctx.fillStyle = '#d4a017';
    ctx.font = '14px "Noto Serif SC", serif';
    ctx.textAlign = 'left';
    const progress = this.room.isBoss
      ? 'BOSS'
      : `Room ${this.roomIndex + 1}/${TOTAL_COMBAT_ROOMS}`;
    ctx.fillText(`${this.room.label}  ·  ${progress}`, pad, pad + 12);

    // HP hearts
    ctx.font = '16px serif';
    let hpStr = '';
    for (let i = 0; i < p.maxHp; i++) hpStr += i < p.hp ? '♥' : '♡';
    ctx.fillStyle = '#c42b2b';
    ctx.fillText(hpStr, pad, pad + 36);

    // Lantern CD bar
    const cdPct = 1 - p.lanternCd / p.lanternCdMax;
    ctx.fillStyle = '#e8d5a3';
    ctx.font = '12px serif';
    ctx.fillText('寶蓮燈', pad, pad + 58);
    this.drawBar(ctx, pad + 52, pad + 48, 100, 10, cdPct, cdPct >= 1 ? '#3ecf9a' : '#2d8a6e', '#1a1214');
    if (cdPct >= 1) {
      ctx.fillStyle = '#3ecf9a';
      ctx.fillText('READY', pad + 160, pad + 58);
    }

    // Boons
    if (p.boons.length) {
      ctx.fillStyle = '#9a7510';
      ctx.font = '11px serif';
      ctx.fillText('八仙: ' + p.boons.map((id) => {
        const b = UI.getBoon(id);
        return b ? b.name : id;
      }).join(' · '), pad, pad + 78);
    }

    // Controls hint (bottom)
    ctx.fillStyle = 'rgba(184,160,112,0.7)';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(
      'WASD move · J/LMB axe · K/F/RMB 寶蓮燈 · ESC pause',
      this.W / 2,
      this.H - 12
    );

    // Enemy count
    const alive = this.aliveEnemies().length;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#e8d5a3';
    ctx.font = '12px serif';
    if (this.room.exitOpen) {
      ctx.fillStyle = '#3ecf9a';
      ctx.fillText('→ Reach the exit', this.W - pad, pad + 12);
    } else {
      ctx.fillText(`天兵 ${alive}`, this.W - pad, pad + 12);
    }
  }
}
