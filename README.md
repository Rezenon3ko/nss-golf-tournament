# Nintendo Switch Sports高尔夫锦标赛赛况记录网站

基于《NSS鬼吃鱼高尔夫锦标赛比赛规则》的 16 人高尔夫锦标赛赛况记录网站：从抽签分组、小组赛积分、淘汰赛对阵，到赛果与证据管理，一站完成。主办方口令登录后可编辑，选手与游客只读。

## 功能

**公开端（只读）**

- 首页总览：阶段进度、轮次 DDL、积分榜速览、最近赛果、淘汰赛进度
- 小组赛：A/B/C/D 四组赛程、BO3 比分、SD 标记、逾期高亮
- 积分榜：四组同页展示，按规则自动排序（积分 → 相互战绩 → 净胜局 → 净胜杆 → 主办方抽签）
- 淘汰赛：固定对阵（A1-B2 / C1-D2 / A2-B1 / C2-D1），8 强未确定前只显示预计对位，胜者自动晋级
- 选手：4×4 卡片 + 个人档案（战绩、对局明细）
- 规则：规则九章在线查阅

**管理端（主办方）**

- 选手与分组：名单管理、加密级随机抽签（crypto.getRandomValues）并留可验证记录、约束校验
- 赛果录入：BO3/BO5、相对标准杆记分、平局 SD 胜者、掉线合并登记、截图链接
- DDL 与逾期：每周日 23:59 预设，逾期判负（A负 / B负 / 双方负 / 延期）、群通知文案
- 证据与日志：赛果截图、掉线证据留档，操作日志可追溯
- 数据导出：CSV / JSON / 对阵文本

其他：深色模式（首屏不闪白）、真实选手头像（压缩后存入 Supabase Storage，赛事数据里只留 URL）、
移动端适配、应用内提示与确认弹窗（不阻塞操作，弹窗支持 ESC 关闭与键盘焦点循环）。

## 技术栈

