'use strict';
// 블록 디펜스 — 내려오는 픽셀 블록을 방어선 전에 부수는 게임
// 블록은 작은 픽셀들로 이루어져 있고, 맞은 자리의 픽셀만 부서짐.
// 픽셀이 40% 부서지면 블록 전체가 산산조각 남.
// 좌표는 가로 360 기준의 "게임 좌표"로 계산하고, 화면 크기에 맞춰 늘려서 그림

const VERSION = 'v3.0';
const W = 360;          // 게임판 가로 (게임 좌표)
const P = 4;            // 픽셀 한 칸 크기
const COLS = 12;
const CELL = W / COLS;  // 한 칸 폭 (30)
const BPX = 7, BPY = 4; // 블록 = 가로 7 × 세로 4 픽셀
const ROW_GAP = 22;     // 줄 간격
const SHATTER = 0.6;    // 남은 픽셀이 이 비율 이하면 블록이 부서짐 (40% 부서지면 통째로)
const BEST_KEY = 'blockdefense:best';

// ---------- 무기 ----------
// dmg: 픽셀 하나에 주는 피해 / 레이저 drill: 한 번에 뚫는 픽셀 수
const WEAPONS = {
  laser: {
    name: '레이저', desc: '한 줄로 픽셀을 깊게 뚫어요. 갑옷·보스용', price: 0, color: '#2de2e6',
    interval: 0.35,
    stat: (lv) => ({ dmg: 3 * 1.22 ** (lv - 1), drill: 6 + Math.floor((lv - 1) / 3) }),
    statText: (s) => `세기 ${s.dmg.toFixed(1)} · ${s.drill}칸 뚫기`,
  },
  shotgun: {
    name: '산탄총', desc: '표면을 넓게 갉아내요. 떼거지·분열 블록용', price: 40, color: '#fffb96',
    interval: 0.5,
    stat: (lv) => ({ dmg: 1.2 * 1.22 ** (lv - 1), pellets: 7 + Math.floor((lv - 1) / 3) }),
    statText: (s) => `세기 ${s.dmg.toFixed(1)} × ${s.pellets}발`,
  },
  mortar: {
    name: '박격포', desc: '누른 자리에 둥근 구멍을 내요. 뭉친 블록용', price: 90, color: '#ff8c42',
    interval: 0.75,
    stat: (lv) => ({ dmg: 1.5 * 1.22 ** (lv - 1), radius: Math.min(24 + 1.5 * (lv - 1), 40) }),
    statText: (s) => `세기 ${s.dmg.toFixed(1)} · 범위 ${Math.round(s.radius)}`,
  },
};
const upgradeCost = (lv) => Math.round(30 * 1.7 ** (lv - 1));

// ---------- 블록 ----------
const TYPES = {
  normal: { color: '#2de2e6', hp: 1.0, reward: 1 },
  charger: { color: '#ff6c11', hp: 0.8, reward: 2 },
  splitter: { color: '#b967ff', hp: 1.2, reward: 2 },
  armor: { color: '#c7cdff', hp: 1.5, reward: 3, armor: 1 },
  mini: { color: '#f9a8ff', hp: 0.6, reward: 1 },
  minion: { color: '#ff3cac', hp: 0.8, reward: 1 },
  boss: { color: '#ff2a6d', hp: 3.0, reward: 0, armor: 1.3 }, // 약한 광역 공격은 거의 안 들어감
};

// ---------- 부품 (가챠) ----------
// 슬롯 5칸에 끼움. 왼쪽부터 발동하고, 복사형 부품은 옆 칸 효과를 그대로 따라함
const RARITY = {
  common: { name: '일반', color: '#d8d4f0', sell: 8 },
  rare: { name: '희귀', color: '#2de2e6', sell: 20 },
  legend: { name: '전설', color: '#ffd166', sell: 45 },
};
const PARTS = {
  dna: { icon: '🧬', name: '복제 코어', rarity: 'legend', desc: '발사할 때마다 한 번 더 통째로 쏴요' },
  baron: { icon: '👑', name: '남작의 왕관', rarity: 'legend', desc: '화면의 갑옷 블록 1개마다 레이저 세기 ×1.2 (곱으로 쌓임)' },
  glass: { icon: '🔮', name: '유리 대포', rarity: 'legend', desc: '모든 세기 ×2. 대신 생명이 최대 2개' },
  blueprint: { icon: '📘', name: '청사진 칩', rarity: 'rare', desc: '오른쪽 칸 부품의 효과를 복사해요', copy: true },
  brain: { icon: '🧠', name: '두뇌 회로', rarity: 'rare', desc: '맨 왼쪽 칸 부품의 효과를 복사해요', copy: true },
  echo: { icon: '🔔', name: '잔향 장치', rarity: 'rare', desc: '발사할 때 첫 한 발이 2번 더 발동 (레이저 3번, 박격포 폭발 3번)' },
  chain: { icon: '💥', name: '연쇄 폭발', rarity: 'rare', desc: '블록이 산산조각 나면 그 자리가 터져요. 터진 블록이 또 터질 수 있어요' },
  magnet: { icon: '🧲', name: '황금 자석', rarity: 'rare', desc: '블록을 부술 때마다 돈 +1' },
  combo: { icon: '📈', name: '콤보 증폭기', rarity: 'rare', desc: '콤보 배율이 세기에도 붙고, 최대 ×1.5 → ×2.5' },
  lens: { icon: '🔍', name: '과충전 렌즈', rarity: 'common', desc: '레이저가 3칸 더 깊게 뚫어요' },
  nozzle: { icon: '🌬️', name: '확산 노즐', rarity: 'common', desc: '산탄 +3발, 대신 산탄 세기 -15%' },
  warhead: { icon: '🎯', name: '대형 탄두', rarity: 'common', desc: '박격포 범위 +30%, 대신 박격포 연사 -20%' },
  coil: { icon: '🧊', name: '냉각 코일', rarity: 'common', desc: '폭격 쿨타임 -25%' },
  battery: { icon: '🔋', name: '고물 배터리', rarity: 'common', desc: '연사 +5%, 대신 돈 -10%' },
  gear: { icon: '⚙️', name: '녹슨 톱니', rarity: 'common', desc: '아무 효과 없어요. 대신 팔면 돈을 꽤 줘요', sell: 40 },
};
const SLOTS = 5;
const sellPrice = (id) => Math.round((PARTS[id].sell || RARITY[PARTS[id].rarity].sell) * (1 + 0.05 * G.stage));

