-- ============================================================================
-- NSS高尔夫锦标赛 · 多表结构（v2）事务函数（RPC）
--
-- 依赖      schema-v2.sql（表结构 / 权限 / 触发器）已执行
-- 执行方式  Dashboard → SQL Editor，整段执行（幂等，可重复执行）
-- 数据影响  只创建函数，不改任何数据
--
-- 约定
--   a. 所有函数 SECURITY INVOKER + SET search_path = ''：RLS 仍然生效，
--      实际权限以调用者（主办方账号）为准；
--   b. 每个写操作先锁住所属赛季行（SELECT … FOR UPDATE）：
--      同一赛季的写入串行执行，跨赛季互不影响；
--   c. 逐行乐观锁：前端提交已知的 version（p_base_version / base_version），
--      不匹配时抛 SQLSTATE 'PT409'（消息：版本冲突），由前端提示后重拉；
--   d. 错误码：PT400 参数不合法 / PT404 对象不存在 / PT409 冲突或占用；
--   e. 只有 authenticated 且在白名单（public.is_admin()）内才能执行：
--      匿名与普通登录账号既没有 EXECUTE 权限，也会被 RLS 拦下；
--   f. 内部辅助函数放在 private schema（不暴露给 PostgREST），
--      仅授予 authenticated 执行权限，供上面的公开函数调用。
-- ============================================================================

create schema if not exists private;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 0. 内部辅助函数
-- ---------------------------------------------------------------------------

