/**
 * Canvas HUD, low-HP vignette, hurt direction, and the opening aim hint.
 */

function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function drawHeart(ctx, x, y, size, filled, pulse) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(pulse, pulse);
  ctx.beginPath();
  const s = size;
  ctx.moveTo(0, s * 0.32);
  ctx.bezierCurveTo(-s * 0.55, -s * 0.15, -s * 0.5, -s * 0.72, 0, -s * 0.32);
  ctx.bezierCurveTo(s * 0.5, -s * 0.72, s * 0.55, -s * 0.15, 0, s * 0.32);
  ctx.fillStyle = filled ? '#e23b3b' : 'rgba(196,43,43,0.18)';
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = filled ? '#f0d7a4' : 'rgba(232,213,163,0.4)';
  ctx.stroke();
  if (filled) {
    ctx.fillStyle = 'rgba(255,220,180,0.35)';
    ctx.beginPath();
    ctx.ellipse(-s * 0.16, -s * 0.28, s * 0.12, s * 0.08, -0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawPlayHUD(ctx, W, H, hud) {
  const pad = 18;
  const low = hud.maxHp > 0 && hud.hp / hud.maxHp <= 0.34;
  const pulse = low ? 1 + 0.08 * Math.sin(performance.now() / 140) : 1;

  ctx.save();
  ctx.textAlign = 'left';
  ctx.fillStyle = '#f0d48a';
  ctx.font = '18px "Noto Serif SC", serif';
  ctx.fillText(hud.label, pad, pad + 16);

  ctx.fillStyle = '#b8a070';
  ctx.font = '13px serif';
  const progress = hud.isBoss
    ? 'BOSS · 二郎神'
    : `第 ${hud.roomIndex + 1} / ${hud.totalRooms} 室   ·   Room ${hud.roomIndex + 1}/${hud.totalRooms}`;
  ctx.fillText(progress, pad, pad + 36);

  const heartSize = 15;
  const heartGap = 30;
  const heartsTop = pad + 68;
  for (let i = 0; i < hud.maxHp; i++) {
    drawHeart(ctx, pad + 12 + i * heartGap, heartsTop, heartSize, i < hud.hp, pulse);
  }
  ctx.fillStyle = low ? '#ff8d8d' : '#e8d5a3';
  ctx.font = 'bold 16px serif';
  ctx.fillText(`${hud.hp}/${hud.maxHp}`, pad + 12 + hud.maxHp * heartGap + 4, heartsTop + 6);

  drawLantern(ctx, pad, heartsTop + 28, hud.lanternCd, hud.lanternCdMax);

  if (hud.boons && hud.boons.length) {
    const by = heartsTop + 86;
    hud.boons.forEach((b, i) => {
      const x = pad + 14 + i * 34;
      ctx.beginPath();
      ctx.arc(x, by, 13, 0, Math.PI * 2);
      ctx.fillStyle = '#140e10';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = b.kind === 'cast' ? '#c42b2b' : '#3ecf9a';
      ctx.stroke();
      ctx.fillStyle = '#f0d48a';
      ctx.font = '13px serif';
      ctx.textAlign = 'center';
      ctx.fillText(b.glyph, x, by + 4);
    });
    ctx.textAlign = 'left';
  }

  // Room + enemy plate
  const plateW = 168;
  const plateH = hud.exitOpen ? 78 : 86;
  const px = W - pad - plateW;
  ctx.fillStyle = 'rgba(8,6,7,0.62)';
  ctx.strokeStyle = 'rgba(212,160,23,0.45)';
  ctx.lineWidth = 1;
  roundRect(ctx, px, 12, plateW, plateH, 6);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = 'center';
  if (hud.exitOpen) {
    ctx.fillStyle = '#3ecf9a';
    ctx.font = 'bold 16px serif';
    ctx.fillText('出口已開', px + plateW / 2, 40);
    ctx.font = '13px serif';
    ctx.fillText('EXIT OPEN', px + plateW / 2, 60);
  } else {
    ctx.fillStyle = '#b8a070';
    ctx.font = '13px serif';
    ctx.fillText(hud.isBoss ? '強敵 · FOES' : '敵人 · ENEMIES', px + plateW / 2, 34);
    ctx.fillStyle = '#f0d48a';
    ctx.font = 'bold 28px serif';
    ctx.fillText(String(hud.alive), px + plateW / 2, 66);
  }

  ctx.fillStyle = hud.muted ? '#c42b2b' : 'rgba(184,160,112,0.85)';
  ctx.font = '12px serif';
  ctx.textAlign = 'right';
  ctx.fillText(hud.muted ? '靜音 MUTE' : '音效 ON', W - pad, plateH + 28);

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(232,213,163,0.82)';
  ctx.font = '13px serif';
  ctx.fillText(
    'WASD 移動 · 滑鼠瞄準 Mouse aims · J/LMB 斧 · K/RMB 燈 · M 靜音 · ESC 暫停',
    W / 2,
    H - 14
  );
  ctx.restore();
}

function drawLantern(ctx, x, y, cd, cdMax) {
  const ready = cd <= 0.02;
  const pct = cdMax > 0 ? 1 - cd / cdMax : 1;
  const pulse = ready ? 0.5 + 0.5 * Math.sin(performance.now() / 160) : 0;
  const cx = x + 22;
  const cy = y + 18;
  const r = 16;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = ready ? `rgba(62,207,154,${0.25 + pulse * 0.35})` : '#1a1214';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(154,117,16,0.45)';
  ctx.stroke();

  ctx.beginPath();
  ctx.strokeStyle = ready ? '#7dffc8' : '#2d8a6e';
  ctx.lineWidth = 3;
  ctx.arc(cx, cy, r - 1, -Math.PI / 2, -Math.PI / 2 + Math.max(0.001, pct) * Math.PI * 2);
  ctx.stroke();

  // Tiny lantern flame
  ctx.fillStyle = ready ? '#e8ffd8' : '#d4a017';
  ctx.globalAlpha = ready ? 0.9 : 0.75;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 1, 4, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.textAlign = 'left';
  ctx.fillStyle = '#e8d5a3';
  ctx.font = '14px serif';
  ctx.fillText('寶蓮燈', x + 46, y + 14);

  if (ready) {
    ctx.fillStyle = `rgba(126,255,200,${0.75 + pulse * 0.25})`;
    ctx.font = 'bold 16px serif';
    ctx.fillText('就緒 READY', x + 46, y + 34);
  } else {
    ctx.fillStyle = '#d4a017';
    ctx.font = 'bold 16px serif';
    ctx.fillText(`冷卻 ${cd.toFixed(1)}s`, x + 46, y + 34);
  }

  const barX = x + 46;
  const barY = y + 42;
  const barW = 132;
  ctx.fillStyle = '#1a1214';
  ctx.fillRect(barX, barY, barW, 8);
  ctx.fillStyle = ready ? '#3ecf9a' : '#1f6e56';
  ctx.fillRect(barX, barY, barW * Math.max(0, Math.min(1, pct)), 8);
  ctx.strokeStyle = ready ? '#7dffc8' : 'rgba(212,160,23,0.45)';
  ctx.strokeRect(barX, barY, barW, 8);
  ctx.restore();
}

export function drawIntroHint(ctx, W, H, alpha, mode) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  const w = 460;
  const h = 92;
  const x = (W - w) / 2;
  const y = H - 188;
  ctx.fillStyle = 'rgba(8,6,7,0.78)';
  ctx.strokeStyle = mode === 'next' ? 'rgba(62,207,154,0.85)' : 'rgba(212,160,23,0.9)';
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = 'center';
  if (mode === 'next') {
    ctx.fillStyle = '#7dffc8';
    ctx.font = '20px serif';
    ctx.fillText('弱兵已倒 · 下一波將至', W / 2, y + 36);
    ctx.fillStyle = '#e8d5a3';
    ctx.font = '15px serif';
    ctx.fillText('Drill done — a lighter wave is coming', W / 2, y + 62);
  } else {
    ctx.fillStyle = '#f0d48a';
    ctx.font = '22px serif';
    ctx.fillText('滑鼠瞄準，再揮斧', W / 2, y + 32);
    ctx.fillStyle = '#e8d5a3';
    ctx.font = '16px serif';
    ctx.fillText('Mouse aims your attacks', W / 2, y + 54);
    ctx.fillStyle = '#b8a070';
    ctx.font = '13px serif';
    ctx.fillText('移動游標 Move cursor  ·  J / 左鍵 LMB', W / 2, y + 76);
  }
  ctx.restore();
}

/** Faint tether from the hero to the cursor while the aim lesson is on screen. */
export function drawAimGuide(ctx, x1, y1, x2, y2, alpha) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = 0.55 * alpha;
  ctx.strokeStyle = '#d4a017';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.9 * alpha;
  ctx.strokeStyle = '#f0d48a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x2, y2, 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2 - 14, y2);
  ctx.lineTo(x2 + 14, y2);
  ctx.moveTo(x2, y2 - 14);
  ctx.lineTo(x2, y2 + 14);
  ctx.stroke();
  ctx.restore();
}

