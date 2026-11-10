-- =====================================================================
--  seojae (서재) - Supabase schema v0.1
--  project ref: dnihkxmecdyuplzvuemu (Seoul, ap-northeast-2)
--
--  - 정적 호스팅(GitHub Pages) + 브라우저에서 Supabase 직접 호출
--  - 로그인: Google 만 사용 (익명 로그인 없음)
--  - 권한: admin(관리자) / 승인된 사용자 + 섹터별 열람 권한(grants)
--  - 모든 권한은 RLS + SECURITY DEFINER 함수로 제어 (화면 숨김에 의존 X)
--  - 본문 파일은 Storage 비공개 버킷 content/<섹터>/... 에 저장,
--    DB 에는 목록·정렬용 메타와 읽기 상태만 저장
--  - 콘텐츠 업로드는 로컬 업로드 스크립트(service_role) 가 담당 → 클라이언트 쓰기 권한 없음
--
--  설치: SQL Editor 에서 이 파일 전체 실행 (최초 1회)
--  이후 변경은 migration_00N_*.sql 로 추가
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. 공통 트리거 함수
-- ---------------------------------------------------------------------
create or replace function public.tg_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;


-- ---------------------------------------------------------------------
-- 1. 관리자 / 사용자
-- ---------------------------------------------------------------------
create table public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Google 로그인한 사람은 ensure_profile() 로 자동 등록 → 관리자가 승인
create table public.profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  email         text,
  display_name  text check (char_length(display_name) <= 40),
  avatar_url    text check (char_length(avatar_url) <= 500),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'blocked')),
  note          text check (char_length(note) <= 200),          -- 관리자 메모
  approved_at   timestamptz,
  approved_by   uuid references auth.users(id) on delete set null,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 2. 섹터 / 섹터별 열람 권한
--    섹터 key = Storage 최상위 폴더명 (content/<key>/...)
-- ---------------------------------------------------------------------
create table public.sectors (
  key         text primary key check (key ~ '^[a-z0-9_-]{2,30}$'),
  name        text not null check (char_length(name) between 1 and 30),
  kind        text not null check (kind in ('column', 'novel')),
  sort_order  int  not null default 0
);

create table public.grants (
  user_id     uuid not null references public.profiles(user_id) on delete cascade,
  sector      text not null references public.sectors(key) on delete cascade,
  granted_by  uuid references auth.users(id) on delete set null,
  granted_at  timestamptz not null default now(),
  primary key (user_id, sector)
);


-- ---------------------------------------------------------------------
-- 3. 권한 헬퍼 (RLS 재귀 방지를 위해 SECURITY DEFINER)
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where user_id = auth.uid() and status = 'approved');
$$;

