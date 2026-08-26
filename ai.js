/* ============================================================
 * ai.js —— 2048 n-tuple AI（使用训练权重推理）
 *
 * 与 ntuple2048.js 训练脚本保持完全一致的：
 *   - tuple 定义（tuple-size 6：22 条蛇形/列蛇形 6 元组）
 *   - 棋盘编码（log2 取整，档位数从权重文件自动识别）
 *   - expectimax 策略（bestQ，可调搜索深度）
 *
 * 权重文件：NT2048 二进制格式（.bin），默认从 weights.bin 加载。
 * 浏览器中需要经 HTTP 服务访问（file:// 下 fetch 会被拦截）。
 * ============================================================ */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NTuple2048AI = api;
  if (typeof document !== 'undefined' && root) initController(api, document, root);
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const SIZE = 4;
  const GAMMA = 0.99;
  const MAX_SAMPLE = 8;
  const DEFAULT_SEARCH_DEPTH = 1; // 0=1层前瞻(最快)，1=2层前瞻(推荐)，2=3层前瞻(很慢)

  /* ---------- 游戏核心（纯数值版，方向：0左 1上 2右 3下） ---------- */
  function emptyBoard() {
    return Array.from({ length: SIZE }, function () { return [0, 0, 0, 0]; });
  }

  function cloneBoard(b) {
    return b.map(function (row) { return row.slice(); });
  }

  function compressLine(arr) {
    const out = [];
    let gain = 0;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (!v) continue;
      if (out.length && out[out.length - 1] === v) {
        out[out.length - 1] = v * 2;
        gain += v * 2;
      } else {
        out.push(v);
      }
    }
    while (out.length < SIZE) out.push(0);
    return { out: out, gain: gain };
  }

  function moveBoard(b, dir) {
    const g = cloneBoard(b);
    let gain = 0;
    for (let r = 0; r < SIZE; r++) {
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
      for (let c = 0; c < SIZE; c++) {
        const col = [g[0][c], g[1][c], g[2][c], g[3][c]];
        if (dir === 1) {
          const res = compressLine(col);
          for (let i = 0; i < SIZE; i++) g[i][c] = res.out[i];
          gain += res.gain;
        } else {
          const res = compressLine(col.slice().reverse());
          const o = res.out.reverse();
          for (let i = 0; i < SIZE; i++) g[i][c] = o[i];
          gain += res.gain;
        }
      }
    }
    return { board: g, gain: gain };
  }

  function sameBoard(a, b) {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (a[r][c] !== b[r][c]) return false;
      }
    }
    return true;
  }

  /* ---------- n-tuple 特征 ---------- */
  function encodeCell(v) {
    return v === 0 ? 0 : Math.min(BASE - 1, Math.round(Math.log2(v)));
  }

  function encodeBoard(b) {
    return b.map(function (row) { return row.map(encodeCell); });
  }

  /* tuple-size 6：与训练脚本 buildTuples(6) 完全一致 */
  function buildTuples() {
    const snake = [];
    for (let r = 0; r < SIZE; r++) {
      if (r % 2 === 0) {
        for (let c = 0; c < SIZE; c++) snake.push(r * SIZE + c);
      } else {
        for (let c = SIZE - 1; c >= 0; c--) snake.push(r * SIZE + c);
      }
    }
    const cSnake = [];
    for (let c = 0; c < SIZE; c++) {
      if (c % 2 === 0) {
        for (let r = 0; r < SIZE; r++) cSnake.push(r * SIZE + c);
      } else {
        for (let r = SIZE - 1; r >= 0; r--) cSnake.push(r * SIZE + c);
      }
    }
    const t = [];
    for (let s = 0; s + 6 <= 16; s++) t.push(snake.slice(s, s + 6));
    for (let s = 0; s + 6 <= 16; s++) t.push(cSnake.slice(s, s + 6));
    return t;
  }

  const TUPLES = buildTuples();
  let BASE = 12; // 由权重文件头自动识别（2048→12，8192→14）
  let tables = null;
  let features = null;
  let heavyModel = false;

  function tupleIndex(e, cells) {
    let idx = 0;
    for (let i = 0; i < cells.length; i++) {
      idx = idx * BASE + e[Math.floor(cells[i] / SIZE)][cells[i] % SIZE];
    }
    return idx;
  }

  /* TDL2048 索引：第一个格子是最低位（与引擎 indexpt 一致） */
  function featureIndex(e, cells) {
    let idx = 0;
    for (let i = 0; i < cells.length; i++) {
      idx += e[Math.floor(cells[i] / SIZE)][cells[i] % SIZE] << (i * 4);
    }
    return idx;
  }

  function valueOf(b) {
    const e = encodeBoard(b);
    let v = 0;
    if (features) {
      for (let i = 0; i < features.length; i++) {
        const f = features[i];
        v += tables[f.wi][featureIndex(e, f.cells)];
      }
    } else {
      for (let t = 0; t < TUPLES.length; t++) {
        v += tables[t][tupleIndex(e, TUPLES[t])];
      }
    }
    return v;
  }

  function expectedAfter(g, depth) {
    const empties = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (!g[r][c]) empties.push([r, c]);
      }
    }
    if (!empties.length) return valueOf(g);
    const sample = empties.length > MAX_SAMPLE ? empties.slice(0, MAX_SAMPLE) : empties;
    let total = 0;
    for (let i = 0; i < sample.length; i++) {
      const rc = sample[i];
      for (let j = 0; j < 2; j++) {
        const v = j === 0 ? 2 : 4;
        const g2 = cloneBoard(g);
        g2[rc[0]][rc[1]] = v;
        const leaf = depth <= 0 ? valueOf(g2) : bestMove(g2, depth - 1).q;
        total += (v === 2 ? 0.9 : 0.1) * leaf;
      }
    }
    return total / (sample.length * 2);
  }

  /* 选择当前棋盘下 Q 值最高的一步 */
  function bestMove(values, depth) {
    if (!tables) throw new Error('权重未加载');
    if (depth === undefined) depth = heavyModel ? 0 : DEFAULT_SEARCH_DEPTH;
    const b = values.map(function (row) { return row.slice(); });
    let bestD = -1;
    let bestQ = -Infinity;
    for (let d = 0; d < 4; d++) {
      const res = moveBoard(b, d);
      if (sameBoard(b, res.board)) continue;
      // TDL2048 模型用引擎原生 1-ply 策略：gain + max(V(after), 0)，不做 spawn 采样
      const q = heavyModel
        ? res.gain + Math.max(valueOf(res.board), 0)
        : res.gain + GAMMA * expectedAfter(res.board, depth);
      if (q > bestQ) {
        bestQ = q;
        bestD = d;
      }
    }
    return { dir: bestD, q: bestQ };
  }

  /* 从 ArrayBuffer 解析 NT2048 .bin 权重（直接视图，不拷贝） */
  function loadFromBuffer(buf) {
    if (!buf || buf.byteLength < 16) throw new Error('权重文件不完整');
    const magic = String.fromCharCode.apply(null, new Uint8Array(buf, 0, 6));
    if (String.fromCharCode.apply(null, new Uint8Array(buf, 0, 4)) === 'TDLG') return loadTdlg(buf);
    if (magic !== 'NT2048') throw new Error('不是 NT2048 权重文件');
    const dv = new DataView(buf);
    const nTables = dv.getUint32(6, true);
    const tSize = dv.getUint32(10, true);
    const tupleLen = TUPLES[0].length;
    const baseGuess = Math.round(Math.pow(tSize, 1 / tupleLen));
    if (Math.pow(baseGuess, tupleLen) !== tSize || baseGuess < 2 || baseGuess > 20) {
      throw new Error(
        '权重档位无法识别：tableSize=' + tSize
      );
    }
    if (nTables !== TUPLES.length) {
      throw new Error('权重不匹配：tables=' + nTables + '/' + TUPLES.length);
    }
    BASE = baseGuess;
    const out = [];
    let off = 16;
    for (let i = 0; i < nTables; i++) {
      out.push(new Float32Array(buf, off, tSize));
      off += tSize * 4;
    }
    tables = out;
    features = null;
    heavyModel = false;
    return { nTables: nTables, tSize: tSize, base: BASE, bytes: off };
  }

  /* TDL2048 转换格式（TDLG v1）：4 张 16^6 表 + 32 特征 */
  function loadTdlg(buf) {
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    const ver = dv.getUint8(4);
    if (ver !== 1) throw new Error('不支持的 TDLG 版本 ' + ver);
    const nTables = dv.getUint32(8, true);
    const out = [];
    let off = 12;
    for (let i = 0; i < nTables; i++) {
      const length = dv.getUint32(off, true); off += 4;
      const bytes = dv.getUint32(off, true); off += 4;
      off += 8;
      if (off % 4 !== 0) throw new Error('TDLG 表数据未对齐');
      out.push(new Float32Array(buf, off, length));
      off += bytes;
    }
    const nFeat = dv.getUint32(off, true); off += 4;
    const feats = [];
    for (let i = 0; i < nFeat; i++) {
      const wi = u8[off]; off += 1;
      const clen = u8[off]; off += 1;
      const cells = Array.from(new Uint8Array(buf, off, clen));
      off += clen;
      feats.push({ wi: wi, cells: cells });
    }
    const tupleLen = feats.length ? feats[0].cells.length : 6;
    const baseGuess = Math.round(Math.pow(out[0].length, 1 / tupleLen));
    if (Math.pow(baseGuess, tupleLen) !== out[0].length) throw new Error('TDLG 档位无法识别');
    BASE = baseGuess;
    tables = out;
    features = feats;
    heavyModel = true;
    return { format: 'TDLG', nTables: nTables, tSize: out[0].length, base: BASE, features: feats.length, bytes: off };
  }

  /* 判断前几个字节是不是权重文件头（TDLG / NT2048）。
   * 有些托管/CDN 会把缺失文件回退成 200 的 index.html，
   * 仅靠 HTTP 状态码判断会误以为加载成功。 */
  function isWeightBinary(buf) {
    if (!buf || buf.byteLength < 6) return false;
    const u8 = new Uint8Array(buf);
    let head = '';
    for (let i = 0; i < 6; i++) head += String.fromCharCode(u8[i]);
    return head === 'NT2048' || head.indexOf('TDLG') === 0;
  }

  /* 下载单个分块：失败自动重试（大文件下载易被中间网络中断） */
  async function fetchChunk(url, attempts) {
    for (let i = 1; i <= attempts; i++) {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error('分块 HTTP ' + r.status);
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        if (ct.indexOf('text/html') !== -1) {
          throw new Error('分块返回了 HTML，权重分块没有上传成功');
        }
        return await r.arrayBuffer();
      } catch (err) {
        if (i === attempts) throw err;
        await new Promise(function (resolve) { setTimeout(resolve, 400 * i); });
      }
    }
  }

  async function load(url, onProgress) {
    let ab = null;
    try {
      const res = await fetch(url);
      if (res && res.ok) {
        ab = await res.arrayBuffer();
        if (isWeightBinary(ab)) return loadFromBuffer(ab);
        ab = null; // 200 但内容不是权重（HTML 回退页），按缺失处理
      }
    } catch (err) {
      ab = null;
    }
    // 分块回退（Cloudflare Pages 单文件 25MiB 上限，权重拆成多块部署）
    const manifestUrl = url + '.json';
    const mr = await fetch(manifestUrl);
    if (!mr.ok) throw new Error('HTTP ' + mr.status + '：' + url);
    const manifest = await mr.json();
    const base = url.substring(0, url.lastIndexOf('/') + 1);
    // 分批并发下载（每批 6 个），避免大量并行大连接被中途掐断
    const CHUNK_CONCURRENCY = 6;
    let doneChunks = 0;
    const bufs = [];
    for (let i = 0; i < manifest.files.length; i += CHUNK_CONCURRENCY) {
      const batch = manifest.files.slice(i, i + CHUNK_CONCURRENCY);
      const arr = await Promise.all(batch.map(function (f) {
        return fetchChunk(base + f, 3).then(function (b) {
          doneChunks++;
          if (onProgress) onProgress(doneChunks, manifest.files.length);
          return b;
        });
      }));
      for (const b of arr) bufs.push(b);
    }
    const out = new Uint8Array(manifest.totalBytes);
    let off = 0;
    for (const b of bufs) {
      out.set(new Uint8Array(b), off);
      off += b.byteLength;
    }
    if (off !== manifest.totalBytes) throw new Error('分块总大小不匹配');
    if (!isWeightBinary(out.buffer)) throw new Error('拼接后的数据不是有效权重');
    return loadFromBuffer(out.buffer);
  }

  function isReady() {
    return !!tables;
  }

  return {
    load: load,
    loadFromBuffer: loadFromBuffer,
    bestMove: bestMove,
    isReady: isReady,
    tupleCount: TUPLES.length,
    base: function () { return BASE; },
    buildTuples: buildTuples
  };
});

