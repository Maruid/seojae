-- =====================================================================
-- migration_009: 오프라인 다운로드 한도
--   - 월 전송량(기본 5GB)에서 남겨 둘 양(기본 2GB)을 뺀 나눌 양(3GB)을 사용자들이 나눠 씀
--   - 인원 = 승인된 사용자 (관리자·차단·승인 대기 제외). 관리자는 무제한
--   - 계산: ① 직접 정한 한도 ② 차단·대기된 사람이 이번 기간에 이미 쓴 양 을 먼저 빼고
--           ③ 남은 양을 자동 인원으로 똑같이 나누되, 이미 그보다 많이 쓴 사람은 쓴 만큼에서 멈추고
--              그 사람을 빼고 남은 양을 다시 나눔 (빠질 사람이 없을 때까지)
--   - 기간: 매달 reset_day 일 reset_hour_utc 시(UTC) 에 다시 시작 (기본 10일 0시 UTC = 한국 9시)
--   - 사용량은 앱이 다운로드로 서버에서 받은 바이트를 기록 (앱이 지키는 한도)
--   다시 실행해도 안전
-- =====================================================================

create table if not exists public.dl_settings (
  id              int primary key default 1 check (id = 1),
  total_bytes     bigint not null default 5368709120 check (total_bytes >= 0),     -- 5 GiB
  reserve_bytes   bigint not null default 2147483648 check (reserve_bytes >= 0),   -- 2 GiB
  reset_day       int    not null default 10 check (reset_day between 1 and 28),
  reset_hour_utc  int    not null default 0  check (reset_hour_utc between 0 and 23),
  updated_at      timestamptz not null default now()
);
insert into public.dl_settings(id) values (1) on conflict (id) do nothing;

create table if not exists public.dl_overrides (
  user_id      uuid primary key references public.profiles(user_id) on delete cascade,
  limit_bytes  bigint not null check (limit_bytes >= 0),
  updated_at   timestamptz not null default now()
);

create table if not exists public.dl_usage (
  user_id       uuid not null references public.profiles(user_id) on delete cascade,
  period_start  timestamptz not null,
  used_bytes    bigint not null default 0 check (used_bytes >= 0),
  updated_at    timestamptz not null default now(),
  primary key (user_id, period_start)
);

alter table public.dl_settings  enable row level security;
alter table public.dl_overrides enable row level security;
alter table public.dl_usage     enable row level security;
-- 직접 읽고 쓰는 정책 없음 → 아래 함수로만
grant all on public.dl_settings, public.dl_overrides, public.dl_usage to service_role;

-- 지금 기간의 시작 (UTC 기준)
create or replace function public.dl_period_start(p_now timestamptz default now())
returns timestamptz language plpgsql stable set search_path = public as $$
declare s record; c timestamptz;
begin
  select * into s from dl_settings where id = 1;
  c := (date_trunc('month', p_now at time zone 'UTC') + make_interval(days => s.reset_day - 1, hours => s.reset_hour_utc)) at time zone 'UTC';
  if p_now < c then
    c := ((date_trunc('month', p_now at time zone 'UTC') - interval '1 month') + make_interval(days => s.reset_day - 1, hours => s.reset_hour_utc)) at time zone 'UTC';
  end if;
  return c;
end $$;

/*
  모든 사용자의 이번 기간 한도 (내부용)
    mode: admin(무제한) | direct(직접) | auto(자동) | stopped(자동인데 쓴 만큼에서 멈춤) | blocked | pending
    limit_bytes: null = 무제한
*/
create or replace function public.dl_quota_table()
returns table(user_id uuid, mode text, limit_bytes bigint, used_bytes bigint)
language plpgsql security definer set search_path = public as $$
declare
  s record; ps timestamptz; pool bigint; left_ bigint; n int; share bigint; r record;
  fixed uuid[] := '{}';
begin
  select * into s from dl_settings where id = 1;
  ps := dl_period_start();
  pool := greatest(s.total_bytes - s.reserve_bytes, 0);

  if to_regclass('pg_temp._dlq') is null then
    create temp table _dlq(user_id uuid primary key, mode text, limit_bytes bigint, used_bytes bigint) on commit drop;
  else
    truncate _dlq;
  end if;
  insert into _dlq
  select p.user_id,
         case when a.user_id is not null then 'admin'
              when p.status <> 'approved' then p.status
              when o.user_id is not null then 'direct'
              else 'auto' end,
         case when a.user_id is not null then null
              when p.status <> 'approved' then coalesce(u.used_bytes, 0)
              when o.user_id is not null then o.limit_bytes
              else null end,
         coalesce(u.used_bytes, 0)
    from profiles p
    left join admins a on a.user_id = p.user_id
    left join dl_overrides o on o.user_id = p.user_id
    left join dl_usage u on u.user_id = p.user_id and u.period_start = ps;

  -- ①② 먼저 빼기 (직접 한도, 차단·대기의 쓴 양)
  select pool - coalesce(sum(q.limit_bytes) filter (where q.mode = 'direct'), 0)
              - coalesce(sum(q.used_bytes) filter (where q.mode in ('blocked', 'pending')), 0)
    into left_ from _dlq q;
  left_ := greatest(left_, 0);

  -- ③ 물 채우기: 많이 쓴 사람부터 보면서, 몫보다 많이 썼으면 쓴 만큼에서 멈춤
  select count(*) into n from _dlq q where q.mode = 'auto';
  for r in select q.user_id, q.used_bytes from _dlq q where q.mode = 'auto' order by q.used_bytes desc loop
    exit when n = 0;
    share := left_ / n;
    if r.used_bytes >= share then
      update _dlq set mode = 'stopped', limit_bytes = r.used_bytes where _dlq.user_id = r.user_id;
      left_ := greatest(left_ - r.used_bytes, 0);
      n := n - 1;
    else
      exit;
    end if;
  end loop;
  share := case when n > 0 then left_ / n else 0 end;
  update _dlq set limit_bytes = share where _dlq.mode = 'auto';

  return query select q.user_id, q.mode, q.limit_bytes, q.used_bytes from _dlq q;
