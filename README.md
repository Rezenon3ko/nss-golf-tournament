# NSS高尔夫锦标赛赛况记录网站

基于《NSS高尔夫锦标赛比赛规则》的 16 人高尔夫锦标赛赛况记录网站：从抽签分组、小组赛积分、淘汰赛对阵，到赛果记录与操作日志，一站完成。主办方口令登录后可编辑，选手与游客只读。

## 功能

**公开端（只读）**

- 首页总览：阶段进度、轮次 DDL、积分榜速览、最近赛果、淘汰赛进度
- 小组赛：A/B/C/D 四组赛程、BO3 比分、SD 标记、逾期高亮
- 积分榜：四组同页展示，按规则自动排序（积分 → 相互战绩 → 净胜局 → 净胜杆 → 主办方抽签）
- 淘汰赛：固定对阵（A1-B2 / C1-D2 / A2-B1 / C2-D1），8 强未确定前只显示预计对位，胜者自动晋级
- 选手：4×4 卡片 + 个人档案（战绩、对局明细）
- 规则：规则九章在线查阅
- 历届赛事：多赛季切换、归档浏览与冠军展示（多表模式）

**管理端（主办方）**

- 选手与分组：名单管理、加密级随机抽签（crypto.getRandomValues）并留可验证记录、约束校验
- 赛果录入：BO3/BO5、相对标准杆记分、平局 SD 胜者与自动晋级
- DDL 与逾期：每周日 23:59 预设，逾期判负（A负 / B负 / 双方负 / 延期）、群通知文案
- 日志记录：主办方关键操作留痕，全程可追溯（赛果在群聊分享，网站不收集证据）
- 数据统计与导出：SD 之王、PB 之星（与报名时填的历史最佳对比）、群聊分享文案（最终结果 /
  对阵文本）与全部数据 JSON
- 赛季管理：新建 / 复制上届名单与 DDL / 设为当前 / 归档（归档后只读）/ 删除未启用的赛季（多表模式）

其他：深色模式（首屏不闪白）、真实选手头像（压缩后存入 Supabase Storage，赛事数据里只留 URL）、
移动端适配、应用内提示与确认弹窗（不阻塞操作，弹窗支持 ESC 关闭与键盘焦点循环）。

## 技术栈

- Vue 3 + Vite + Tailwind CSS 4 + Pinia + vue-router
- Supabase（Postgres + 登录鉴权 + Storage + Realtime，RLS 行级安全）
  - 客户端按需组装：常驻 `@supabase/auth-js` + `postgrest-js` + `storage-js`
    （见 `src/lib/supabase.js`）；多表模式再动态加载 `@supabase/realtime-js`（独立 chunk，
    仅观众端实时订阅时下载），不引入未使用的 Functions
