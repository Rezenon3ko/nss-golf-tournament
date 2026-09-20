-- ============================================================================
-- 鬼吃鱼高尔夫锦标赛 · Supabase 初始化 / 升级脚本
--
-- 环境      Supabase（PostgreSQL 15+）
-- 执行方式  Dashboard → SQL Editor，整段执行
-- 幂等性    可重复执行：建表使用 IF NOT EXISTS，函数使用 CREATE OR REPLACE，
--           策略与触发器先 DROP IF EXISTS 再创建
-- 数据影响  不涉及数据本身：无 DROP TABLE / TRUNCATE / DELETE / 数据 UPDATE；
--           ALTER TABLE 仅新增列（既有行取默认值），value 字段不被读取或修改；
--           DROP POLICY / DROP TRIGGER 仅用于重建策略与触发器，与数据无关
-- 依赖对象  除 public.tournament_state 外，还会创建 Storage bucket `avatars`
--           （头像对象存储；公开读、登录可写），不影响其他 bucket
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 赛事状态表
--    整份赛事状态（选手、赛程、赛果、证据、日志）序列化为单个 JSONB 文档，存于一行。
--    当前规模（16 名选手 / 31 场比赛）下，整份原子读写可保证写入一致性且实现简单；
--    代价是每次写入都会重写整个 value 字段。
-- ---------------------------------------------------------------------------
create table if not exists public.tournament_state (
  key text primary key,
  value jsonb not null
);

-- ---------------------------------------------------------------------------
-- 2. 乐观锁与审计字段
--    revision    递增版本号，供前端「读取 → 校验 → 写入」的乐观锁使用
--    updated_at  最后一次写入的数据库时间
--    updated_by  最后一次写入对应的 auth.uid()；service_role 或 SQL Editor 直连写入时为 NULL
--    对既有表执行本段即完成升级，既有行的 revision 取默认值 0。
-- ---------------------------------------------------------------------------
alter table public.tournament_state
  add column if not exists revision bigint not null default 0;

alter table public.tournament_state
  add column if not exists updated_at timestamptz not null default now();

alter table public.tournament_state
  add column if not exists updated_by uuid;

-- ---------------------------------------------------------------------------
-- 3. 写入契约（由触发器保证）
--    a. 客户端以 UPDATE ... WHERE key = 'main' AND revision = :base 声明基线版本；
--    b. BEFORE UPDATE 触发器将 revision 覆写为 old.revision + 1，并写入时间与操作者，
--       因此客户端提交的 revision / updated_at / updated_by 不参与最终结果，仅作为匹配条件；
--    c. 影响行数为 0 时，含义是「基线版本不匹配（并发写入）」或「未匹配到可写策略」。
--    由此，任何来源的写入（新版前端、旧版前端、Dashboard 手动修改、直接执行 SQL）
--    都会推进 revision，旧客户端不带版本号的覆盖式写入同样会被前端乐观锁识别为冲突。
--    SET search_path = '' + 全限定名：避免 Security Advisor 报 Function Search Path Mutable。
-- ---------------------------------------------------------------------------
create or replace function public.touch_tournament_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := pg_catalog.now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

drop trigger if exists trg_tournament_state_touch on public.tournament_state;
create trigger trg_tournament_state_touch
  before update on public.tournament_state
  for each row
  execute function public.touch_tournament_state();

-- 3.1 首次插入（表中尚无 main 行）
--     revision 抬到至少 1，与前端首次写入提交的 revision = 1 保持一致；
--     手动插入未指定 revision 时（默认值 0）同样得到 1。
--     此处不使用 greatest()：该函数在部分 PostgreSQL 版本中属于语法特例，加 schema 限定后不保证可解析。
create or replace function public.init_tournament_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.revision is null or new.revision < 1 then
    new.revision := 1;
  end if;
  new.updated_at := pg_catalog.now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

drop trigger if exists trg_tournament_state_init on public.tournament_state;
create trigger trg_tournament_state_init
  before insert on public.tournament_state
  for each row
  execute function public.init_tournament_state();

