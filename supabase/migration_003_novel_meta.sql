-- =====================================================================
-- migration_003: 소설 작가 · 대표 장르 · 태그
--   입력은 앱의 관리 탭에서 (upload.py 는 이 세 칸을 건드리지 않음)
--   다시 실행해도 안전.
-- =====================================================================

alter table public.novels add column if not exists author text;
alter table public.novels add column if not exists genre  text;
alter table public.novels add column if not exists tags   text[] not null default '{}';

do $$ begin
  alter table public.novels add constraint novels_author_len check (author is null or char_length(author) between 1 and 60);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.novels add constraint novels_genre_len check (genre is null or char_length(genre) between 1 and 30);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.novels add constraint novels_tags_len check (cardinality(tags) <= 20);
exception when duplicate_object then null; end $$;

-- 관리자만: 작가 · 장르 · 태그 저장
--   태그는 '#'·앞뒤 공백 제거, 빈 값·중복 제거, 각 20자 이하
create or replace function public.admin_update_novel(p_id text, p_author text, p_genre text, p_tags text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tags text[];
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  select coalesce(array_agg(t order by ord), '{}') into v_tags
    from (
      select distinct on (t) t, ord
        from (select btrim(regexp_replace(x, '^#+', '')) as t, ord
                from unnest(coalesce(p_tags, '{}')) with ordinality as u(x, ord)) s
       where t <> ''
       order by t, ord
    ) d;
  if cardinality(v_tags) > 20 then raise exception 'TOO_MANY_TAGS'; end if;
  if exists (select 1 from unnest(v_tags) t where char_length(t) > 20) then raise exception 'TAG_TOO_LONG'; end if;

  update novels
     set author = nullif(btrim(p_author), ''),
         genre  = nullif(btrim(p_genre), ''),
         tags   = v_tags
   where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

revoke execute on function public.admin_update_novel(text, text, text, text[]) from public, anon;
grant  execute on function public.admin_update_novel(text, text, text, text[]) to authenticated;