// ---------- 상태 ----------
let G = null;            // 한 판의 상태
let H = 600;             // 게임판 세로 (화면 비율에 따라)
let LINE_Y = 540;        // 방어선
let TURRET_Y = 570;      // 포대
let scale = 1, dpr = 1;
const pointer = { down: false, x: W / 2, y: 0 };

function newGame() {
  return {
    stage: 0, lives: 5, money: 0, score: 0, kills: 0,
    weapons: { laser: 1 },  // 가진 무기와 레벨
    current: 'laser',
    cooldown: 0,
    mods: { dmg: 1, rate: 1, crit: 0, pierce: 0, money: 1, radius: 1, ult: 1 },
    parts: [],              // 끼운 부품 (왼쪽부터)
    eff: {},                // 복사까지 계산한 부품별 개수
    blasts: [],             // 연쇄 폭발 대기열
    rerolls: 0,
    ult: { cd: 0, max: 40 },
    blocks: [], bullets: [], shells: [], beams: [], fx: [], bits: [], texts: [],
    rowsLeft: 0, rowDist: 0, speed: 10,
    combo: 0, comboTime: 0,
    state: 'title',
    boss: null, bossKilled: 0, time: 0,
  };
}

// ---------- 화면 크기 + 우주 배경 ----------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let bg = null;
let stars = [];
function resize() {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  scale = rect.width / W;
  H = Math.round(rect.height / scale);
  LINE_Y = H - 52;
  TURRET_Y = H - 24;
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  bg = makeBackground();
  glowCache.clear();
}
window.addEventListener('resize', resize);

// 배경은 한 번만 그려 두고 매 프레임 복사 (빠름)
function makeBackground() {
  const k = dpr * scale;
  const c = document.createElement('canvas');
  c.width = Math.round(W * k); c.height = Math.round(H * k);
  const g = c.getContext('2d');
  g.scale(k, k);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#07021a'); grad.addColorStop(1, '#130631');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  // 성운
  for (const [x, y, r, col] of [[0.25, 0.22, 0.6, 'rgba(138,43,226,.28)'], [0.8, 0.55, 0.55, 'rgba(15,106,216,.22)'], [0.4, 0.85, 0.4, 'rgba(255,42,109,.14)']]) {
    const rg = g.createRadialGradient(x * W, y * H, 0, x * W, y * H, r * W);
    rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
  }
  // 아주 옅은 벽돌 무늬 (네온 간판 느낌)
  g.strokeStyle = 'rgba(160,140,255,.045)'; g.lineWidth = 0.6;
  for (let y = 0, row = 0; y < H; y += 12, row++) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    for (let x = (row % 2) * 13; x < W; x += 26) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 12); g.stroke(); }
  }
  // 별
  stars = [];
  for (let i = 0; i < 150; i++) {
    const s = { x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.1 + 0.25, a: Math.random() * 0.6 + 0.2, tw: Math.random() < 0.15 };
    if (!s.tw) { g.globalAlpha = s.a; g.fillStyle = '#fff'; g.beginPath(); g.arc(s.x, s.y, s.r, 0, Math.PI * 2); g.fill(); }
    stars.push(s);
  }
  g.globalAlpha = 1;
  return c;
}

// 블록 뒤의 네온 번짐 (크기·색별로 한 번만 만들어 둠)
const glowCache = new Map();
function glowSprite(color, w, h) {
  const key = `${color}|${w}|${h}`;
  let s = glowCache.get(key);
  if (s) return s;
  const pad = 10, k = dpr * scale;
  s = document.createElement('canvas');
  s.width = Math.ceil((w + pad * 2) * k); s.height = Math.ceil((h + pad * 2) * k);
  const g = s.getContext('2d');
  g.scale(k, k);
  g.shadowColor = color; g.shadowBlur = 9;
  g.strokeStyle = color; g.lineWidth = 2;
  g.strokeRect(pad, pad, w, h);
  s.pad = pad;
  glowCache.set(key, s);
  return s;
}

