/* 复盘评分逻辑的临时验证脚本（按每步真实盘面快照评价） */
'use strict';
const path = require('path');
const ai = require(path.join(__dirname, '..', 'ai.js'));

function emptyBoard() { return Array.from({ length: 4 }, function () { return [0, 0, 0, 0]; }); }
function spawn(b, rnd) {
  const empties = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (!b[r][c]) empties.push(r * 4 + c);
  if (!empties.length) return false;
  const p = empties[Math.floor(rnd() * empties.length)];
  b[Math.floor(p / 4)][p % 4] = rnd() < 0.9 ? 2 : 4;
  return true;
}
function compressLine(arr) {
  const out = []; let gain = 0;
  for (const v of arr) {
    if (!v) continue;
    if (out.length && out[out.length - 1] === v) { out[out.length - 1] = v * 2; gain += v * 2; }
    else out.push(v);
  }
  while (out.length < 4) out.push(0);
  return { out: out, gain: gain };
}
function moveBoard(b, dir) {
  const g = b.map(function (row) { return row.slice(); });
  let gain = 0;
  for (let r = 0; r < 4; r++) {
    if (dir === 0) { const res = compressLine(g[r]); g[r] = res.out; gain += res.gain; }
    else if (dir === 2) { const res = compressLine(g[r].slice().reverse()); g[r] = res.out.reverse(); gain += res.gain; }
  }
  if (dir === 1 || dir === 3) {
    for (let c = 0; c < 4; c++) {
      const col = [g[0][c], g[1][c], g[2][c], g[3][c]];
      if (dir === 1) { const res = compressLine(col); for (let i = 0; i < 4; i++) g[i][c] = res.out[i]; gain += res.gain; }
      else { const res = compressLine(col.slice().reverse()); const o = res.out.reverse(); for (let i = 0; i < 4; i++) g[i][c] = o[i]; gain += res.gain; }
    }
  }
  return { board: g, gain: gain };
}
function sameBoard(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function hasMoves(b) {
  for (let d = 0; d < 4; d++) if (!sameBoard(b, moveBoard(b, d).board)) return true;
  return false;
}
function maxTile(b) { let m = 0; for (const row of b) for (const v of row) if (v > m) m = v; return m; }
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const fs = require('fs');
const raw = fs.readFileSync(path.join(__dirname, '..', 'weights.bin'));
const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
ai.loadFromBuffer(ab);
console.log('weights loaded');

function playGame(strategy, seed) {
  const rnd = mulberry32(seed);
  let b = emptyBoard();
  spawn(b, rnd); spawn(b, rnd);
  const moves = [];
  let m = 0;
  while (m < 20000 && hasMoves(b)) {
    let dir;
    if (strategy === 'ai') {
      const best = ai.bestMove(b, 0);
      if (best.dir < 0) break;
      dir = best.dir;
    } else if (strategy === 'half') {
      dir = rnd() < 0.5 ? ai.bestMove(b, 0).dir : Math.floor(rnd() * 4);
      if (dir < 0) dir = Math.floor(rnd() * 4);
    } else {
      dir = Math.floor(rnd() * 4);
    }
    const res = moveBoard(b, dir);
    if (sameBoard(b, res.board)) continue;
    moves.push({ dir: dir, board: b.map(function (row) { return row.slice(); }) });
    b = res.board;
    m++;
    if (!spawn(b, rnd)) break;
  }
  return { moves: moves, maxTile: maxTile(b), score: m };
}

const t0 = Date.now();
console.log('---- AI 自己玩（应接近满分）----');
const g1 = playGame('ai', 42);
const t1 = Date.now();
const r1 = ai.review(g1.moves);
console.log('评审耗时', Date.now() - t1, 'ms');
console.log('得分', r1.score, '评级', r1.grade, '最大', r1.maxTile, '步数', r1.moves,
  'AI吻合率', Math.round(r1.aiRate * 100) + '%', '损失', Math.round(r1.lossSum), '失误数', r1.faults.length);

console.log('---- 随机玩家（应低分）----');
const g2 = playGame('random', 7);
const r2 = ai.review(g2.moves);
console.log('得分', r2.score, '评级', r2.grade, '最大', r2.maxTile, '步数', r2.moves,
  'AI吻合率', Math.round(r2.aiRate * 100) + '%', '损失', Math.round(r2.lossSum), '失误数', r2.faults.length);

console.log('---- 一半 AI 一半随机（应中分）----');
const g3 = playGame('half', 99);
const r3 = ai.review(g3.moves);
console.log('得分', r3.score, '评级', r3.grade, '最大', r3.maxTile, '步数', r3.moves,
  'AI吻合率', Math.round(r3.aiRate * 100) + '%', '失误数', r3.faults.length);
if (r3.faults.length) {
  const f = r3.faults[0];
  console.log('最大失误: 第' + f.step + '步 loss=' + Math.round(f.loss) + ' 玩家向' + f.dir + ' AI向' + f.aiDir);
}
console.log('总耗时', Date.now() - t0, 'ms');