- Vue 3 + Vite + Tailwind CSS 4 + Pinia + vue-router
- Supabase（Postgres + 登录鉴权 + Storage，RLS 行级安全）
- 界面基础：[Admin One Tailwind Vue 3](https://justboil.me/tailwind-admin-templates/free-vue-dashboard/)（MIT）

## 快速开始

```bash
npm install
npm run dev
npm test   # 同步引擎 + 计分/排名/淘汰赛规则的单测（node --test，无额外依赖）
npm run lint
```

测试覆盖：云同步（版本冲突、写入失败重试、读不到云端时的降级、老库兼容）、
计分截断（先得 2/3 局即封盘）、排名 tie-break（积分 → 相互战绩 → 净胜局 → 净胜杆 → 抽签）、
淘汰赛晋级/轮空/半区作废/递补亚军、DDL 倒计时与逾期判定。

CI：GitHub Actions 在 push / PR 时执行 `lint` + `test` + `build`（见 `.github/workflows/ci.yml`）。

访问 `http://localhost:5173/`。

- 未配置 Supabase 时自动回退到本地 localStorage，方便离线体验。
- 主办方口令：本地回退模式在 `.env` 的 `VITE_ADMIN_PASSWORD` 里配置（该文件已被 git 忽略，不会提交）；启用 Supabase 后改用 Supabase 主办方账号密码登录。

## Supabase 配置

1. 在 Supabase Dashboard → **SQL Editor** 执行 `supabase/schema.sql`（建表 + RLS：游客只读、登录用户可写）。
2. **Authentication → Users → Add user** 创建主办方账号（勾选 Auto Confirm User）。
3. 建议关闭公开注册：Authentication → Providers → Email → Allow new users to sign up 关掉。
4. 复制 `.env.example` 为 `.env` 填入项目信息（anon key 为公开值，可放心放在前端）。

> 云端首次写入会在主办方登录后自动触发；本地已有数据会同步到云端。
> 已经建过表的老项目，请重新执行一次 `supabase/schema.sql`（幂等）以补上 `revision` /
> `updated_at` / `updated_by` 三列与两个触发器（写入时盖章版本号与时间，首次插入也有），
> 同时会创建头像用的 Storage bucket `avatars`（公开读、登录可写，单文件上限 512 KB）。

### 头像存储

头像压缩成 256×256 JPEG（约 15 KB）后上传到 Storage，赛事数据里只保留公开 URL，
因此整份赛事 JSON 保持在几 KB——改一次 DDL、录一场比分都只上传几 KB，而不是几百 KB。
路径带时间戳（`<选手 id>-<时间戳>.jpg`），换头像即换 URL，可安全使用一年长缓存，
读取由 Storage 自带的边缘 CDN 承担；删除选手时会顺带清理对应对象。
未配置 Supabase 时回退为 dataURL（随本机缓存保存），行为与以前一致。

万一有残留的孤儿对象（例如上传成功但没点保存、或删除时网络失败），可在
Supabase Dashboard → Storage → `avatars` 里对照赛事数据手动删除。

## 数据与重置

- 初始预设：16 名选手（含头像）、按历史最佳分档、**未抽签**，等待主办方抽签发布。
- 主办方后台「选手与分组 → 重置赛事」可清空分组与赛程（保留选手名单）。
- 数据以 Supabase 为唯一真相，任意设备打开为同一份数据（打开页面时拉取最新）。

### 同步状态（右下角提示条）

- **正在同步 / 已同步**：改动防抖合并后写入云端，成功会给出回执。
- **同步失败**：改动已保存在本机，系统按 1s → 2s → … → 30s 自动重试，也可手动「立即重试」；
  期间刷新页面不会丢数据（本机缓存里有）。
- **本地模式**：打开时读不到云端（断网/项目未建表）时的降级状态，此时**改动只保存在本机**，
  不会静默当作已同步；恢复网络后点「重试连接」再选择保留哪一份。
- **版本冲突**：云端已被其他设备写入时出现，由主办方选择「采用云端版本」或「用本机版本覆盖」，
  不会自动覆盖。上次关页时若还有没同步成功的改动，下次打开也会进入这个选择，而不是直接用云端覆盖本机。
- **数据库未升级**：缺少 `revision` 列时提示，此时仍是覆盖式写入，多设备同时编辑可能互相覆盖。

数据库侧还有一个 `before update` 触发器：任何写入（含旧版页面、Dashboard 手改、手跑 SQL）
都会让 `revision` 自增，所以「别处改了数据」也会被检测成冲突，而不是被静默覆盖。
`updated_at` 与 `updated_by` 同样由数据库盖章（不采信前端提交的值）；两人共用一个管理员账号时，
`updated_by` 只能区分「管理员 / service_role」，想按人追溯需要各自建账号。

## 部署

构建产物：`npm run build` → `dist/`。

推荐 **GitHub（私有仓库）+ Cloudflare Pages**，详细步骤见 [DEPLOY.md](DEPLOY.md)。也支持 Vercel / Netlify / 国内 OSS 静态托管。

## 目录结构

```
src/
├── components/     # 通用组件（对阵树、积分榜、弹窗、头像等）
├── layouts/        # 公开端 / 管理端布局
├── stores/         # Pinia：赛事数据、登录、深色模式
├── lib/            # Supabase 客户端
├── views/          # 页面（公开端 + 管理端）
├── utils/          # 格式化、CSV 工具
├── config.js       # 站点配置与环境变量读取
└── router/         # 路由与权限守卫
supabase/
└── schema.sql      # 建表与权限脚本
```

## 比赛规则

完整规则见《NSS鬼吃鱼高尔夫锦标赛比赛规则》PDF。核心要点：

- 16 人按历史最佳分 4 档，抽签进入 A/B/C/D 组，每组各档 1 人。
- 小组赛：随机 9 洞、BO3，胜 2 分 / 负 1 分，每人 3 场。
- 排名：积分 → 相互战绩 → 净胜局 → 净胜杆 → 主办方抽签。
- 淘汰赛：BO5 先 3 胜，固定对阵，每周 1 场，DDL 由主办方公布。
- 单局 9 洞平局进入突然死亡（SD）：新开一局逐洞比较，先领先者胜。
- 一旦有人先到 2 局（BO3）/ 3 局（BO5），比赛即结束；之后误填的局**不计入**胜负与净胜杆，
  录入界面会标注「不计入」，原始数据仍原样保留。
- 掉线：已完成洞数保留，重赛剩余洞数合并计算，截图/录屏留档。

## License

MIT。界面基础基于 Admin One Tailwind Vue 3（JustBoil.me）。
