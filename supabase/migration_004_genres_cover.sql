-- =====================================================================
-- migration_004: 소설 장르 여러 개 · 표지
--   - genres: 장르 목록 (기존 genre 한 칸은 genres 로 옮기고, 앞으로는 genres[1] 을 그대로 따라감)
--   - cover_path / cover_hash: upload.py 가 올린 표지 (novels/<id>/cover-<해시>.webp)
--   다시 실행해도 안전.
-- =====================================================================

alter table public.novels add column if not exists genres     text[] not null default '{}';
alter table public.novels add column if not exists cover_path text;
alter table public.novels add column if not exists cover_hash text;

-- 기존 장르 한 칸 → 목록으로
update public.novels set genres = array[genre] where genre is not null and genres = '{}';

do $$ begin
  alter table public.novels add constraint novels_genres_len check (cardinality(genres) <= 10);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.novels add constraint novels_cover_path check (cover_path is null or cover_path ~ '^novels/[a-z0-9_-]+/cover-[0-9a-f]{8,64}\.(webp|jpg|png)$');
exception when duplicate_object then null; end $$;

-- 관리자만: 작가 · 장르(여러 개) · 태그 저장
--   장르: 앞뒤 공백 제거, 빈 값·중복 제거(처음 순서 유지), 각 30자 · 최대 10개
--   태그: 앞의 '#' 과 모든 공백 제거, 빈 값·중복 제거, 각 20자 · 최대 20개
create or replace function public.admin_update_novel(p_id text, p_author text, p_genres text[], p_tags text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_genres text[];
  v_tags   text[];
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;

  select coalesce(array_agg(t order by ord), '{}') into v_genres
    from (select distinct on (t) t, ord
            from (select btrim(regexp_replace(x, '\s+', ' ', 'g')) as t, ord
                    from unnest(coalesce(p_genres, '{}')) with ordinality as u(x, ord)) s
           where t <> ''
           order by t, ord) d;
  if cardinality(v_genres) > 10 then raise exception 'TOO_MANY_GENRES'; end if;
  if exists (select 1 from unnest(v_genres) t where char_length(t) > 30) then raise exception 'GENRE_TOO_LONG'; end if;

  select coalesce(array_agg(t order by ord), '{}') into v_tags
    from (select distinct on (t) t, ord
            from (select regexp_replace(regexp_replace(x, '^\s*#+', ''), '\s+', '', 'g') as t, ord
                    from unnest(coalesce(p_tags, '{}')) with ordinality as u(x, ord)) s
           where t <> ''
           order by t, ord) d;
  if cardinality(v_tags) > 20 then raise exception 'TOO_MANY_TAGS'; end if;
  if exists (select 1 from unnest(v_tags) t where char_length(t) > 20) then raise exception 'TAG_TOO_LONG'; end if;

  update novels
     set author = nullif(btrim(p_author), ''),
         genres = v_genres,
         genre  = v_genres[1],
         tags   = v_tags
   where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

revoke execute on function public.admin_update_novel(text, text, text[], text[]) from public, anon;
grant  execute on function public.admin_update_novel(text, text, text[], text[]) to authenticated;

-- 예전 앱(장르 한 칸)에서 저장해도 장르 목록이 맞게: 기존 함수는 새 함수로 넘김
create or replace function public.admin_update_novel(p_id text, p_author text, p_genre text, p_tags text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_update_novel(p_id, p_author, case when nullif(btrim(p_genre), '') is null then '{}'::text[] else array[p_genre] end, p_tags);
end $$;
