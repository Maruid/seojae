-- =====================================================================
-- 장르 정리 2단계: 적용 (1단계 미리 보기를 확인한 뒤 실행)
--   트리거(migration_007)가 정리하므로 genres 를 자기 자신으로 다시 쓰기만 하면 됨
--   바뀐 소설 수와, 장르가 비게 된 소설 목록을 보여 줌
-- =====================================================================
update public.novels n
   set genres = n.genres
 where n.genres is distinct from (public.clean_genres(n.genres, n.tags)).genres
    or n.tags   is distinct from (public.clean_genres(n.genres, n.tags)).tags
    or n.genre  is distinct from (public.clean_genres(n.genres, n.tags)).genres[1];

-- 장르가 없는 소설 → 관리 › 소설 정보에서 골라 주세요
select title as "장르 없는 소설", id
  from public.novels
 where cardinality(genres) = 0
 order by title;