- 界面基础：[Admin One Tailwind Vue 3](https://justboil.me/tailwind-admin-templates/free-vue-dashboard/)（MIT）

## 快速开始

```bash
npm install
npm run dev
npm test   # 同步引擎 + 计分/排名/淘汰赛规则的单测（node --test，无额外依赖）
npm run lint
```

> 依赖变动后如果 `npm run dev` 报 `node_modules/... ENOENT`（找不到某个包的文件），
> 是 Vite 的依赖预构建缓存过期了：用 `npm run dev:force` 重启，或删掉 `node_modules/.vite` 再启动。

测试覆盖：云同步（版本冲突、写入失败重试、读不到云端时的降级、老库兼容）、
计分截断（先得 2/3 局即封盘）、排名 tie-break（积分 → 相互战绩 → 净胜局 → 净胜杆 → 抽签）、
淘汰赛晋级/轮空/半区作废/递补亚军、DDL 倒计时与逾期判定；
多表部分另覆盖迁移映射与往返对账、镜像差异同步、多表读取、Realtime 事件合并、赛季 RPC 参数。

CI：GitHub Actions 在 push / PR 时执行 `lint` + `test` + `build`（见 `.github/workflows/ci.yml`）。

访问 `http://localhost:5173/`。

- 未配置 Supabase 时自动回退到本地 localStorage，方便离线体验。
- 主办方口令：本地回退模式在 `.env` 的 `VITE_ADMIN_PASSWORD` 里配置（该文件已被 git 忽略，不会提交）；启用 Supabase 后改用 Supabase 主办方账号密码登录。

## Supabase 配置

数据库脚本（都能重复执行）：

| 脚本 | 作用 | 什么时候需要 |
|---|---|---|
| `supabase/schema-v2.sql` | 表结构：多表（seasons / players / matches …）+ 单文档表 `tournament_state` + 头像 Storage bucket `avatars` + RLS + Realtime 发布 | **始终需要**（原 `schema.sql` 已退役，功能并入本文件） |
| `supabase/rpc-v2.sql` | 多表模式的写入函数（赛季管理、录赛果、发布分组等） | 使用多表模式时 |

1. SQL Editor 依次执行 `supabase/schema-v2.sql` 与 `supabase/rpc-v2.sql`
   （建表 + 事务函数；游客只读、登录用户可写，同时建好头像 bucket）。
2. 按「[多表模式](#多表模式可选)」一节切换数据模型。
3. **Authentication → Users → Add user** 创建主办方账号（勾选 Auto Confirm User）。
4. 建议关闭公开注册：Authentication → Providers → Email → Allow new users to sign up 关掉。
5. 复制 `.env.example` 为 `.env` 填入项目信息（anon key 为公开值，可放心放在前端）。

> 云端首次写入会在主办方登录后自动触发；本地已有数据会同步到云端。
> 已经建过表的老项目，请重新执行一次 `supabase/schema-v2.sql`（幂等）以补上 `revision` /
> `updated_at` / `updated_by` 三列与两个触发器（写入时盖章版本号与时间，首次插入也有）；
> 执行 `supabase/rpc-v2.sql`（幂等）则用于升级多表模式的事务函数（例如归档只读、删除赛季）。

### 头像存储

头像压缩成 256×256 JPEG（约 15 KB）后上传到 Storage，赛事数据里只保留公开 URL，
因此整份赛事 JSON 保持在几 KB——改一次 DDL、录一场比分都只上传几 KB，而不是几百 KB。
路径带时间戳（`<选手 id>-<时间戳>.jpg`），换头像即换 URL，可安全使用一年长缓存，
读取由 Storage 自带的边缘 CDN 承担；删除选手时会顺带清理对应对象。
未配置 Supabase 时回退为 dataURL（随本机缓存保存），行为与以前一致。

万一有残留的孤儿对象（例如上传成功但没点保存、或删除时网络失败），可在
Supabase Dashboard → Storage → `avatars` 里对照赛事数据手动删除。

### 多表模式（可选）

为「多届赛事 + 观众端实时更新」准备的多表结构已经落地，默认仍走单文档模式，可切换：

1. SQL Editor 执行 `supabase/schema-v2.sql` 与 `supabase/rpc-v2.sql`（均为新增，不影响现网）；
2. 执行 `node scripts/migrate-to-tables.mjs --apply` 导入当前赛季，`--verify` 对账；
3. `.env` 增加 `VITE_DATA_MODEL=multi` 后重新构建。

开启后：页面读取走各表，写入走事务函数（同一赛季串行 + 行级版本校验）；旧单文档只作为
回滚备份异步补写。观众端通过 Supabase Realtime 订阅 6 张公开表，赛果与积分榜等页面会
实时更新（断线自动重连并做一次全量补偿）。多表读取失败会自动回退单文档模式并在右下角
提示；删除 `VITE_DATA_MODEL`（或改为 `doc`）即可完全回退。

多表模式下的赛季规则：

- **归档 = 只读锁定**：归档赛季的所有写入会被事务函数拒绝（提示需先取消归档），后台顶部会
  常驻只读横幅，编辑类按钮置灰；改名、设为当前、取消归档本身不受限制。
- **删除赛季**：仅允许删除「非当前、非归档」的赛季（例如建错的空赛季），会级联删除该赛季的
  名单 / 赛程 / 赛果 / 日志且不可恢复，删除前有二次确认。
- 旧文档备份仍然写入 `tournament_state`（与头像 bucket 一起由 `schema-v2.sql` 创建），不要删除。

## 数据与重置

- 全新环境从**空白**开始：没有内置示例选手与赛程，名单由主办方在「选手与分组」里添加
  （16 名选手、按历史最佳分 4 档、未抽签）；只有 DDL 轮次结构是预置的，日期需主办方设置。
- 主办方后台「选手与分组 → 重置赛事」可清空分组与赛程（保留选手名单）。
- 单文档模式：数据存于 `public.tournament_state` 的一行 JSON（默认）。
- 多表模式：数据存于 `seasons` / `players` / `matches` 等表，并按赛季隔离；旧单文档表仍会
  异步补写一份快照作为回滚备份。
- 两种模式都以 Supabase 为唯一真相，任意设备打开为同一份数据（打开页面时拉取最新；
  多表模式另有 Realtime 实时更新）。

### 同步状态（右下角提示条）

> 以下为**单文档模式**的行为；多表模式下写入走事务函数（同一行被两台设备同时修改才会提示
> 冲突），旧文档仅作备份、失败不影响编辑。

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
├── lib/            # Supabase 客户端、同步 / 多表 / 实时、统计与结果文案
├── views/          # 页面（公开端 + 管理端）
├── utils/          # 格式化与下载工具
├── config.js       # 站点配置与环境变量读取
└── router/         # 路由与权限守卫
supabase/
├── schema-v2.sql   # 表结构：多表 + 单文档表 + 头像 Storage + RLS + Realtime（唯一需要执行的建表脚本）
└── rpc-v2.sql      # 事务函数：赛季 / 赛果 / 分组等写入（多表模式）
scripts/
└── migrate-to-tables.mjs   # 旧文档 → 多表迁移、对账（--dry-run / --apply / --verify）
```

## 比赛规则

完整规则见《NSS高尔夫锦标赛比赛规则》PDF。核心要点：

- 16 人按历史最佳分 4 档，抽签进入 A/B/C/D 组，每组各档 1 人。
- 小组赛：随机 9 洞、BO3，胜 2 分 / 负 1 分，每人 3 场。
- 排名：积分 → 相互战绩 → 净胜局 → 净胜杆 → 主办方抽签。
- 淘汰赛：BO5 先 3 胜，固定对阵，每周 1 场，DDL 由主办方公布。
- 单局 9 洞平局进入突然死亡（SD）：新开一局逐洞比较，先领先者胜。
- 一旦有人先到 2 局（BO3）/ 3 局（BO5），比赛即结束；之后误填的局**不计入**胜负与净胜杆，
  录入界面会标注「不计入」，原始数据仍原样保留。
- 掉线：已完成洞数保留，重赛剩余洞数合并计算，截图 / 录屏发送至比赛群。

## License

MIT。界面基础基于 Admin One Tailwind Vue 3（JustBoil.me）。
