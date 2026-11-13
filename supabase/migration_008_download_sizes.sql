-- =====================================================================
-- migration_008: 다운로드 용량 미리 계산용 크기 칸
--   - 웹의 "회차 받기 · 칼럼 받기" 창이 받기 전에 용량을 보여 주고 한도를 확인할 때 씀
--   - 업로더가 올릴 때 채움 (docs/DOWNLOAD_SIZE_SPEC.md). 비어 있으면 웹은 글자 수로 어림
--   - 칸만 추가, 기존 데이터는 그대로. 다시 실행해도 안전
-- =====================================================================

-- 회차 파일(.txt) 크기 (Storage 에 올라간 바이트 그대로)
alter table public.novel_chapters add column if not exists size_bytes int;

-- 목록용 표지 파일 크기 (소설을 받을 때 같이 받음)
alter table public.novels add column if not exists cover_bytes int;

-- 칼럼: size_bytes(이미 있음) = .md 크기. 이미지는 따로
alter table public.columns add column if not exists image_bytes bigint;   -- md 가 참조하는 이미지 파일 크기 합
alter table public.columns add column if not exists image_count int;      -- 참조하는 이미지 개수

do $$ begin
  alter table public.novel_chapters add constraint novel_chapters_size_bytes check (size_bytes is null or size_bytes >= 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.novels add constraint novels_cover_bytes check (cover_bytes is null or cover_bytes >= 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.columns add constraint columns_image_bytes check ((image_bytes is null or image_bytes >= 0) and (image_count is null or image_count >= 0));
exception when duplicate_object then null; end $$;
