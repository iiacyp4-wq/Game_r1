'use strict';
// 블록 디펜스 — 내려오는 블록을 방어선 전에 부수는 게임
// 좌표는 가로 360 기준의 "게임 좌표"로 계산하고, 화면 크기에 맞춰 늘려서 그림

const VERSION = 'v1.0';
const W = 360;          // 게임판 가로 (게임 좌표)
const COLS = 7;
const CELL = W / COLS;  // 한 칸 폭
const BW = CELL - 6;    // 블록 폭
const BH = 34;          // 블록 높이
const ROW_GAP = 44;     // 줄 간격
const BEST_KEY = 'blockdefense:best';

// ---------- 무기 ----------
const WEAPONS = {
  laser: {
    name: '레이저', desc: '한 블록에 강한 한 방. 갑옷·보스용', price: 0,
    interval: 0.45, // 느리지만 한 방이 셈: 블록이 몰려오면 혼자서는 못 버팀
    stat: (lv) => ({ dmg: Math.round(24 * 1.22 ** (lv - 1)), pierce: 1 }),
    statText: (s) => `데미지 ${s.dmg}`,
  },
  shotgun: {
    name: '산탄총', desc: '약한 탄을 부채꼴로 여러 발. 떼거지·분열 블록용', price: 60,
    interval: 0.5,
    stat: (lv) => ({ dmg: Math.round(5 * 1.22 ** (lv - 1)), pellets: 6 + Math.floor((lv - 1) / 3) }),
    statText: (s) => `데미지 ${s.dmg} × ${s.pellets}발`,
  },
  mortar: {
    name: '박격포', desc: '누른 자리에서 터져 주변까지 피해. 뭉친 블록용', price: 120,
    interval: 0.8,
    stat: (lv) => ({ dmg: Math.round(12 * 1.22 ** (lv - 1)), radius: Math.min(48 + 3 * (lv - 1), 80) }),
    statText: (s) => `데미지 ${s.dmg} · 범위 ${Math.round(s.radius)}`,
  },
};
const upgradeCost = (lv) => Math.round(40 * 1.7 ** (lv - 1));

// ---------- 블록 ----------
const TYPES = {
  normal: { color: '#3fb8c9', hp: 1.0, reward: 3 },
  charger: { color: '#ff7a45', hp: 0.8, reward: 5 },
  splitter: { color: '#a970ff', hp: 1.2, reward: 4 },
  armor: { color: '#7b8496', hp: 1.5, reward: 7, armor: 1 },
  mini: { color: '#c9a7ff', hp: 0.3, reward: 1 },
  minion: { color: '#ff9db0', hp: 0.6, reward: 2 },
  boss: { color: '#e63e62', hp: 1, reward: 0, armor: 1.3 }, // 약한 광역 공격은 거의 안 들어감
};

// ---------- 강화 카드 ----------
// max: 한 판에 고를 수 있는 횟수 (무한히 쌓이면 너무 쉬워져서)
const CARDS = [
  { id: 'dmg', name: '데미지 +15%', desc: '모든 무기의 데미지가 늘어요', max: 3 },
  { id: 'rate', name: '연사 +15%', desc: '모든 무기를 더 빨리 쏴요', max: 3 },
  { id: 'crit', name: '치명타 +10%', desc: '10% 확률로 2배 데미지', max: 3 },
  { id: 'pierce', name: '산탄 관통 +1', desc: '산탄총 탄이 블록을 1개 더 뚫고 지나가요', max: 2 },
  { id: 'money', name: '돈 +20%', desc: '블록을 깰 때 버는 돈이 늘어요', max: 3 },
  { id: 'radius', name: '폭발 범위 +25%', desc: '박격포가 더 넓게 터져요', max: 2 },
  { id: 'life', name: '생명 +1', desc: '방어선 생명을 1개 채워요 (최대 7)', max: 99 },
  { id: 'ult', name: '폭격 쿨타임 -20%', desc: '필살기를 더 자주 써요', max: 2 },
];

