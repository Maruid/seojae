-- =====================================================================
-- 장르 정리 1단계: 미리 보기 (DB 를 바꾸지 않음)
--   migration_007_genre_list.sql 을 먼저 실행해야 함
--   결과: 바뀌는 소설만, 장르 전 → 후, 태그로 옮길 장르, 태그로도 못 넣는 것, 장르가 비게 되는지
-- =====================================================================
with x as (
  select n.id, n.title, n.genres as before_genres, n.tags as before_tags, n.genre as before_genre,
         (public.clean_genres(n.genres, n.tags)).*
    from public.novels n
)
select title                                         as "소설",
       array_to_string(before_genres, ', ')          as "장르 (지금)",
       array_to_string(genres, ', ')                 as "장르 (정리 후)",
       array_to_string(moved, ', ')                  as "태그로 옮김",
       array_to_string(dropped, ', ')                as "버림 (20자·20개 초과)",
       case when cardinality(genres) = 0 then '⚠ 장르 없음 — 직접 골라 주세요' else '' end as "확인",
       id
  from x
 where before_genres is distinct from genres or before_tags is distinct from tags or before_genre is distinct from genres[1]
 order by cardinality(genres) = 0 desc, title;

-- 정리 후 장르별 소설 수
with x as (select (public.clean_genres(n.genres, n.tags)).genres g from public.novels n)
select l.name as "장르", count(*) filter (where l.name = any(x.g)) as "소설 수"
  from public.genre_list l cross join x
 group by l.name, l.ord order by l.ord;
