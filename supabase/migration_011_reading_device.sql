-- =====================================================================
-- migration_011: 읽기 기록에 기기 표시 + 클라이언트 시각 유지
--   - device_id: 기록을 쓴 기기 (앱/브라우저마다 한 번 만든 ID)
--     → "다른 기기에서 읽었어요" 알림을 이 값으로만 판단
--   - updated_at: 서버가 업로드 시각으로 덮어쓰지 않고 기기에서 실제로 읽은 시각을 유지
--     (한꺼번에 올린 여러 회차가 같은 시각이 되어 순서가 뒤섞이던 문제 해결)
--     미래 시각은 now() 로 막음
-- =====================================================================

alter table public.reading_state
  add column if not exists device_id text check (char_length(device_id) <= 64);

create or replace function public.tg_reading_state()
returns trigger language plpgsql as $$
begin
  new.user_id := auth.uid();
  new.updated_at := least(coalesce(new.updated_at, now()), now());
  return new;
end $$;
