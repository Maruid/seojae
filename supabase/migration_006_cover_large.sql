-- =====================================================================
-- migration_006: 소설 표지 크게 보기용 (선택)
--   cover_large_path: novels/<id>/cover-<해시>-l.webp  (업로더가 올림, 없으면 앱은 목록용 표지로 크게 보기)
--   다시 실행해도 안전.
-- =====================================================================
alter table public.novels add column if not exists cover_large_path text;

do $$ begin
  alter table public.novels add constraint novels_cover_large_path
    check (cover_large_path is null or cover_large_path ~ '^novels/[a-z0-9_-]+/cover-[0-9a-f]{8,64}-l\.(webp|jpg)$');
exception when duplicate_object then null; end $$;
