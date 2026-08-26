/* ============================================================
 * ai_selfcheck.js —— 权重自检
 *
 * 用法：node tools/ai_selfcheck.js [局数] [搜索深度] [目标方块(0=不限)]
 * 用 ai.js 的策略跑 N 局，输出平均分与最大方块分布。
 * 搜索深度 0 与训练脚本 eval 完全一致（可做一致性校验）；
 * 默认 0，游戏内 AI 默认深度为 2。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ai = require('../ai.js');

const N = parseInt(process.argv[2] || '50', 10);
const DEPTH = parseInt(process.argv[3] || '0', 10);
const TARGET = parseInt(process.argv[4] || '2048', 10);

/* ---------- 游戏核心（与训练脚本一致） ---------- */
function emptyBoard() {
  return Array.from({ length: 4 }, function () { return [0, 0, 0, 0]; });
}

function spawn(b, rnd) {
  const empties = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (!b[r][c]) empties.push(r * 4 + c);
    }
  }
  if (!empties.length) return false;
  const p = empties[Math.floor(rnd() * empties.length)];
  b[Math.floor(p / 4)][p % 4] = rnd() < 0.9 ? 2 : 4;
  return true;
}

function compressLine(arr) {
  const out = [];
  let gain = 0;
  for (const v of arr) {
    if (!v) continue;
    if (out.length && out[out.length - 1] === v) {
      out[out.length - 1] = v * 2;
      gain += v * 2;
    } else {
      out.push(v);
    }
  }
  while (out.length < 4) out.push(0);
  return { out: out, gain: gain };
}

function moveBoard(b, dir) {
  const g = b.map(function (row) { return row.slice(); });
  let gain = 0;
  for (let r = 0; r < 4; r++) {
    if (dir === 0) {
      const res = compressLine(g[r]);
      g[r] = res.out;
      gain += res.gain;
    } else if (dir === 2) {
      const res = compressLine(g[r].slice().reverse());
      g[r] = res.out.reverse();
      gain += res.gain;
    }
  }
  if (dir === 1 || dir === 3) {
    for (let c = 0; c < 4; c++) {
      const col = [g[0][c], g[1][c], g[2][c], g[3][c]];
      if (dir === 1) {
        const res = compressLine(col);
        for (let i = 0; i < 4; i++) g[i][c] = res.out[i];
        gain += res.gain;
      } else {
        const res = compressLine(col.slice().reverse());
        const o = res.out.reverse();
        for (let i = 0; i < 4; i++) g[i][c] = o[i];
        gain += res.gain;
      }
    }
  }
  return { board: g, gain: gain };
}

function sameBoard(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function hasMoves(b) {
  for (let d = 0; d < 4; d++) {
    if (!sameBoard(b, moveBoard(b, d).board)) return true;
  }
  return false;
}

function maxTile(b) {
  let m = 0;
  for (const row of b) for (const v of row) if (v > m) m = v;
  return m;
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function playGame(rnd) {
  let b = emptyBoard();
  spawn(b, rnd);
  spawn(b, rnd);
  let score = 0;
  let moves = 0;
  let maxV = 2;
  while (moves < MAX_MOVES) {
    if (!hasMoves(b)) break;
    const best = ai.bestMove(b, DEPTH);
    if (best.dir < 0) break;
    const res = moveBoard(b, best.dir);
    b = res.board;
    score += res.gain;
    moves++;
    if (!spawn(b, rnd)) break;
    maxV = Math.max(maxV, maxTile(b));
    if (TARGET > 0 && maxV >= TARGET) break;
  }
  return { score: score, maxV: maxV };
}

/* ---------- 主流程 ---------- */
const weightsPath = path.join(__dirname, '..', 'weights.bin');
const raw = fs.readFileSync(weightsPath);
const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
const info = ai.loadFromBuffer(ab);
console.log('weights OK: tables=' + info.nTables + ' tableSize=' + info.tSize + ' base=' + info.base + ' bytes=' + info.bytes);
// TDL2048 模型（16 档）冲高分局很长，放宽步数上限，避免被 3000 步截断
const MAX_MOVES = info.base === 16 ? 100000 : 3000;

const rnd = mulberry32(42);
const counts = {};
let sum = 0;
for (let i = 0; i < N; i++) {
  const r = playGame(rnd);
  counts[r.maxV] = (counts[r.maxV] || 0) + 1;
  sum += r.score;
}
const dist = Object.keys(counts).map(Number).sort(function (a, b) { return a - b; })
  .map(function (k) { return k + ':' + counts[k]; }).join(' ');
console.log('eval(' + N + ' games) avgScore=' + Math.round(sum / N) + ' maxTileDist={' + dist + '}');
