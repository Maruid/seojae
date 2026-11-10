-- =====================================================================
-- migration_001: 업로드 스크립트(service_role) 테이블 권한
--   Automatically expose new tables = OFF 이면 service_role 에도 기본 GRANT 가 없음.
--   service_role 은 RLS 는 우회하지만 테이블 GRANT 는 우회하지 못하므로 명시적으로 부여.
--   다시 실행해도 안전.
-- =====================================================================
grant usage on schema public to service_role;

-- 업로드 스크립트가 읽고 쓰는 콘텐츠 메타
grant select, insert, update, delete on
  public.columns, public.novels, public.novel_chapters
to service_role;

-- 관리 작업용 (SQL 이 아닌 스크립트로 사용자/권한을 다룰 경우 대비)
grant select, insert, update, delete on
  public.profiles, public.sectors, public.grants, public.admins, public.reading_state
to service_role;
