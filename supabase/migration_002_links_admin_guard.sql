-- =====================================================================
-- migration_002
--   1) columns.links: 본문 속 naver.me 단축 링크 → 실제 주소 (업로드 스크립트가 채움)
--      서재 화면에서 자기 글 링크를 서재 안 링크로 바꾸는 데 사용
--   2) 관리자가 자기 자신을 차단/대기로 바꾸지 못하게
--   다시 실행해도 안전.
-- =====================================================================

alter table public.columns
  add column if not exists links jsonb not null default '{}'::jsonb;

create or replace function public.admin_set_status(p_user uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  if p_status not in ('pending', 'approved', 'blocked') then raise exception 'INVALID_STATUS'; end if;
  if p_user = auth.uid() and p_status <> 'approved' then raise exception 'CANNOT_CHANGE_SELF'; end if;
  update profiles
     set status      = p_status,
         note        = coalesce(p_note, note),
         approved_at = case when p_status = 'approved' then now() else approved_at end,
         approved_by = case when p_status = 'approved' then auth.uid() else approved_by end
   where user_id = p_user;
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

revoke execute on function public.admin_set_status(uuid, text, text) from public, anon;
grant  execute on function public.admin_set_status(uuid, text, text) to authenticated;
