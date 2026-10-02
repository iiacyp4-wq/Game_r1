'use strict';
// 블록 디펜스 — 하나하나 따로 움직이는 작은 큐브들이 방어선을 넘기 전에 부수는 게임
// 스테이지 사이 캡슐 머신에서 부품을 뽑아 조합하면 데미지·폭발력이 크게 늘어남
// 방어선 아래 4칸에 보조 타워를 세울 수 있음
// 좌표는 가로 360 기준의 "게임 좌표"로 계산하고, 화면 크기에 맞춰 늘려서 그림

const VERSION = 'v4.0';
const W = 360;
const BASE_MAX = 100;   // 기지 체력
const BEST_KEY = 'blockdefense:best';

// ---------- 무기 ----------
const WEAPONS = {
  laser: {
    name: '레이저', desc: '즉시 맞는 강한 한 줄. 갑옷·보스용', price: 0, color: '#2de2e6',
    interval: 0.35,
    stat: (lv) => ({ dmg: 10 * 1.22 ** (lv - 1), pierce: 1 }),
    statText: (s) => `세기 ${Math.round(s.dmg)}`,
  },
  shotgun: {
    name: '산탄총', desc: '약한 탄을 부채꼴로 여러 발. 떼거지용', price: 40, color: '#fffb96',
    interval: 0.5,
    stat: (lv) => ({ dmg: 3 * 1.22 ** (lv - 1), pellets: 7 + Math.floor((lv - 1) / 3) }),
    statText: (s) => `세기 ${s.dmg.toFixed(1)} × ${s.pellets}발`,
  },
  mortar: {
    name: '박격포', desc: '누른 자리에서 터져 주변을 휩쓸어요. 뭉친 적용', price: 90, color: '#ff8c42',
    interval: 0.75,
    stat: (lv) => ({ dmg: 6 * 1.22 ** (lv - 1), radius: Math.min(26 + 1.5 * (lv - 1), 44) }),
    statText: (s) => `세기 ${Math.round(s.dmg)} · 범위 ${Math.round(s.radius)}`,
  },
};
const upgradeCost = (lv) => Math.round(30 * 1.7 ** (lv - 1));

// ---------- 보조 타워 ----------
// 방어선 바로 아래 4칸(PADS)에 세움. 최대 Lv.5
const TOWERS = {
  gatling: {
    icon: '🔫', name: '기관포 탑', color: '#fffb96', price: 50,
    desc: '가장 가까운 적을 빠르게 쏴요',
    stat: (lv) => ({ dmg: 2.5 * 1.3 ** (lv - 1), interval: 0.28, range: 150 }),
    text: (s) => `세기 ${s.dmg.toFixed(1)} · 초당 ${(1 / s.interval).toFixed(1)}발`,
  },
  tesla: {
    icon: '⚡', name: '테슬라 탑', color: '#a8f0ff', price: 80,
    desc: '범위 안의 적 여러 마리를 번개로 지져요',
    stat: (lv) => ({ dmg: 5 * 1.3 ** (lv - 1), targets: 3 + Math.floor(lv / 2), interval: 1.0, range: 120 }),
    text: (s) => `세기 ${s.dmg.toFixed(1)} · ${s.targets}마리`,
  },
  frost: {
    icon: '❄️', name: '냉기 탑', color: '#bfefff', price: 70,
    desc: '범위 안의 적을 느리게 해요',
    stat: (lv) => ({ slow: Math.min(0.3 + 0.07 * (lv - 1), 0.6), range: 70 + 8 * (lv - 1) }),
    text: (s) => `${Math.round(s.slow * 100)}% 느리게 · 범위 ${s.range}`,
  },
  missile: {
    icon: '🚀', name: '미사일 탑', color: '#ff8c42', price: 110,
    desc: '적을 따라가는 미사일이 터져요',
    stat: (lv) => ({ dmg: 7 * 1.3 ** (lv - 1), radius: 22 + 2 * (lv - 1), interval: 1.6, range: 260 }),
    text: (s) => `세기 ${s.dmg.toFixed(1)} · 폭발 ${s.radius}`,
  },
  marker: {
    icon: '🎯', name: '표식 탑', color: '#ff3cac', price: 80,
    desc: '범위 안의 적이 받는 피해가 늘어요',
    stat: (lv) => ({ bonus: 0.25 + 0.05 * (lv - 1), range: 110 + 6 * (lv - 1) }),
    text: (s) => `받는 피해 +${Math.round(s.bonus * 100)}% · 범위 ${s.range}`,
  },
  shield: {
    icon: '🛡️', name: '방벽 탑', color: '#9fb3ff', price: 90,
    desc: '양옆 구역에서 선을 넘는 적을 막아요. 시간이 지나면 다시 충전',
    stat: (lv) => ({ max: 2 + lv, recharge: 9 - lv, width: 70 }),
    text: (s) => `${s.max}번 막기 · ${s.recharge}초마다 충전`,
  },
  mine: {
    icon: '💰', name: '채굴 탑', color: '#ffd166', price: 60,
    desc: '가만히 있어도 돈을 벌어요',
    stat: (lv) => ({ income: 0.5 * lv }),
    text: (s) => `초당 ● ${s.income.toFixed(1)}`,
  },
};
const PAD_X = [40, 105, 255, 320];
const TOWER_MAX = 5;
const towerUpCost = (type, lv) => Math.round(TOWERS[type].price * 0.8 * 1.6 ** (lv - 1));
const towerSell = (t) => { let sum = TOWERS[t.type].price; for (let l = 1; l < t.lv; l++) sum += towerUpCost(t.type, l); return Math.round(sum * 0.5); };

// ---------- 적 (큐브) ----------
// size: 한 변 길이, hp/speed: 기준 대비 배율, leak: 방어선을 넘으면 깎이는 기지 체력
const TYPES = {
  normal: { color: '#2de2e6', size: 8, hp: 1.0, speed: 1.0, reward: 0.5, leak: 5 },
  swarm: { color: '#ff3cac', size: 6, hp: 0.5, speed: 1.5, reward: 0.3, leak: 3 },
  charger: { color: '#ff6c11', size: 9, hp: 0.9, speed: 0.9, reward: 0.8, leak: 7 },
  armor: { color: '#c7cdff', size: 10, hp: 2.0, speed: 0.8, reward: 1.2, leak: 10, armor: 1 },
  cluster: { color: '#b967ff', size: 16, hp: 2.5, speed: 0.75, reward: 1.0, leak: 14 },
  shard: { color: '#dcb6ff', size: 7, hp: 0.6, speed: 1.2, reward: 0.3, leak: 4 },
  minion: { color: '#ff7eb6', size: 8, hp: 0.8, speed: 1.0, reward: 0.3, leak: 5 },
  boss: { color: '#ff2a6d', size: 0, hp: 150, speed: 0.4, reward: 0, leak: 999, armor: 1.3 },
};