// ---------- 부품 효과 ----------
// 복사형 부품을 풀어서 "실제로 발동하는 부품" 목록을 만듦
function effectiveParts() {
  const out = [];
  const resolve = (i, seen) => {
    const id = G.parts[i];
    if (!id || seen.has(i)) return null;
    seen.add(i);
    if (id === 'blueprint') return resolve(i + 1, seen);
    if (id === 'brain') return resolve(0, seen);
    return id;
  };
  for (let i = 0; i < G.parts.length; i++) { const id = resolve(i, new Set()); if (id) out.push(id); }
  return out;
}
const has = (id) => G.eff[id] || 0;
function recalcParts() {
  G.eff = {};
  for (const id of effectiveParts()) G.eff[id] = (G.eff[id] || 0) + 1;
  const m = G.mods;
  m.dmg = 2 ** has('glass');
  m.rate = 1.05 ** has('battery');
  m.money = 0.9 ** has('battery');
  m.ult = 0.75 ** has('coil');
  m.radius = 1.3 ** has('warhead');
  if (has('glass')) G.lives = Math.min(G.lives, 2);
  updateHud();
}
const maxLives = () => (has('glass') ? 2 : 7);
// 무기 성능 + 부품 보정
function weaponStat(w) {
  const s = { ...WEAPONS[w].stat(G.weapons[w]) };
  if (w === 'laser') { s.drill += 3 * has('lens'); s.dmg *= 1.2 ** (has('baron') * G.blocks.filter((b) => !b.dead && b.type === 'armor').length); }
  if (w === 'shotgun') { s.pellets += 3 * has('nozzle'); s.dmg *= 0.85 ** has('nozzle'); }
  let interval = WEAPONS[w].interval / G.mods.rate;
  if (w === 'mortar') interval /= 0.8 ** has('warhead');
  return { s, interval };
}

// ---------- 스테이지 ----------
const isBossStage = (n) => n > 0 && n % 5 === 0;
// 픽셀 하나의 체력: 스테이지마다 17%씩 늘어남
const pixHp = (type, stage) => 1.17 ** (stage - 1) * TYPES[type].hp;
const armorOf = (type) => (TYPES[type].armor ? TYPES[type].armor * 2 * 1.12 ** (G.stage - 1) : 0);
function startStage() {
  G.stage++;
  const n = G.stage;
  G.speed = Math.min(10 + n * 0.8, 30);
  G.rowsLeft = isBossStage(n) ? 0 : Math.min(12 + n, 30); // 보스 스테이지는 보스와 졸개만
  G.rowDist = ROW_GAP; // 바로 첫 줄
  G.boss = null;
  if (isBossStage(n)) spawnBoss();
  G.state = 'play';
  showBanner(isBossStage(n) ? 'BOSS' : `STAGE ${n}`, isBossStage(n) ? '노란 약점을 노려요' : '', isBossStage(n));
  updateHud();
}
function spawnRow() {
  const n = G.stage;
  // 한 줄 블록 수: 스테이지가 오를수록 빽빽하게 (단일 무기만으로는 못 버티게)
  const count = Math.min(COLS, 3 + Math.floor(n / 2) + Math.floor(Math.random() * 4));
  const cols = [...Array(COLS).keys()].sort(() => Math.random() - 0.5).slice(0, count);
  for (const c of cols) {
    let type = 'normal';
    const r = Math.random();
    if (n >= 2 && r < 0.12 + n * 0.01) type = 'charger';
    else if (n >= 3 && r < 0.26 + n * 0.012) type = 'splitter';
    else if (n >= 4 && r < 0.36 + n * 0.014) type = 'armor';
    addBlock(type, c * CELL + (CELL - BPX * P) / 2, -BPY * P - 4, BPX, BPY);
  }
  G.rowsLeft--;
}
function addBlock(type, x, y, cols, rows) {
  const n = cols * rows, hp = pixHp(type, G.stage);
  const b = {
    type, x, y, cols, rows, w: cols * P, h: rows * P,
    hp: new Float32Array(n).fill(hp), max: hp, alive: n, total: n, bottomRow: rows - 1,
    hit: 0, dash: 0, warn: 0,
  };
  if (type === 'charger') b.next = 3 + Math.random() * 3;
  G.blocks.push(b);
  return b;
}
function spawnBoss() {
  const b = addBlock('boss', (W - 52 * P) / 2, -60, 52, 12);
  b.weak = { t: 0, r: 10 };
  b.shieldAt = [0.6, 0.3];   // 체력 60%, 30%에서 보호막
  b.shield = false;
  G.boss = b;
}
// 보스 체력 비율: 부서지는 선(35%)까지를 0으로 봄
const bossLife = (b) => Math.max(0, (b.alive / b.total - SHATTER) / (1 - SHATTER));
// 보스 보호막: 졸개 블록이 남아 있는 동안 보스는 피해를 안 받음
function bossShield(b) {
  b.shield = true;
  const y = b.y + b.h + 6;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < COLS; c++) {
      if ((c + r) % 2) continue;
      addBlock('minion', c * CELL + (CELL - BPX * P) / 2, y + r * ROW_GAP, BPX, BPY).escort = true;
    }
  }
  showBanner('보호막!', '졸개를 먼저 치워요', true);
}

