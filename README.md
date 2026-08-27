# 2048

纯前端实现的经典 2048 小游戏。无框架、无第三方依赖、无需构建，打开即玩。

**在线试玩：<https://2048.clouddance.me/>**（Cloudflare Pages 托管，完整功能含 AI 模式）

## 功能特性

- 经典 4×4 滑动合并玩法，达成 2048 后可选继续挑战
- 实时计分与最高分记录（浏览器本地持久化）
- 撤销上一步操作
- 本地排行榜：游戏结束后可输入名字保存成绩，展示前 10 名
- 音效开关：使用 Web Audio 实时合成，无需任何音频文件
- 键盘与触屏双操作：方向键 / WASD / 手指滑动
- 游戏进度自动保存：刷新或关闭页面后自动恢复
- 移动端适配，支持 `prefers-reduced-motion` 减弱动效偏好
- AI 模式：加载 n-tuple 训练权重后，可让 AI 提示下一步或全程托管

## AI 模式（使用训练权重）

> **权重通过 Git LFS 管理**：268 MB 的 `weights.bin` 随仓库一起版本化
> （`.gitattributes` 中已注册 LFS），clone 时默认拉取；
> 只想快速克隆代码可跳过：`GIT_LFS_SKIP_SMUDGE=1 git clone <仓库地址>`。

训练好的权重放在项目根目录 `weights.bin` 即可启用 AI。支持两种格式：

- **NT2048**（自训格式）：22 条蛇形 6 元组，12/13/14 档编码，2048/4096/8192 目标对应 262/425/663 MB
- **TDLG**（TDL2048 转换格式）：顶级开源模型 4x6patt 转换而来，4 张 16⁶ 表 + 32 特征，268 MB

当前目录里的 `weights.bin` 是 TDL2048 4x6patt 转换版；如需换回旧的自训权重，
把对应权重文件复制为 `weights.bin` 即可，例如 `Copy-Item weights_4096_10m.bin weights.bin -Force`。

### 权重来源与许可

- 权重训练自 **moporgic/TDL2048** 项目（"The Most Efficient Temporal Difference Learning Framework for 2048"）：
  GitHub <https://github.com/moporgic/TDL2048> · Hugging Face 模型卡 <https://huggingface.co/moporgic/TDL2048>
- 上游模型（TDL2048+ 4x6patt：4 张 16⁶ 表 + 32 特征）遵循 **MIT License**，版权归上游作者；
  本仓库将其封装为 `TDLG` 二进制格式随项目分发（`dist/weights.bin.json` 分块部署版同源），
  按 MIT 许可条款保留上游版权声明与许可文本
- 本仓库其余代码同样采用 **MIT License**（见 `LICENSE`），与上游许可兼容

```powershell
# 从训练目录复制（或从云服务器下载后放这里），把路径换成你的训练权重
Copy-Item <训练权重路径> .\weights.bin
```

顶部工具栏会多出两个按钮：

- **AI 提示**：加载权重并走出权重推荐的一步
- **AI 托管**：开启后自动游玩，直到游戏结束；再点一次停止

注意：

- 权重大小取决于训练目标：2048 目标约 262 MB，8192 目标约 662 MB；`ai.js` 会自动识别档位（12 档/14 档），不需要改代码
- TDL2048 模型自动识别为 16 档，并使用引擎原生的 1-ply 策略（`gain + max(V,0)`），每步不到 1ms，实测 20 局平均 18.8 万分、8192 出现 10 局、16384 出现 6 局
- 必须通过 HTTP 服务打开页面（`fetch` 不允许 `file://` 读取本地文件），例如 `python -m http.server 8765` 后访问 <http://127.0.0.1:8765/>
- 当前 AI 只支持 tuple-6 权重（22 张表）；如果你训练的是 tuple-4 版本，需要同步修改 `ai.js` 里的 `buildTuples`
- 游戏内 AI 默认 1 层额外前瞻（`ai.js` 里的 `DEFAULT_SEARCH_DEPTH`，即 2 层 expectimax），比训练时更强但每步约 0.1 秒；浏览器里卡的话改成 0（最快）；2 层额外前瞻计算量再乘 64 倍，不推荐
- 换新权重后建议先自检：

```bash
node tools/ai_selfcheck.js 100
```

自检默认用与训练脚本完全相同的策略（深度 0）和随机种子跑 100 局，输出平均分与最大方块分布，可用于对比权重好坏；
TDL2048 模型建议 `node tools/ai_selfcheck.js 20 0 0`（目标方块 0 = 不限，脚本会自动放宽步数上限）。

## 快速开始

项目无需安装依赖，也无需构建。

**方式一：直接打开**

用浏览器打开 `index.html` 即可游玩。

**方式二：本地静态服务（推荐）**

在项目目录下启动任意静态文件服务器，例如：

```bash
python -m http.server 8765
```

然后访问 <http://127.0.0.1:8765/>。

## Cloudflare Pages 部署

线上站点：<https://2048.clouddance.me/>（自定义域名，绑定 Pages 项目 `2048`）。

权重整包 268 MB 超过 Cloudflare Pages 单文件 25 MiB 上限，所以部署前先用构建脚本把权重拆成 16 MiB 分块：

```bash
node tools/deploy_build.js                      # 生成 dist/（17 个分块 + weights.bin.json 清单）
cd dist && npx wrangler pages deploy . --project-name 2048
```

首次运行 `wrangler` 会提示在浏览器里登录 Cloudflare 账号。部署后站点里没有整包 `weights.bin`（返回 404），`ai.js` 会自动读取 `weights.bin.json` 清单并并发下载所有分块拼接，功能与本地一致。

注意：

- 首次打开需要下载约 268 MB 权重，浏览器还需约 268 MB+ 内存解析，手机/低配设备慎用
- 每次替换 `weights.bin` 后重新执行 `node tools/deploy_build.js` 再部署

## 操作说明

| 操作 | 按键 / 手势 |
| --- | --- |
| 向左 / 向右 / 向上 / 向下移动 | 方向键 ← → ↑ ↓ 或 A D W S |
| 撤销 | 点击顶部撤销按钮（或游戏结束面板外按 Esc 关闭弹窗） |
| 新游戏 | 点击顶部"+"按钮 |
| 排行榜 | 点击顶部奖杯按钮 |
| 移动 | 在棋盘上手指滑动 |

## 项目结构

| 文件 | 说明 |
| --- | --- |
| `index.html` | 页面结构与布局 |
| `style.css` | 样式、主题与动画，含移动端适配 |
| `game.js` | 全部游戏逻辑：棋盘、合并、计分、撤销、排行榜、音效与自动保存 |
| `ai.js` | AI 推理引擎与按钮控制：加载权重、计算最佳移动 |
| `weights.bin` | 训练好的 n-tuple 权重（tuple-6；2048 目标约 262 MB，8192 目标约 662 MB） |
| `tools/ai_selfcheck.js` | 权重自检：本地跑 N 局评估 |
| `tools/deploy_build.js` | 拆分权重生成 `dist/`（17 分块 + 清单），Cloudflare 部署前运行 |

## 技术说明

- 纯原生 HTML / CSS / JavaScript，无任何第三方库
- 游戏逻辑封装在 `game.js` 的 IIFE 中，通过 DOM 操作与 CSS transition 实现动画
- 所有数据（最高分、进度、设置、排行榜）仅保存在浏览器 `localStorage`（键名以 `2048-` 开头），不发起任何网络请求

## 浏览器兼容性

支持现代桌面与移动浏览器（Chrome、Edge、Firefox、Safari 等）。触屏设备支持滑动操作。
