-- 鬼吃鱼高尔夫锦标赛 · Supabase 建表与权限
-- 在 Supabase Dashboard → SQL Editor 中执行（可重复执行，幂等）

-- 赛事数据（整体存取，体量小，便于前端原子读写）
create table if not exists public.tournament_state (
  key text primary key,
  value jsonb not null
);

-- ============ 乐观锁与审计（v4.2 新增，老库重跑本文件即可升级）============
-- 前端写入时带上“我读到的那一版 revision”，只有仍匹配才会写入，
-- 从而避免多设备同时编辑时互相覆盖；updated_at 便于事后排查。
alter table public.tournament_state
  add column if not exists revision bigint not null default 0;

alter table public.tournament_state
  add column if not exists updated_at timestamptz not null default now();

-- 版本号由数据库自己推进：无论谁写入（新版前端、旧版前端、Dashboard 手改、手跑 SQL），
-- revision 都会 +1，因此「别人偷偷改了数据」也会被前端的乐观锁检测成冲突。
-- 与前端配合：前端提交 revision = 基线 + 1，触发器同样算出「旧值 + 1」，两者一致。
create or replace function public.touch_tournament_state()
returns trigger
language plpgsql
as $$
begin
  new.revision := coalesce(old.revision, 0) + 1;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_tournament_state_touch on public.tournament_state;
create trigger trg_tournament_state_touch
  before update on public.tournament_state
  for each row
  execute function public.touch_tournament_state();

-- ============ 角色授权（关键：手建表必须手动 GRANT）============
grant select on public.tournament_state to anon;
grant all on public.tournament_state to authenticated;
grant all on public.tournament_state to service_role;

-- ============ 行级安全 ============
alter table public.tournament_state enable row level security;

-- 所有人可读（赛事数据公开）
drop policy if exists public_read_tournament_state on public.tournament_state;
create policy "public_read_tournament_state"
  on public.tournament_state
  for select
  using (true);

-- 仅登录用户可写（配合关闭公开注册，实际只有管理员能写）
drop policy if exists admin_write_tournament_state on public.tournament_state;
create policy "admin_write_tournament_state"
  on public.tournament_state
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- 说明：
-- 1. 执行后匿名访客可读、不可写。
-- 2. 管理员账号请在 Dashboard → Authentication → Users → Add user 创建
--    （邮箱随意，如 admin@nss.local；密码建议与管理口令一致；勾选 Auto Confirm User）。
-- 3. 建议在 Authentication → Providers → Email 关闭 "Allow new users to sign up"，
--    防止别人注册后也能写入。
-- 4. 升级提示：已经建过表的老项目，重新执行本文件即可补上 revision / updated_at 列
--    （本文件幂等）。若未执行，前端会自动退回“覆盖式写入”并在页面上提示数据库未升级。
