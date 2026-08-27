/* ============================================================
 * 2048 —— 游戏逻辑
 * 纯原生 JavaScript（IIFE 封装），无任何第三方依赖。
 * 所有数据仅保存在浏览器 localStorage，不发起网络请求。
 * ============================================================ */
(function () {
  'use strict';

  /* ---------- 常量与存储键 ----------
   * 本地存储键统一以 "2048-" 开头，
   * 避免与页面上的其他数据冲突。 */
  const SIZE = 4;
  const GAP = 12;
  const STORAGE_BEST = '2048-best';
  const STORAGE_SAVE = '2048-save';
  const STORAGE_SOUND = '2048-sound';
  const STORAGE_LEADERBOARD = '2048-leaderboard';
  const STORAGE_NAME = '2048-player-name';
  const MAX_ENTRIES = 10; // 排行榜最多保留 10 条

  /* ---------- DOM 引用 ---------- */
  const boardEl = document.getElementById('board');
  const cellsEl = document.getElementById('cells');
  const tilesEl = document.getElementById('tiles');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const newBtn = document.getElementById('new-btn');
  const undoBtn = document.getElementById('undo-btn');
  const soundBtn = document.getElementById('sound-btn');
  const iconSound = document.getElementById('icon-sound');
  const iconMuted = document.getElementById('icon-muted');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlaySub = document.getElementById('overlay-sub');
  const overlayContinue = document.getElementById('overlay-continue');
  const overlayNew = document.getElementById('overlay-new');
  const leaderboardBtn = document.getElementById('leaderboard-btn');
  const leaderboardOverlay = document.getElementById('leaderboard-overlay');
  const leaderboardList = document.getElementById('leaderboard-list');
  const leaderboardEmpty = document.getElementById('leaderboard-empty');
  const leaderboardClose = document.getElementById('leaderboard-close');
  const leaderboardDone = document.getElementById('leaderboard-done');
  const saveForm = document.getElementById('save-form');
  const playerName = document.getElementById('player-name');
  const reviewBtn = document.getElementById('review-btn');
  const reviewOverlay = document.getElementById('review-overlay');
  const reviewScore = document.getElementById('review-score');
  const reviewGrade = document.getElementById('review-grade');
  const reviewMetrics = document.getElementById('review-metrics');
  const reviewComment = document.getElementById('review-comment');
  const reviewLoading = document.getElementById('review-loading');
  const reviewSubtitle = document.getElementById('review-subtitle');
  const reviewFaults = document.getElementById('review-faults');
  const reviewClose = document.getElementById('review-close');
  const reviewDone = document.getElementById('review-done');

  /* ---------- 游戏状态 ---------- */
  const tileById = new Map();
  let grid = emptyGrid(); // 棋盘：grid[行][列] 存方块 id，0 表示空格
  let cell = 0; // 每个格子的边长（px），随窗口大小动态计算
  let nextId = 1; // 方块自增 id，用于区分每个方块并驱动动画
  let score = 0; // 当前得分
  let best = Number(readStorage(STORAGE_BEST) || 0); // 历史最高分
  let wonShown = false; // 是否已展示过"达成 2048"提示（只提示一次）
  let over = false; // 是否游戏结束
  let busy = false; // 动画/合并进行中的锁，避免连续操作
  let busyTimer = null; // busy 锁的定时器句柄
  let scoreBumpTimer = null; // 分数缩放动画的定时器句柄
  let soundOn = readStorage(STORAGE_SOUND) !== 'off'; // 音效开关
  let history = []; // 撤销栈：保存每一步之前的棋盘与分数
  let audioCtx = null; // Web Audio 上下文（首次发声时创建）
  let lastScore = 0; // 游戏结束时的得分快照（用于保存排行榜）
  let lastMaxTile = 0; // 游戏结束时的最大方块快照
  let scoreSubmitted = false; // 防止同一次结算重复提交成绩
  let moveLog = []; // 盘子复盘日志：每步 { dir, board(移动前真实盘面) }，撤销时同步回退

  /* ---------- 本地存储 ----------
   * 读写失败时静默降级（如隐私模式），游戏仍可在内存中运行。 */
  function readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      // Storage can be unavailable; the game still works in memory.
    }
  }

  function emptyGrid() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  }

  /* 创建 4×4 的背景网格（cells 层）；
   * 方块（tiles 层）叠加在其上，靠 transform 定位。 */
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cellEl = document.createElement('div');
      cellEl.className = 'cell';
      cellsEl.appendChild(cellEl);
    }
  }

  /* 根据棋盘实际宽度计算格子边长，写入 CSS 变量 --cell，
   * 供方块尺寸与定位使用。 */
  function metrics() {
    cell = (boardEl.clientWidth - GAP * (SIZE + 1)) / SIZE;
    boardEl.style.setProperty('--cell', cell + 'px');
  }

  /* 用 translate 定位方块：transform 同时承担移动动画。 */
  function positionTile(el, row, col) {
    const x = GAP + col * (cell + GAP);
    const y = GAP + row * (cell + GAP);
    el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
  }

  /* 数值 → 样式类名：2048 及以下用 t-2 / t-4 ... 专属配色，
   * 超出后统一用 t-super。 */
  function valueClass(value) {
    return value <= 2048 ? 't-' + value : 't-super';
  }

  /* 创建方块 DOM：外层 .tile 负责位移，内层 .tile-face 负责
   * 缩放/透明度动画，extra 用于追加 spawn/merge 等动画类。 */
  function createTile(id, row, col, value, extra) {
    const el = document.createElement('div');
    const classes = ['tile', valueClass(value)];
    if (extra) classes.push(extra);
    el.className = classes.join(' ');
    el.dataset.id = String(id);

    const face = document.createElement('div');
    face.className = 'tile-face len-' + Math.min(String(value).length, 6);
    face.textContent = String(value);
    el.appendChild(face);
    tilesEl.appendChild(el);
    positionTile(el, row, col);
    return el;
  }

  /* 逻辑层方块对象：记录位置、数值与对应 DOM。 */
  function tileObject(id, row, col, value) {
    return { id: id, row: row, col: col, value: value, el: null };
  }

  /* 清空所有方块（DOM 与映射表）。 */
  function clearTiles() {
    tilesEl.innerHTML = '';
    tileById.clear();
  }

  /* 从数值矩阵重建方块：用于读档和撤销恢复。 */
  function renderFromValues(values) {
    clearTiles();
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const value = values[r][c];
        if (!value) {
          grid[r][c] = 0;
          continue;
        }
        const tile = tileObject(nextId++, r, c, value);
        tile.el = createTile(tile.id, r, c, value);
        tileById.set(tile.id, tile);
        grid[r][c] = tile.id;
      }
    }
  }

  /* 把 id 矩阵转换为数值矩阵：用于存档与撤销快照。 */
  function gridValues() {
    return grid.map(function (row) {
      return row.map(function (id) {
        return id ? tileById.get(id).value : 0;
      });
    });
  }

  /* 返回所有空格子的 [行, 列] 列表。 */
  function emptyCells() {
    const result = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (!grid[r][c]) result.push([r, c]);
      }
    }
    return result;
  }

  /* 在随机空格生成新方块：90% 为 2，10% 为 4。 */
  function addRandom() {
    const cells = emptyCells();
    if (!cells.length) return;
    const index = Math.floor(Math.random() * cells.length);
    const pos = cells[index];
    const value = Math.random() < 0.9 ? 2 : 4;
    const tile = tileObject(nextId++, pos[0], pos[1], value);
    tile.el = createTile(tile.id, tile.row, tile.col, tile.value, 'spawn');
    tileById.set(tile.id, tile);
    grid[tile.row][tile.col] = tile.id;
    return tile;
  }

  /* 把 4 行 / 4 列按移动方向转成「行」数组统一处理：
   * 0=左 1=上 2=右 3=下。 */
  function linesFor(dir) {
    const lines = [];
    for (let i = 0; i < SIZE; i++) {
      const line = [];
      for (let j = 0; j < SIZE; j++) {
        if (dir === 0) line.push([i, j]);
        else if (dir === 1) line.push([j, i]);
        else if (dir === 2) line.push([i, SIZE - 1 - j]);
        else line.push([SIZE - 1 - j, i]);
      }
      lines.push(line);
    }
    return lines;
  }

  /* 将一行中的方块按顺序收拢，并合并相邻等值方块；
   * merged 标记保证每个方块在一次移动中最多合并一次。 */
  function collapseLine(line) {
    const result = [];
    for (let i = 0; i < line.length; i++) {
      const pos = line[i];
      const id = grid[pos[0]][pos[1]];
      if (!id) continue;
      const tile = tileById.get(id);
      const last = result[result.length - 1];
      if (last && !last.merged && last.value === tile.value) {
        last.merged = true;
        last.partner = id;
        last.gain = tile.value * 2;
      } else {
        result.push({ id: id, value: tile.value, merged: false, partner: null, gain: 0 });
      }
    }
    return result;
  }

  /* 核心移动逻辑：
   * 1. 动画锁 / 弹窗打开时忽略操作；
   * 2. 先记录移动前快照（供撤销）；
   * 3. 计算新棋盘，同时收集位移动画（moves）与合并动画（merges）；
   * 4. 无有效移动则直接返回；
   * 5. 分两段 setTimeout：先播合并动画并生成新方块，
   *    再解锁并检测游戏是否结束。 */
  function move(dir) {
    if (busy || over || !overlay.classList.contains('hidden') || !leaderboardOverlay.classList.contains('hidden')) return;

    // 快照：记录移动前的棋盘与分数，供撤销使用
    const before = gridValues();
    const lines = linesFor(dir);
    const newGrid = emptyGrid();
    const moves = [];
    const merges = [];
    let gained = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const collapsed = collapseLine(line);

      for (let j = 0; j < collapsed.length; j++) {
        const entry = collapsed[j];
        const target = line[j];
        const tr = target[0];
        const tc = target[1];

        if (entry.merged) {
          const first = tileById.get(entry.id);
          const second = tileById.get(entry.partner);
          const mergedId = nextId++;
          const mergedTile = tileObject(mergedId, tr, tc, entry.gain);
          tileById.set(mergedId, mergedTile);
          newGrid[tr][tc] = mergedId;
          merges.push({
            pair: [entry.id, entry.partner],
            row: tr,
            col: tc,
            value: entry.gain,
            mergedId: mergedId
          });
          gained += entry.gain;

          [first, second].forEach(function (tile) {
            tile.row = tr;
            tile.col = tc;
            moves.push({ id: tile.id, toRow: tr, toCol: tc, dying: true });
          });
        } else {
          const tile = tileById.get(entry.id);
          newGrid[tr][tc] = tile.id;
          if (tile.row !== tr || tile.col !== tc) {
            moves.push({ id: tile.id, toRow: tr, toCol: tc });
          }
          tile.row = tr;
          tile.col = tc;
        }
      }
    }

    // 没有任何方块发生移动或合并，本次按键无效
    if (!moves.length && !merges.length) return;

    // 只有有效移动才进入撤销栈（上限 80 步）与复盘日志
    history.push({ values: before, score: score, wonShown: wonShown });
    if (history.length > 80) history.shift();
    moveLog.push({ dir: dir, board: before });
    updateUndoState();

    // 切换新棋盘，并播放方块位移动画
    grid = newGrid;
    moves.forEach(function (m) {
      const tile = tileById.get(m.id);
      if (m.dying) tile.el.classList.add('dying');
      positionTile(tile.el, m.toRow, m.toCol);
    });

    score += gained;
    updateScore();
    playMove();
    if (merges.length) playMerge();

    // 上锁：动画期间忽略新的操作
    busy = true;
    busyTimer = setTimeout(function () {
        // 第二阶段：移除被合并的旧方块，创建合并后的新方块
      merges.forEach(function (merge) {
        merge.pair.forEach(function (oldId) {
          const oldTile = tileById.get(oldId);
          oldTile.el.remove();
          tileById.delete(oldId);
        });
        const mergedTile = tileById.get(merge.mergedId);
        mergedTile.el = createTile(mergedTile.id, mergedTile.row, mergedTile.col, mergedTile.value, 'merge');
      });

        // 每次有效落子后补充一个随机新方块
      addRandom();
      updateScore();
      saveState();

        // 第三阶段：解锁，并检查是否达成 2048 或游戏结束
      busyTimer = setTimeout(function () {
        busy = false;
        checkEnd();
      }, 90);
    }, 130);
  }

  /* 判断是否还有可行走法：存在空格，或相邻有等值方块。 */
  function hasMoves() {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const id = grid[r][c];
        if (!id) return true;
        const value = tileById.get(id).value;
        if (c + 1 < SIZE && grid[r][c + 1] && tileById.get(grid[r][c + 1]).value === value) return true;
        if (r + 1 < SIZE && grid[r + 1][c] && tileById.get(grid[r + 1][c]).value === value) return true;
      }
    }
    return false;
  }

  /* 结束检测：首次达成 2048 弹获胜提示（可继续挑战）；
   * 无路可走时判定游戏结束。 */
  function checkEnd() {
    let reached2048 = false;
    tileById.forEach(function (tile) {
      if (tile.value >= 2048) reached2048 = true;
    });

    if (reached2048 && !wonShown) {
      wonShown = true;
      showOverlay('win');
      playWin();
      saveState();
    } else if (!hasMoves()) {
      over = true;
      showOverlay('over');
      saveState();
    }
  }

  /* 显示结算面板：win=达成 2048（可继续），over=游戏结束（可保存成绩）。 */
  function showOverlay(kind) {
    overlayTitle.textContent = kind === 'win' ? '达成 2048！' : '游戏结束';
    overlaySub.textContent = '得分 ' + score;
    lastScore = score;
    lastMaxTile = currentMaxTile();
    scoreSubmitted = false;
    saveForm.classList.toggle('hidden', kind !== 'over');
    reviewBtn.classList.toggle('hidden', kind !== 'over');
    if (kind === 'over') playerName.value = readStorage(STORAGE_NAME) || '';
    overlayContinue.classList.toggle('hidden', kind !== 'win');
    overlayNew.textContent = '再来一局';
    overlay.classList.remove('hidden');
    if (kind === 'win') overlayContinue.focus();
    else if (kind === 'over') playerName.focus();
    else overlayNew.focus();
  }

  function hideOverlay() {
    overlay.classList.add('hidden');
  }

  /* 当前棋盘上最大的方块数值。 */
  function currentMaxTile() {
    let max = 0;
    tileById.forEach(function (tile) {
      if (tile.value > max) max = tile.value;
    });
    return max;
  }

  /* ---------- 排行榜 ----------
   * 数据存于 localStorage，按分数降序、同分按日期排序，最多 10 条。 */
  function readLeaderboard() {
    const raw = readStorage(STORAGE_LEADERBOARD);
    if (!raw) return [];
    try {
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      const valid = data.filter(function (entry) {
        return entry && typeof entry.score === 'number';
      });
      const sorted = valid.sort(function (a, b) {
        return b.score - a.score || String(a.date).localeCompare(String(b.date));
      }).slice(0, MAX_ENTRIES);
      if (JSON.stringify(sorted) !== JSON.stringify(valid)) {
        writeStorage(STORAGE_LEADERBOARD, JSON.stringify(sorted));
      }
      return sorted;
    } catch (err) {
      return [];
    }
  }

  function writeLeaderboard(entries) {
    writeStorage(STORAGE_LEADERBOARD, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  }

  /* 渲染排行榜列表：前三名高亮显示。 */
  function renderLeaderboard() {
    const entries = readLeaderboard();
    leaderboardList.innerHTML = '';
    leaderboardEmpty.classList.toggle('hidden', entries.length > 0);
    leaderboardList.classList.toggle('hidden', entries.length === 0);
    entries.forEach(function (entry, index) {
      const li = document.createElement('li');
      const topClass = index === 0 ? ' top-1' : index === 1 ? ' top-2' : index === 2 ? ' top-3' : '';
      li.className = 'leaderboard-row' + (index < 3 ? ' top' : '') + topClass;
      const rank = document.createElement('span');
      rank.className = 'leaderboard-rank';
      rank.textContent = String(index + 1);
      const name = document.createElement('span');
      name.className = 'leaderboard-name';
      name.textContent = entry.name || '玩家';
      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'leaderboard-score';
      scoreSpan.textContent = String(entry.score);
      const meta = document.createElement('span');
      meta.className = 'leaderboard-meta';
      meta.textContent = (entry.maxTile ? entry.maxTile + ' · ' : '') + (entry.date || '');
      li.appendChild(rank);
      li.appendChild(name);
      li.appendChild(scoreSpan);
      li.appendChild(meta);
      leaderboardList.appendChild(li);
    });
  }

  function openLeaderboard() {
    renderLeaderboard();
    leaderboardOverlay.classList.remove('hidden');
    leaderboardDone.focus();
  }

  function closeLeaderboard() {
    leaderboardOverlay.classList.add('hidden');
  }

  /* 保存成绩：名字、分数、最大方块与日期；防止重复提交。 */
  function submitScore(event) {
    event.preventDefault();
    if (scoreSubmitted) return;
    const name = playerName.value.trim() || '玩家';
    writeStorage(STORAGE_NAME, name);
    const entries = readLeaderboard();
    entries.push({
      name: name,
      score: lastScore,
      maxTile: lastMaxTile,
      date: new Date().toISOString().slice(0, 10)
    });
    entries.sort(function (a, b) {
      return b.score - a.score || String(a.date).localeCompare(String(b.date));
    });
    writeLeaderboard(entries);
    scoreSubmitted = true;
    saveForm.classList.add('hidden');
    openLeaderboard();
    playMerge();
  }

  /* 更新分数显示；超过历史最高分时持久化；
   * bump 是加分时的短暂缩放动画。 */
  function updateScore() {
    scoreEl.textContent = String(score);
    if (score > best) {
      best = score;
      writeStorage(STORAGE_BEST, String(best));
    }
    bestEl.textContent = String(best);
    scoreEl.classList.toggle('long', String(score).length > 6);
    bestEl.classList.toggle('long', String(best).length > 6);

    scoreEl.classList.add('bump');
    clearTimeout(scoreBumpTimer);
    scoreBumpTimer = setTimeout(function () {
      scoreEl.classList.remove('bump');
    }, 180);
  }

  /* 每次落子后自动保存进度（刷新/关闭后可恢复）。 */
  function saveState() {
    writeStorage(STORAGE_SAVE, JSON.stringify({
      values: gridValues(),
      score: score,
      over: over,
      wonShown: wonShown
    }));
  }

  /* 页面加载时恢复进度；数据无效则返回 false，由调用方开新局。 */
  function loadState() {
    const raw = readStorage(STORAGE_SAVE);
    if (!raw) return false;

    try {
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.values) || data.values.length !== SIZE) return false;
      nextId = 1;
      renderFromValues(data.values);
      moveLog = [];
      score = Number(data.score) || 0;
      over = Boolean(data.over);
      wonShown = Boolean(data.wonShown);
      updateScore();
      if (over) showOverlay('over');
      return true;
    } catch (err) {
      return false;
    }
  }

  /* 新开一局：清空棋盘与历史，放两个初始方块。 */
  function newGame(silent) {
    clearTimeout(busyTimer);
    busy = false;
    history = [];
    grid = emptyGrid();
    score = 0;
    over = false;
    wonShown = false;
    nextId = 1;
    clearTiles();
    hideOverlay();
    closeLeaderboard();
    closeReview();
    addRandom();
    addRandom();
    moveLog = [];
    updateScore();
    updateUndoState();
    saveState();
    if (!silent) playNew();
  }

  /* 撤销：从历史栈恢复上一步的棋盘、分数与状态。 */
  function undo() {
    if (busy || !history.length) return;
    const snapshot = history.pop();
    moveLog.pop();
    renderFromValues(snapshot.values);
    score = snapshot.score;
    wonShown = snapshot.wonShown;
    over = false;
    hideOverlay();
    updateScore();
    updateUndoState();
    saveState();
  }

  /* 无可撤销步骤时禁用撤销按钮。 */
  function updateUndoState() {
    undoBtn.disabled = !history.length;
  }

  /* ---------- 音效 ----------（Web Audio 实时合成，无需音频文件） */
  function updateSoundIcon() {
    iconSound.classList.toggle('hidden', !soundOn);
    iconMuted.classList.toggle('hidden', soundOn);
    soundBtn.setAttribute('aria-pressed', String(soundOn));
  }

  /* 首次发声时创建 AudioContext（需用户交互后才可用）。 */
  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  /* 合成一个短音：freq=频率，duration=时长，type=波形，
   * volume=音量，delay=延迟（用于叠加和弦）。 */
  function beep(freq, duration, type, volume, delay) {
    if (!soundOn) return;
    ensureAudio();
    if (!audioCtx) return;

    const start = audioCtx.currentTime + (delay || 0);
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume || 0.04, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  function playMove() {
    beep(240, 0.06, 'triangle', 0.035);
  }

  function playMerge() {
    beep(330, 0.08, 'triangle', 0.04);
    beep(495, 0.1, 'sine', 0.035, 0.06);
  }

  function playWin() {
    [523.25, 659.25, 783.99, 1046.5].forEach(function (freq, index) {
      beep(freq, 0.14, 'triangle', 0.045, index * 0.09);
    });
  }

  function playNew() {
    beep(392, 0.08, 'triangle', 0.04);
    beep(523.25, 0.1, 'sine', 0.035, 0.06);
  }

  /* ---------- 事件绑定 ---------- */
  newBtn.addEventListener('click', function () {
    newGame();
  });

  undoBtn.addEventListener('click', undo);

  soundBtn.addEventListener('click', function () {
    soundOn = !soundOn;
    writeStorage(STORAGE_SOUND, soundOn ? 'on' : 'off');
    updateSoundIcon();
  });

  leaderboardBtn.addEventListener('click', openLeaderboard);
  leaderboardClose.addEventListener('click', closeLeaderboard);
  leaderboardDone.addEventListener('click', closeLeaderboard);
  saveForm.addEventListener('submit', submitScore);

  overlayContinue.addEventListener('click', hideOverlay);
  overlayNew.addEventListener('click', function () {
    newGame();
  });

  /* 方向键与 WASD 映射到移动方向（0左 1上 2右 3下）。 */
  const KEYMAP = {
    ArrowLeft: 0,
    ArrowUp: 1,
    ArrowRight: 2,
    ArrowDown: 3,
    a: 0,
    w: 1,
    d: 2,
    s: 3,
    A: 0,
    W: 1,
    D: 2,
    S: 3
  };

  /* 键盘操作：忽略组合键；Esc 关闭排行榜；方向键/WASD 移动。 */
  window.addEventListener('keydown', function (event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'Escape' && !leaderboardOverlay.classList.contains('hidden')) {
      closeLeaderboard();
      return;
    }
    const dir = KEYMAP[event.key];
    if (dir === undefined) return;
    event.preventDefault();
    move(dir);
  });

  /* 触屏滑动：记录起点，结束时按位移方向移动；
   * 位移小于 24px 视为误触。 */
  let touchStart = null;
  boardEl.addEventListener('touchstart', function (event) {
    touchStart = {
      x: event.touches[0].clientX,
      y: event.touches[0].clientY
    };
  }, { passive: true });

  boardEl.addEventListener('touchend', function (event) {
    if (!touchStart) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    touchStart = null;

    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    let dir;
    if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? 2 : 0;
    else dir = dy > 0 ? 3 : 1;
    move(dir);
  }, { passive: true });

  /* 窗口变化时重算格子尺寸并重新定位所有方块。 */
  window.addEventListener('resize', function () {
    metrics();
    tileById.forEach(function (tile) {
      positionTile(tile.el, tile.row, tile.col);
    });
  });

  /* ---------- 初始化 ----------
   * 计算尺寸、恢复设置，优先读档，无档则开新局。 */
  metrics();
  updateSoundIcon();
  updateScore();
  updateUndoState();

  if (!loadState()) {
    newGame(true);
  }

  /* ---------- AI 接口 ----------
   * 供 ai.js 读取棋盘、执行移动、处理弹窗。 */
  window.Game2048 = {
    move: move,
    gridValues: gridValues,
    isBusy: function () { return busy; },
    isOver: function () { return over; },
    overlayVisible: function () { return !overlay.classList.contains('hidden'); },
    continueGame: hideOverlay,
    newGame: function () { newGame(); },
    getReviewData: function () { return moveLog.slice(); }
  };

  /* ---------- AI 复盘评价 ----------
   * 游戏结束后：回放全剧，对比 AI 推荐，输出综合评分与关键失误。 */
  const DIR_TEXT = ['左', '上', '右', '下'];
  const GRADE_TEXT = {
    S: '宗师级对局，每一步都近乎完美！',
    A: '大师级表现，失误极少，节奏掌控出色。',
    B: '稳健的发挥，整体策略正确，细节仍有打磨空间。',
    C: '还在成长期，建议对照关键失误逐步优化。',
    D: '刚入门的水平，多玩几局、多与 AI 建议对照会进步很快。'
  };

  function renderMiniBoard(el, values) {
    el.innerHTML = '';
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = values[r][c];
        const d = document.createElement('div');
        d.className = 'mini-cell' + (v ? ' ' + valueClass(v) : '');
        d.textContent = v ? String(v) : '';
        el.appendChild(d);
      }
    }
  }

  /* 按评分生成中文点评（模板句式）。 */
  function buildComment(r) {
    const parts = [GRADE_TEXT[r.grade] || ''];
    parts.push('最大方块 ' + r.maxTile + '，' + r.moves + ' 步，得分约 ' + Math.round(r.gainSum) + '。');
    const rate = Math.round(r.aiRate * 100);
    if (rate >= 70) parts.push('AI 推荐步吻合率 ' + rate + '%，与最优策略高度一致。');
    else if (rate >= 50) parts.push('AI 推荐步吻合率 ' + rate + '%，整体方向正确，步序上仍有优化空间。');
    else parts.push('AI 推荐步吻合率 ' + rate + '%，与最优策略差距较大，请重点参考下方关键失误。');
    const lossPct = Math.round(r.lossSum / Math.max(1, r.gainSum) * 100);
    if (r.faults.length) {
      const top = r.faults[0];
      parts.push('最大失误在第 ' + top.step + ' 步（机会损失约 ' + Math.round(top.loss) + ' 分），累计机会损失占得分 ' + lossPct + '%。');
    } else {
      parts.push('全程几乎无明显失误，节奏控制极佳！');
    }
    return parts.join(' ');
  }

  function closeReview() {
    reviewOverlay.classList.add('hidden');
  }

  function openReview() {
    const ai = window.NTuple2048AI;
    if (!ai) {
      setReviewText('AI 引擎未加载，请刷新页面重试。');
      return;
    }
    reviewOverlay.classList.remove('hidden');
    reviewLoading.textContent = '正在加载 AI 权重（约 268 MB）…';
    reviewLoading.classList.remove('hidden');
    reviewScore.parentElement.classList.add('hidden');
    reviewMetrics.classList.add('hidden');
    reviewComment.classList.add('hidden');
    reviewSubtitle.classList.add('hidden');
    reviewFaults.classList.add('hidden');

    // 首次复盘可能需要加载权重；已加载则立即复用（ai.js 内部有缓存）
    ai.load('weights.bin', function (done, total) {
      reviewLoading.textContent = '正在加载 AI 权重… ' + done + '/' + total;
    }).then(function () {
      const data = window.Game2048.getReviewData();
      if (!data || !data.length) {
        reviewLoading.textContent = '本局没有可复盘的走法。';
        return;
      }
      reviewLoading.textContent = 'AI 分析中…';
      setTimeout(function () {
        const r = ai.review(data);
        reviewScore.textContent = String(r.score);
        reviewGrade.textContent = r.grade;
        reviewScore.parentElement.classList.remove('hidden');
        reviewMetrics.innerHTML =
          '<div class="review-metric"><span class="rm-label">最大方块</span><span class="rm-value">' + r.maxTile + '</span></div>' +
          '<div class="review-metric"><span class="rm-label">AI 吻合率</span><span class="rm-value">' + Math.round(r.aiRate * 100) + '%</span></div>' +
          '<div class="review-metric"><span class="rm-label">机会损失</span><span class="rm-value">' + Math.round(r.lossSum) + '</span></div>' +
          '<div class="review-metric"><span class="rm-label">步数</span><span class="rm-value">' + r.moves + '</span></div>';
        reviewMetrics.classList.remove('hidden');
        reviewComment.textContent = buildComment(r);
        reviewComment.classList.remove('hidden');
        reviewFaults.innerHTML = '';
        if (r.faults.length) {
          reviewSubtitle.classList.remove('hidden');
          r.faults.forEach(function (f) {
            const item = document.createElement('div');
            item.className = 'review-fault';
            const head = document.createElement('div');
            head.className = 'fault-head';
            head.textContent = '第 ' + f.step + ' 步 · 机会损失 ' + Math.round(f.loss) + ' 分';
            const board = document.createElement('div');
            board.className = 'mini-board';
            renderMiniBoard(board, f.board);
            const tip = document.createElement('div');
            tip.className = 'fault-tip';
            tip.textContent = 'AI 建议：向' + DIR_TEXT[f.aiDir];
            item.appendChild(head);
            item.appendChild(board);
            item.appendChild(tip);
            reviewFaults.appendChild(item);
          });
          reviewFaults.classList.remove('hidden');
        }
        reviewLoading.classList.add('hidden');
      }, 30);
    }).catch(function (err) {
      reviewLoading.textContent = 'AI 权重加载失败：' + (err && err.message ? err.message : String(err)) + '（关闭后点 AI 提示重试）';
    });
  }

  function setReviewText(text) {
    reviewLoading.textContent = text;
    reviewLoading.classList.remove('hidden');
  }

  reviewBtn.addEventListener('click', openReview);
  reviewClose.addEventListener('click', closeReview);
  reviewDone.addEventListener('click', closeReview);
})();