// ---------- 부품 (가챠) ----------
const RARITY = {
  common: { name: '일반', color: '#d8d4f0', sell: 8, chance: 0.6 },
  rare: { name: '희귀', color: '#2de2e6', sell: 20, chance: 0.31 },
  legend: { name: '전설', color: '#ffd166', sell: 45, chance: 0.09 },
};
const PARTS = {
  nitro: { icon: '🧨', name: '니트로', rarity: 'legend', desc: '모든 폭발의 범위·세기 +50%' },
  hammer: { icon: '🔨', name: '파쇄 해머', rarity: 'legend', desc: '얼어붙은 적에게 주는 피해 ×3' },
  conduct: { icon: '🔗', name: '전도체', rarity: 'legend', desc: '번개가 3번 더 튀고, 튈 때마다 세기 ×1.25' },
  critamp: { icon: '🗡️', name: '치명 증폭기', rarity: 'legend', desc: '치명타 피해 ×2 → ×4' },
  fire: { icon: '🔥', name: '소이탄', rarity: 'rare', desc: '맞은 적이 3초 동안 불타요 (준 피해의 60%)' },
  oil: { icon: '🛢️', name: '기름 탱크', rarity: 'rare', desc: '불타던 적이 죽으면 크게 폭발해요' },
  frost: { icon: '❄️', name: '냉각탄', rarity: 'rare', desc: '40% 확률로 적을 2초 동안 얼려 느리게 해요' },
  tesla: { icon: '⚡', name: '테슬라 코일', rarity: 'rare', desc: '맞히면 번개가 근처 적 2마리에게 튀어요 (60% 세기)' },
  chain: { icon: '💥', name: '연쇄 폭발', rarity: 'rare', desc: '적이 죽으면 그 자리가 작게 터져요' },
  scope: { icon: '🎯', name: '저격 조준경', rarity: 'rare', desc: '치명타 확률 +20% (기본 5%)' },
  bounce: { icon: '🪃', name: '도탄', rarity: 'rare', desc: '레이저·산탄이 벽에서 한 번 튕겨요' },
  overload: { icon: '🔁', name: '과부하', rarity: 'rare', desc: '8번째 발사마다 세기 ×5' },
  pierce: { icon: '🌀', name: '관통 코어', rarity: 'common', desc: '레이저·산탄이 적을 1마리 더 뚫어요' },
  bounty: { icon: '💰', name: '현상금', rarity: 'common', desc: '적을 잡을 때 버는 돈 +30%' },
  battery: { icon: '🔋', name: '고물 배터리', rarity: 'common', desc: '연사 +5%, 대신 돈 -10%' },
  antenna: { icon: '📡', name: '장식 안테나', rarity: 'common', desc: '아무 효과 없어요. 대신 비싸게 팔려요', sell: 40 },
};
// 시너지: 함께 있으면 위력이 크게 늘어나는 조합
// 켜지면 두 부품 효과에 더해 '보너스'가 붙음
const SYNERGIES = [
  { key: 'inferno', name: '불바다', icon: '🔥', need: ['fire', 'oil'], desc: '불 피해 ×2, 기름 폭발 ×2·더 넓게' },
  { key: 'shatter', name: '빙결 파쇄', icon: '❄️', need: ['frost', 'hammer'], desc: '빙결 확률 70%·3초, 얼린 적 피해 ×3' },
  { key: 'storm', name: '연쇄 번개', icon: '⚡', need: ['tesla', 'conduct'], desc: '번개 세기 100%, 더 멀리 튐' },
  { key: 'bigbang', name: '대폭발', icon: '💥', need: ['chain', 'nitro'], desc: '연쇄 폭발 ×2·더 넓게 계속 번짐' },
  { key: 'oilbang', name: '기름 대폭발', icon: '🛢️', need: ['oil', 'nitro'], desc: '기름 폭발 범위 +30%' },
  { key: 'assassin', name: '급소 사냥', icon: '🎯', need: ['scope', 'critamp'], desc: '치명타 확률 +15% 더, 피해 ×4' },
  { key: 'pinball', name: '핀볼', icon: '🪃', need: ['bounce', 'pierce'], desc: '튕김 +2, 관통 +1 더' },
];
const SLOTS = 5;

// ---------- 상태 ----------
let G = null;
let H = 600, LINE_Y = 540, TURRET_Y = 570, PAD_Y = 555;
let scale = 1, dpr = 1;
const pointer = { down: false, x: W / 2, y: 0 };

function newGame() {
  return {
    stage: 0, base: BASE_MAX, money: 0, score: 0, kills: 0,
    weapons: { laser: 1 }, current: 'laser', cooldown: 0, shots: 0,
    parts: [], cnt: {},
    towers: [null, null, null, null],
    ult: { cd: 0, max: 40 },
    enemies: [], bullets: [], shells: [], missiles: [], beams: [], bolts: [], blasts: [], fx: [], bits: [], texts: [],
    toSpawn: 0, spawnT: 0, speed: 14, synOn: new Set(),
    combo: 0, comboTime: 0,
    state: 'title', boss: null, bossKilled: 0, rerolls: 0,
  };
}
const has = (id) => G.cnt[id] || 0;
function recalcParts() {
  G.cnt = {};
  for (const id of G.parts) G.cnt[id] = (G.cnt[id] || 0) + 1;
  G.synOn = new Set(activeSynergies().map((x) => x.key));
  updateHud();
}
const activeSynergies = (parts = G.parts) => SYNERGIES.filter((s) => s.need.every((id) => parts.includes(id)));
const syn = (key) => G.synOn && G.synOn.has(key);
const critChance = () => 0.05 + 0.2 * has('scope') + (syn('assassin') ? 0.15 : 0);
const critMult = () => 2 * 2 ** has('critamp');
const blastMult = () => 1.5 ** has('nitro');
const moneyMult = () => 1.3 ** has('bounty') * 0.9 ** has('battery');

// ---------- 화면 크기 + 우주 배경 ----------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let bg = null, stars = [];
function resize() {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  scale = rect.width / W;
  H = Math.round(rect.height / scale);
  LINE_Y = H - 58;
  PAD_Y = H - 36;
  TURRET_Y = H - 24;
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  bg = makeBackground();
  glowCache.clear();
}
window.addEventListener('resize', resize);
function makeBackground() {
  const k = dpr * scale;
  const c = document.createElement('canvas');
  c.width = Math.round(W * k); c.height = Math.round(H * k);
  const g = c.getContext('2d');
  g.scale(k, k);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#07021a'); grad.addColorStop(1, '#130631');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  for (const [x, y, r, col] of [[0.25, 0.22, 0.6, 'rgba(138,43,226,.28)'], [0.8, 0.55, 0.55, 'rgba(15,106,216,.22)'], [0.4, 0.85, 0.4, 'rgba(255,42,109,.14)']]) {
    const rg = g.createRadialGradient(x * W, y * H, 0, x * W, y * H, r * W);
    rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
  }
  g.strokeStyle = 'rgba(160,140,255,.045)'; g.lineWidth = 0.6;
  for (let y = 0, row = 0; y < H; y += 12, row++) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    for (let x = (row % 2) * 13; x < W; x += 26) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 12); g.stroke(); }
  }
  stars = [];
  for (let i = 0; i < 150; i++) {
    const s = { x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.1 + 0.25, a: Math.random() * 0.6 + 0.2, tw: Math.random() < 0.15 };
    if (!s.tw) { g.globalAlpha = s.a; g.fillStyle = '#fff'; g.beginPath(); g.arc(s.x, s.y, s.r, 0, Math.PI * 2); g.fill(); }
    stars.push(s);
  }
  g.globalAlpha = 1;
  return c;
}
// 큐브 뒤 네온 번짐 (색·크기별로 한 번만 만듦)
const glowCache = new Map();
function glowSprite(color, w, h) {
  const key = `${color}|${w}|${h}`;
  let s = glowCache.get(key);
  if (s) return s;
  const pad = 9, k = dpr * scale;
  s = document.createElement('canvas');
  s.width = Math.ceil((w + pad * 2) * k); s.height = Math.ceil((h + pad * 2) * k);
  const g = s.getContext('2d');
  g.scale(k, k);
  g.shadowColor = color; g.shadowBlur = 8;
  g.fillStyle = color; g.globalAlpha = 0.55;
  g.fillRect(pad, pad, w, h);
  s.pad = pad;
  glowCache.set(key, s);
  return s;
}

// ---------- 스테이지 / 적 생성 ----------
const isBossStage = (n) => n > 0 && n % 5 === 0;
const baseHp = (stage) => 6 * 1.17 ** (stage - 1);
const armorOf = (type) => (TYPES[type].armor ? TYPES[type].armor * 4 * 1.12 ** (G.stage - 1) : 0);
function startStage() {
  G.stage++;
  const n = G.stage;
  G.speed = Math.min(14 + n * 0.9, 34);
  G.toSpawn = isBossStage(n) ? 24 + n : Math.min(30 + 6 * n, 150);
  G.spawnT = 0.3;
  G.boss = null;
  if (isBossStage(n)) spawnBoss();
  G.state = 'play';
  showBanner(isBossStage(n) ? 'BOSS' : `STAGE ${n}`, isBossStage(n) ? '노란 약점을 노려요' : '', isBossStage(n));
  updateHud();
}
function addEnemy(type, x, y) {
  const t = TYPES[type];
  const hp = baseHp(G.stage) * t.hp;
  const e = {
    type, x, y, s: t.size, hp, max: hp,
    sp: t.speed * (0.82 + Math.random() * 0.36),         // 하나하나 속도가 다름
    sway: 6 + Math.random() * 12, ph: Math.random() * 6.28, wf: 0.8 + Math.random() * 1.4, // 좌우로 살짝 흔들림
    vx: 0, burn: 0, burnDps: 0, frozen: 0, hit: 0, dash: 0, warn: 0, next: 2 + Math.random() * 4,
  };
  G.enemies.push(e);
  return e;
}
function pickType() {
  const n = G.stage, r = Math.random();
  if (n >= 2 && r < 0.10 + n * 0.008) return 'charger';
  if (n >= 3 && r < 0.20 + n * 0.012) return 'cluster';
  if (n >= 4 && r < 0.30 + n * 0.014) return 'armor';
  return 'normal';
}
// 한 무리 생성: 줄 / V자 / 떼 / 흩뿌리기 (생긴 뒤에는 하나하나 따로 움직임)
function spawnGroup() {
  const kinds = G.stage >= 2 ? ['line', 'v', 'swarm', 'rain'] : ['line', 'rain'];
  const kind = kinds[Math.floor(Math.random() * kinds.length)];
  const out = [];
  if (kind === 'line') {
    const k = 5 + Math.floor(Math.random() * 5), x0 = 20 + Math.random() * (W - 40 - k * 22);
    for (let i = 0; i < k; i++) out.push([pickType(), x0 + i * 22, -10]);
  } else if (kind === 'v') {
    const cx = 60 + Math.random() * (W - 120);
    for (let i = 0; i < 7; i++) out.push([pickType(), cx + (i - 3) * 16, -10 - Math.abs(i - 3) * 14]);
  } else if (kind === 'swarm') {
    const cx = 40 + Math.random() * (W - 80), k = 8 + Math.floor(Math.random() * 7);
    for (let i = 0; i < k; i++) out.push(['swarm', cx + (Math.random() - 0.5) * 60, -10 - Math.random() * 40]);
  } else {
    const k = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < k; i++) out.push([pickType(), 12 + Math.random() * (W - 24), -10 - Math.random() * 70]);
  }
  for (const [type, x, y] of out.slice(0, G.toSpawn)) addEnemy(type, Math.max(8, Math.min(W - 8, x)), y);
  G.toSpawn -= Math.min(out.length, G.toSpawn);
}
function spawnBoss() {
  const hp = baseHp(G.stage) * TYPES.boss.hp;
  const e = {
    type: 'boss', x: W / 2, y: -30, w: 150, h: 44, s: 0, hp, max: hp, sp: TYPES.boss.speed, sway: 30, ph: 0, wf: 0.4,
    vx: 0, burn: 0, burnDps: 0, frozen: 0, hit: 0, weak: { t: 0, r: 11 }, shieldAt: [0.6, 0.3], shield: false, shedAt: 0.9,
  };
  G.enemies.push(e);
  G.boss = e;
}
const halfW = (e) => (e.type === 'boss' ? e.w / 2 : e.s / 2);
const halfH = (e) => (e.type === 'boss' ? e.h / 2 : e.s / 2);
const weakPos = (e) => ({ x: e.x + Math.sin(e.weak.t * 1.3) * (e.w / 2 - 16), y: e.y + e.h / 2 - 10 });
const bossLife = (e) => Math.max(0, e.hp / e.max);