// ---------- 픽셀 피해 ----------
function blockAt(x, y) {
  for (const b of G.blocks) if (!b.dead && x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return b;
  return null;
}
function pixIndex(b, x, y) {
  const ix = Math.floor((x - b.x) / P), iy = Math.floor((y - b.y) / P);
  if (ix < 0 || iy < 0 || ix >= b.cols || iy >= b.rows) return -1;
  return iy * b.cols + ix;
}
function weakPos(b) {
  return { x: b.x + b.w / 2 + Math.sin(b.weak.t * 1.3) * (b.w / 2 - 18), y: b.y + b.h - 14 };
}
// 픽셀 하나에 피해. 반환: 부서졌으면 true
function hitPixel(b, i, raw, crit) {
  if (b.dead || b.hp[i] <= 0) return false;
  if (b.type === 'boss' && b.shield) return false;
  // 갑옷: 기본 세기(약점·치명타 전)가 갑옷보다 약하면 거의 안 들어감 → 광역 무기만으로는 보스·갑옷을 못 깸
  const armor = armorOf(b.type);
  let d = raw * G.mods.dmg * (has('combo') ? comboMult() : 1);
  if (armor && d < armor) d *= 0.1;
  if (crit) d *= 2;
  if (b.type === 'boss') {
    const wp = weakPos(b), px = b.x + (i % b.cols + 0.5) * P, py = b.y + (Math.floor(i / b.cols) + 0.5) * P;
    if (Math.hypot(px - wp.x, py - wp.y) < b.weak.r) d *= 3; // 약점
  }
  const before = b.hp[i];
  b.hp[i] -= d;
  b.hit = 0.06;
  G.score += Math.min(d, before);
  if (b.hp[i] > 0) return false;
  // 픽셀이 부서짐 → 조각이 튐
  b.alive--;
  const cx = b.x + (i % b.cols + 0.5) * P, cy = b.y + (Math.floor(i / b.cols) + 0.5) * P;
  addBit(cx, cy, TYPES[b.type].color, 1);
  if (Math.floor(i / b.cols) === b.bottomRow) updateBottom(b);
  if (b.type === 'boss') {
    while (b.shieldAt.length && bossLife(b) <= b.shieldAt[0]) { b.shieldAt.shift(); bossShield(b); }
  }
  if (b.alive <= b.total * SHATTER) shatter(b);
  return true;
}
function updateBottom(b) {
  for (let r = b.rows - 1; r >= 0; r--) {
    for (let c = 0; c < b.cols; c++) if (b.hp[r * b.cols + c] > 0) { b.bottomRow = r; return; }
  }
  b.bottomRow = -1;
}
// 남은 픽셀이 적어지면 블록 전체가 산산조각
function shatter(b) {
  if (b.dead) return;
  b.dead = true;
  G.kills++;
  for (let i = 0; i < b.hp.length; i++) {
    if (b.hp[i] > 0) addBit(b.x + (i % b.cols + 0.5) * P, b.y + (Math.floor(i / b.cols) + 0.5) * P, TYPES[b.type].color, 1.6);
  }
  // 콤보: 1.5초 안에 연달아 깨면 돈 배율 증가 (5콤보마다 +0.1, 최대 ×1.5)
  G.combo = G.comboTime > 0 ? G.combo + 1 : 1;
  G.comboTime = 1.5;
  let reward = TYPES[b.type].reward * (1 + 0.06 * G.stage);
  if (b.type === 'boss') reward = 60 + G.stage * 15;
  const gain = (reward + has('magnet') * (1 + 0.05 * G.stage)) * comboMult() * G.mods.money;
  G.money += gain;
  // 연쇄 폭발: 바로 터뜨리면 끝없이 이어질 수 있어서 대기열에 넣고 매 프레임 조금씩 처리
  if (has('chain') && b.type !== 'boss') G.blasts.push({ x: b.x + b.w / 2, y: b.y + b.h / 2, n: has('chain') });
  if (gain >= 1) addText(b.x + b.w / 2, b.y + b.h / 2, `+${Math.floor(gain)}`, '#ffd166');
  if (b.type === 'splitter') {
    for (const dx of [-6, 14]) addBlock('mini', b.x + dx, b.y + 2, 4, 3);
  }
  if (b.type === 'boss') {
    G.boss = null;
    G.bossKilled++;
    for (const m of G.blocks) if (m.escort) m.escort = false;
    G.fx.push({ type: 'flash', life: 0.4, max: 0.4 });
    G.lives = Math.min(maxLives(), G.lives + 1); // 보스를 잡으면 생명 1 회복
    showBanner('보스 격파!', `+${Math.floor(gain)}`, false);
  }
  if (b.escort && G.boss && !G.blocks.some((m) => m.escort && !m.dead)) {
    G.boss.shield = false;
    showBanner('보호막 해제!', '지금 강한 무기로', false);
  }
  updateHud();
}

// ---------- 발사 ----------
function aimAngle() {
  const dx = pointer.x - W / 2, dy = pointer.y - TURRET_Y;
  let a = Math.atan2(dy, dx);
  // 아래쪽으로는 못 쏘게 (위쪽 170도 안에서만)
  const min = -Math.PI + 0.09, max = -0.09;
  if (a > max && a <= Math.PI / 2) a = max;
  if (a > Math.PI / 2 || a < min) a = min;
  return a;
}
const comboMult = () => 1 + Math.min(has('combo') ? 15 : 5, Math.floor(G.combo / 5)) * 0.1;
const rollCrit = () => Math.random() < G.mods.crit;
function fire() {
  const w = G.current, { s, interval } = weaponStat(w);
  const volleys = 1 + has('dna');
  for (let v = 0; v < volleys; v++) shoot(w, s, aimAngle() + (v ? (v % 2 ? 1 : -1) * 0.035 * Math.ceil(v / 2) : 0), 2 * has('echo'));
  G.cooldown = interval;
}
// 한 번 쏘기. echo = 첫 한 발이 추가로 발동하는 횟수
function shoot(w, s, a, echo) {
  const dx = Math.cos(a), dy = Math.sin(a);
  const ox = W / 2 + dx * 20, oy = TURRET_Y + dy * 20;
  if (w === 'laser') {
    for (let e = 0; e <= echo; e++) laserBeam(s, ox, oy, dx, dy);
  } else if (w === 'shotgun') {
    const spread = 0.6;
    for (let i = 0; i < s.pellets; i++) {
      const aa = a - spread / 2 + (spread * i) / (s.pellets - 1) + (Math.random() - 0.5) * 0.05;
      G.bullets.push({ x: ox, y: oy, vx: Math.cos(aa) * 620, vy: Math.sin(aa) * 620, dmg: s.dmg, pierce: G.mods.pierce, life: 0.7, crit: rollCrit(), echo: i === Math.floor(s.pellets / 2) ? echo : 0 });
    }
  } else if (w === 'mortar') {
    // 누른 자리(사거리 안)까지 날아가서 터짐. 중간에 픽셀에 닿으면 그 자리에서 터짐
    const dist = Math.min(Math.hypot(pointer.x - ox, pointer.y - oy), 640);
    G.shells.push({ x: ox, y: oy, vx: dx * 480, vy: dy * 480, left: Math.max(dist, 40), dmg: s.dmg, radius: s.radius * G.mods.radius, crit: rollCrit(), echo });
  }
}
function laserBeam(s, ox, oy, dx, dy) {
  {
    // 즉시 맞는 광선: 3픽셀 폭(나란한 광선 3줄). 빈 칸은 통과하고, 픽셀을 만날 때마다 피해.
    // 줄마다 drill 개수만큼 뚫거나, 못 부순 픽셀을 만나면 멈춤
    const crit = rollCrit();
    let reach = 0;
    for (const off of [-P, 0, P]) {
      const sx = ox - dy * off, sy = oy + dx * off;
      let left = s.drill, t = 0, last = -1, lastB = null;
      for (; t < 900 && left > 0; t += 1.5) {
        const x = sx + dx * t, y = sy + dy * t;
        if (y < -10 || x < 0 || x > W) break;
        const b = blockAt(x, y);
        if (!b) continue;
        const i = pixIndex(b, x, y);
        if (i < 0 || b.hp[i] <= 0 || (lastB === b && last === i)) continue;
        lastB = b; last = i;
        left--;
        if (b.type === 'boss' && b.shield) { if (off === 0) addText(x, y, '막힘', '#9fb3ff'); break; }
        if (!hitPixel(b, i, s.dmg, crit) && !b.dead) break; // 못 부순 픽셀에서 멈춤
      }
      if (off === 0) reach = t;
    }
    G.beams.push({ x1: ox, y1: oy, x2: ox + dx * reach, y2: oy + dy * reach, life: 0.1 });
  }
}
function explode(x, y, dmg, radius, crit) {
  for (const b of [...G.blocks]) { // 분열로 새로 생긴 블록은 이번 폭발에서 제외
    if (b.dead || x < b.x - radius || x > b.x + b.w + radius || y < b.y - radius || y > b.y + b.h + radius) continue;
    for (let i = 0; i < b.hp.length && !b.dead; i++) {
      if (b.hp[i] <= 0) continue;
      const px = b.x + (i % b.cols + 0.5) * P, py = b.y + (Math.floor(i / b.cols) + 0.5) * P;
      const d = Math.hypot(px - x, py - y);
      if (d <= radius) hitPixel(b, i, dmg * (1 - 0.3 * d / radius), crit);
    }
  }
  G.fx.push({ type: 'ring', x, y, r: radius, life: 0.3, max: 0.3 });
}
function useUlt() {
  if (G.state !== 'play' || G.ult.cd > 0) return;
  // 모든 픽셀에 일반 픽셀 체력의 75%만큼 (데미지 카드 영향 X) → 이미 깎인 블록은 부서짐
  const dmg = pixHp('normal', G.stage) * 0.75 / G.mods.dmg;
  for (const b of [...G.blocks]) for (let i = 0; i < b.hp.length && !b.dead; i++) if (b.hp[i] > 0) hitPixel(b, i, dmg, false);
  G.ult.cd = G.ult.max * G.mods.ult;
  G.fx.push({ type: 'flash', life: 0.35, max: 0.35 });
  buzz();
}

// ---------- 효과 ----------
function addBit(x, y, color, power) {
  if (G.bits.length > 900) return;
  const a = Math.random() * Math.PI * 2, v = (40 + Math.random() * 110) * power;
  G.bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, life: 0.7 + Math.random() * 0.3, color });
}
function addText(x, y, text, color) { G.texts.push({ x, y, text, color, life: 0.8 }); }
function buzz() { if (navigator.vibrate) navigator.vibrate(30); }

