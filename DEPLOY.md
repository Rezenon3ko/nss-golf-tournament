# 推送到 GitHub + Cloudflare Pages 部署清单

## 一、Git 初始化（本仓库已完成）

- 已执行 `git init` 并完成首次提交。
- `.gitignore` 已忽略：`node_modules`、`dist`、`.env`、`.DS_Store` 等。
- `.env` 不会提交；`.env.example` 里有本地开发用的公开配置，云端构建时在 Cloudflare Pages 里配环境变量。

## 二、在 GitHub 建仓库

1. 打开 https://github.com/new
2. 仓库名建议：`nss-golf-tournament`（可自定义）
3. 可见性：Private 或 Public 都可以（Pages 部署不需要公开代码）
4. **不要**勾选 “Add a README / .gitignore / license”（避免和本地冲突）
5. 点 Create repository

## 三、推送到 GitHub

先进入你下载/克隆下来的项目目录（下文用 `你的项目目录` 代指，即包含 `package.json` 的那一层），再把 `你的用户名` 和 `你的仓库名` 替换成实际的，然后执行：

```bash
cd 你的项目目录
git remote add origin https://github.com/你的用户名/你的仓库名.git
git branch -M main
git push -u origin main
```

如果提示需要登录，按提示在浏览器里完成 GitHub 授权即可。

## 四、Cloudflare Pages 部署

1. 注册/登录 https://dash.cloudflare.com
2. 左侧：**Workers & Pages → Create → Pages → Connect to Git**
3. 授权 GitHub，选择刚推送的仓库
4. 构建配置：

| 项目 | 值 |
| --- | --- |
| Framework preset | Vue |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | 默认（20+ 即可） |

5. **环境变量**（Environment variables）添加：

| 变量名 | 值 |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://psnrzbntwedznveopwcy.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `sb_publishable_6syVh8oN8GAB9zWBJQ49UQ_Aj_VsJtQ` |
| `VITE_USE_SUPABASE` | `true` |
| `VITE_ADMIN_EMAIL` | `admin@nss.local` |

6. 点 **Save and Deploy**，等 1-2 分钟，得到 `https://<项目名>.pages.dev` 链接。

## 五、以后更新网站

进入项目目录后执行：

```bash
git add .
git commit -m "更新内容说明"
git push
```

推送后 Cloudflare Pages 自动重新构建部署，无需手动操作。

仓库里带了 GitHub Actions CI（`.github/workflows/ci.yml`）：每次 push / PR 会自动跑
lint、单元测试和构建，红了就说明这次改动有问题，先修再合。

### 升级已有站点到 v4.2（同步可靠性）

v4.2 起写入带版本校验（乐观锁），需要数据库补两列 + 一个触发器：

1. Supabase Dashboard → **SQL Editor** → 重新执行一遍 `supabase/schema.sql`（幂等，不会清数据）。
2. 重新打开站点，右下角不再出现「数据库未升级」提示即完成。

（若只想补这一部分，单独执行 `supabase/schema.sql` 里 `revision` / `updated_at` 两列
与 `trg_tournament_state_touch` 触发器的语句即可。）

若暂时不执行，站点仍可正常使用，只是退回覆盖式写入：多设备同时编辑时可能互相覆盖，
页面右下角会持续提示。

## 六、自定义域名（可选）

Cloudflare Pages → 项目 → Custom domains → 添加域名，免费自动签发 HTTPS。

> 提示：`.pages.dev` 域名在国内访问可能不稳定，绑定自己的域名并走 Cloudflare 代理会更稳；追求国内极致稳定可改用国内 OSS/CDN 或轻量服务器部署（构建产物就是 `dist/`）。