// ---------- 피해 ----------
// src.kind: laser / pellet / blast / bolt / burn / tower
function markBonus(e) {
  let bonus = 0;
  G.towers.forEach((t, i) => {
    if (t && t.type === 'marker') { const s = TOWERS.marker.stat(t.lv); if (Math.hypot(e.x - PAD_X[i], e.y - PAD_Y) <= s.range) bonus = Math.max(bonus, s.bonus); }
  });
  return 1 + bonus;
}
function damage(e, raw, src) {
  if (e.dead) return;
  if (e.type === 'boss' && e.shield) { if (src.kind !== 'burn' && Math.random() < 0.2) addText(e.x, e.y, '막힘', '#9fb3ff'); return; }
  let d = raw;
  // 갑옷: 기본 세기가 갑옷보다 약하면 거의 안 들어감 (치명타·약점 전에 판정)
  const armor = armorOf(e.type);
  if (armor && d < armor && src.kind !== 'burn') d *= 0.1;
  let crit = false;
  if (src.kind !== 'burn' && Math.random() < critChance()) { d *= critMult(); crit = true; }
  if (e.frozen > 0 && has('hammer')) d *= 1 + 2 * has('hammer');
  if (e.type === 'boss' && src.weak) d *= 3;
  d *= markBonus(e);
  e.hp -= d;
  if (src.kind !== 'burn') e.hit = 0.06;
  G.score += d;
  if (crit && d > 1) addText(e.x, e.y - halfH(e) - 3, `${Math.round(d)}!`, '#fffb96');
  // 부품 효과 (타워 공격에도 붙음)
  if (src.kind !== 'burn') {
    if (has('fire')) { e.burn = 3; e.burnDps = Math.max(e.burnDps, (d * 0.6 * has('fire') * (syn('inferno') ? 2 : 1)) / 3); }
    if (has('frost') && Math.random() < (syn('shatter') ? 1 - 0.3 ** has('frost') : 1 - 0.6 ** has('frost'))) e.frozen = syn('shatter') ? 3 : 2;
    if (has('tesla') && src.kind !== 'bolt') lightning(e, d, 2 * has('tesla') + 3 * has('conduct'));
  }
  if (e.type === 'boss') {
    while (e.shieldAt.length && bossLife(e) <= e.shieldAt[0]) { e.shieldAt.shift(); bossShield(e); }
    while (e.shedAt > 0 && bossLife(e) <= e.shedAt) { e.shedAt -= 0.1; shedCubes(e); }
  }
  if (e.hp <= 0) kill(e);
}
// 번개: 근처 적에게 튐 (전도체가 있으면 튈 때마다 세짐)
function lightning(from, d, jumps) {
  let power = d * (syn('storm') ? 1 : 0.6), cur = from;
  const hit = new Set([from]);
  const reach = syn('storm') ? 110 : 70;
  while (jumps-- > 0) {
    let best = null, bd = reach;
    for (const e of G.enemies) {
      if (e.dead || hit.has(e)) continue;
      const dist = Math.hypot(e.x - cur.x, e.y - cur.y);
      if (dist < bd) { bd = dist; best = e; }
    }
    if (!best) break;
    hit.add(best);
    G.bolts.push({ x1: cur.x, y1: cur.y, x2: best.x, y2: best.y, life: 0.12 });
    power *= 1.25 ** has('conduct');
    damage(best, power, { kind: 'bolt' });
    cur = best;
  }
}
function kill(e) {
  if (e.dead) return;
  e.dead = true;
  G.kills++;
  G.combo = G.comboTime > 0 ? G.combo + 1 : 1;
  G.comboTime = 1.5;
  let reward = TYPES[e.type].reward * (1 + 0.06 * G.stage);
  if (e.type === 'boss') reward = 60 + G.stage * 15;
  const gain = reward * comboMult() * moneyMult();
  G.money += gain;
  if (gain >= 1) addText(e.x, e.y, `+${Math.floor(gain)}`, '#ffd166');
  for (let k = 0; k < (e.type === 'boss' ? 60 : 6); k++) addBit(e.x + (Math.random() - 0.5) * (halfW(e) * 2), e.y + (Math.random() - 0.5) * (halfH(e) * 2), TYPES[e.type].color, e.type === 'boss' ? 2 : 1);
  // 폭발 부품: 바로 터뜨리면 끝없이 이어질 수 있어서 대기열에 넣고 매 프레임 조금씩 처리
  if (e.type !== 'boss') {
    if (has('chain')) G.blasts.push({ x: e.x, y: e.y, r: syn('bigbang') ? 26 : 18, dmg: baseHp(G.stage) * 0.8 * has('chain') * (syn('bigbang') ? 2 : 1) });
    if (has('oil') && e.burn > 0) G.blasts.push({ x: e.x, y: e.y, r: 30 * (syn('inferno') ? 1.2 : 1) * (syn('oilbang') ? 1.3 : 1), dmg: baseHp(G.stage) * 1.6 * has('oil') * (syn('inferno') ? 2 : 1), fire: true });
  }
  if (e.type === 'cluster') {
    for (let k = 0; k < 4; k++) {
      const s = addEnemy('shard', e.x + (k % 2 ? 5 : -5), e.y + (k < 2 ? -5 : 5));
      s.vx = (k % 2 ? 1 : -1) * (40 + Math.random() * 30);
    }
  }
  if (e.type === 'boss') {
    G.boss = null;
    G.bossKilled++;
    G.base = Math.min(BASE_MAX, G.base + 25);
    for (const m of G.enemies) m.escort = false;
    G.fx.push({ type: 'flash', life: 0.4, max: 0.4 });
    showBanner('보스 격파!', `+${Math.floor(gain)} · 기지 회복`, false);
  }
  if (e.escort && G.boss && !G.enemies.some((m) => m.escort && !m.dead)) {
    G.boss.shield = false;
    showBanner('보호막 해제!', '지금 강한 무기로', false);
  }
  updateHud();
}
const comboMult = () => 1 + Math.min(5, Math.floor(G.combo / 5)) * 0.1;
function bossShield(b) {
  b.shield = true;
  for (let k = 0; k < 12; k++) { const m = addEnemy('minion', 20 + (k / 11) * (W - 40), b.y + b.h / 2 + 14 + (k % 2) * 14); m.escort = true; }
  showBanner('보호막!', '졸개를 먼저 치워요', true);
}
// 보스가 깎일 때마다 큐브가 떨어져 나와 따로 움직임
function shedCubes(b) {
  for (let k = 0; k < 5; k++) {
    const c = addEnemy('normal', b.x + (Math.random() - 0.5) * b.w, b.y + b.h / 2 + 4);
    c.vx = (Math.random() - 0.5) * 120;
  }
}