// ---------- 매 프레임 ----------
function update(dt) {
  if (G.state !== 'play') return;
  G.time += dt;
  G.ult.cd = Math.max(0, G.ult.cd - dt);
  G.comboTime -= dt;
  if (G.comboTime <= 0) G.combo = 0;

  // 새 줄
  G.rowDist += G.speed * dt;
  if (G.rowsLeft > 0 && G.rowDist >= ROW_GAP) { G.rowDist = 0; spawnRow(); }

  // 블록 이동
  for (const b of G.blocks) {
    if (b.dead) continue;
    b.hit = Math.max(0, b.hit - dt);
    b.y += (b.type === 'boss' || b.escort ? G.speed * 0.55 : G.speed) * dt;
    if (b.type === 'boss') b.weak.t += dt;
    if (b.type === 'charger') {
      if (b.dash > 0) { const d = Math.min(b.dash, 220 * dt); b.y += d; b.dash -= d; }
      else if (b.warn > 0) { b.warn -= dt; if (b.warn <= 0) b.dash = ROW_GAP * 2; }
      else if ((b.next -= dt) <= 0 && b.y > 0) { b.warn = 0.9; b.next = 4 + Math.random() * 3; }
    }
    if (b.bottomRow >= 0 && b.y + (b.bottomRow + 1) * P >= LINE_Y) {
      b.dead = true;
      (G.leaks ||= {})[b.type] = (G.leaks[b.type] || 0) + 1; // 시험용 기록: 어떤 블록이 뚫었나
      if (b.type === 'boss') G.lives = 0;
      else G.lives--;
      G.fx.push({ type: 'flash', life: 0.25, max: 0.25, red: true });
      for (let k = 0; k < 14; k++) addBit(b.x + Math.random() * b.w, LINE_Y, '#ff2a6d', 1.4);
      buzz();
      updateHud();
      if (G.lives <= 0) return gameOver();
    }
  }

  // 발사
  G.cooldown -= dt;
  if (pointer.down && G.cooldown <= 0) fire();

  // 산탄: 픽셀을 건너뛰지 않게 잘게 나눠서 이동
  for (const p of G.bullets) {
    const steps = Math.ceil(Math.hypot(p.vx, p.vy) * dt / 2.5);
    for (let k = 0; k < steps && p.life > 0; k++) {
      p.x += p.vx * dt / steps; p.y += p.vy * dt / steps;
      const b = blockAt(p.x, p.y);
      if (!b) continue;
      const i = pixIndex(b, p.x, p.y);
      if (i < 0 || b.hp[i] <= 0) continue;
      if (b.type === 'boss' && b.shield) { p.life = 0; break; }
      // 맞은 픽셀 + 위아래·양옆을 갉아냄 (잔향이면 같은 자리를 더 갉음)
      const c = i % b.cols, r = Math.floor(i / b.cols);
      for (let e = 0; e <= (p.echo || 0); e++) {
        if (!b.dead) hitPixel(b, i, p.dmg, p.crit);
        for (const [nc, nr] of [[c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]]) {
          if (!b.dead && nc >= 0 && nr >= 0 && nc < b.cols && nr < b.rows) hitPixel(b, nr * b.cols + nc, p.dmg * 0.8, p.crit);
        }
      }
      p.echo = 0;
      if (p.pierce-- <= 0) p.life = 0;
    }
    p.life -= dt;
  }
  G.bullets = G.bullets.filter((p) => p.life > 0 && p.y > -20 && p.x > -20 && p.x < W + 20);

  // 박격포
  for (const s of G.shells) {
    const steps = Math.ceil(Math.hypot(s.vx, s.vy) * dt / 3);
    for (let k = 0; k < steps && !s.done; k++) {
      s.x += s.vx * dt / steps; s.y += s.vy * dt / steps; s.left -= Math.hypot(s.vx, s.vy) * dt / steps;
      const b = blockAt(s.x, s.y);
      const onPixel = b && b.hp[pixIndex(b, s.x, s.y)] > 0;
      if (onPixel || s.left <= 0 || s.y < -10) { for (let e = 0; e <= (s.echo || 0); e++) explode(s.x, s.y, s.dmg, s.radius, s.crit); s.done = true; }
    }
  }
  G.shells = G.shells.filter((s) => !s.done);

  // 연쇄 폭발
  for (let k = 0; k < 25 && G.blasts.length; k++) {
    const bl = G.blasts.shift();
    explode(bl.x, bl.y, pixHp('normal', G.stage) * 0.9 * bl.n, 13 + 3 * (bl.n - 1), false);
  }

  G.blocks = G.blocks.filter((b) => !b.dead);

  // 효과
  for (const f of G.bits) { f.life -= dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 260 * dt; f.vx *= 0.98; }
  G.bits = G.bits.filter((f) => f.life > 0 && f.y < H + 10);
  for (const f of G.fx) f.life -= dt;
  G.fx = G.fx.filter((f) => f.life > 0);
  for (const b of G.beams) b.life -= dt;
  G.beams = G.beams.filter((b) => b.life > 0);
  for (const t of G.texts) { t.life -= dt; t.y -= 30 * dt; }
  G.texts = G.texts.filter((t) => t.life > 0);

  // 스테이지 클리어
  if (G.rowsLeft <= 0 && !G.blocks.length && !G.boss) stageClear();
}