/**
 * Red edge vignette while hurt or low, plus a chevron toward the attacker.
 * angle is screen-space radians (0 = right).
 */
export function drawHurtOverlay(ctx, W, H, o) {
  const hpPct = o.maxHp > 0 ? o.hp / o.maxHp : 1;
  const hurtT = o.hurtT || 0;
  ctx.save();
  if (hpPct <= 0.5) {
    const low = (0.5 - hpPct) / 0.5;
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() / (hpPct <= 0.34 ? 130 : 260));
    const alpha = 0.16 + low * 0.5 * pulse;
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.72);
    g.addColorStop(0, 'rgba(40,0,0,0)');
    g.addColorStop(0.62, `rgba(90,8,12,${alpha * 0.4})`);
    g.addColorStop(1, `rgba(130,8,12,${alpha})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  if (hurtT > 0) {
    const a = Math.max(0, Math.min(1, hurtT / 0.8));
    const flash = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.75);
    flash.addColorStop(0, 'rgba(0,0,0,0)');
    flash.addColorStop(1, `rgba(190,24,28,${0.33 * a})`);
    ctx.fillStyle = flash;
    ctx.fillRect(0, 0, W, H);

    if (o.angle != null) {
      const R = Math.min(W, H) * 0.42;
      const x = W / 2 + Math.cos(o.angle) * R;
      const y = H / 2 + Math.sin(o.angle) * R;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(o.angle);
      ctx.globalAlpha = 0.4 + 0.6 * a;
      ctx.fillStyle = '#ff4a4a';
      ctx.beginPath();
      ctx.moveTo(18, 0);
      ctx.lineTo(-12, -13);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-12, 13);
      ctx.closePath();
      ctx.fill();
      ctx.rotate(-o.angle);
      ctx.globalAlpha = a;
      ctx.fillStyle = '#ffe7c2';
      ctx.font = 'bold 14px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Pull the name back toward center so it stays on screen.
      const inward = -36;
      ctx.fillText(o.label || '', Math.cos(o.angle) * inward, Math.sin(o.angle) * inward);
      ctx.restore();
    }
  }
  ctx.restore();
}