// ---------- 발사 ----------
function aimAngle() {
  const dx = pointer.x - W / 2, dy = pointer.y - TURRET_Y;
  let a = Math.atan2(dy, dx);
  const min = -Math.PI + 0.09, max = -0.09;
  if (a > max && a <= Math.PI / 2) a = max;
  if (a > Math.PI / 2 || a < min) a = min;
  return a;
}
function fire() {
  const w = G.current, s = { ...WEAPONS[w].stat(G.weapons[w]) };
  G.shots++;
  const over = has('overload') && G.shots % 8 === 0 ? 5 : 1; // 과부하
  s.dmg *= over;
  const a = aimAngle(), dx = Math.cos(a), dy = Math.sin(a);
  const ox = W / 2 + dx * 20, oy = TURRET_Y + dy * 20;
  if (w === 'laser') {
    const pb = syn('pinball');
    laser(ox, oy, dx, dy, s.dmg, s.pierce + has('pierce') + (pb ? 1 : 0), has('bounce') + (pb ? 2 : 0), over > 1);
  } else if (w === 'shotgun') {
    const spread = 0.6;
    for (let i = 0; i < s.pellets; i++) {
      const aa = a - spread / 2 + (spread * i) / (s.pellets - 1) + (Math.random() - 0.5) * 0.05;
      G.bullets.push({ x: ox, y: oy, vx: Math.cos(aa) * 620, vy: Math.sin(aa) * 620, dmg: s.dmg, pierce: has('pierce') + (syn('pinball') ? 1 : 0), bounce: has('bounce') + (syn('pinball') ? 2 : 0), life: 0.75, hitSet: new Set(), big: over > 1, kind: 'pellet' });
    }
  } else if (w === 'mortar') {
    const dist = Math.min(Math.hypot(pointer.x - ox, pointer.y - oy), 640);
    G.shells.push({ x: ox, y: oy, vx: dx * 480, vy: dy * 480, left: Math.max(dist, 40), dmg: s.dmg, r: s.radius, big: over > 1 });
  }
  G.cooldown = WEAPONS[w].interval / 1.05 ** has('battery');
}
// 레이저: 가까운 적부터 pierce마리까지. 도탄이면 옆 벽에서 한 번 꺾임
function laser(ox, oy, dx, dy, dmg, pierce, bounces, big) {
  let left = pierce, x = ox, y = oy;
  for (let seg = 0; seg <= bounces && left > 0; seg++) {
    let tEnd = 900;
    if (dx > 0) tEnd = Math.min(tEnd, (W - x) / dx); else if (dx < 0) tEnd = Math.min(tEnd, -x / dx);
    if (dy < 0) tEnd = Math.min(tEnd, (y + 10) / -dy);
    const hits = [];
    for (const e of G.enemies) {
      if (e.dead) continue;
      const t = rayBox(x, y, dx, dy, e);
      if (t != null && t <= tEnd) hits.push([t, e]);
    }
    hits.sort((p, q) => p[0] - q[0]);
    let reach = tEnd;
    for (const [t, e] of hits) {
      if (left <= 0) break;
      const weak = e.type === 'boss' && rayCircle(x, y, dx, dy, weakPos(e), e.weak.r);
      damage(e, dmg, { kind: 'laser', weak });
      left--;
      if (left <= 0 || (e.type === 'boss' && e.shield)) { reach = t + 4; left = 0; break; }
    }
    G.beams.push({ x1: x, y1: y, x2: x + dx * reach, y2: y + dy * reach, life: 0.1, big });
    x += dx * reach; y += dy * reach;
    if (reach < tEnd - 0.5 || y < 0) break;
    dx = -dx; // 옆 벽에서 튕김
  }
}
function explode(x, y, dmg, r, opts = {}) {
  r *= blastMult(); dmg *= blastMult();
  for (const e of [...G.enemies]) {
    if (e.dead) continue;
    const cx = Math.max(e.x - halfW(e), Math.min(x, e.x + halfW(e))), cy = Math.max(e.y - halfH(e), Math.min(y, e.y + halfH(e)));
    const d = Math.hypot(cx - x, cy - y);
    if (d <= r) damage(e, dmg * (1 - 0.3 * d / r), { kind: 'blast', weak: e.type === 'boss' && Math.hypot(x - weakPos(e).x, y - weakPos(e).y) < r * 0.5 });
  }
  G.fx.push({ type: 'ring', x, y, r, life: 0.3, max: 0.3, color: opts.fire ? '#ff6c11' : '#ff8c42' });
}
function useUlt() {
  if (G.state !== 'play' || G.ult.cd > 0) return;
  const dmg = baseHp(G.stage) * 0.9;
  for (const e of [...G.enemies]) if (!e.dead) damage(e, dmg, { kind: 'blast' });
  G.ult.cd = G.ult.max;
  G.fx.push({ type: 'flash', life: 0.35, max: 0.35 });
  buzz();
}

// ---------- 보조 타워 동작 ----------
function nearestEnemy(x, y, range, filter) {
  let best = null, bd = range;
  for (const e of G.enemies) {
    if (e.dead || e.y < -5 || (filter && !filter(e))) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
// 냉기 탑 범위 안이면 느려짐 (가장 센 냉기 탑 기준)
function towerSlow(e) {
  let slow = 0;
  G.towers.forEach((t, i) => {
    if (t && t.type === 'frost') { const s = TOWERS.frost.stat(t.lv); if (Math.hypot(e.x - PAD_X[i], e.y - PAD_Y) <= s.range) slow = Math.max(slow, s.slow); }
  });
  return 1 - slow;
}
function updateTowers(dt) {
  G.towers.forEach((t, i) => {
    if (!t) return;
    const s = TOWERS[t.type].stat(t.lv), x = PAD_X[i], y = PAD_Y;
    t.cd -= dt;
    if (t.type === 'gatling' && t.cd <= 0) {
      const e = nearestEnemy(x, y, s.range);
      if (e) {
        const a = Math.atan2(e.y - y, e.x - x);
        t.aim = a;
        G.bullets.push({ x, y: y - 6, vx: Math.cos(a) * 560, vy: Math.sin(a) * 560, dmg: s.dmg, pierce: 0, bounce: 0, life: 0.5, hitSet: new Set(), tower: true, kind: 'tower' });
        t.cd = s.interval;
      }
    } else if (t.type === 'tesla' && t.cd <= 0) {
      const inRange = G.enemies.filter((e) => !e.dead && e.y > -5 && Math.hypot(e.x - x, e.y - y) <= s.range)
        .sort((p, q) => q.y - p.y).slice(0, s.targets);
      if (inRange.length) {
        for (const e of inRange) { G.bolts.push({ x1: x, y1: y - 8, x2: e.x, y2: e.y, life: 0.14 }); damage(e, s.dmg, { kind: 'tower' }); }
        t.cd = s.interval;
      }
    } else if (t.type === 'missile' && t.cd <= 0) {
      const e = nearestEnemy(x, y, s.range);
      if (e) { G.missiles.push({ x, y: y - 8, vx: 0, vy: -160, target: e, dmg: s.dmg, r: s.radius, life: 3 }); t.cd = s.interval; }
    } else if (t.type === 'mine') {
      G.money += s.income * dt;
    } else if (t.type === 'shield') {
      if (t.charge == null) t.charge = s.max;
      if (t.charge < s.max) { t.re = (t.re || 0) + dt; if (t.re >= s.recharge) { t.re = 0; t.charge++; } }
    }
  });
}
// 방벽 탑: 자기 구역에서 선을 넘는 적을 막음
function shieldBlocks(e) {
  for (let i = 0; i < 4; i++) {
    const t = G.towers[i];
    if (!t || t.type !== 'shield' || !(t.charge > 0) || e.type === 'boss') continue;
    if (Math.abs(e.x - PAD_X[i]) <= TOWERS.shield.stat(t.lv).width / 2) {
      t.charge--;
      G.fx.push({ type: 'ring', x: e.x, y: LINE_Y, r: 14, life: 0.3, max: 0.3, color: '#9fb3ff' });
      return true;
    }
  }
  return false;
}

// ---------- 충돌 ----------
function rayBox(ox, oy, dx, dy, e) {
  const x0 = e.x - halfW(e), x1 = e.x + halfW(e), y0 = e.y - halfH(e), y1 = e.y + halfH(e);
  let tmin = 0, tmax = 2000;
  for (const [o, d, lo, hi] of [[ox, dx, x0, x1], [oy, dy, y0, y1]]) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return null; continue; }
    let t1 = (lo - o) / d, t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
function rayCircle(ox, oy, dx, dy, c, r) {
  const fx = c.x - ox, fy = c.y - oy, t = fx * dx + fy * dy;
  return t >= 0 && Math.hypot(fx - dx * t, fy - dy * t) <= r;
}
const inside = (x, y, e) => Math.abs(x - e.x) <= halfW(e) && Math.abs(y - e.y) <= halfH(e);

// ---------- 효과 ----------
function addBit(x, y, color, power) {
  if (G.bits.length > 700) return;
  const a = Math.random() * Math.PI * 2, v = (40 + Math.random() * 110) * power;
  G.bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, life: 0.6 + Math.random() * 0.3, color });
}
function addText(x, y, text, color) { if (G.texts.length < 40) G.texts.push({ x, y, text, color, life: 0.8 }); }
function buzz() { if (navigator.vibrate) navigator.vibrate(30); }

