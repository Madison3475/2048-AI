/* deploy_build.js —— 生成可上传 Cloudflare Pages 的 dist 目录
 * 用法: node tools/deploy_build.js [weights.bin 路径]
 * 输出: dist/（含网页文件 + 权重分块 + manifest）
 * 上传: npx wrangler pages deploy dist --project-name 你的项目名
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WEIGHTS = process.argv[2] || path.join(ROOT, 'weights.bin');
const DIST = path.join(ROOT, 'dist');
const CHUNK_SIZE = 16 * 1024 * 1024; // 16 MiB，低于 Pages 25 MiB 上限

const STATIC = ['index.html', 'game.js', 'style.css', 'ai.js'];

function copyStatic() {
  for (const f of STATIC) {
    fs.copyFileSync(path.join(ROOT, f), path.join(DIST, f));
  }
}

function splitWeights() {
  const data = fs.readFileSync(WEIGHTS);
  const chunksDir = path.join(DIST, 'weights');
  fs.mkdirSync(chunksDir, { recursive: true });
  const files = [];
  let index = 0;
  for (let off = 0; off < data.length; off += CHUNK_SIZE) {
    const name = 'weights/' + String(index).padStart(4, '0') + '.bin';
    fs.writeFileSync(path.join(DIST, name), data.slice(off, off + CHUNK_SIZE));
    files.push(name);
    index++;
  }
  const manifest = {
    format: 'chunks',
    chunkSize: CHUNK_SIZE,
    count: files.length,
    totalBytes: data.length,
    files: files
  };
  fs.writeFileSync(path.join(DIST, 'weights.bin.json'), JSON.stringify(manifest));
  console.log('chunks=' + files.length + ' totalBytes=' + data.length);
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
copyStatic();
splitWeights();

const size = fs.readdirSync(DIST, { recursive: true })
  .filter(f => fs.statSync(path.join(DIST, f)).isFile())
  .reduce((a, f) => a + fs.statSync(path.join(DIST, f)).size, 0);
const count = fs.readdirSync(DIST, { recursive: true }).filter(f => fs.statSync(path.join(DIST, f)).isFile()).length;
console.log('dist ready: ' + count + ' files, ' + (size / 1024 / 1024).toFixed(1) + ' MiB -> ' + DIST);
