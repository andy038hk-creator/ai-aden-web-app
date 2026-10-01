# 沉香：劈山 — Chenxiang: Split the Mountain

Version: v0.2.0

Hades-like isometric roguelike prototype set in Chinese mythology: **沉香 (Chenxiang)** saving his mother from **二郎神 (Erlang Shen)**, aided by the **八仙 (Eight Immortals)**. Mixed melee (axe) + cast (**寶蓮燈** lotus lantern).

**Session length:** ~2–4 minutes. Clear 2 combat rooms → pick Baxian boons → boss tease → win/lose → restart.

## How to run

ES modules need a local HTTP server (opening `file://` may hit CORS):

```bash
cd chenxiang-roguelike
python3 -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080).

Alternatives: `npx serve` or any static file server from this folder.

## Controls

| Action | Keys |
|--------|------|
| Move | `WASD` or Arrow keys |
| Aim | Mouse — axe and lantern face the cursor 滑鼠瞄準 |
| Axe melee | `Space` / `J` / Left mouse |
| 寶蓮燈 cast | `K` / `F` / Right mouse |
| Pause | `Esc` |
| Mute | `M` |

Desktop keyboard/mouse first. Touch is a later pass.

## Core loop

1. **Title** → Start  
2. Clear **2 isometric combat rooms** (天兵 melee rushers + ranged)  
3. Between rooms: pick **1 of 3 八仙 cards** (passive boon or lantern/cast upgrade)  
4. Face **二郎神** boss tease (spear fans, slam, ring shots + 哮天犬)  
5. **Die** → Game Over + Restart · **Win** → Victory + Restart  

## Baxian implemented

**Passives**

- **鐵拐李** Iron-Crutch Li — +2 max HP  
- **呂洞賓** Lü Dongbin — +35% melee damage  
- **何仙姑** He Xiangu — lantern CD −30%  
- **韓湘子** Han Xiangzi — +25% move speed  

**Cast / weapon upgrades**

- **曹國舅** Cao Guojiu — lantern leaves lingering flame  
- **藍采和** Lan Caihe — lantern heals +1 HP  
- **張果老** Zhang Guolao — short dash + i-frames on cast  
- **漢鍾離** Han Zhongli — wider melee arc  

## Tech

Pure **HTML + CSS + Canvas2D + vanilla JS** (ES modules). No Phaser/Pixi, no npm build step, no external images — shapes/colors only. Dark mythic palette: crimson, gold, jade, ink.

```
chenxiang-roguelike/
  index.html
  css/style.css
  js/main.js game.js iso.js entities.js combat.js rooms.js baxian.js ui.js
  README.md
```

## What works / known limits

**Works:** title → rooms → reward UI → boss → win/lose → restart; melee + lantern; 8 Baxian; HUD; pause. v0.2 adds a Room 1 aim drill, lighter opening fight, hit-stop / damage numbers / knockback, hurt direction + low-HP vignette, last-hit line, procedural SFX, and a larger HUD (hearts, lantern READY, enemy count, Baxian icons).

**Limits / next**

- Only 2 combat rooms + short boss tease (expand map / room pool)  
- Shape art only — real sprites / tiles later  
- No narrative beats / dialogue yet  
- Boon shop depth & stacking balance TBD  
- Touch / gamepad later  
- Audio is procedural beeps, not scored music  

## Theme one-liner

*Split the mountain with axe and lotus fire — claim the Eight Immortals’ gifts, and challenge Erlang Shen.*