// ---------- 매 프레임 ----------
function update(dt) {
  if (G.state !== 'play') return;
  G.ult.cd = Math.max(0, G.ult.cd - dt);
  G.comboTime -= dt;
  if (G.comboTime <= 0) G.combo = 0;

  G.spawnT -= dt;
  if (G.toSpawn > 0 && G.spawnT <= 0) { spawnGroup(); G.spawnT = Math.max(1.1, 3 - G.stage * 0.08) * (0.8 + Math.random() * 0.4); }

  // 적 이동: 하나하나 따로
  for (const e of G.enemies) {
    if (e.dead) continue;
    e.hit = Math.max(0, e.hit - dt);
    const slow = (e.frozen > 0 ? 0.4 : 1) * towerSlow(e);
    e.frozen = Math.max(0, e.frozen - dt);
    const base = e.type === 'boss' || e.escort ? G.speed * 0.55 : G.speed;
    e.y += base * e.sp * slow * dt;
    e.ph += e.wf * dt;
    e.x += (Math.cos(e.ph) * e.sway * e.wf + e.vx) * slow * dt;
    e.vx *= 0.94;
    const hw = halfW(e);
    if (e.x < hw) { e.x = hw; e.vx = Math.abs(e.vx); } else if (e.x > W - hw) { e.x = W - hw; e.vx = -Math.abs(e.vx); }
    if (e.type === 'boss') e.weak.t += dt;
    if (e.type === 'charger') {
      if (e.dash > 0) { const d = Math.min(e.dash, 200 * dt); e.y += d; e.dash -= d; }
      else if (e.warn > 0) { e.warn -= dt; if (e.warn <= 0) e.dash = 40; }
      else if ((e.next -= dt) <= 0 && e.y > 0) { e.warn = 0.7; e.next = 3 + Math.random() * 3; }
    }
    if (e.burn > 0) {
      e.burn -= dt;
      damage(e, e.burnDps * dt, { kind: 'burn' });
      if (Math.random() < dt * 6) addBit(e.x, e.y, '#ff8c42', 0.4);
      if (e.burn <= 0) e.burnDps = 0;
      if (e.dead) continue;
    }
    if (e.y + halfH(e) >= LINE_Y) {
      if (shieldBlocks(e)) { kill(e); continue; }
      e.dead = true;
      G.base -= TYPES[e.type].leak;
      (G.leaks ||= {})[e.type] = (G.leaks[e.type] || 0) + 1; // 시험용 기록
      G.fx.push({ type: 'flash', life: 0.2, max: 0.2, red: true });
      for (let k = 0; k < 6; k++) addBit(e.x, LINE_Y, '#ff2a6d', 1.2);
      if (e.type === 'boss') G.base = 0;
      buzz();
      updateHud();
      if (G.base <= 0) return gameOver();
    }
  }

  G.cooldown -= dt;
  if (pointer.down && G.cooldown <= 0) fire();
  updateTowers(dt);

  // 산탄 + 기관포 탄
  for (const p of G.bullets) {
    const steps = Math.ceil(Math.hypot(p.vx, p.vy) * dt / 3);
    for (let k = 0; k < steps && p.life > 0; k++) {
      p.x += p.vx * dt / steps; p.y += p.vy * dt / steps;
      if ((p.x < 0 || p.x > W) && p.bounce > 0) { p.vx = -p.vx; p.x = Math.max(0, Math.min(W, p.x)); p.bounce--; }
      for (const e of G.enemies) {
        if (e.dead || p.hitSet.has(e) || !inside(p.x, p.y, e)) continue;
        p.hitSet.add(e);
        damage(e, p.dmg, { kind: p.kind, weak: e.type === 'boss' && Math.hypot(p.x - weakPos(e).x, p.y - weakPos(e).y) < e.weak.r + 2 });
        if (p.pierce-- <= 0) { p.life = 0; break; }
      }
    }
    p.life -= dt;
  }
  G.bullets = G.bullets.filter((p) => p.life > 0 && p.y > -20 && p.x > -20 && p.x < W + 20);

  for (const s of G.shells) {
    const steps = Math.ceil(Math.hypot(s.vx, s.vy) * dt / 3);
    for (let k = 0; k < steps && !s.done; k++) {
      s.x += s.vx * dt / steps; s.y += s.vy * dt / steps; s.left -= Math.hypot(s.vx, s.vy) * dt / steps;
      const hitE = G.enemies.some((e) => !e.dead && inside(s.x, s.y, e));
      if (hitE || s.left <= 0 || s.y < -10) { explode(s.x, s.y, s.dmg, s.r); s.done = true; }
    }
  }
  G.shells = G.shells.filter((s) => !s.done);

  // 미사일: 목표를 따라감 (목표가 죽으면 새 목표)
  for (const m of G.missiles) {
    if (!m.target || m.target.dead) m.target = nearestEnemy(m.x, m.y, 400);
    if (m.target) {
      const a = Math.atan2(m.target.y - m.y, m.target.x - m.x), sp = 300;
      m.vx += (Math.cos(a) * sp - m.vx) * Math.min(1, dt * 6);
      m.vy += (Math.sin(a) * sp - m.vy) * Math.min(1, dt * 6);
    }
    m.x += m.vx * dt; m.y += m.vy * dt; m.life -= dt;
    if (Math.random() < 0.6) G.bits.push({ x: m.x, y: m.y, vx: 0, vy: 0, life: 0.25, color: '#ff8c42' });
    const hitE = G.enemies.some((e) => !e.dead && inside(m.x, m.y, e));
    if (hitE || m.life <= 0 || m.y < -20) { explode(m.x, m.y, m.dmg, m.r); m.done = true; }
  }
  G.missiles = G.missiles.filter((m) => !m.done);

  for (let k = 0; k < 25 && G.blasts.length; k++) {
    const b = G.blasts.shift();
    explode(b.x, b.y, b.dmg, b.r, { fire: b.fire });
  }

  G.enemies = G.enemies.filter((e) => !e.dead);

  for (const f of G.bits) { f.life -= dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 260 * dt; f.vx *= 0.98; }
  G.bits = G.bits.filter((f) => f.life > 0 && f.y < H + 10);
  for (const list of [G.fx, G.beams, G.bolts]) for (const f of list) f.life -= dt;
  G.fx = G.fx.filter((f) => f.life > 0);
  G.beams = G.beams.filter((b) => b.life > 0);
  G.bolts = G.bolts.filter((b) => b.life > 0);
  for (const t of G.texts) { t.life -= dt; t.y -= 30 * dt; }
  G.texts = G.texts.filter((t) => t.life > 0);

  if (G.toSpawn <= 0 && !G.enemies.length && !G.boss && !G.blasts.length) stageClear();
}