// ---------- 그리기 ----------
function draw() {
  if (bg) ctx.drawImage(bg, 0, 0, W, H); else ctx.clearRect(0, 0, W, H);
  // 반짝이는 별
  const now = performance.now() / 1000;
  ctx.fillStyle = '#fff';
  for (const s of stars) {
    if (!s.tw) continue;
    ctx.globalAlpha = s.a * (0.5 + 0.5 * Math.sin(now * 2 + s.x));
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r + 0.3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 방어선 (네온)
  ctx.save();
  ctx.strokeStyle = '#ff2a6d'; ctx.shadowColor = '#ff2a6d'; ctx.shadowBlur = 12;
  ctx.setLineDash([10, 6]); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, LINE_Y); ctx.lineTo(W, LINE_Y); ctx.stroke();
  ctx.restore();

  // 블록
  for (const b of G.blocks) drawBlock(b);

  // 레이저
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const b of G.beams) {
    const k = b.life / 0.1;
    ctx.globalAlpha = k * 0.35; ctx.strokeStyle = '#2de2e6'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
    ctx.globalAlpha = k; ctx.strokeStyle = '#d9ffff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
  }
  // 산탄
  ctx.globalAlpha = 1;
  for (const p of G.bullets) {
    ctx.fillStyle = 'rgba(255,251,150,.35)'; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fffde0'; ctx.beginPath(); ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2); ctx.fill();
  }
  // 박격포
  for (const s of G.shells) {
    ctx.fillStyle = 'rgba(255,140,66,.35)'; ctx.beginPath(); ctx.arc(s.x, s.y, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd2b0'; ctx.beginPath(); ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2); ctx.fill();
  }
  // 부서진 픽셀 조각
  for (const f of G.bits) {
    ctx.globalAlpha = Math.min(1, f.life * 1.6);
    ctx.fillStyle = f.color;
    ctx.fillRect(f.x - P / 2, f.y - P / 2, P - 0.6, P - 0.6);
  }
  // 폭발 고리 / 화면 번쩍
  for (const f of G.fx) {
    const k = f.life / f.max;
    if (f.type === 'ring') {
      ctx.globalAlpha = k; ctx.strokeStyle = '#ff8c42'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1.1 - k * 0.4), 0, Math.PI * 2); ctx.stroke();
    } else if (f.type === 'flash') {
      ctx.globalAlpha = k * 0.35; ctx.fillStyle = f.red ? '#ff2a6d' : '#b967ff'; ctx.fillRect(0, 0, W, H);
    }
  }
  ctx.restore();

  // 조준선 + 포대
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

  // 떠오르는 숫자
  ctx.textAlign = 'center'; ctx.font = '800 11px -apple-system, "Apple SD Gothic Neo", sans-serif';
  for (const t of G.texts) { ctx.globalAlpha = Math.min(1, t.life * 2); ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, t.y); }
  ctx.globalAlpha = 1;
}
function drawBlock(b) {
  const t = TYPES[b.type];
  const ratio = b.alive / b.total;
  // 돌진 경고: 깜빡이는 빨간 테두리 + 아래 화살표
  if (b.type === 'charger' && b.warn > 0 && Math.floor(b.warn * 10) % 2 === 0) {
    ctx.strokeStyle = '#ff2a6d'; ctx.lineWidth = 2;
    ctx.strokeRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6);
    ctx.fillStyle = '#ff2a6d';
    ctx.beginPath(); ctx.moveTo(b.x + b.w / 2 - 5, b.y + b.h + 5); ctx.lineTo(b.x + b.w / 2 + 5, b.y + b.h + 5); ctx.lineTo(b.x + b.w / 2, b.y + b.h + 11); ctx.fill();
  }
  // 네온 번짐 (남은 픽셀이 적을수록 흐려짐)
  const glow = glowSprite(t.color, b.w, b.h);
  ctx.globalAlpha = 0.25 + 0.6 * ratio;
  ctx.drawImage(glow, b.x - glow.pad, b.y - glow.pad, b.w + glow.pad * 2, b.h + glow.pad * 2);
  ctx.globalAlpha = 1;
  // 픽셀: 체력이 깎인 픽셀은 어둡게
  const flash = b.hit > 0;
  for (let i = 0; i < b.hp.length; i++) {
    const hp = b.hp[i];
    if (hp <= 0) continue;
    const c = i % b.cols, r = (i - c) / b.cols;
    ctx.globalAlpha = 0.45 + 0.55 * Math.min(1, hp / b.max);
    ctx.fillStyle = flash ? '#ffffff' : t.color;
    ctx.fillRect(b.x + c * P, b.y + r * P, P - 0.7, P - 0.7);
  }
  ctx.globalAlpha = 1;
  // 갑옷: 흰 테두리
  if (b.type === 'armor') { ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1; ctx.strokeRect(b.x - 1, b.y - 1, b.w + 1.3, b.h + 1.3); }
  if (b.type === 'boss') {
    const wp = weakPos(b);
    ctx.save();
    ctx.fillStyle = '#fffb96'; ctx.shadowColor = '#fffb96'; ctx.shadowBlur = 16;
    ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.arc(wp.x, wp.y, b.weak.r * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // 보스 체력 막대
    ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(b.x, b.y - 8, b.w, 3);
    ctx.fillStyle = '#ff2a6d'; ctx.fillRect(b.x, b.y - 8, b.w * bossLife(b), 3);
    if (b.shield) {
      ctx.save();
      ctx.strokeStyle = '#9fb3ff'; ctx.fillStyle = 'rgba(159,179,255,.12)'; ctx.lineWidth = 2;
      ctx.shadowColor = '#9fb3ff'; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12, 12) : ctx.rect(b.x - 6, b.y - 6, b.w + 12, b.h + 12);
      ctx.fill(); ctx.stroke();
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
  $('#hud-lives').textContent = '♥'.repeat(Math.max(0, G.lives));
  renderPartsBar();
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
}
function updateUltButton() {
  const btn = $('#btn-ult');
  const max = G.ult.max * G.mods.ult;
  btn.classList.toggle('ready', G.ult.cd <= 0);
  btn.style.setProperty('--fill', `${(1 - G.ult.cd / max) * 100}%`);
  $('#ult-cd').textContent = G.ult.cd > 0 ? `${Math.ceil(G.ult.cd)}초` : '사용 가능';
}
let lastCombo = -1;
function updateCombo() {
  if (G.combo === lastCombo) return;
  lastCombo = G.combo;
  const el = $('#combo');
  if (G.combo >= 5) {
    el.textContent = `${G.combo} 콤보 · 돈 ×${comboMult().toFixed(1)}`;
    el.hidden = false;
  } else el.hidden = true;
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
  clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 1500);
}
function overlay(id) {
  for (const o of $$('.overlay')) o.hidden = o.id !== id;
}

