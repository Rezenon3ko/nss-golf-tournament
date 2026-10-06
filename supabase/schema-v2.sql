-- ============================================================================
-- NSS高尔夫锦标赛 · 多表结构（v2）
--
-- 与 schema.sql 的关系
--   本文件只做「新增」：不修改、不删除现有 public.tournament_state，
--   旧版前端仍按单行 JSON 文档读写，作为迁移期的回滚点。
--   执行顺序：先执行 schema.sql（已建过的项目无需重复），再执行本文件。
--
-- 环境      Supabase（PostgreSQL 15+）
-- 执行方式  Dashboard → SQL Editor，整段执行
-- 幂等性    可重复执行：建表使用 IF NOT EXISTS，约束 / 策略 / 触发器先 DROP IF EXISTS
--           再创建，函数使用 CREATE OR REPLACE，Realtime 发布逐表判断后再添加
-- 数据影响  不涉及旧数据：无 DROP TABLE / TRUNCATE / DELETE / 旧表 UPDATE；
--           新表初始为空，数据由 scripts/migrate-to-tables.mjs 迁移
-- 后续阶段  事务函数（RPC，供新版前端写入）在 Phase 1 单独提供；
--           本文件只负责表结构、权限与 Realtime 发布
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. 管理员白名单
--    双主办方共用一个登录账号：白名单保留一行即可。
--    本表不开放任何写入策略（避免登录用户把自己加进白名单），
--    新增 / 删除管理员请用 SQL Editor 或 service_role（表第 10 节给出按邮箱播种的语句）。
-- ---------------------------------------------------------------------------
create table if not exists public.admins (
  uid uuid primary key,
  note text not null default '',
  created_at timestamptz not null default now()
);

alter table public.admins drop constraint if exists admins_uid_fkey;
alter table public.admins
  add constraint admins_uid_fkey foreign key (uid) references auth.users (id) on delete cascade;

-- 判定函数：SECURITY DEFINER 以表属主身份读 admins，绕过 RLS，避免策略自引用。
-- SET search_path = '' + 全限定名：避免 Security Advisor 报 Function Search Path Mutable。
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.uid = (select auth.uid()))
$$;

revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. 赛季（一届赛事一行）
--    所有业务表按 season_id 归属；is_current 通过部分唯一索引保证至多一个。
--    champion / runner_up 的外键在 players 建好后补充（避免建表顺序问题）。
-- ---------------------------------------------------------------------------
create table if not exists public.seasons (
  id text primary key default gen_random_uuid()::text,
  slug text not null,
  name text not null,
  is_current boolean not null default false,
  is_archived boolean not null default false,
  champion_player_id text,
  runner_up_player_id text,
  draft_groups jsonb,
  revision bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists seasons_slug_key on public.seasons (slug);
create unique index if not exists seasons_single_current_idx
  on public.seasons (is_current) where is_current;

alter table public.seasons drop constraint if exists seasons_name_len;
alter table public.seasons
  add constraint seasons_name_len check (char_length(btrim(name)) between 1 and 40);
alter table public.seasons drop constraint if exists seasons_slug_format;
alter table public.seasons
  add constraint seasons_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{0,39}$');

-- ---------------------------------------------------------------------------
-- 2. 选手
--    id 沿用前端生成的字符串（p-…），迁移与头像 Storage 路径可 1:1 对应；
--    sort_order 固定名单顺序，替代旧版「数组位置即顺序」的隐式约定。
-- ---------------------------------------------------------------------------
create table if not exists public.players (
  id text primary key,
  season_id text not null references public.seasons (id) on delete cascade,
  name text not null,
  tier smallint not null default 4,
  group_id text,
  best_score numeric,
  avatar_url text,
  sort_order integer not null default 0,
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists players_season_group_idx on public.players (season_id, group_id);
create index if not exists players_season_order_idx on public.players (season_id, sort_order);

alter table public.players drop constraint if exists players_name_len;
alter table public.players
  add constraint players_name_len check (char_length(btrim(name)) between 1 and 24);
alter table public.players drop constraint if exists players_tier_range;
alter table public.players add constraint players_tier_range check (tier between 1 and 4);
alter table public.players drop constraint if exists players_group_values;
alter table public.players
  add constraint players_group_values
  check (group_id is null or group_id in ('A', 'B', 'C', 'D'));

alter table public.seasons drop constraint if exists seasons_champion_player_fkey;
alter table public.seasons
  add constraint seasons_champion_player_fkey
  foreign key (champion_player_id) references public.players (id) on delete set null;
alter table public.seasons drop constraint if exists seasons_runner_up_player_fkey;
alter table public.seasons
  add constraint seasons_runner_up_player_fkey
  foreign key (runner_up_player_id) references public.players (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 3. 比赛
--    sets / disconnect / log 保留为 jsonb：它们永远与比赛同读同写，拆表只多一层 join；
--    log 会被公开的比赛详情弹窗直接渲染，因此跟随比赛行（logs 表只存全局操作日志）。
--    overdue / locked 是展示态，由前端按 DDL 与对阵推导，不落库。
-- ---------------------------------------------------------------------------
create table if not exists public.matches (
  id text primary key,
  season_id text not null references public.seasons (id) on delete cascade,
  stage text not null,
  group_id text,
  round smallint,
  bracket_order smallint,
  label text,
  player_a_id text references public.players (id) on delete set null,
  player_b_id text references public.players (id) on delete set null,
  status text not null default 'pending',
  forfeit_by text,
  winner_id text references public.players (id) on delete set null,
  walkover_note text,
  sets jsonb not null default '[]'::jsonb,
  disconnect jsonb,
  result_links text[] not null default '{}'::text[],
  log jsonb not null default '[]'::jsonb,
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists matches_season_bracket_idx
  on public.matches (season_id, stage, bracket_order);
create index if not exists matches_season_group_round_idx
  on public.matches (season_id, group_id, round);
create index if not exists matches_season_status_updated_idx
  on public.matches (season_id, status, updated_at desc);
-- 淘汰赛一个签位只允许一场；小组赛按 group+round 循环，不受此约束
create unique index if not exists matches_bracket_slot_key
  on public.matches (season_id, stage, bracket_order) where stage <> 'group';

alter table public.matches drop constraint if exists matches_stage_values;
alter table public.matches
  add constraint matches_stage_values check (stage in ('group', 'qf', 'sf', 'final'));
alter table public.matches drop constraint if exists matches_status_values;
alter table public.matches
  add constraint matches_status_values
  check (status in ('pending', 'complete', 'forfeit', 'walkover'));
alter table public.matches drop constraint if exists matches_forfeit_by_values;
alter table public.matches
  add constraint matches_forfeit_by_values
  check (forfeit_by is null or forfeit_by in ('A', 'B', 'both'));
alter table public.matches drop constraint if exists matches_group_values;
alter table public.matches
  add constraint matches_group_values
  check (group_id is null or group_id in ('A', 'B', 'C', 'D'));
alter table public.matches drop constraint if exists matches_sets_is_array;
alter table public.matches
  add constraint matches_sets_is_array check (jsonb_typeof(sets) = 'array');
alter table public.matches drop constraint if exists matches_log_is_array;
alter table public.matches
  add constraint matches_log_is_array check (jsonb_typeof(log) = 'array');

-- ---------------------------------------------------------------------------
-- 4. DDL 轮次 / 抽签解决记录 / 抽签历史
--    ddl 用 timestamp（不带时区）：规则里的「周日 23:59」是墙上时间，
--    与旧版前端 new Date('2026-09-06T23:59') 的本地时间语义一致。
-- ---------------------------------------------------------------------------
create table if not exists public.ddl_rounds (
  season_id text not null references public.seasons (id) on delete cascade,
  key text not null,
  label text not null,
  stage text not null,
  round smallint,
  ddl timestamp,
  version bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (season_id, key)
);

alter table public.ddl_rounds drop constraint if exists ddl_rounds_stage_values;
alter table public.ddl_rounds
  add constraint ddl_rounds_stage_values check (stage in ('group', 'qf', 'sf', 'final'));

create table if not exists public.tiebreak_resolutions (
  season_id text not null references public.seasons (id) on delete cascade,
  group_id text not null,
  player_id text not null references public.players (id) on delete cascade,
  position smallint not null,
  version bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (season_id, group_id, player_id)
);

alter table public.tiebreak_resolutions drop constraint if exists tiebreak_group_values;
alter table public.tiebreak_resolutions
  add constraint tiebreak_group_values check (group_id in ('A', 'B', 'C', 'D'));
alter table public.tiebreak_resolutions drop constraint if exists tiebreak_position_range;
alter table public.tiebreak_resolutions
  add constraint tiebreak_position_range check (position between 0 and 15);

create table if not exists public.draws (
  id text primary key,
  season_id text not null references public.seasons (id) on delete cascade,
  at timestamptz not null default now(),
  by_uid uuid,
  by_name text,
  tiers jsonb,
  groups jsonb
);

create index if not exists draws_season_at_idx on public.draws (season_id, at desc);

-- ---------------------------------------------------------------------------
-- 5. 证据 / 全局日志 / 主办方资料
--    evidence 公开读（公开的比赛详情弹窗会展示截图链接）；
--    logs 仅登录可见（目前只有后台「证据与日志」页在用）；
--    admin_profiles 存主办方头像，替代旧文档里的 adminAvatar。
-- ---------------------------------------------------------------------------
create table if not exists public.evidence (
  id text primary key,
  season_id text not null references public.seasons (id) on delete cascade,
  match_id text references public.matches (id) on delete set null,
  type text not null default 'other',
  name text not null default '未命名证据',
  url text not null,
  by_uid uuid,
  by_name text,
  created_at timestamptz not null default now()
);

create index if not exists evidence_season_created_idx
  on public.evidence (season_id, created_at desc);
create index if not exists evidence_season_match_idx on public.evidence (season_id, match_id);

alter table public.evidence drop constraint if exists evidence_type_values;
alter table public.evidence
  add constraint evidence_type_values check (type in ('result', 'disconnect', 'other'));

create table if not exists public.logs (
  id text primary key,
  season_id text not null references public.seasons (id) on delete cascade,
  at timestamptz not null default now(),
  by_uid uuid,
  by_name text,
  message text not null,
  meta jsonb
);

create index if not exists logs_season_at_idx on public.logs (season_id, at desc);

create table if not exists public.admin_profiles (
  uid uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6. 版本号与更新时间（由数据库盖章，不采信前端提交的值）
--    players / matches / ddl_rounds / tiebreak_resolutions 逐行自增 version，
--    供乐观锁与 Realtime 增量合并使用；
--    seasons 用 revision 汇总（与旧表 tournament_state 的约定一致）。
-- ---------------------------------------------------------------------------
create or replace function public.touch_versioned_row()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.version := coalesce(new.version, 0);
    -- 迁移会带来历史 updated_at（「最近赛果」排序要用），仅在缺省时才落成当前时间
    new.updated_at := coalesce(new.updated_at, pg_catalog.now());
  else
    -- 只负责版本自增；updated_at 交给写入方决定：
    --   RPC 的实时编辑会显式写 now()，迁移回填则原样保留文档里的历史时间。
    --   （若这里无条件 now()，重复执行迁移脚本会把历史时间全部冲成当下，
    --   导致「最近赛果」排序失真，对账也会失败。）
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_players_version on public.players;
create trigger trg_players_version
  before insert or update on public.players
  for each row execute function public.touch_versioned_row();

drop trigger if exists trg_matches_version on public.matches;
create trigger trg_matches_version
  before insert or update on public.matches
  for each row execute function public.touch_versioned_row();

drop trigger if exists trg_ddl_rounds_version on public.ddl_rounds;
create trigger trg_ddl_rounds_version
  before insert or update on public.ddl_rounds
  for each row execute function public.touch_versioned_row();

drop trigger if exists trg_tiebreak_version on public.tiebreak_resolutions;
create trigger trg_tiebreak_version
  before insert or update on public.tiebreak_resolutions
  for each row execute function public.touch_versioned_row();

create or replace function public.touch_season_row()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := coalesce(new.revision, 0);
    new.updated_at := coalesce(new.updated_at, pg_catalog.now());
  else
    new.revision := old.revision + 1;
    new.updated_at := pg_catalog.now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_seasons_touch on public.seasons;
create trigger trg_seasons_touch
  before insert or update on public.seasons
  for each row execute function public.touch_season_row();

-- ---------------------------------------------------------------------------
-- 7. 对象权限与行级安全
--    GRANT 决定角色能否访问该表，RLS 策略决定能访问哪些行，两者同时生效。
--    公开读：seasons / players / matches / ddl_rounds / tiebreak_resolutions / draws / evidence
--    仅登录：logs / admin_profiles / admins（白名单表只读）
--    写入：所有表都要求 is_admin()，即白名单内的共享主办方账号。
-- ---------------------------------------------------------------------------
alter table public.admins enable row level security;
alter table public.seasons enable row level security;
alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.ddl_rounds enable row level security;
alter table public.tiebreak_resolutions enable row level security;
alter table public.draws enable row level security;
alter table public.evidence enable row level security;
alter table public.logs enable row level security;
alter table public.admin_profiles enable row level security;

-- 7.1 公开读 + 管理员写（逐表生成，策略名形如 public_read_players / admin_write_players）
do $$
declare
  t text;
begin
  foreach t in array array[
    'seasons', 'players', 'matches', 'ddl_rounds',
    'tiebreak_resolutions', 'draws', 'evidence'
  ] loop
    execute format('drop policy if exists public_read_%s on public.%I', t, t);
    execute format(
      'create policy public_read_%s on public.%I for select using (true)', t, t
    );
    execute format('drop policy if exists admin_write_%s on public.%I', t, t);
    execute format(
      'create policy admin_write_%s on public.%I for all to authenticated '
      'using (public.is_admin()) with check (public.is_admin())',
      t, t
    );
  end loop;
end;
$$;

-- 7.2 仅登录可见的表
drop policy if exists admin_read_logs on public.logs;
create policy "admin_read_logs"
  on public.logs
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists admin_write_logs on public.logs;
create policy "admin_write_logs"
  on public.logs
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists admin_read_admin_profiles on public.admin_profiles;
create policy "admin_read_admin_profiles"
  on public.admin_profiles
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists admin_write_admin_profiles on public.admin_profiles;
create policy "admin_write_admin_profiles"
  on public.admin_profiles
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 白名单表只允许白名单成员查看；写入不在策略里开放
drop policy if exists admin_read_admins on public.admins;
create policy "admin_read_admins"
  on public.admins
  for select
  to authenticated
  using (public.is_admin());

-- 7.3 对象权限
grant select on public.seasons, public.players, public.matches, public.ddl_rounds,
  public.tiebreak_resolutions, public.draws, public.evidence to anon;

grant select, insert, update, delete on public.admins, public.seasons, public.players,
  public.matches, public.ddl_rounds, public.tiebreak_resolutions, public.draws,
  public.evidence, public.logs, public.admin_profiles to authenticated;

grant all on public.admins, public.seasons, public.players, public.matches,
  public.ddl_rounds, public.tiebreak_resolutions, public.draws, public.evidence,
  public.logs, public.admin_profiles to service_role;

-- ---------------------------------------------------------------------------
-- 8. Realtime 发布（观众端增量订阅）
--    只发布页面会实时展示的表：seasons / players / matches / ddl_rounds /
--    tiebreak_resolutions / evidence；logs 高频且只有后台用，不发布。
--    Supabase 默认已存在 supabase_realtime 发布；不存在时本段会补建。
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'create publication supabase_realtime';
  end if;

  foreach t in array array[
    'seasons', 'players', 'matches', 'ddl_rounds', 'tiebreak_resolutions', 'evidence'
  ] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. 播种主办方白名单
--    按邮箱匹配现有登录账号（.env 里的 VITE_ADMIN_EMAIL 默认 admin@nss.local）。
--    如使用其他邮箱，请改成实际值后再执行；重复执行不会产生多行。
-- ---------------------------------------------------------------------------
insert into public.admins (uid, note)
select u.id, '主办方（共享账号）'
from auth.users u
where u.email = 'admin@nss.local'
on conflict (uid) do nothing;

-- ============================================================================
-- 附：部署与验收
--
-- 1. 执行后自检
--    a. select * from public.admins;                          -- 应有 1 行共享主办方
--    b. select * from pg_publication_tables
--         where pubname = 'supabase_realtime';                -- 应列出 6 张表
--    c. 用匿名访问（浏览器或 curl）读 public.seasons 应返回空数组而不是报错
--
-- 2. 迁移（Phase 0 脚本，先 dry-run）
--    node scripts/migrate-to-tables.mjs --dry-run
--    node scripts/migrate-to-tables.mjs --apply --slug 2026 --name "2026 赛季"
--    node scripts/migrate-to-tables.mjs --verify --slug 2026
--
-- 3. 回滚
--    新表与旧表互不影响：如需放弃，删除本文件创建的 10 张表即可；
--    旧版前端始终只读写 public.tournament_state。
--
-- 4. 收紧项（后续阶段可选项）
--    a. 事务函数改为 security definer 时，务必 revoke execute from public 后按需授权；
--    b. evidence.url 可在迁移后改为 Storage 路径 + 签名 URL；
--    c. logs 保留期（例如每赛季保留 180 天）可用定时任务清理。
-- ============================================================================