// ---------- 그리기 ----------
function draw() {
  if (bg) ctx.drawImage(bg, 0, 0, W, H); else ctx.clearRect(0, 0, W, H);
  const now = performance.now() / 1000;
  ctx.fillStyle = '#fff';
  for (const s of stars) {
    if (!s.tw) continue;
    ctx.globalAlpha = s.a * (0.5 + 0.5 * Math.sin(now * 2 + s.x));
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r + 0.3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 타워 범위 (냉기·표식은 늘 옅게 보임)
  G.towers.forEach((t, i) => {
    if (!t || !(t.type === 'frost' || t.type === 'marker')) return;
    const s = TOWERS[t.type].stat(t.lv);
    ctx.globalAlpha = 0.07; ctx.fillStyle = TOWERS[t.type].color;
    ctx.beginPath(); ctx.arc(PAD_X[i], PAD_Y, s.range, Math.PI, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  });

  ctx.save();
  ctx.strokeStyle = '#ff2a6d'; ctx.shadowColor = '#ff2a6d'; ctx.shadowBlur = 12;
  ctx.setLineDash([10, 6]); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, LINE_Y); ctx.lineTo(W, LINE_Y); ctx.stroke();
  ctx.restore();

  for (const e of G.enemies) drawEnemy(e);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const b of G.beams) {
    const k = b.life / 0.1;
    ctx.globalAlpha = k * 0.35; ctx.strokeStyle = b.big ? '#ffd166' : '#2de2e6'; ctx.lineWidth = b.big ? 12 : 7;
    ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
    ctx.globalAlpha = k; ctx.strokeStyle = '#e9ffff'; ctx.lineWidth = b.big ? 3.5 : 2;
    ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
  }
  for (const b of G.bolts) {
    ctx.globalAlpha = b.life / 0.12; ctx.strokeStyle = '#a8f0ff'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(b.x1, b.y1);
    for (let k = 1; k < 5; k++) { const t = k / 5; ctx.lineTo(b.x1 + (b.x2 - b.x1) * t + (Math.random() - 0.5) * 8, b.y1 + (b.y2 - b.y1) * t + (Math.random() - 0.5) * 8); }
    ctx.lineTo(b.x2, b.y2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (const p of G.bullets) {
    const r = p.tower ? 3 : p.big ? 6 : 4;
    ctx.fillStyle = p.big ? 'rgba(255,209,102,.5)' : 'rgba(255,251,150,.35)'; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fffde0'; ctx.beginPath(); ctx.arc(p.x, p.y, p.tower ? 1.3 : 1.8, 0, Math.PI * 2); ctx.fill();
  }
  for (const s of G.shells) {
    ctx.fillStyle = 'rgba(255,140,66,.35)'; ctx.beginPath(); ctx.arc(s.x, s.y, s.big ? 12 : 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd2b0'; ctx.beginPath(); ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2); ctx.fill();
  }
  for (const m of G.missiles) { ctx.fillStyle = '#ffd2b0'; ctx.beginPath(); ctx.arc(m.x, m.y, 2.6, 0, Math.PI * 2); ctx.fill(); }
  for (const f of G.bits) {
    ctx.globalAlpha = Math.min(1, f.life * 1.6);
    ctx.fillStyle = f.color;
    ctx.fillRect(f.x - 1.6, f.y - 1.6, 3.2, 3.2);
  }
  for (const f of G.fx) {
    const k = f.life / f.max;
    if (f.type === 'ring') {
      ctx.globalAlpha = k * 0.25; ctx.fillStyle = f.color; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1.05 - k * 0.3), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = k; ctx.strokeStyle = f.color; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1.1 - k * 0.4), 0, Math.PI * 2); ctx.stroke();
    } else if (f.type === 'flash') {
      ctx.globalAlpha = k * 0.35; ctx.fillStyle = f.red ? '#ff2a6d' : '#b967ff'; ctx.fillRect(0, 0, W, H);
    }
  }
  ctx.restore();

  drawTowers();

  const a = aimAngle();
  const wc = WEAPONS[G.current].color;
  if (pointer.down && G.state === 'play') {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.setLineDash([4, 6]); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(W / 2, TURRET_Y); ctx.lineTo(W / 2 + Math.cos(a) * 700, TURRET_Y + Math.sin(a) * 700); ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  ctx.shadowColor = wc; ctx.shadowBlur = 10;
  ctx.strokeStyle = wc; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(W / 2, TURRET_Y); ctx.lineTo(W / 2 + Math.cos(a) * 24, TURRET_Y + Math.sin(a) * 24); ctx.stroke();
  ctx.fillStyle = '#12062e'; ctx.strokeStyle = '#b967ff'; ctx.lineWidth = 2; ctx.shadowColor = '#b967ff';
  ctx.beginPath(); ctx.arc(W / 2, TURRET_Y, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();

  ctx.textAlign = 'center'; ctx.font = '800 11px -apple-system, "Apple SD Gothic Neo", sans-serif';
  for (const t of G.texts) { ctx.globalAlpha = Math.min(1, t.life * 2); ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, t.y); }
  ctx.globalAlpha = 1;
}
function drawTowers() {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < 4; i++) {
    const t = G.towers[i], x = PAD_X[i], y = PAD_Y;
    ctx.save();
    if (!t) {
      ctx.strokeStyle = 'rgba(185,103,255,.55)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(185,103,255,.8)'; ctx.font = '700 13px sans-serif'; ctx.fillText('+', x, y + 0.5);
    } else {
      const c = TOWERS[t.type].color;
      ctx.fillStyle = '#12062e'; ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.shadowColor = c; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.font = '12px sans-serif'; ctx.fillText(TOWERS[t.type].icon, x, y + 0.5);
      // 레벨 점
      ctx.fillStyle = c;
      for (let l = 0; l < t.lv; l++) ctx.fillRect(x - 9 + l * 4, y + 14, 2.4, 2.4);
      if (t.type === 'shield') { ctx.fillStyle = '#9fb3ff'; ctx.font = '700 9px sans-serif'; ctx.fillText(`${t.charge ?? TOWERS.shield.stat(t.lv).max}`, x + 14, y - 10); }
    }
    ctx.restore();
  }
  ctx.textBaseline = 'alphabetic';
}
function drawEnemy(e) {
  const t = TYPES[e.type];
  const hw = halfW(e), hh = halfH(e);
  if (e.type === 'charger' && e.warn > 0 && Math.floor(e.warn * 10) % 2 === 0) {
    ctx.strokeStyle = '#ff2a6d'; ctx.lineWidth = 1.5;
    ctx.strokeRect(e.x - hw - 3, e.y - hh - 3, hw * 2 + 6, hh * 2 + 6);
  }
  const color = e.frozen > 0 ? '#bfefff' : t.color;
  const glow = glowSprite(color, hw * 2, hh * 2);
  ctx.globalAlpha = 0.5 + 0.5 * Math.max(0, e.hp / e.max);
  ctx.drawImage(glow, e.x - hw - glow.pad, e.y - hh - glow.pad, hw * 2 + glow.pad * 2, hh * 2 + glow.pad * 2);
  ctx.fillStyle = e.hit > 0 ? '#ffffff' : color;
  ctx.fillRect(e.x - hw, e.y - hh, hw * 2, hh * 2);
  // 안쪽 어두운 칸: 체력이 깎일수록 커짐 (네온 테두리만 남는 느낌)
  const k = 1 - Math.max(0, e.hp / e.max);
  if (k > 0.05 && e.type !== 'boss') {
    ctx.fillStyle = 'rgba(7,2,26,.75)';
    const iw = (hw * 2 - 2) * k, ih = (hh * 2 - 2) * k;
    ctx.fillRect(e.x - iw / 2, e.y - ih / 2, iw, ih);
  }
  ctx.globalAlpha = 1;
  if (e.type === 'armor') { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(e.x - hw - 1, e.y - hh - 1, hw * 2 + 2, hh * 2 + 2); }
  if (e.burn > 0) { ctx.strokeStyle = '#ff8c42'; ctx.lineWidth = 1; ctx.globalAlpha = 0.6 + 0.4 * Math.random(); ctx.strokeRect(e.x - hw - 1.5, e.y - hh - 1.5, hw * 2 + 3, hh * 2 + 3); ctx.globalAlpha = 1; }
  if (e.type === 'boss') {
    ctx.strokeStyle = 'rgba(7,2,26,.35)'; ctx.lineWidth = 1;
    for (let x = e.x - hw + 6; x < e.x + hw; x += 6) { ctx.beginPath(); ctx.moveTo(x, e.y - hh); ctx.lineTo(x, e.y + hh); ctx.stroke(); }
    for (let y = e.y - hh + 6; y < e.y + hh; y += 6) { ctx.beginPath(); ctx.moveTo(e.x - hw, y); ctx.lineTo(e.x + hw, y); ctx.stroke(); }
    const wp = weakPos(e);
    ctx.save();
    ctx.fillStyle = '#fffb96'; ctx.shadowColor = '#fffb96'; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.arc(wp.x, wp.y, e.weak.r * 0.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(e.x - hw, e.y - hh - 8, hw * 2, 3);
    ctx.fillStyle = '#ff2a6d'; ctx.fillRect(e.x - hw, e.y - hh - 8, hw * 2 * bossLife(e), 3);
    if (e.shield) {
      ctx.save();
      ctx.strokeStyle = '#9fb3ff'; ctx.fillStyle = 'rgba(159,179,255,.12)'; ctx.lineWidth = 2;
      ctx.shadowColor = '#9fb3ff'; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.rect(e.x - hw - 6, e.y - hh - 6, hw * 2 + 12, hh * 2 + 12); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }
}

// ---------- 화면(HUD) ----------
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const money = () => Math.floor(G.money);
function updateHud() {
  $('#hud-stage').textContent = isBossStage(G.stage) ? `STAGE ${G.stage} · BOSS` : `STAGE ${Math.max(G.stage, 1)}`;
  $('#hud-stage').classList.toggle('boss', isBossStage(G.stage) && !!G.boss);
  const b = Math.max(0, Math.ceil(G.base));
  $('#hud-lives').innerHTML = `<span class="base-bar"><i style="width:${(b / BASE_MAX) * 100}%"></i></span><b>${b}</b>`;
  $('#hud-lives').classList.toggle('low', b <= 30);
  $('#hud-money').textContent = money().toLocaleString();
  for (const btn of $$('.weapon')) {
    const w = btn.dataset.w, def = WEAPONS[w], lv = G.weapons[w];
    btn.classList.toggle('active', G.current === w);
    btn.classList.toggle('locked', !lv);
    btn.classList.toggle('afford', !lv && G.money >= def.price);
    btn.style.setProperty('--wc', def.color);
    btn.innerHTML = lv
      ? `<span class="w-name">${def.name}</span><span class="w-sub">Lv.${lv}</span>`
      : `<span class="w-name">🔒 ${def.name}</span><span class="w-sub">● ${def.price}</span>`;
  }
  renderPartsBar();
}
function renderPartsBar() {
  const syn = activeSynergies();
  $('#parts-bar').innerHTML = G.parts.map((id) => `<span class="pb" style="--rc:${RARITY[PARTS[id].rarity].color}" title="${PARTS[id].name}">${PARTS[id].icon}</span>`).join('')
    + syn.map((s) => `<span class="syn">${s.icon} ${s.name}</span>`).join('');
}
function updateUltButton() {
  const btn = $('#btn-ult');
  btn.classList.toggle('ready', G.ult.cd <= 0);
  btn.style.setProperty('--fill', `${(1 - G.ult.cd / G.ult.max) * 100}%`);
  $('#ult-cd').textContent = G.ult.cd > 0 ? `${Math.ceil(G.ult.cd)}초` : '사용 가능';
}
let lastCombo = -1;
function updateCombo() {
  if (G.combo === lastCombo) return;
  lastCombo = G.combo;
  const el = $('#combo');
  if (G.combo >= 5) { el.textContent = `${G.combo} 콤보 · 돈 ×${comboMult().toFixed(1)}`; el.hidden = false; } else el.hidden = true;
}
let bannerTimer;
function showBanner(text, sub, boss) {
  const el = $('#banner');
  el.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
  el.classList.toggle('boss', !!boss);
  el.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => (el.hidden = true), 1600);
}
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 1600);
}
function overlay(id) { for (const o of $$('.overlay')) o.hidden = o.id !== id; }