-- 锁住赛季并校验存在（同一赛季的写操作由此串行）
create or replace function private.assert_season_locked(p_season_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id text;
begin
  select s.id into v_id
  from public.seasons s
  where s.id = p_season_id
  for update;

  if v_id is null then
    raise exception '赛季不存在：%', coalesce(p_season_id, '(空)') using errcode = 'PT404';
  end if;
end;
$$;

-- 批量写入操作日志；同 id 已存在时跳过（重放安全）
create or replace function private.insert_logs(p_season_id text, p_logs jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v jsonb;
begin
  if p_logs is null or jsonb_typeof(p_logs) <> 'array' then
    return;
  end if;

  for v in select value from jsonb_array_elements(p_logs) loop
    insert into public.logs (id, season_id, at, by_uid, by_name, message, meta)
    values (
      coalesce(nullif(v ->> 'id', ''), 'lg-' || replace(gen_random_uuid()::text, '-', '')),
      p_season_id,
      coalesce(nullif(v ->> 'at', '')::timestamptz, pg_catalog.now()),
      (select auth.uid()),
      coalesce(nullif(v ->> 'by', ''), '主办方'),
      coalesce(v ->> 'message', ''),
      nullif(v -> 'meta', 'null'::jsonb)
    )
    on conflict (id) do nothing;
  end loop;
end;
$$;

-- 按 JSON 行插入一场比赛（字段与 public.matches 列名一致）
create or replace function private.insert_match_row(p_season_id text, p_row jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.matches (
    id, season_id, stage, group_id, round, bracket_order, label,
    player_a_id, player_b_id, status, forfeit_by, winner_id, walkover_note,
    sets, disconnect, result_links, log, version
  )
  values (
    p_row ->> 'id',
    p_season_id,
    p_row ->> 'stage',
    nullif(p_row ->> 'group_id', ''),
    nullif(p_row ->> 'round', '')::smallint,
    nullif(p_row ->> 'bracket_order', '')::smallint,
    nullif(p_row ->> 'label', ''),
    nullif(p_row ->> 'player_a_id', ''),
    nullif(p_row ->> 'player_b_id', ''),
    coalesce(nullif(p_row ->> 'status', ''), 'pending'),
    nullif(p_row ->> 'forfeit_by', ''),
    nullif(p_row ->> 'winner_id', ''),
    nullif(p_row ->> 'walkover_note', ''),
    coalesce(p_row -> 'sets', '[]'::jsonb),
    nullif(p_row -> 'disconnect', 'null'::jsonb),
    coalesce(
      array(select jsonb_array_elements_text(coalesce(p_row -> 'result_links', '[]'::jsonb))),
      '{}'::text[]
    ),
    coalesce(p_row -> 'log', '[]'::jsonb),
    coalesce(nullif(p_row ->> 'version', '')::bigint, 0)
  );
end;
$$;

-- 插入或更新一场比赛；更新时校验行版本
create or replace function private.apply_match_row(
  p_season_id text,
  p_row jsonb,
  p_base_version bigint default null
)
returns public.matches
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id text := nullif(p_row ->> 'id', '');
  v_current bigint;
  v_result public.matches;
begin
  if v_id is null then
    raise exception '比赛 id 不能为空' using errcode = 'PT400';
  end if;
  if nullif(p_row ->> 'stage', '') is null then
    raise exception '比赛 % 缺少 stage', v_id using errcode = 'PT400';
  end if;

  select m.version into v_current
  from public.matches m
  where m.id = v_id and m.season_id = p_season_id
  for update;

  if v_current is null then
    perform private.insert_match_row(p_season_id, p_row);
  else
    if p_base_version is not null and p_base_version <> v_current then
      raise exception '比赛 % 已被其他设备更新（版本 % ≠ %）', v_id, v_current, p_base_version
        using errcode = 'PT409';
    end if;

    update public.matches m
    set
      updated_at = pg_catalog.now(),
      stage = coalesce(nullif(p_row ->> 'stage', ''), m.stage),
      group_id = nullif(p_row ->> 'group_id', ''),
      round = nullif(p_row ->> 'round', '')::smallint,
      bracket_order = nullif(p_row ->> 'bracket_order', '')::smallint,
      label = nullif(p_row ->> 'label', ''),
      player_a_id = nullif(p_row ->> 'player_a_id', ''),
      player_b_id = nullif(p_row ->> 'player_b_id', ''),
      status = coalesce(nullif(p_row ->> 'status', ''), m.status),
      forfeit_by = nullif(p_row ->> 'forfeit_by', ''),
      winner_id = nullif(p_row ->> 'winner_id', ''),
      walkover_note = nullif(p_row ->> 'walkover_note', ''),
      sets = coalesce(p_row -> 'sets', m.sets),
      disconnect = nullif(p_row -> 'disconnect', 'null'::jsonb),
      result_links = coalesce(
        array(select jsonb_array_elements_text(coalesce(p_row -> 'result_links', '[]'::jsonb))),
        m.result_links
      ),
      log = coalesce(p_row -> 'log', m.log)
    where m.id = v_id and m.season_id = p_season_id;
  end if;

  select m.* into v_result
  from public.matches m
  where m.id = v_id and m.season_id = p_season_id;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. 赛季管理
-- ---------------------------------------------------------------------------

-- 新建赛季；p_copy_from 可指定从某个赛季复制名单与 DDL 结构（不含赛果）
create or replace function public.create_season(
  p_name text,
  p_slug text,
  p_copy_from text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id text;
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_row public.seasons;
  v_has_current boolean;
begin
  if v_name = '' then
    raise exception '赛季名称不能为空' using errcode = 'PT400';
  end if;
  if v_slug = '' then
    raise exception '赛季 slug 不能为空' using errcode = 'PT400';
  end if;
  if exists (select 1 from public.seasons s where s.slug = v_slug) then
    raise exception 'slug 已被占用：%', v_slug using errcode = 'PT409';
  end if;

  select exists (select 1 from public.seasons s where s.is_current) into v_has_current;
  v_id := 's-' || replace(gen_random_uuid()::text, '-', '');

  insert into public.seasons (id, slug, name, is_current)
  values (v_id, v_slug, v_name, not v_has_current)
  returning * into v_row;

  -- 复制名单（头像 URL 可复用，Storage 对象不变）
  if p_copy_from is not null and exists (select 1 from public.seasons s where s.id = p_copy_from) then
    insert into public.players (id, season_id, name, tier, best_score, avatar_url, sort_order)
    select
      'p-' || replace(gen_random_uuid()::text, '-', ''),
      v_id,
      p.name,
      p.tier,
      p.best_score,
      p.avatar_url,
      p.sort_order
    from public.players p
    where p.season_id = p_copy_from
    order by p.sort_order, p.id;

    insert into public.ddl_rounds (season_id, key, label, stage, round, ddl)
    select v_id, d.key, d.label, d.stage, d.round, d.ddl
    from public.ddl_rounds d
    where d.season_id = p_copy_from;
  end if;

  -- 兜底：保证 6 个固定轮次存在
  insert into public.ddl_rounds (season_id, key, label, stage, round)
  select v_id, x.key, x.label, x.stage, x.round
  from (
    values
      ('group1', '小组赛第1轮', 'group', 1),
      ('group2', '小组赛第2轮', 'group', 2),
      ('group3', '小组赛第3轮', 'group', 3),
      ('qf', '八强', 'qf', null::smallint),
      ('sf', '半决赛', 'sf', null::smallint),
      ('final', '决赛', 'final', null::smallint)
  ) as x (key, label, stage, round)
  where not exists (
    select 1 from public.ddl_rounds d where d.season_id = v_id and d.key = x.key
  );

  return to_jsonb(v_row);
end;
$$;

-- 改名 / 改 slug（传 null 表示不改）
create or replace function public.update_season(
  p_season_id text,
  p_name text default null,
  p_slug text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_slug text;
  v_name text;
  v_row public.seasons;
begin
  perform private.assert_season_locked(p_season_id);

  if p_name is not null then
    v_name := btrim(p_name);
    if v_name = '' then
      raise exception '赛季名称不能为空' using errcode = 'PT400';
    end if;
  end if;

  if p_slug is not null then
    v_slug := lower(btrim(p_slug));
    if v_slug = '' then
      raise exception '赛季 slug 不能为空' using errcode = 'PT400';
    end if;
    if exists (
      select 1 from public.seasons s where s.slug = v_slug and s.id <> p_season_id
    ) then
      raise exception 'slug 已被占用：%', v_slug using errcode = 'PT409';
    end if;
  end if;

  update public.seasons s
  set
    name = coalesce(v_name, s.name),
    slug = coalesce(v_slug, s.slug)
  where s.id = p_season_id
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

-- 把某个赛季设为「当前赛季」（同一时间只允许一个）
create or replace function public.set_current_season(p_season_id text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.seasons;
begin
  perform private.assert_season_locked(p_season_id);

  update public.seasons s
  set is_current = false
  where s.is_current and s.id <> p_season_id;

  update public.seasons s
  set is_current = true
  where s.id = p_season_id
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

-- 归档 / 取消归档；归档当前赛季时会同时取消其「当前」标记
create or replace function public.archive_season(
  p_season_id text,
  p_archived boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.seasons;
begin
  perform private.assert_season_locked(p_season_id);

  update public.seasons s
  set
    is_archived = coalesce(p_archived, true),
    is_current = case when coalesce(p_archived, true) then false else s.is_current end
  where s.id = p_season_id
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

-- 保存未发布的分组草稿（p_draft 为 null 表示清空）
create or replace function public.save_draft_groups(
  p_season_id text,
  p_draft jsonb default null,
  p_logs jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.seasons;
begin
  perform private.assert_season_locked(p_season_id);

  update public.seasons s
  set draft_groups = nullif(p_draft, 'null'::jsonb)
  where s.id = p_season_id
  returning * into v_row;

  perform private.insert_logs(p_season_id, p_logs);
  return to_jsonb(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. 选手
-- ---------------------------------------------------------------------------

-- 新增或编辑选手（p_player 为完整行；编辑时传 p_base_version 做乐观锁）
create or replace function public.upsert_player(
  p_season_id text,
  p_player jsonb,
  p_base_version bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id text;
  v_name text;
  v_current bigint;
  v_row public.players;
begin
  perform private.assert_season_locked(p_season_id);

  if p_player is null or jsonb_typeof(p_player) <> 'object' then
    raise exception '选手数据格式不正确' using errcode = 'PT400';
  end if;

  v_id := nullif(p_player ->> 'id', '');
  v_name := btrim(coalesce(p_player ->> 'name', ''));
  if v_name = '' then
    raise exception '选手名称不能为空' using errcode = 'PT400';
  end if;

  select p.version into v_current
  from public.players p
  where p.id = v_id and p.season_id = p_season_id
  for update;

  if v_current is null then
    if v_id is null then
      v_id := 'p-' || replace(gen_random_uuid()::text, '-', '');
    end if;

    insert into public.players (id, season_id, name, tier, group_id, best_score, avatar_url, sort_order)
    values (
      v_id,
      p_season_id,
      v_name,
      coalesce(nullif(p_player ->> 'tier', '')::smallint, 4),
      nullif(p_player ->> 'group_id', ''),
      nullif(p_player ->> 'best_score', '')::numeric,
      nullif(p_player ->> 'avatar_url', ''),
      coalesce(nullif(p_player ->> 'sort_order', '')::integer, 0)
    )
    returning * into v_row;
  else
    if p_base_version is not null and p_base_version <> v_current then
      raise exception '选手 % 已被其他设备更新（版本 % ≠ %）', v_id, v_current, p_base_version
        using errcode = 'PT409';
    end if;

    update public.players p
    set
      updated_at = pg_catalog.now(),
      name = v_name,
      tier = coalesce(nullif(p_player ->> 'tier', '')::smallint, p.tier),
      group_id = case
        when p_player ? 'group_id' then nullif(p_player ->> 'group_id', '')
        else p.group_id
      end,
      best_score = case
        when p_player ? 'best_score' then nullif(p_player ->> 'best_score', '')::numeric
        else p.best_score
      end,
      avatar_url = case
        when p_player ? 'avatar_url' then nullif(p_player ->> 'avatar_url', '')
        else p.avatar_url
      end,
      sort_order = coalesce(nullif(p_player ->> 'sort_order', '')::integer, p.sort_order)
    where p.id = v_id and p.season_id = p_season_id
    returning * into v_row;
  end if;

  return to_jsonb(v_row);
end;
$$;

-- 删除选手（已有比赛记录时拒绝）
create or replace function public.delete_player(
  p_season_id text,
  p_player_id text,
  p_logs jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_matches integer;
  v_deleted integer;
begin
  perform private.assert_season_locked(p_season_id);

  select count(*) into v_matches
  from public.matches m
  where m.season_id = p_season_id
    and (m.player_a_id = p_player_id or m.player_b_id = p_player_id);

  if v_matches > 0 then
    raise exception '该选手有 % 场比赛记录，不能删除（可先重置赛事）', v_matches
      using errcode = 'PT409';
  end if;

  delete from public.players p
  where p.id = p_player_id and p.season_id = p_season_id;
  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    raise exception '选手不存在：%', coalesce(p_player_id, '(空)') using errcode = 'PT404';
  end if;

  perform private.insert_logs(p_season_id, p_logs);
  return jsonb_build_object('deleted', p_player_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. DDL 轮次
-- ---------------------------------------------------------------------------

create or replace function public.set_ddl(
  p_season_id text,
  p_key text,
  p_ddl timestamp default null,
  p_base_version bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current bigint;
  v_row public.ddl_rounds;
begin
  perform private.assert_season_locked(p_season_id);

  select d.version into v_current
  from public.ddl_rounds d
  where d.season_id = p_season_id and d.key = p_key
  for update;

  if v_current is null then
    raise exception '未找到 DDL 轮次：%', coalesce(p_key, '(空)') using errcode = 'PT404';
  end if;

  if p_base_version is not null and p_base_version <> v_current then
    raise exception 'DDL 已被其他设备更新（版本 % ≠ %）', v_current, p_base_version
      using errcode = 'PT409';
  end if;

  update public.ddl_rounds d
  set ddl = p_ddl, updated_at = pg_catalog.now()
  where d.season_id = p_season_id and d.key = p_key
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. 分组发布与赛果
-- ---------------------------------------------------------------------------

-- 发布分组：一次事务写入小组归属、24 场小组赛、抽签记录，并清空旧赛程与冠军
create or replace function public.publish_groups(
  p_season_id text,
  p_players jsonb default '[]'::jsonb,
  p_matches jsonb default '[]'::jsonb,
  p_draw jsonb default null,
  p_logs jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform private.assert_season_locked(p_season_id);

  -- 1. 写入小组归属
  for v in
    select value from jsonb_array_elements(coalesce(nullif(p_players, 'null'::jsonb), '[]'::jsonb))
  loop
    update public.players p
    set group_id = nullif(v ->> 'group_id', ''), updated_at = pg_catalog.now()
    where p.id = v ->> 'id' and p.season_id = p_season_id;
  end loop;

  -- 2. 清空旧赛程 / 抽签解决记录，重置冠军与草稿
  delete from public.matches m where m.season_id = p_season_id;
  delete from public.tiebreak_resolutions t where t.season_id = p_season_id;
  update public.seasons s
  set champion_player_id = null, runner_up_player_id = null, draft_groups = null
  where s.id = p_season_id;

  -- 3. 写入新赛程
  for v in
    select value from jsonb_array_elements(coalesce(nullif(p_matches, 'null'::jsonb), '[]'::jsonb))
  loop
    perform private.insert_match_row(p_season_id, v);
  end loop;

  -- 4. 抽签记录与操作日志
  if p_draw is not null and jsonb_typeof(p_draw) = 'object' then
    insert into public.draws (id, season_id, at, by_uid, by_name, tiers, groups)
    values (
      coalesce(nullif(p_draw ->> 'id', ''), 'draw-' || replace(gen_random_uuid()::text, '-', '')),
      p_season_id,
      coalesce(nullif(p_draw ->> 'at', '')::timestamptz, pg_catalog.now()),
      (select auth.uid()),
      coalesce(nullif(p_draw ->> 'by', ''), '主办方'),
      nullif(p_draw -> 'tiers', 'null'::jsonb),
      nullif(p_draw -> 'groups', 'null'::jsonb)
    )
    on conflict (id) do nothing;
  end if;

  perform private.insert_logs(p_season_id, p_logs);

  return jsonb_build_object(
    'season', (select to_jsonb(s) from public.seasons s where s.id = p_season_id),
    'matches', (
      select coalesce(
        jsonb_agg(
          to_jsonb(m)
          order by m.stage, m.group_id, m.round nulls first, m.bracket_order nulls first
        ),
        '[]'::jsonb
      )
      from public.matches m
      where m.season_id = p_season_id
    )
  );
end;
$$;

-- 赛果变更集：录比分 / 判负 / 延期 / 抽签解决晋级，一次事务写多行。
-- p_matches 每行可带 base_version；p_season_patch 支持 champion_player_id /
-- runner_up_player_id / draft_groups（只更新出现过的键）。
create or replace function public.apply_match_changeset(
  p_season_id text,
  p_matches jsonb default '[]'::jsonb,
  p_season_patch jsonb default null,
  p_logs jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v jsonb;
  v_row public.matches;
  v_changed jsonb := '[]'::jsonb;
begin
  perform private.assert_season_locked(p_season_id);

  for v in
    select value from jsonb_array_elements(coalesce(nullif(p_matches, 'null'::jsonb), '[]'::jsonb))
  loop
    v_row := private.apply_match_row(p_season_id, v, nullif(v ->> 'base_version', '')::bigint);
    v_changed := v_changed || jsonb_build_array(to_jsonb(v_row));
  end loop;

  if p_season_patch is not null and jsonb_typeof(p_season_patch) = 'object' then
    update public.seasons s
    set
      champion_player_id = case
        when p_season_patch ? 'champion_player_id'
          then nullif(p_season_patch ->> 'champion_player_id', '')
        else s.champion_player_id
      end,
      runner_up_player_id = case
        when p_season_patch ? 'runner_up_player_id'
          then nullif(p_season_patch ->> 'runner_up_player_id', '')
        else s.runner_up_player_id
      end,
      draft_groups = case
        when p_season_patch ? 'draft_groups'
          then nullif(p_season_patch -> 'draft_groups', 'null'::jsonb)
        else s.draft_groups
      end
    where s.id = p_season_id;
  end if;

  perform private.insert_logs(p_season_id, p_logs);

  return jsonb_build_object(
    'season', (select to_jsonb(s) from public.seasons s where s.id = p_season_id),
    'matches', v_changed
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. 证据
-- ---------------------------------------------------------------------------

-- p_op = 'add'（p_evidence 为完整行）或 'remove'（p_evidence_id）
create or replace function public.apply_evidence(
  p_season_id text,
  p_op text,
  p_evidence jsonb default null,
  p_evidence_id text default null,
  p_logs jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.evidence;
begin
  perform private.assert_season_locked(p_season_id);

  if p_op = 'add' then
    if p_evidence is null or jsonb_typeof(p_evidence) <> 'object' then
      raise exception '证据数据格式不正确' using errcode = 'PT400';
    end if;

    insert into public.evidence (id, season_id, match_id, type, name, url, by_uid, by_name, created_at)
    values (
      coalesce(nullif(p_evidence ->> 'id', ''), 'ev-' || replace(gen_random_uuid()::text, '-', '')),
      p_season_id,
      nullif(p_evidence ->> 'match_id', ''),
      coalesce(nullif(p_evidence ->> 'type', ''), 'other'),
      coalesce(nullif(p_evidence ->> 'name', ''), '未命名证据'),
      coalesce(p_evidence ->> 'url', ''),
      (select auth.uid()),
      coalesce(nullif(p_evidence ->> 'by', ''), '主办方'),
      coalesce(nullif(p_evidence ->> 'created_at', '')::timestamptz, pg_catalog.now())
    )
    on conflict (id) do update
    set
      match_id = excluded.match_id,
      type = excluded.type,
      name = excluded.name,
      url = excluded.url,
      by_name = excluded.by_name
    returning * into v_row;
  elsif p_op = 'remove' then
    delete from public.evidence e
    where e.id = p_evidence_id and e.season_id = p_season_id
    returning * into v_row;

    if v_row.id is null then
      raise exception '证据不存在：%', coalesce(p_evidence_id, '(空)') using errcode = 'PT404';
    end if;
  else
    raise exception '不支持的操作：%', coalesce(p_op, '(空)') using errcode = 'PT400';
  end if;

  perform private.insert_logs(p_season_id, p_logs);
  return to_jsonb(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. 重置赛事（保留选手名单与历史日志）
-- ---------------------------------------------------------------------------

create or replace function public.reset_season(
  p_season_id text,
  p_logs jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.assert_season_locked(p_season_id);

  delete from public.matches m where m.season_id = p_season_id;
  delete from public.tiebreak_resolutions t where t.season_id = p_season_id;
  delete from public.evidence e where e.season_id = p_season_id;

  update public.players p
  set group_id = null, updated_at = pg_catalog.now()
  where p.season_id = p_season_id;

  update public.seasons s
  set champion_player_id = null, runner_up_player_id = null, draft_groups = null
  where s.id = p_season_id;

  perform private.insert_logs(p_season_id, p_logs);

  return jsonb_build_object(
    'season', (select to_jsonb(s) from public.seasons s where s.id = p_season_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. 主办方资料（头像）
-- ---------------------------------------------------------------------------

create or replace function public.set_admin_avatar(p_avatar_url text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception '未登录' using errcode = 'PT400';
  end if;

  insert into public.admin_profiles (uid, avatar_url, updated_at)
  values (v_uid, nullif(p_avatar_url, ''), pg_catalog.now())
  on conflict (uid) do update
  set avatar_url = excluded.avatar_url, updated_at = pg_catalog.now();

  return jsonb_build_object('uid', v_uid, 'avatar_url', nullif(p_avatar_url, ''));
end;
$$;

-- ---------------------------------------------------------------------------
-- 7.5 增量补齐（Phase 1 双写与 Phase 2 实时合并共用）
--     日志与抽签记录是「只增」数据，单独提供幂等追加函数：
--     客户端按 id 去重后追加，重复调用不会产生多行。
-- ---------------------------------------------------------------------------

create or replace function public.append_logs(
  p_season_id text,
  p_logs jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  perform private.assert_season_locked(p_season_id);

  if p_logs is not null and jsonb_typeof(p_logs) = 'array' then
    v_count := jsonb_array_length(p_logs);
  end if;

  perform private.insert_logs(p_season_id, p_logs);
  return jsonb_build_object('inserted', v_count);
end;
$$;

create or replace function public.append_draw(
  p_season_id text,
  p_draw jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.draws;
begin
  perform private.assert_season_locked(p_season_id);

  if p_draw is null or jsonb_typeof(p_draw) <> 'object' then
    raise exception '抽签记录格式不正确' using errcode = 'PT400';
  end if;

  insert into public.draws (id, season_id, at, by_uid, by_name, tiers, groups)
  values (
    coalesce(nullif(p_draw ->> 'id', ''), 'draw-' || replace(gen_random_uuid()::text, '-', '')),
    p_season_id,
    coalesce(nullif(p_draw ->> 'at', '')::timestamptz, pg_catalog.now()),
    (select auth.uid()),
    coalesce(nullif(p_draw ->> 'by', ''), '主办方'),
    nullif(p_draw -> 'tiers', 'null'::jsonb),
    nullif(p_draw -> 'groups', 'null'::jsonb)
  )
  on conflict (id) do nothing
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

-- 保存同分抽签解决记录：payload 里出现过的 group 整组替换（幂等）
create or replace function public.save_tiebreaks(
  p_season_id text,
  p_tiebreaks jsonb default '[]'::jsonb,
  p_logs jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_groups text[];
begin
  perform private.assert_season_locked(p_season_id);

  if p_tiebreaks is null or jsonb_typeof(p_tiebreaks) <> 'array' then
    raise exception '抽签解决记录格式不正确' using errcode = 'PT400';
  end if;

  select coalesce(array_agg(distinct v ->> 'group_id'), '{}'::text[])
  into v_groups
  from jsonb_array_elements(p_tiebreaks) v;

  delete from public.tiebreak_resolutions t
  where t.season_id = p_season_id and t.group_id = any (v_groups);

  insert into public.tiebreak_resolutions (season_id, group_id, player_id, position)
  select
    p_season_id,
    v ->> 'group_id',
    v ->> 'player_id',
    coalesce(nullif(v ->> 'position', '')::smallint, 0)
  from jsonb_array_elements(p_tiebreaks) v;

  perform private.insert_logs(p_season_id, p_logs);

  return jsonb_build_object(
    'tiebreaks', (
      select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      from public.tiebreak_resolutions t
      where t.season_id = p_season_id
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. 执行权限
--    private 辅助函数与 public 事务函数都只授予 authenticated / service_role：
--    匿名无法调用（同时 RLS 也会拦下非白名单账号）。
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'create_season', 'update_season', 'set_current_season', 'archive_season',
        'save_draft_groups', 'upsert_player', 'delete_player', 'set_ddl',
        'publish_groups', 'apply_match_changeset', 'apply_evidence',
        'reset_season', 'set_admin_avatar',
        'append_logs', 'append_draw', 'save_tiebreaks'
      )
  loop
    execute format('revoke execute on function %s from public, anon', f.signature);
    execute format('grant execute on function %s to authenticated, service_role', f.signature);
  end loop;
end;
$$;

-- ============================================================================
-- 附：调用约定（前端仓储层按此实现）
--
--   建赛季    POST /rest/v1/rpc/create_season
--             { "p_name": "2026 秋季赛", "p_slug": "2026-fall", "p_copy_from": "s-2026" }
--   发布分组  rpc/publish_groups          （players / matches / draw / logs 一次事务）
--   赛果变更  rpc/apply_match_changeset   （p_matches 每行可带 base_version；
--             p_season_patch 支持 champion_player_id / runner_up_player_id / draft_groups）
--   其余函数参数名与上面的签名一一对应。
--
--   冲突处理：响应体 code = 'PT409' 时提示「已被其他设备更新」并重新拉取；
--   PostgREST 会把 SQLSTATE 放在错误响应体的 code 字段里。
--
--   本地回归：/private/tmp/nss-pg 下有 Supabase 环境替身与校验脚本
--   （stub.sql / checks.sql），rpc-checks.sql 覆盖本文件的函数行为。
-- ============================================================================