-- ---------------------------------------------------------------------------
-- 4. 对象权限与行级安全
--    GRANT 决定角色能否访问该表（对象级权限），RLS 策略决定能访问哪些行（行级），
--    两者同时生效，缺一不可；手工建表时必须显式 GRANT。
--    GRANT ALL 覆盖 SELECT / INSERT / UPDATE / DELETE / TRUNCATE / REFERENCES / TRIGGER；
--    前端仅使用 SELECT / INSERT / UPDATE，如需最小权限可收窄为这三项（见文末第 5 条）。
-- ---------------------------------------------------------------------------
grant select on public.tournament_state to anon;
grant all on public.tournament_state to authenticated;
grant all on public.tournament_state to service_role;

alter table public.tournament_state enable row level security;

-- 4.1 读取：所有角色均可读（赛事数据公开，不含敏感字段）
drop policy if exists public_read_tournament_state on public.tournament_state;
create policy "public_read_tournament_state"
  on public.tournament_state
  for select
  using (true);

-- 4.2 写入：仅登录用户可写。
--     策略通过 TO authenticated 限定角色，因此表达式恒为 true；
--     与在表达式中调用 auth.role() 相比，角色匹配在策略选择阶段完成，且无需逐行求值。
--     限制说明：本策略未约束到具体账号，任何已登录用户均可写入，
--     其前提是保持关闭公开注册（见文末第 3 条）。
drop policy if exists admin_write_tournament_state on public.tournament_state;
create policy "admin_write_tournament_state"
  on public.tournament_state
  for all
  to authenticated
  using (true)
  with check (true);

-- ============================================================================
-- 5. 头像对象存储（Supabase Storage）
--    头像是赛事数据里唯一的大字段：256×256 JPEG 约 15 KB，base64 后约 20 KB，
--    十几名选手合计约 0.3 MB。若随 value 一起存取，每次写入都要重传整份 JSON。
--    因此头像走 Storage，赛事数据里只保留公开 URL（几十字节），
--    JSON 体积回到几 KB 量级；读取由 Storage 自带的边缘 CDN 承担。
--    路径形如 <player-id>-<时间戳>.jpg：换头像即换 URL，可安全使用长缓存，
--    无需依赖缓存失效能力（CDN 缓存时长由上传时的 cacheControl 决定）。
--    本段同样幂等，可重复执行。
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 公开读取（赛事数据与头像本就是公开内容）
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
  on storage.objects
  for select
  using (bucket_id = 'avatars');

-- 仅登录用户可增删改（与 tournament_state 的写入策略保持一致的前提：关闭公开注册）
drop policy if exists "avatars_admin_insert" on storage.objects;
create policy "avatars_admin_insert"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'avatars');

drop policy if exists "avatars_admin_update" on storage.objects;
create policy "avatars_admin_update"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'avatars')
  with check (bucket_id = 'avatars');

drop policy if exists "avatars_admin_delete" on storage.objects;
create policy "avatars_admin_delete"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'avatars');

-- ============================================================================
-- 附：部署与升级说明
--
-- 1. 执行后的权限形态
--    anon          仅可读（写入无对应策略，默认拒绝）
--    authenticated 可读可写
--    service_role  具备 BYPASSRLS，不受策略限制
--
-- 2. 管理员账号
--    Dashboard → Authentication → Users → Add user，勾选 Auto Confirm User。
--
-- 3. 必须关闭公开注册
--    Authentication → Providers → Email → Allow new users to sign up = OFF。
--    原因：写入策略未限定到具体账号，任何可自行注册的账号都将获得写入权限。
--
-- 4. 升级既有项目
--    重新执行本脚本即可补上 revision / updated_at / updated_by 三列与两个触发器；
--    脚本幂等，不影响既有数据。未执行时前端自动降级为覆盖式写入，
--    并在页面右下角提示「数据库未升级」。
--    头像对象存储（第 5 节）同样会一并创建：新上传的头像由前端直接写入该 bucket，
--    赛事数据里只保留公开 URL。
--
-- 5. 可选收紧项（均不影响前端现有逻辑）
--    a. 对象权限收窄为 GRANT SELECT, INSERT, UPDATE。
--    b. 写入策略拆分为 FOR INSERT / FOR UPDATE 两条，从而禁止 DELETE。
--    c. 写入限定到具体账号：策略条件改为 auth.uid() = '<管理员 UID>'::uuid，
--       或建立管理员白名单表，并以 SECURITY DEFINER 的判定函数读取。
-- ============================================================================