// ---------- 타워 메뉴 ----------
let towerPad = -1;
function openTower(i) {
  if (G.state !== 'play') return;
  G.state = 'tower';
  pointer.down = false;
  towerPad = i;
  renderTowerMenu();
  overlay('ov-tower');
}
function renderTowerMenu() {
  const t = G.towers[towerPad];
  $('#tower-money').textContent = money().toLocaleString();
  if (!t) {
    $('#tower-title').textContent = '타워 세우기';
    $('#tower-body').innerHTML = Object.entries(TOWERS).map(([id, d]) => `<div class="shop-item" style="--wc:${d.color}">
      <div><b>${d.icon} ${d.name}</b></div>
      <button data-build="${id}" ${G.money < d.price ? 'disabled' : ''}>세우기 ● ${d.price}</button>
      <p>${d.desc}<br>${d.text(d.stat(1))}</p></div>`).join('');
  } else {
    const d = TOWERS[t.type], maxed = t.lv >= TOWER_MAX, cost = towerUpCost(t.type, t.lv);
    $('#tower-title').textContent = `${d.icon} ${d.name} Lv.${t.lv}`;
    $('#tower-body').innerHTML = `<div class="shop-item" style="--wc:${d.color}">
      <div><b>${d.name}</b><span class="lv">Lv.${t.lv}</span></div>
      <button data-tup ${maxed || G.money < cost ? 'disabled' : ''}>${maxed ? '최고 레벨' : `강화 ● ${cost}`}</button>
      <p>${d.desc}<br>${d.text(d.stat(t.lv))}${maxed ? '' : ` → <b>${d.text(d.stat(t.lv + 1))}</b>`}</p></div>
      <button class="ghost sell" data-tsell>팔기 ● ${towerSell(t)}</button>`;
  }
}
$('#tower-body').addEventListener('click', (ev) => {
  const build = ev.target.closest('[data-build]');
  if (build) {
    const d = TOWERS[build.dataset.build];
    if (G.money < d.price) return;
    G.money -= d.price;
    G.towers[towerPad] = { type: build.dataset.build, lv: 1, cd: 0 };
    toast(`${d.icon} ${d.name} 세웠어요`);
  }
  if (ev.target.closest('[data-tup]')) {
    const t = G.towers[towerPad], cost = towerUpCost(t.type, t.lv);
    if (G.money < cost || t.lv >= TOWER_MAX) return;
    G.money -= cost; t.lv++;
    if (t.type === 'shield') t.charge = TOWERS.shield.stat(t.lv).max;
    toast(`${TOWERS[t.type].name} Lv.${t.lv}`);
  }
  if (ev.target.closest('[data-tsell]')) {
    G.money += towerSell(G.towers[towerPad]);
    G.towers[towerPad] = null;
    toast('타워를 팔았어요');
  }
  updateHud();
  renderTowerMenu();
});
$('#btn-tower-close').addEventListener('click', () => { overlay(null); G.state = 'play'; });

// ---------- 스테이지 사이: 캡슐 머신 (가챠) ----------
let offers = [], offerPicked = false, selSlot = -1, pendingOffer = null;
const sellPrice = (id) => Math.round((PARTS[id].sell || RARITY[PARTS[id].rarity].sell) * (1 + 0.05 * G.stage));
function rollRarity(boss) {
  const r = Math.random();
  const [leg, rare] = boss ? [0.2, 0.42] : [RARITY.legend.chance, RARITY.rare.chance];
  return r < leg ? 'legend' : r < leg + rare ? 'rare' : 'common';
}
function rollOffers() {
  const boss = isBossStage(G.stage), out = [];
  while (out.length < 3) {
    const rar = rollRarity(boss);
    const ids = Object.keys(PARTS).filter((id) => PARTS[id].rarity === rar && !out.includes(id));
    if (ids.length) out.push(ids[Math.floor(Math.random() * ids.length)]);
  }
  return out;
}
const rerollCost = () => Math.round((10 + 6 * G.rerolls) * (1 + 0.08 * G.stage));
const skipCash = () => Math.round(15 + 8 * G.stage);
function stageClear() {
  G.state = 'gacha';
  pointer.down = false;
  G.rerolls = 0;
  offers = rollOffers();
  offerPicked = false; selSlot = -1; pendingOffer = null;
  $('#gacha-title').textContent = isBossStage(G.stage) ? '보스 격파! 캡슐 머신' : `STAGE ${G.stage} 클리어!`;
  renderGacha();
  overlay('ov-gacha');
}
// 이 부품을 넣으면 새로 켜지는 시너지
const newSynergies = (id) => activeSynergies([...G.parts, id]).filter((s) => !activeSynergies().includes(s));
function partCard(id, attrs) {
  const p = PARTS[id], r = RARITY[p.rarity];
  const syn = newSynergies(id);
  return `<button class="part" style="--rc:${r.color}" ${attrs}><span class="p-icon">${p.icon}</span>
    <span class="p-body"><span class="p-top"><b>${p.name}</b><span class="p-rar">${r.name}</span>${syn.length ? `<span class="p-syn">시너지!</span>` : ''}</span>
    <span class="p-desc">${p.desc}</span>${syn.map((s) => `<span class="p-syn-desc">${s.icon} ${s.name}: ${s.desc}</span>`).join('')}</span></button>`;
}
function renderGacha() {
  $('#gacha-money').textContent = money().toLocaleString();
  $('#gacha-lead').textContent = pendingOffer ? '바꿀 칸을 눌러요 (원래 부품은 팔려요)' : offerPicked ? '받았어요! 다시 돌려 더 뽑거나 다음으로 가요' : '캡슐 3개 중 1개를 무료로 골라요';
  $('#offers').innerHTML = offers.map((id, i) => partCard(id, `data-offer="${i}" ${offerPicked ? 'disabled' : ''}`)).join('');
  $('#btn-reroll').textContent = `다시 돌리기 ● ${rerollCost()}`;
  $('#btn-reroll').disabled = G.money < rerollCost();
  $('#btn-skip').textContent = offerPicked ? '다음 스테이지' : `건너뛰기 +● ${skipCash()}`;
  $('#slots').innerHTML = Array.from({ length: SLOTS }, (_, i) => {
    const id = G.parts[i];
    if (!id) return `<button class="slot empty" data-slot="${i}">${pendingOffer ? '여기' : ''}</button>`;
    return `<button class="slot ${selSlot === i ? 'sel' : ''}" data-slot="${i}" style="--rc:${RARITY[PARTS[id].rarity].color}">${PARTS[id].icon}</button>`;
  }).join('');
  const sel = selSlot >= 0 && G.parts[selSlot];
  const syn = activeSynergies();
  $('#slot-info').innerHTML = (sel
    ? `<b>${PARTS[sel].icon} ${PARTS[sel].name}</b> · ${PARTS[sel].desc}
       <div class="row"><button class="ghost sell" data-sell>팔기 ● ${sellPrice(sel)}</button></div>`
    : `<span class="muted">부품을 누르면 팔 수 있어요. 같은 부품을 여러 개 끼우면 효과가 겹쳐요.</span>`)
    + `<div class="syn-list">${syn.length ? syn.map((s) => `<span class="syn">${s.icon} ${s.name} · ${s.desc}</span>`).join('') : '<span class="muted">켜진 시너지 없음 — 짝이 맞는 부품을 모아 보세요</span>'}</div>`;
  renderPartsBar();
}
function takePart(id, slot) {
  if (G.parts[slot]) G.money += sellPrice(G.parts[slot]);
  G.parts[slot] = id;
  G.parts = G.parts.filter(Boolean);
  recalcParts();
}
function announce(id) {
  const syn = newSynergies(id);
  toast(syn.length ? `${syn[0].icon} 시너지 발동: ${syn[0].name}!` : `${PARTS[id].icon} ${PARTS[id].name} 장착!`);
}
$('#offers').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-offer]');
  if (!b || offerPicked) return;
  const id = offers[+b.dataset.offer];
  if (G.parts.length < SLOTS) { announce(id); takePart(id, G.parts.length); offerPicked = true; }
  else pendingOffer = id;
  renderGacha();
});
$('#slots').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-slot]');
  if (!b) return;
  const i = +b.dataset.slot;
  if (pendingOffer) { announce(pendingOffer); takePart(pendingOffer, i); pendingOffer = null; offerPicked = true; selSlot = -1; }
  else selSlot = G.parts[i] ? (selSlot === i ? -1 : i) : -1;
  renderGacha();
});
$('#slot-info').addEventListener('click', (ev) => {
  if (ev.target.closest('[data-sell]') && selSlot >= 0) {
    const id = G.parts[selSlot];
    G.money += sellPrice(id);
    G.parts.splice(selSlot, 1);
    selSlot = -1;
    recalcParts();
    toast(`${PARTS[id].name} 팔았어요`);
  }
  renderGacha();
});
$('#btn-reroll').addEventListener('click', () => {
  if (G.money < rerollCost()) return;
  G.money -= rerollCost();
  G.rerolls++;
  offers = rollOffers();
  offerPicked = false; pendingOffer = null;
  renderGacha();
});
$('#btn-skip').addEventListener('click', () => {
  if (!offerPicked) G.money += skipCash();
  overlay(null);
  startStage();
});