end $$;
revoke all on function public.dl_quota_table() from public, anon, authenticated;

-- 내 한도 (앱의 받기 창 · 내 정보)
create or replace function public.dl_my_quota()
returns json language plpgsql security definer set search_path = public as $$
declare q record; ps timestamptz; s record;
begin
  if not (is_admin() or is_approved()) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into s from dl_settings where id = 1;
  ps := dl_period_start();
  select * into q from dl_quota_table() t where t.user_id = auth.uid();
  return json_build_object(
    'mode', coalesce(q.mode, 'auto'),
    'unlimited', q.limit_bytes is null and q.mode = 'admin',
    'limit', q.limit_bytes,
    'used', coalesce(q.used_bytes, 0),
    'period_start', ps,
    'period_end', ps + interval '1 month',
    'pool', greatest(s.total_bytes - s.reserve_bytes, 0));
end $$;
grant execute on function public.dl_my_quota() to authenticated;

-- 받은 양 기록 → 기록 후 내 한도 (한 번에 200MB 까지)
create or replace function public.dl_add_usage(p_bytes bigint)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_approved()) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_bytes is null or p_bytes < 0 or p_bytes > 209715200 then raise exception 'bad bytes' using errcode = '22023'; end if;
  insert into dl_usage(user_id, period_start, used_bytes) values (auth.uid(), dl_period_start(), p_bytes)
  on conflict (user_id, period_start) do update set used_bytes = dl_usage.used_bytes + excluded.used_bytes, updated_at = now();
  return dl_my_quota();
end $$;
grant execute on function public.dl_add_usage(bigint) to authenticated;

-- 관리자: 설정 + 이번 기간 요약
create or replace function public.dl_admin_settings()
returns json language plpgsql security definer set search_path = public as $$
declare s record; ps timestamptz; used bigint; n int;
begin
  if not is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into s from dl_settings where id = 1;
  ps := dl_period_start();
  select coalesce(sum(t.used_bytes) filter (where t.mode <> 'admin'), 0),
         count(*) filter (where t.mode in ('auto', 'stopped', 'direct'))
    into used, n from dl_quota_table() t;
  return json_build_object('total', s.total_bytes, 'reserve', s.reserve_bytes, 'reset_day', s.reset_day,
    'reset_hour_utc', s.reset_hour_utc, 'pool', greatest(s.total_bytes - s.reserve_bytes, 0),
    'period_start', ps, 'period_end', ps + interval '1 month', 'used', used, 'members', n);
end $$;
grant execute on function public.dl_admin_settings() to authenticated;

create or replace function public.dl_admin_set_settings(p_total bigint, p_reserve bigint, p_reset_day int)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_total < 0 or p_reserve < 0 or p_reserve > p_total or p_reset_day not between 1 and 28 then
    raise exception 'bad settings' using errcode = '22023';
  end if;
  update dl_settings set total_bytes = p_total, reserve_bytes = p_reserve, reset_day = p_reset_day, updated_at = now() where id = 1;
  return dl_admin_settings();
end $$;
grant execute on function public.dl_admin_set_settings(bigint, bigint, int) to authenticated;

-- 관리자: 사용자별 한도 표
create or replace function public.dl_admin_quotas()
returns table(user_id uuid, email text, display_name text, status text, mode text,
              limit_bytes bigint, used_bytes bigint, override_bytes bigint, approved_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select t.user_id, p.email, p.display_name, p.status, t.mode, t.limit_bytes, t.used_bytes, o.limit_bytes, p.approved_at
      from dl_quota_table() t
      join profiles p on p.user_id = t.user_id
      left join dl_overrides o on o.user_id = t.user_id
     order by (t.mode = 'admin') desc, p.status = 'approved' desc, p.display_name nulls last, p.email;
end $$;
grant execute on function public.dl_admin_quotas() to authenticated;

-- 관리자: 직접 한도 정하기 (null → 자동으로)
create or replace function public.dl_admin_set_override(p_user uuid, p_bytes bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_bytes is null then
    delete from dl_overrides where user_id = p_user;
  else
    if p_bytes < 0 then raise exception 'bad bytes' using errcode = '22023'; end if;
    insert into dl_overrides(user_id, limit_bytes) values (p_user, p_bytes)
    on conflict (user_id) do update set limit_bytes = excluded.limit_bytes, updated_at = now();
  end if;
end $$;
grant execute on function public.dl_admin_set_override(uuid, bigint) to authenticated;
