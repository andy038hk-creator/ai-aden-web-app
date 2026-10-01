/**
 * 八仙 (Eight Immortals) — passive boons + active lantern upgrades.
 */

export const BAXIANS = [
  {
    id: 'tieguaili',
    glyph: '鐵',
    name: '鐵拐李',
    en: 'Iron-Crutch Li',
    kind: 'passive',
    tag: 'Passive · Vitality',
    desc: '+2 max HP. Chenxiang toughens under the crutch’s blessing.',
    apply(p) {
      p.maxHp += 2;
      p.hp = Math.min(p.hp + 2, p.maxHp);
    },
  },
  {
    id: 'ludongbin',
    glyph: '呂',
    name: '呂洞賓',
    en: 'Lü Dongbin',
    kind: 'passive',
    tag: 'Passive · Melee',
    desc: '+35% axe damage. The immortal sword sharpens every swing.',
    apply(p) {
      p.meleeDamage *= 1.35;
    },
  },
  {
    id: 'hexiangu',
    glyph: '何',
    name: '何仙姑',
    en: 'He Xiangu',
    kind: 'passive',
    tag: 'Passive · Lantern',
    desc: 'Lantern cooldown −30%. Lotus light returns sooner.',
    apply(p) {
      p.lanternCdMax *= 0.7;
    },
  },
  {
    id: 'hanxiangzi',
    glyph: '韓',
    name: '韓湘子',
    en: 'Han Xiangzi',
    kind: 'passive',
    tag: 'Passive · Speed',
    desc: '+25% move speed. Flute song quickens the feet.',
    apply(p) {
      p.speed *= 1.25;
    },
  },
  {
    id: 'caoguojiu',
    glyph: '曹',
    name: '曹國舅',
    en: 'Cao Guojiu',
    kind: 'cast',
    tag: 'Cast · Flame Trail',
    desc: 'Lantern leaves lingering flame that burns foes.',
    apply(p) {
      p.flags.lingeringFlame = true;
    },
  },
  {
    id: 'lancaihe',
    glyph: '藍',
    name: '藍采和',
    en: 'Lan Caihe',
    kind: 'cast',
    tag: 'Cast · Heal',
    desc: 'Lantern cast heals +1 HP. Basket of flowers mends wounds.',
    apply(p) {
      p.flags.lanternHeal = true;
    },
  },
  {
    id: 'zhangguolao',
    glyph: '張',
    name: '張果老',
    en: 'Zhang Guolao',
    kind: 'cast',
    tag: 'Cast · Dash',
    desc: 'Cast grants a short dash + brief i-frames.',
    apply(p) {
      p.flags.castDash = true;
    },
  },
  {
    id: 'hanzhongli',
    glyph: '鍾',
    name: '漢鍾離',
    en: 'Han Zhongli',
    kind: 'cast',
    tag: 'Cast · Wide Swing',
    desc: 'Melee arc +40% wider. Fan sweeps a broader path.',
    apply(p) {
      p.meleeArc *= 1.4;
      p.meleeRange *= 1.15;
    },
  },
];

/** Return 3 random unique Baxian cards (prefer mix). */
export function rollRewardChoices(ownedIds) {
  const pool = BAXIANS.filter((b) => !ownedIds.includes(b.id));
  // Prefer mix of passive + cast when possible
  const passives = pool.filter((b) => b.kind === 'passive');
  const casts = pool.filter((b) => b.kind === 'cast');
  const picks = [];
  if (passives.length) picks.push(passives[Math.floor(Math.random() * passives.length)]);
  if (casts.length) {
    const c = casts[Math.floor(Math.random() * casts.length)];
    if (!picks.find((p) => p.id === c.id)) picks.push(c);
  }
  const rest = pool.filter((b) => !picks.find((p) => p.id === b.id));
  while (picks.length < 3 && rest.length) {
    const i = Math.floor(Math.random() * rest.length);
    picks.push(rest.splice(i, 1)[0]);
  }
  // Shuffle
  for (let i = picks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [picks[i], picks[j]] = [picks[j], picks[i]];
  }
  return picks.slice(0, 3);
}