// ---------- 상태 ----------
let G = null;            // 한 판의 상태
let H = 600;             // 게임판 세로 (화면 비율에 따라)
let LINE_Y = 540;        // 방어선
let TURRET_Y = 570;      // 포대
let scale = 1;
const pointer = { down: false, x: W / 2, y: 0 };

function newGame() {
  return {
    stage: 0, lives: 5, money: 0, score: 0, kills: 0,
    weapons: { laser: 1 },  // 가진 무기와 레벨
    current: 'laser',
    cooldown: 0,
    mods: { dmg: 1, rate: 1, crit: 0, pierce: 0, money: 1, radius: 1, ult: 1 },
    picked: {},             // 카드별 고른 횟수
    ult: { cd: 0, max: 40 },
    blocks: [], bullets: [], shells: [], beams: [], fx: [], texts: [],
    rowsLeft: 0, rowDist: 0, speed: 10,
    combo: 0, comboTime: 0,
    state: 'title', banner: 0,
    boss: null, bossKilled: 0,
  };
}

// ---------- 화면 크기 ----------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
function resize() {
  const rect = canvas.getBoundingClientRect();
  scale = rect.width / W;
  H = Math.round(rect.height / scale);
  LINE_Y = H - 52;
  TURRET_Y = H - 24;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
}
window.addEventListener('resize', resize);

// ---------- 스테이지 ----------
const isBossStage = (n) => n > 0 && n % 5 === 0;
// 블록 체력은 스테이지마다 17%씩 늘어남
function blockHp(type, stage) {
  return Math.max(1, Math.round(20 * 1.17 ** (stage - 1) * TYPES[type].hp));
}
const armorOf = (type) => (TYPES[type].armor ? TYPES[type].armor * 8 * 1.12 ** (G.stage - 1) : 0);
function startStage() {
  G.stage++;
  const n = G.stage;
  G.speed = Math.min(10 + n * 0.8, 30);
  G.rowsLeft = isBossStage(n) ? 0 : Math.min(8 + Math.floor(n / 2), 20); // 보스 스테이지는 보스와 졸개만
  G.rowDist = ROW_GAP; // 바로 첫 줄
  G.boss = null;
  if (isBossStage(n)) spawnBoss();
  G.state = 'play';
  showBanner(isBossStage(n) ? `BOSS` : `STAGE ${n}`, isBossStage(n) ? '노란 약점을 노려요' : '', isBossStage(n));
  updateHud();
}
function spawnRow() {
  const n = G.stage;
  // 한 줄 블록 수: 스테이지가 오를수록 빽빽하게 (단일 무기만으로는 못 버티게)
  const count = Math.min(COLS, 2 + Math.floor(n / 3) + Math.floor(Math.random() * 3));
  const cols = [...Array(COLS).keys()].sort(() => Math.random() - 0.5).slice(0, count);
  for (const c of cols) {
    let type = 'normal';
    const r = Math.random();
    if (n >= 2 && r < 0.12 + n * 0.01) type = 'charger';
    else if (n >= 3 && r < 0.26 + n * 0.012) type = 'splitter';
    else if (n >= 4 && r < 0.36 + n * 0.014) type = 'armor';
    addBlock(type, c * CELL + 3, -BH - 4, BW, BH, blockHp(type, n));
  }
  G.rowsLeft--;
}
function addBlock(type, x, y, w, h, hp) {
  const b = { type, x, y, w, h, hp, max: hp, hit: 0, dash: 0, warn: 0 };
  if (type === 'charger') b.next = 3 + Math.random() * 3;
  G.blocks.push(b);
  return b;
}
function spawnBoss() {
  const n = G.stage;
  const hp = blockHp('normal', n) * 60;
  const b = addBlock('boss', CELL + 3, -90, CELL * 5 - 6, 74, hp);
  b.weak = { t: 0, r: 13 };
  b.shieldAt = [0.6, 0.3];   // 체력 60%, 30%에서 보호막
  b.shield = false;
  G.boss = b;
}
// 보스 보호막: 졸개 블록이 남아 있는 동안 보스는 데미지를 안 받음
function bossShield(b) {
  b.shield = true;
  const hp = Math.round(blockHp('minion', G.stage));
  const y = b.y + b.h + 8;
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < COLS; c++) {
      if ((c + r) % 2) continue;
      const m = addBlock('minion', c * CELL + 3, y + r * ROW_GAP, BW, BH, hp);
      m.escort = true;
    }
  }
  showBanner('보호막!', '졸개를 먼저 치워요', true);
}