/* ---------- 页面控制：AI 提示 / AI 托管 ---------- */
function initController(api, doc, win) {
  'use strict';

  const hintBtn = doc.getElementById('ai-hint-btn');
  const autoBtn = doc.getElementById('ai-auto-btn');
  const statusEl = doc.getElementById('ai-status');
  const progressEl = doc.getElementById('ai-progress');
  const progressBar = doc.getElementById('ai-progress-bar');
  const progressLabel = doc.getElementById('ai-progress-label');
  if (!hintBtn || !autoBtn || !statusEl) return;

  const WEIGHTS_URL = 'weights.bin';
  let loaded = false;
  let loading = false;
  let autoTimer = null;
  let statusTimer = null;

  function setProgress(visible, done, total) {
    if (!progressEl) return;
    progressEl.classList.toggle('hidden', !visible);
    if (!visible) return;
    const pct = total ? Math.round(done / total * 100) : 0;
    progressBar.style.width = pct + '%';
    progressLabel.textContent = done + ' / ' + total + '（' + pct + '%）';
    progressEl.setAttribute('aria-valuenow', String(pct));
    progressEl.setAttribute('aria-valuetext', done + ' / ' + total + ' 分块');
  }

  function setStatus(text) {
    statusEl.textContent = text || '';
    statusEl.classList.toggle('hidden', !text);
    clearTimeout(statusTimer);
    if (text && text.indexOf('失败') === -1 && text.indexOf('请通过') === -1
        && text.indexOf('加载中') === -1 && text.indexOf('托管中') === -1) {
      statusTimer = setTimeout(function () { setStatus(''); }, 4000);
    }
  }

  function fail(err) {
    setStatus('AI 权重加载失败：' + (err && err.message ? err.message : String(err)) + '（点 AI 提示可重试）');
  }

  async function ensureLoaded() {
    if (loaded) return true;
    if (loading) return false;
    loading = true;
    setStatus('AI 权重加载中…');
    try {
      const info = await api.load(WEIGHTS_URL, function (done, total) {
        setProgress(true, done, total);
      });
      loaded = true;
      setProgress(false);
      setStatus('AI 权重已加载（' + (info.format === 'TDLG' ? 'TDL2048 模型' : '本地模型') + '）');
      return true;
    } catch (err) {
      setProgress(false);
      fail(err);
      return false;
    } finally {
      loading = false;
    }
  }

  function gameApi() {
    return win.Game2048 || null;
  }

  /* 走一步：处理胜利弹窗、计算并执行最佳方向 */
  function stepOnce() {
    const g = gameApi();
    if (!g) {
      setStatus('游戏核心未就绪');
      return false;
    }
    if (g.isBusy()) return true;
    if (g.isOver()) {
      setStatus('游戏已结束');
      return false;
    }
    if (g.overlayVisible()) {
      g.continueGame(); // 达成 2048 的胜利弹窗：继续挑战
      return true;
    }
    const best = api.bestMove(g.gridValues());
    if (best.dir < 0) {
      setStatus('没有可走的方向');
      return false;
    }
    g.move(best.dir);
    return true;
  }

  function setAuto(on) {
    if (on && !autoTimer) {
      autoTimer = setInterval(function () {
        if (!stepOnce()) stopAuto();
      }, 120);
      autoBtn.classList.add('active');
      autoBtn.textContent = '停止';
      setStatus('AI 托管中…');
    } else if (!on && autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
      autoBtn.classList.remove('active');
      autoBtn.textContent = 'AI 托管';
      setStatus('');
    }
  }

  function stopAuto() {
    setAuto(false);
  }

  hintBtn.addEventListener('click', function () {
    if (!gameApi()) return;
    ensureLoaded().then(function (ok) {
      if (ok) stepOnce();
    });
  });

  autoBtn.addEventListener('click', function () {
    if (autoTimer) {
      stopAuto();
      return;
    }
    ensureLoaded().then(function (ok) {
      if (ok) setAuto(true);
    });
  });
}
