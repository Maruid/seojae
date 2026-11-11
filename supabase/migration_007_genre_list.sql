-- =====================================================================
-- migration_007: 장르 목록 고정 + 자동 정리
--   - genre_list  : 쓸 수 있는 장르 (보이는 순서 ord)
--   - genre_alias : 같은 뜻 바꾸기 (현판 → 현대판타지 …)
--   - clean_genres(genres, tags) : 띄어쓰기 무시 비교 → 같은 뜻 바꾸기 → 목록에 없는 장르는 태그로
--   - 트리거: novels 의 genres·tags 가 바뀔 때마다 자동으로 정리 (웹 관리 화면 · 업로더 · SQL 어디서 바꿔도)
--   이 파일은 구조만 만들고 기존 데이터는 바꾸지 않음 → 정리는 genre_cleanup_1_preview / 2_apply 로.
--   다시 실행해도 안전 (목록·별칭은 이 파일 내용으로 다시 맞춤).
-- =====================================================================

create table if not exists public.genre_list (
  name text primary key check (char_length(name) between 1 and 30),
  ord  int  not null default 0
);
create table if not exists public.genre_alias (
  alias text primary key,
  name  text not null references public.genre_list(name) on update cascade on delete cascade
);

-- 목록 (바꾸려면 여기를 고쳐서 다시 실행하거나 표를 직접 고침)
insert into public.genre_list(name, ord) values
  ('판타지', 10), ('현대판타지', 20), ('무협', 30), ('로맨스', 40), ('로맨스판타지', 50),
  ('라이트노벨', 60), ('SF', 70), ('대체역사', 80), ('스포츠', 90), ('공포', 100),
  ('미스터리', 110), ('추리', 120), ('BL', 130), ('GL', 140), ('현대', 150),
  ('퓨전', 160), ('게임', 170), ('역사', 180)
on conflict (name) do update set ord = excluded.ord;

insert into public.genre_alias(alias, name) values
  ('현판', '현대판타지'), ('로판', '로맨스판타지'), ('호러', '공포')
on conflict (alias) do update set name = excluded.name;

alter table public.genre_list  enable row level security;
alter table public.genre_alias enable row level security;
drop policy if exists genre_list_read on public.genre_list;
create policy genre_list_read on public.genre_list for select to authenticated using (true);
drop policy if exists genre_alias_read on public.genre_alias;
create policy genre_alias_read on public.genre_alias for select to authenticated using (true);
grant select on public.genre_list, public.genre_alias to authenticated;
grant all on public.genre_list, public.genre_alias to service_role;

-- 비교용 키: 공백 제거 + 소문자 (SF / sf, 현대 판타지 / 현대판타지)
create or replace function public.genre_key(p text)
returns text language sql immutable as $$ select lower(regexp_replace(coalesce(p, ''), '\s+', '', 'g')) $$;

/*
  장르·태그 정리
    장르: 목록 이름(띄어쓰기 무시) 또는 별칭 → 목록 이름. 그 밖은 태그 후보로
    태그: 앞의 '#'·모든 공백 제거, 빈 값·중복 제거, 20자 넘는 건 버림, 최대 20개
    장르: 중복 제거(처음 순서 유지), 최대 10개
  반환: genres, tags, moved(태그로 옮긴 장르), dropped(태그로도 못 넣은 것: 20자 초과·20개 초과)
*/
create or replace function public.clean_genres(p_genres text[], p_tags text[],
  out genres text[], out tags text[], out moved text[], out dropped text[])
language plpgsql stable set search_path = public as $$
declare
  g text; canon text; t text;
begin
  genres := '{}'; tags := '{}'; moved := '{}'; dropped := '{}';
  foreach g in array coalesce(p_genres, '{}') loop
    continue when public.genre_key(g) = '';
    select l.name into canon from genre_list l where public.genre_key(l.name) = public.genre_key(g);
    if canon is null then
      select a.name into canon from genre_alias a where public.genre_key(a.alias) = public.genre_key(g);
    end if;
    if canon is not null then
      if not canon = any(genres) and cardinality(genres) < 10 then genres := genres || canon; end if;
    else
      moved := moved || btrim(g);
    end if;
    canon := null;
  end loop;
  -- 기존 태그 먼저, 그다음 옮긴 장르
  foreach t in array coalesce(p_tags, '{}') || moved loop
    t := regexp_replace(regexp_replace(t, '^\s*#+', ''), '\s+', '', 'g');
    continue when t = '' or t = any(tags);
    if char_length(t) > 20 or cardinality(tags) >= 20 then dropped := dropped || t; continue; end if;
    tags := tags || t;
  end loop;
end $$;

-- 트리거: genres·tags 를 쓸 때마다 정리 + 대표 genre(예전 앱 호환) = 첫 장르
create or replace function public.novels_clean_genres()
returns trigger language plpgsql set search_path = public as $$
declare r record;
begin
  r := public.clean_genres(new.genres, new.tags);
  new.genres := r.genres;
  new.tags := r.tags;
  new.genre := r.genres[1];
  return new;
end $$;

drop trigger if exists novels_clean_genres on public.novels;
create trigger novels_clean_genres before insert or update of genres, tags on public.novels
  for each row execute function public.novels_clean_genres();