// ---------- 스테이지 사이: 캡슐 머신 (가챠) ----------
let offers = [], offerPicked = false, selSlot = -1, pendingOffer = null;
function rollRarity(boss) {
  const r = Math.random();
  const [leg, rare] = boss ? [0.18, 0.42] : [0.08, 0.30];
  return r < leg ? 'legend' : r < leg + rare ? 'rare' : 'common';
}
function rollOffers() {
  const boss = isBossStage(G.stage);
  const out = [];
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
function partCard(id, attrs = '') {
  const p = PARTS[id], r = RARITY[p.rarity];
  return `<button class="part" style="--rc:${r.color}" ${attrs}><span class="p-icon">${p.icon}</span>
    <span class="p-body"><span class="p-top"><b>${p.name}</b><span class="p-rar">${r.name}</span></span><span class="p-desc">${p.desc}</span></span></button>`;
}
function renderGacha() {
  $('#gacha-money').textContent = money().toLocaleString();
  $('#gacha-lead').textContent = pendingOffer ? '교체할 칸을 눌러요 (원래 부품은 팔려요)' : offerPicked ? '부품을 받았어요. 다시 돌려서 더 뽑거나 다음으로 가요' : '캡슐 3개 중 1개를 무료로 골라요';
  $('#offers').innerHTML = offers.map((id, i) => partCard(id, `data-offer="${i}" ${offerPicked ? 'disabled' : ''}`)).join('');
  $('#btn-reroll').textContent = `다시 돌리기 ● ${rerollCost()}`;
  $('#btn-reroll').disabled = G.money < rerollCost();
  $('#btn-skip').textContent = offerPicked ? '다음 스테이지' : `건너뛰기 +● ${skipCash()}`;
  // 내 부품 슬롯
  $('#slots').innerHTML = Array.from({ length: SLOTS }, (_, i) => {
    const id = G.parts[i];
    if (!id) return `<button class="slot empty" data-slot="${i}">${pendingOffer != null ? '여기' : ''}</button>`;
    const p = PARTS[id];
    return `<button class="slot ${selSlot === i ? 'sel' : ''}" data-slot="${i}" style="--rc:${RARITY[p.rarity].color}" title="${p.name}">${p.icon}</button>`;
  }).join('');
  const sel = selSlot >= 0 && G.parts[selSlot];
  $('#slot-info').innerHTML = sel
    ? `<b>${PARTS[sel].icon} ${PARTS[sel].name}</b> · ${PARTS[sel].desc}${PARTS[sel].copy ? `<br><span class="copy-note">지금 복사 중: ${copyTarget(selSlot)}</span>` : ''}
       <div class="row"><button class="ghost" data-move="-1">◀ 왼쪽</button><button class="ghost" data-move="1">오른쪽 ▶</button><button class="ghost sell" data-sell>팔기 ● ${sellPrice(sel)}</button></div>`
    : `<span class="muted">슬롯을 누르면 순서를 바꾸거나 팔 수 있어요. 왼쪽부터 발동해요.</span>`;
  renderPartsBar();
}
function copyTarget(i) {
  const seen = new Set();
  let j = i;
  while (G.parts[j] && (G.parts[j] === 'blueprint' || G.parts[j] === 'brain') && !seen.has(j)) { seen.add(j); j = G.parts[j] === 'blueprint' ? j + 1 : 0; }
  const id = G.parts[j];
  return id && !seen.has(j) && !PARTS[id].copy ? `${PARTS[id].icon} ${PARTS[id].name}` : '없음 (복사할 부품이 없어요)';
}
function takePart(id, slot) {
  if (G.parts[slot]) G.money += sellPrice(G.parts[slot]);
  G.parts[slot] = id;
  G.parts = G.parts.filter(Boolean);
  recalcParts();
}
$('#offers').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-offer]');
  if (!b || offerPicked) return;
  const id = offers[+b.dataset.offer];
  if (G.parts.length < SLOTS) { takePart(id, G.parts.length); offerPicked = true; toast(`${PARTS[id].icon} ${PARTS[id].name} 장착!`); }
  else pendingOffer = id; // 칸이 꽉 찼으면 바꿀 칸을 고르게 함
  renderGacha();
});
$('#slots').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-slot]');
  if (!b) return;
  const i = +b.dataset.slot;
  if (pendingOffer) { takePart(pendingOffer, i); toast(`${PARTS[pendingOffer].icon} ${PARTS[pendingOffer].name} 장착!`); pendingOffer = null; offerPicked = true; selSlot = -1; }
  else selSlot = G.parts[i] ? (selSlot === i ? -1 : i) : -1;
  renderGacha();
});
$('#slot-info').addEventListener('click', (ev) => {
  const mv = ev.target.closest('[data-move]');
  if (mv && selSlot >= 0) {
    const j = selSlot + +mv.dataset.move;
    if (j >= 0 && j < G.parts.length) { [G.parts[selSlot], G.parts[j]] = [G.parts[j], G.parts[selSlot]]; selSlot = j; recalcParts(); }
  }
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
// 게임 화면 위쪽에 끼운 부품 표시
function renderPartsBar() {
  $('#parts-bar').innerHTML = G.parts.map((id) => `<span class="pb" style="--rc:${RARITY[PARTS[id].rarity].color}" title="${PARTS[id].name}">${PARTS[id].icon}</span>`).join('');
}

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
  }).join('');
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
    <div><b>${G.kills}</b><span>부순 블록</span></div>
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
canvas.addEventListener('pointerdown', (ev) => { toGame(ev); pointer.down = true; canvas.setPointerCapture(ev.pointerId); });
canvas.addEventListener('pointermove', (ev) => { if (pointer.down) toGame(ev); });
const release = () => { pointer.down = false; };
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
// 키보드 (컴퓨터): 1·2·3 무기, 스페이스 필살기, P 일시정지
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
window.__game = { get G() { return G; }, start, recalcParts, effectiveParts, PARTS, update, draw, fire, useUlt, startStage, stageClear, pointer, WEAPONS, upgradeCost, weakPos, get H() { return H; }, get LINE_Y() { return LINE_Y; }, get TURRET_Y() { return TURRET_Y; } };