-- 관리자는 모든 섹터, 일반 사용자는 승인 + 해당 섹터 권한이 있어야 함
create or replace function public.has_sector(p_sector text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (
        select 1
          from grants g
          join profiles p on p.user_id = g.user_id
         where g.user_id = auth.uid() and g.sector = p_sector and p.status = 'approved'
      );
$$;


-- ---------------------------------------------------------------------
-- 4. 콘텐츠 메타 (쓰기는 업로드 스크립트만)
-- ---------------------------------------------------------------------

-- 4-1. 칼럼 (.md 1개 = 1행). 본문: content/<sector>/md/<id>.md
create table public.columns (
  id            text primary key check (id ~ '^[A-Za-z0-9_-]{4,64}$'),   -- source_url 의 콘텐츠 ID
  sector        text not null default 'columns' references public.sectors(key),
  category      text not null check (char_length(category) between 1 and 50),
  title         text not null check (char_length(title) between 1 and 200),
  author        text check (char_length(author) <= 50),
  published_at  timestamptz not null,
  source_url    text check (char_length(source_url) <= 500),
  md_path       text not null,
  file_name     text,                                            -- 로컬 원본 파일명
  tags          text[] not null default '{}',
  size_bytes    int,
  content_hash  text,
  uploaded_at   timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index columns_list on public.columns(sector, category, published_at desc);

-- 4-2. 소설 (.txt 1개 = 1행)
create table public.novels (
  id             text primary key check (id ~ '^[a-z0-9_-]{2,40}$'),     -- Storage 키용 슬러그
  sector         text not null default 'novels' references public.sectors(key),
  title          text not null check (char_length(title) between 1 and 100),
  file_name      text not null unique,
  key_mode       text not null check (key_mode in ('number', 'sequence', 'size')),
  chapter_count  int  not null default 0,
  last_added_at  timestamptz,                                    -- 마지막으로 회차가 추가된 시각 ("새 회차" 표시)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- 4-3. 소설 회차. 본문: content/<sector>/<novel_id>/<key>.txt
--   key: 읽기 위치를 기억하는 고정 키
--     number 모드  → 'n0033'      (제목의 회차 번호, 빠진 회차를 나중에 채워도 불변)
--     sequence 모드→ 's0012'      (등장 순서)
--     size 모드    → 'p0003'      (크기 분할 순서)
--     번호 없는 꼬리 회차 → 'x0001' ([BONUS] 후기 등)  /  첫 회차 앞 소개 → 'intro'
--   seq: 화면 정렬 순서 (빠진 회차가 채워지면 다시 매겨질 수 있음)
create table public.novel_chapters (
  novel_id       text not null references public.novels(id) on delete cascade,
  key            text not null check (key ~ '^(intro|[nspx][0-9]{4,6})$'),
  seq            int  not null,
  title          text,                                           -- 원본 제목 줄
  display_title  text,                                           -- 작품명 등을 뗀 표시용 제목
  path           text not null,
  char_count     int,
  content_hash   text,
  added_at       timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (novel_id, key)
);
create index novel_chapters_order on public.novel_chapters(novel_id, seq);


-- ---------------------------------------------------------------------
-- 5. 읽기 상태 (사용자별)
--   column  : item_id = 칼럼 id,            anchor = 마지막 문단 id (SE-...)
--   chapter : item_id = '<novel_id>/<key>', anchor = 줄 번호
--   소설의 "마지막으로 읽던 회차" = 같은 novel_id 중 updated_at 최신 행
-- ---------------------------------------------------------------------
create table public.reading_state (
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_kind    text not null check (item_kind in ('column', 'chapter')),
  item_id      text not null check (char_length(item_id) <= 120),
  novel_id     text,                                             -- chapter 일 때만 (목록 조회용)
  anchor       text check (char_length(anchor) <= 80),
  progress     real check (progress between 0 and 1),
  finished_at  timestamptz,                                      -- 읽음 처리 시각 (null = 안 읽음/읽는 중)
  updated_at   timestamptz not null default now(),
  primary key (user_id, item_kind, item_id),
  check ((item_kind = 'chapter') = (novel_id is not null))
);
create index reading_state_novel on public.reading_state(user_id, novel_id, updated_at desc)
  where novel_id is not null;

-- user_id 위조 방지 + updated_at 갱신
create or replace function public.tg_reading_state()
returns trigger language plpgsql as $$
begin
  new.user_id := auth.uid();
  new.updated_at := now();
  return new;
end $$;
create trigger reading_state_meta before insert or update on public.reading_state
  for each row execute function public.tg_reading_state();

create trigger columns_touch before update on public.columns
  for each row execute function public.tg_touch_updated_at();
create trigger novels_touch before update on public.novels
  for each row execute function public.tg_touch_updated_at();
create trigger novel_chapters_touch before update on public.novel_chapters
  for each row execute function public.tg_touch_updated_at();


-- ---------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------
alter table public.admins         enable row level security;
alter table public.profiles       enable row level security;
alter table public.sectors        enable row level security;
alter table public.grants         enable row level security;
alter table public.columns        enable row level security;
alter table public.novels         enable row level security;
alter table public.novel_chapters enable row level security;
alter table public.reading_state  enable row level security;

-- admins: 클라이언트 직접 접근 없음 (is_admin() 으로만 확인)

-- profiles: 본인 / 관리자 조회. 변경은 전부 RPC
create policy profiles_select on public.profiles for select
  using (user_id = auth.uid() or public.is_admin());

-- sectors: 로그인 사용자 누구나 조회 (이름표 용도)
create policy sectors_select on public.sectors for select using (auth.uid() is not null);

-- grants: 본인 / 관리자 조회. 변경은 RPC
create policy grants_select on public.grants for select
  using (user_id = auth.uid() or public.is_admin());

-- 콘텐츠 메타: 섹터 권한이 있는 사람만 조회. 쓰기 정책 없음 (service_role 은 RLS 우회)
create policy columns_select on public.columns for select using (public.has_sector(sector));
create policy novels_select  on public.novels  for select using (public.has_sector(sector));
create policy novel_chapters_select on public.novel_chapters for select
  using (exists (select 1 from public.novels n where n.id = novel_id and public.has_sector(n.sector)));

-- 읽기 상태: 본인 것만, 승인된 사용자(또는 관리자)만 기록
create policy reading_state_select on public.reading_state for select
  using (user_id = auth.uid());
create policy reading_state_insert on public.reading_state for insert
  with check (user_id = auth.uid() and (public.is_approved() or public.is_admin()));
create policy reading_state_update on public.reading_state for update
  using (user_id = auth.uid() and (public.is_approved() or public.is_admin()))
  with check (user_id = auth.uid());
create policy reading_state_delete on public.reading_state for delete
  using (user_id = auth.uid());


-- ---------------------------------------------------------------------
-- 7. RPC - 사용자
-- ---------------------------------------------------------------------

-- 로그인 직후 호출: 프로필이 없으면 만들고(pending), 내 상태를 돌려줌
--   반환: { status, is_admin, sectors: [{key,name,kind}], profile }
create or replace function public.ensure_profile()
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_user auth.users%rowtype;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_user from auth.users where id = v_uid;

  insert into profiles(user_id, email, display_name, avatar_url, last_seen_at)
  values (
    v_uid,
    v_user.email,
    left(coalesce(v_user.raw_user_meta_data->>'full_name', v_user.raw_user_meta_data->>'name',
                  split_part(v_user.email, '@', 1)), 40),
    left(v_user.raw_user_meta_data->>'avatar_url', 500),
    now()
  )
  on conflict (user_id) do update
    set email = excluded.email,
        avatar_url = coalesce(excluded.avatar_url, profiles.avatar_url),
        last_seen_at = case when profiles.last_seen_at is null
                              or profiles.last_seen_at < now() - interval '30 minutes'
                            then now() else profiles.last_seen_at end;

  return (
    select json_build_object(
      'status',   p.status,
      'is_admin', public.is_admin(),
      'profile',  json_build_object('display_name', p.display_name, 'email', p.email, 'avatar_url', p.avatar_url),
      'sectors',  coalesce((
         select json_agg(json_build_object('key', s.key, 'name', s.name, 'kind', s.kind) order by s.sort_order)
           from sectors s
          where public.has_sector(s.key)
      ), '[]'::json)
    )
    from profiles p where p.user_id = v_uid
  );
end $$;

create or replace function public.update_my_name(p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if char_length(trim(p_name)) not between 1 and 40 then raise exception 'INVALID_NAME'; end if;
  update profiles set display_name = trim(p_name) where user_id = auth.uid();
end $$;


-- ---------------------------------------------------------------------
-- 8. RPC - 관리자
-- ---------------------------------------------------------------------

-- 사용자 목록 + 섹터 권한 (대기 중인 사람이 위로)
create or replace function public.admin_list_users()
returns table (user_id uuid, email text, display_name text, avatar_url text, status text, note text,
               sectors text[], is_admin boolean, created_at timestamptz, last_seen_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  return query
  select p.user_id, p.email, p.display_name, p.avatar_url, p.status, p.note,
         coalesce(array(select g.sector from grants g where g.user_id = p.user_id order by g.sector), '{}'),
         exists (select 1 from admins a where a.user_id = p.user_id),
         p.created_at, p.last_seen_at
    from profiles p
   order by (p.status = 'pending') desc, p.created_at desc;
end $$;

-- 승인 / 차단 / 대기로 되돌림
create or replace function public.admin_set_status(p_user uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  if p_status not in ('pending', 'approved', 'blocked') then raise exception 'INVALID_STATUS'; end if;
  update profiles
     set status      = p_status,
         note        = coalesce(p_note, note),
         approved_at = case when p_status = 'approved' then now() else approved_at end,
         approved_by = case when p_status = 'approved' then auth.uid() else approved_by end
   where user_id = p_user;
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

-- 섹터 권한 켜기/끄기
create or replace function public.admin_set_grant(p_user uuid, p_sector text, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  if p_on then
    insert into grants(user_id, sector, granted_by) values (p_user, p_sector, auth.uid())
    on conflict do nothing;
  else
    delete from grants where user_id = p_user and sector = p_sector;
  end if;
end $$;

create or replace function public.admin_stats()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  return json_build_object(
    'users_pending',  (select count(*) from profiles where status = 'pending'),
    'users_approved', (select count(*) from profiles where status = 'approved'),
    'active_7d',      (select count(*) from profiles where last_seen_at > now() - interval '7 days'),
    'columns',        (select count(*) from columns),
    'novels',         (select count(*) from novels),
    'chapters',       (select count(*) from novel_chapters),
    'db_size_bytes',  pg_database_size(current_database()),
    'storage_bytes',  (select coalesce(sum((metadata->>'size')::bigint), 0)
                         from storage.objects where bucket_id = 'content')
  );
end $$;


-- ---------------------------------------------------------------------
-- 9. keepalive (GitHub Actions 에서 publishable key 로 호출)
-- ---------------------------------------------------------------------
create or replace function public.ping()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from sectors;
$$;


-- ---------------------------------------------------------------------
-- 10. 함수 실행 권한
--   비로그인(anon)은 ping 만 허용
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated;
grant  execute on function public.ping() to anon;


-- ---------------------------------------------------------------------
-- 11. 테이블 접근 권한 (Automatically expose new tables = OFF 기준)
--   GRANT = 테이블에 접근할 수 있는가 / RLS = 어떤 행에 접근할 수 있는가
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select on public.profiles, public.sectors, public.grants,
                public.columns, public.novels, public.novel_chapters
to authenticated;

grant select, insert, update, delete on public.reading_state to authenticated;

-- admins: 권한 없음 (is_admin() 으로만 확인)
-- 업로드 스크립트는 service_role 로 접속하므로 별도 GRANT 불필요


-- ---------------------------------------------------------------------
-- 12. Storage: 비공개 버킷 + 섹터 권한 기반 읽기
--   경로 규칙: content/<sector>/...   (첫 폴더 = sectors.key)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('content', 'content', false)
on conflict (id) do nothing;

create policy content_read on storage.objects for select to authenticated
  using (bucket_id = 'content' and public.has_sector((storage.foldername(name))[1]));
-- 업로드/수정/삭제 정책 없음 → service_role(업로드 스크립트)만 가능


-- ---------------------------------------------------------------------
-- 13. 기본 섹터
-- ---------------------------------------------------------------------
insert into public.sectors(key, name, kind, sort_order) values
  ('columns', '칼럼', 'column', 10),
  ('novels',  '소설', 'novel',  20);


-- =====================================================================
-- 관리자 등록 (최초 1회, SQL Editor 에서 직접 실행)
--   1) 사이트에서 Google 로그인 (profiles 에 pending 으로 등록됨)
--   2) Authentication > Users 에서 uid 확인 후:
--   insert into public.admins(user_id) values ('<your-uid>');
--   update public.profiles set status = 'approved', approved_at = now() where user_id = '<your-uid>';
-- =====================================================================