// ---------- 상점 ----------
function openShop() {
  if (G.state !== 'play') return;
  G.state = 'shop';
  pointer.down = false;
  renderShop();
  overlay('ov-shop');
}
function renderShop() {
  $('#shop-money').textContent = money().toLocaleString();
  $('#shop-list').innerHTML = Object.entries(WEAPONS).map(([id, def]) => {
    const lv = G.weapons[id];
    const cost = lv ? upgradeCost(lv) : def.price;
    const now = lv ? def.statText(def.stat(lv)) : '';
    const next = def.statText(def.stat((lv || 0) + 1));
    return `<div class="shop-item" style="--wc:${def.color}">
      <div><b>${def.name}</b>${lv ? `<span class="lv">Lv.${lv}</span>` : ''}</div>
      <button data-buy="${id}" ${G.money < cost ? 'disabled' : ''}>${lv ? '강화' : '구매'} ● ${cost}</button>
      <p>${def.desc}<br>${lv ? `${now} → <b>${next}</b>` : next}</p>
    </div>`;
  }).join('') + '<p class="muted small center">보조 타워는 방어선 아래 ＋ 자리를 눌러 세워요</p>';
}
$('#shop-list').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-buy]');
  if (!b) return;
  const id = b.dataset.buy, lv = G.weapons[id];
  const cost = lv ? upgradeCost(lv) : WEAPONS[id].price;
  if (G.money < cost) return;
  G.money -= cost;
  G.weapons[id] = (lv || 0) + 1;
  if (!lv) G.current = id;
  updateHud(); renderShop();
  toast(lv ? `${WEAPONS[id].name} Lv.${lv + 1}` : `${WEAPONS[id].name} 구매!`);
});
$('#btn-shop').addEventListener('click', openShop);
$('#btn-shop-close').addEventListener('click', () => { overlay(null); G.state = 'play'; });

// ---------- 무기 버튼 / 필살기 ----------
$$('.weapon').forEach((btn) => btn.addEventListener('click', () => {
  if (G.state !== 'play') return;
  const w = btn.dataset.w, def = WEAPONS[w];
  if (!G.weapons[w]) {
    if (G.money < def.price) return toast(`● ${def.price - money()} 더 모아야 해요`);
    G.money -= def.price;
    G.weapons[w] = 1;
    toast(`${def.name} 구매!`);
  }
  G.current = w;
  G.cooldown = Math.min(G.cooldown, 0.1);
  updateHud();
}));
$('#btn-ult').addEventListener('click', useUlt);

// ---------- 일시정지 / 시작 / 끝 ----------
function statsHtml(newBest) {
  return `<div><b>${G.stage}</b><span>도달 스테이지</span>${newBest ? '<span class="new">최고 기록!</span>' : ''}</div>
    <div><b>${Math.round(G.score).toLocaleString()}</b><span>점수</span></div>
    <div><b>${G.kills}</b><span>부순 큐브</span></div>
    <div><b>${G.bossKilled}</b><span>잡은 보스</span></div>`;
}
function pause() {
  if (G.state !== 'play') return;
  G.state = 'pause';
  pointer.down = false;
  $('#pause-stats').innerHTML = statsHtml(false);
  overlay('ov-pause');
}
$('#btn-pause').addEventListener('click', pause);
$('#btn-resume').addEventListener('click', () => { overlay(null); G.state = 'play'; });
$('#btn-quit').addEventListener('click', () => { G = newGame(); updateHud(); showTitle(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

function loadBest() { try { return JSON.parse(localStorage.getItem(BEST_KEY)) || { stage: 0, score: 0 }; } catch { return { stage: 0, score: 0 }; } }
function showTitle() {
  const best = loadBest();
  $('#best').textContent = (best.stage ? `최고 기록: STAGE ${best.stage} · ${Math.round(best.score).toLocaleString()}점 · ` : '') + VERSION;
  overlay('ov-title');
}
function gameOver() {
  G.state = 'over';
  pointer.down = false;
  const best = loadBest();
  const newBest = G.stage > best.stage || (G.stage === best.stage && G.score > best.score);
  if (newBest) try { localStorage.setItem(BEST_KEY, JSON.stringify({ stage: G.stage, score: G.score })); } catch {}
  $('#over-stats').innerHTML = statsHtml(newBest);
  overlay('ov-over');
}
function start() {
  G = newGame();
  overlay(null);
  resize();
  recalcParts();
  startStage();
}
$('#btn-start').addEventListener('click', start);
$('#btn-retry').addEventListener('click', start);

// ---------- 터치 / 마우스 ----------
function toGame(ev) {
  const r = canvas.getBoundingClientRect();
  pointer.x = (ev.clientX - r.left) / scale;
  pointer.y = (ev.clientY - r.top) / scale;
}
canvas.addEventListener('pointerdown', (ev) => {
  toGame(ev);
  // 방어선 아래 타워 자리를 누르면 타워 메뉴
  if (G.state === 'play' && pointer.y > LINE_Y - 4) {
    const i = PAD_X.findIndex((x) => Math.hypot(pointer.x - x, pointer.y - PAD_Y) < 20);
    if (i >= 0) return openTower(i);
  }
  pointer.down = true;
  canvas.setPointerCapture(ev.pointerId);
});
canvas.addEventListener('pointermove', (ev) => { if (pointer.down) toGame(ev); });
const release = () => { pointer.down = false; };
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
window.addEventListener('keydown', (ev) => {
  if (!G || G.state !== 'play') return;
  const w = { 1: 'laser', 2: 'shotgun', 3: 'mortar' }[ev.key];
  if (w) $(`.weapon[data-w="${w}"]`).click();
  if (ev.code === 'Space') useUlt();
  if (ev.key === 'p' || ev.key === 'P') pause();
});

// ---------- 반복 ----------
let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (G) {
    update(dt);
    draw();
    if (G.state === 'play') { updateUltButton(); updateCombo(); $('#hud-money').textContent = money().toLocaleString(); }
  }
  requestAnimationFrame(loop);
}

G = newGame();
resize();
updateHud();
showTitle();
requestAnimationFrame(loop);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
window.__game = { get G() { return G; }, start, recalcParts, PARTS, SYNERGIES, TOWERS, update, draw, fire, useUlt, startStage, stageClear, pointer, WEAPONS, upgradeCost, towerUpCost, weakPos, get H() { return H; }, get LINE_Y() { return LINE_Y; }, get TURRET_Y() { return TURRET_Y; } };