// ---------- 데미지 ----------
function dealDamage(b, raw, opts = {}) {
  if (b.dead) return 0;
  if (b.type === 'boss' && b.shield) { addText(b.x + b.w / 2, b.y + b.h / 2, '막힘', '#9fb3ff'); return 0; }
  let d = raw * G.mods.dmg;
  let crit = false;
  if (Math.random() < G.mods.crit) { d *= 2; crit = true; }
  if (opts.weak) d *= 3;
  const armor = armorOf(b.type);
  if (armor && d < armor) d *= 0.1; // 갑옷: 약한 공격은 거의 안 들어감
  b.hp -= d;
  b.hit = 0.08;
  G.score += Math.min(d, b.hp + d);
  if (opts.weak || crit) addText(b.x + b.w / 2, b.y - 4, `${opts.weak ? '약점 ' : ''}${Math.round(d)}`, opts.weak ? '#ffcc4d' : '#fff');
  if (b.type === 'boss') {
    while (b.shieldAt.length && b.hp / b.max <= b.shieldAt[0]) { b.shieldAt.shift(); bossShield(b); }
  }
  if (b.hp <= 0) killBlock(b);
  return d;
}
function killBlock(b) {
  b.dead = true;
  G.kills++;
  // 콤보: 1.5초 안에 연달아 깨면 돈 배율 증가 (5콤보마다 +0.1, 최대 ×1.5)
  G.combo = G.comboTime > 0 ? G.combo + 1 : 1;
  G.comboTime = 1.5;
  const mult = comboMult();
  let reward = TYPES[b.type].reward * (1 + 0.06 * G.stage);
  if (b.type === 'boss') reward = 100 + G.stage * 25;
  const gain = Math.round(reward * mult * G.mods.money);
  G.money += gain;
  addText(b.x + b.w / 2, b.y + b.h / 2, `+${gain}`, '#ffcc4d');
  burst(b.x + b.w / 2, b.y + b.h / 2, TYPES[b.type].color, b.type === 'boss' ? 60 : 12);
  if (b.type === 'splitter') {
    const hp = Math.round(b.max * 0.3);
    for (const dx of [0, b.w / 2]) addBlock('mini', b.x + dx + 1, b.y + 6, b.w / 2 - 2, BH - 10, hp);
  }
  if (b.type === 'boss') {
    G.boss = null;
    G.bossKilled++;
    for (const m of G.blocks) if (m.escort) m.escort = false;
    showBanner('보스 격파!', `+${gain}`, false);
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
const comboMult = () => 1 + Math.min(5, Math.floor(G.combo / 5)) * 0.1;
function fire() {
  const w = G.current, lv = G.weapons[w], s = WEAPONS[w].stat(lv);
  const a = aimAngle();
  const ox = W / 2 + Math.cos(a) * 22, oy = TURRET_Y + Math.sin(a) * 22;
  if (w === 'laser') {
    // 즉시 맞는 광선: 가까운 블록부터 관통 수만큼
    const dx = Math.cos(a), dy = Math.sin(a);
    const hits = [];
    for (const b of G.blocks) {
      if (b.dead) continue;
      const t = rayRect(ox, oy, dx, dy, b);
      if (t != null) hits.push([t, b]);
    }
    hits.sort((p, q) => p[0] - q[0]);
    const pierce = s.pierce; // 레이저는 항상 한 블록만 (관통 카드는 산탄 전용)
    let end = 900;
    hits.slice(0, pierce).forEach(([t, b], i) => {
      dealDamage(b, s.dmg, { weak: b.type === 'boss' && rayCircle(ox, oy, dx, dy, weakPos(b), b.weak.r) });
      if (i === pierce - 1) end = t + 6;
    });
    G.beams.push({ x1: ox, y1: oy, x2: ox + dx * end, y2: oy + dy * end, life: 0.09 });
  } else if (w === 'shotgun') {
    const spread = 0.55;
    for (let i = 0; i < s.pellets; i++) {
      const aa = a - spread / 2 + (spread * i) / (s.pellets - 1) + (Math.random() - 0.5) * 0.04;
      G.bullets.push({ x: ox, y: oy, vx: Math.cos(aa) * 620, vy: Math.sin(aa) * 620, dmg: s.dmg, pierce: G.mods.pierce, life: 0.62, hitSet: new Set() });
    }
  } else if (w === 'mortar') {
    // 누른 자리(사거리 안)까지 날아가서 터짐. 중간에 블록에 닿으면 그 자리에서 터짐
    const dist = Math.min(Math.hypot(pointer.x - ox, pointer.y - oy), 640);
    G.shells.push({ x: ox, y: oy, vx: Math.cos(a) * 480, vy: Math.sin(a) * 480, left: Math.max(dist, 60), dmg: s.dmg, radius: s.radius * G.mods.radius });
  }
  G.cooldown = WEAPONS[w].interval / G.mods.rate;
}
function explode(x, y, dmg, radius) {
  for (const b of [...G.blocks]) { // 분열로 새로 생긴 블록은 이번 폭발에서 제외
    if (b.dead) continue;
    const cx = Math.max(b.x, Math.min(x, b.x + b.w)), cy = Math.max(b.y, Math.min(y, b.y + b.h));
    if (Math.hypot(cx - x, cy - y) <= radius) {
      dealDamage(b, dmg, { weak: b.type === 'boss' && Math.hypot(x - weakPos(b).x, y - weakPos(b).y) < radius * 0.5 });
    }
  }
  G.fx.push({ type: 'ring', x, y, r: radius, life: 0.3, max: 0.3 });
  burst(x, y, '#ffb347', 10);
}
function useUlt() {
  if (G.state !== 'play' || G.ult.cd > 0) return;
  const dmg = blockHp('normal', G.stage) * 0.8; // 약해진 블록은 정리, 나머지는 크게 깎는 세기
  for (const b of [...G.blocks]) if (!b.dead) dealDamage(b, dmg / G.mods.dmg); // 필살기는 데미지 카드 영향 X
  G.ult.cd = G.ult.max * G.mods.ult;
  G.fx.push({ type: 'flash', life: 0.35, max: 0.35 });
  buzz();
}

// ---------- 충돌 계산 ----------
function rayRect(ox, oy, dx, dy, b) {
  let tmin = 0, tmax = 2000;
  for (const [o, d, lo, hi] of [[ox, dx, b.x, b.x + b.w], [oy, dy, b.y, b.y + b.h]]) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return null; continue; }
    let t1 = (lo - o) / d, t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
function rayCircle(ox, oy, dx, dy, c, r) {
  const fx = c.x - ox, fy = c.y - oy;
  const t = fx * dx + fy * dy;
  if (t < 0) return false;
  return Math.hypot(fx - dx * t, fy - dy * t) <= r;
}
function weakPos(b) {
  return { x: b.x + b.w / 2 + Math.sin(b.weak.t * 1.3) * (b.w / 2 - 22), y: b.y + b.h - 18 };
}
const inside = (x, y, b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

// ---------- 효과 ----------
function burst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 160;
    G.fx.push({ type: 'p', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5, max: 0.5, color });
  }
}
function addText(x, y, text, color) { G.texts.push({ x, y, text, color, life: 0.8 }); }
function buzz() { if (navigator.vibrate) navigator.vibrate(30); }

// ---------- 매 프레임 ----------
function update(dt) {
  if (G.state !== 'play') return;
  if (G.banner > 0) G.banner -= dt;
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
    const sp = b.type === 'boss' || b.escort ? G.speed * 0.55 : G.speed;
    b.y += sp * dt;
    if (b.type === 'boss') b.weak.t += dt;
    if (b.type === 'charger') {
      if (b.dash > 0) { const d = Math.min(b.dash, 260 * dt); b.y += d; b.dash -= d; }
      else if (b.warn > 0) { b.warn -= dt; if (b.warn <= 0) b.dash = ROW_GAP; }
      else if ((b.next -= dt) <= 0 && b.y > 0) { b.warn = 0.9; b.next = 4 + Math.random() * 3; }
    }
    if (b.y + b.h >= LINE_Y) {
      b.dead = true;
      if (b.type === 'boss') { G.lives = 0; }
      else G.lives--;
      G.fx.push({ type: 'flash', life: 0.25, max: 0.25, red: true });
      burst(b.x + b.w / 2, LINE_Y, '#ff4d6d', 14);
      buzz();
      updateHud();
      if (G.lives <= 0) return gameOver();
    }
  }

  // 발사
  G.cooldown -= dt;
  if (pointer.down && G.cooldown <= 0) fire();

  // 산탄 탄환
  for (const p of G.bullets) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    for (const b of [...G.blocks]) {
      if (b.dead || p.hitSet.has(b) || !inside(p.x, p.y, b)) continue;
      p.hitSet.add(b);
      dealDamage(b, p.dmg, { weak: b.type === 'boss' && Math.hypot(p.x - weakPos(b).x, p.y - weakPos(b).y) < b.weak.r + 3 });
      if (p.pierce-- <= 0) { p.life = 0; break; }
    }
  }
  G.bullets = G.bullets.filter((p) => p.life > 0 && p.y > -20 && p.x > -20 && p.x < W + 20);

  // 박격포
  for (const s of G.shells) {
    const step = Math.hypot(s.vx, s.vy) * dt;
    s.x += s.vx * dt; s.y += s.vy * dt; s.left -= step;
    const hitBlock = G.blocks.some((b) => !b.dead && inside(s.x, s.y, b));
    if (hitBlock || s.left <= 0 || s.y < -10) { explode(s.x, s.y, s.dmg, s.radius); s.done = true; }
  }
  G.shells = G.shells.filter((s) => !s.done);

  G.blocks = G.blocks.filter((b) => !b.dead);

  // 효과
  for (const f of G.fx) { f.life -= dt; if (f.type === 'p') { f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.92; f.vy *= 0.92; } }
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
  ctx.clearRect(0, 0, W, H);
  // 배경 격자
  ctx.strokeStyle = 'rgba(255,255,255,.035)';
  ctx.lineWidth = 1;
  for (let c = 1; c < COLS; c++) { ctx.beginPath(); ctx.moveTo(c * CELL, 0); ctx.lineTo(c * CELL, LINE_Y); ctx.stroke(); }

  // 방어선
  ctx.save();
  ctx.strokeStyle = '#ff4d6d';
  ctx.shadowColor = '#ff4d6d'; ctx.shadowBlur = 10;
  ctx.setLineDash([10, 6]);
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, LINE_Y); ctx.lineTo(W, LINE_Y); ctx.stroke();
  ctx.restore();

  // 블록
  for (const b of G.blocks) drawBlock(b);

  // 광선
  for (const b of G.beams) {
    ctx.save();
    ctx.globalAlpha = b.life / 0.09;
    ctx.strokeStyle = '#7ff7d6'; ctx.shadowColor = '#38d39f'; ctx.shadowBlur = 12; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
    ctx.restore();
  }
  // 산탄
  ctx.fillStyle = '#ffe08a';
  for (const p of G.bullets) { ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2); ctx.fill(); }
  // 박격포
  ctx.fillStyle = '#ffb347';
  for (const s of G.shells) { ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI * 2); ctx.fill(); }

  // 효과
  for (const f of G.fx) {
    const k = f.life / f.max;
    if (f.type === 'p') { ctx.globalAlpha = k; ctx.fillStyle = f.color; ctx.fillRect(f.x - 2, f.y - 2, 4, 4); }
    else if (f.type === 'ring') { ctx.globalAlpha = k; ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1.1 - k * 0.4), 0, Math.PI * 2); ctx.stroke(); }
    else if (f.type === 'flash') { ctx.globalAlpha = k * 0.5; ctx.fillStyle = f.red ? '#ff4d6d' : '#ffcc4d'; ctx.fillRect(0, 0, W, H); }
  }
  ctx.globalAlpha = 1;

  // 조준선 + 포대
  const a = aimAngle();
  if (pointer.down && G.state === 'play') {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.setLineDash([4, 6]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(W / 2, TURRET_Y); ctx.lineTo(W / 2 + Math.cos(a) * 700, TURRET_Y + Math.sin(a) * 700); ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  ctx.translate(W / 2, TURRET_Y);
  ctx.rotate(a);
  ctx.fillStyle = { laser: '#38d39f', shotgun: '#ffe08a', mortar: '#ffb347' }[G.current];
  ctx.fillRect(0, -5, 26, 10);
  ctx.restore();
  ctx.fillStyle = '#1d2747'; ctx.strokeStyle = '#3c4a78'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(W / 2, TURRET_Y, 16, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

  // 떠오르는 숫자
  ctx.textAlign = 'center'; ctx.font = '700 12px -apple-system, "Apple SD Gothic Neo", sans-serif';
  for (const t of G.texts) { ctx.globalAlpha = Math.min(1, t.life * 2); ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, t.y); }
  ctx.globalAlpha = 1;
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function drawBlock(b) {
  const t = TYPES[b.type];
  // 돌진 경고: 깜빡이는 빨간 테두리 + 아래 화살표
  if (b.type === 'charger' && b.warn > 0 && Math.floor(b.warn * 10) % 2 === 0) {
    ctx.strokeStyle = '#ff4d6d'; ctx.lineWidth = 3;
    roundRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6, 9); ctx.stroke();
    ctx.fillStyle = '#ff4d6d';
    ctx.beginPath(); ctx.moveTo(b.x + b.w / 2 - 7, b.y + b.h + 6); ctx.lineTo(b.x + b.w / 2 + 7, b.y + b.h + 6); ctx.lineTo(b.x + b.w / 2, b.y + b.h + 14); ctx.fill();
  }
  ctx.fillStyle = b.hit > 0 ? '#ffffff' : t.color;
  roundRect(b.x, b.y, b.w, b.h, b.type === 'boss' ? 12 : 7); ctx.fill();
  if (b.type === 'armor') { ctx.strokeStyle = '#c9d1e3'; ctx.lineWidth = 3; roundRect(b.x + 1.5, b.y + 1.5, b.w - 3, b.h - 3, 6); ctx.stroke(); }
  // 남은 체력 띠
  const k = Math.max(0, b.hp / b.max);
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.fillRect(b.x + 4, b.y + b.h - 6, b.w - 8, 3);
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.fillRect(b.x + 4, b.y + b.h - 6, (b.w - 8) * k, 3);
  // 체력 숫자
  ctx.fillStyle = '#0b1020';
  ctx.textAlign = 'center';
  ctx.font = `800 ${b.type === 'boss' ? 18 : b.type === 'mini' ? 10 : 13}px -apple-system, "Apple SD Gothic Neo", sans-serif`;
  ctx.fillText(Math.ceil(b.hp), b.x + b.w / 2, b.y + b.h / 2 + (b.type === 'boss' ? -4 : 3));
  if (b.type === 'boss') {
    const wp = weakPos(b);
    ctx.save();
    ctx.fillStyle = '#ffcc4d'; ctx.shadowColor = '#ffcc4d'; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.arc(wp.x, wp.y, b.weak.r * 0.7, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (b.shield) {
      ctx.save();
      ctx.strokeStyle = 'rgba(159,179,255,.9)'; ctx.fillStyle = 'rgba(159,179,255,.15)'; ctx.lineWidth = 3;
      roundRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12, 16); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }
}

// ---------- 화면(HUD) ----------
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
function updateHud() {
  $('#hud-stage').textContent = isBossStage(G.stage) ? `STAGE ${G.stage} · BOSS` : `STAGE ${Math.max(G.stage, 1)}`;
  $('#hud-stage').classList.toggle('boss', isBossStage(G.stage) && !!G.boss);
  $('#hud-lives').textContent = '♥'.repeat(Math.max(0, G.lives));
  $('#hud-money').textContent = G.money.toLocaleString();
  for (const btn of $$('.weapon')) {
    const w = btn.dataset.w, def = WEAPONS[w], lv = G.weapons[w];
    btn.classList.toggle('active', G.current === w);
    btn.classList.toggle('locked', !lv);
    btn.classList.toggle('afford', !lv && G.money >= def.price);
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

// ---------- 스테이지 사이: 강화 카드 ----------
function stageClear() {
  G.state = 'cards';
  pointer.down = false;
  const pool = CARDS.filter((c) => (G.picked[c.id] || 0) < c.max && !(c.id === 'life' && G.lives >= 7) && !(c.id === 'radius' && !G.weapons.mortar) && !(c.id === 'pierce' && !G.weapons.shotgun));
  const pick = pool.sort(() => Math.random() - 0.5).slice(0, 3);
  // 고를 카드가 모자라면 '돈 받기' 카드로 채움 (항상 3장)
  const cash = 40 + 20 * G.stage;
  while (pick.length < 3) pick.push({ id: 'cash', name: `● ${cash} 받기`, desc: '바로 돈을 받아요' });
  $('#cards-title').textContent = isBossStage(G.stage) ? '보스 격파!' : `STAGE ${G.stage} 클리어!`;
  $('#cards').innerHTML = pick.map((c) => `<button class="card" data-card="${c.id}"><span class="tag">강화</span><b>${c.name}</b><span>${c.desc}</span></button>`).join('');
  overlay('ov-cards');
}
$('#cards').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-card]');
  if (!b) return;
  const id = b.dataset.card, m = G.mods;
  G.picked[id] = (G.picked[id] || 0) + 1;
  if (id === 'dmg') m.dmg *= 1.15;
  if (id === 'rate') m.rate *= 1.15;
  if (id === 'crit') m.crit += 0.1;
  if (id === 'pierce') m.pierce += 1;
  if (id === 'money') m.money *= 1.2;
  if (id === 'radius') m.radius *= 1.25;
  if (id === 'life') G.lives = Math.min(7, G.lives + 1);
  if (id === 'ult') m.ult *= 0.8;
  if (id === 'cash') G.money += 40 + 20 * G.stage;
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
  $('#shop-money').textContent = G.money.toLocaleString();
  $('#shop-list').innerHTML = Object.entries(WEAPONS).map(([id, def]) => {
    const lv = G.weapons[id];
    const cost = lv ? upgradeCost(lv) : def.price;
    const now = lv ? def.statText(def.stat(lv)) : '';
    const next = def.statText(def.stat((lv || 0) + 1 || 1));
    return `<div class="shop-item">
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
    if (G.money < def.price) return toast(`● ${def.price - G.money} 더 모아야 해요`);
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
    if (G.state === 'play') { updateUltButton(); updateCombo(); $('#hud-money').textContent = G.money.toLocaleString(); }
  }
  requestAnimationFrame(loop);
}

G = newGame();
resize();
updateHud();
showTitle();
requestAnimationFrame(loop);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
window.__game = { get G() { return G; }, start, update, draw, fire, useUlt, startStage, stageClear, pointer, WEAPONS, upgradeCost, get H() { return H; }, get LINE_Y() { return LINE_Y; }, get TURRET_Y() { return TURRET_Y; } };
