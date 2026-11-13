// 다운로드 한도 (migration_009)
//   - 내 한도는 서버 함수로 받고 기기에 기억 (오프라인에서도 마지막 값 표시)
//   - 받은 양은 모아서 dl_add_usage 로 기록 → 기록 후 한도가 돌아옴
import { rpc, isOffline } from '../supabase.js';
import { roomOf } from './plan.js';

const KEY = 'cache:dlQuota';
let quota = (() => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } })();
let missing = false;   // 009 를 아직 안 돌린 DB
const subs = new Set();

const keep = (q) => {
  quota = q;
  try { localStorage.setItem(KEY, JSON.stringify(q)); } catch {}
  subs.forEach((f) => { try { f(q); } catch {} });
  return q;
};
const isMissing = (err) => /PGRST202|42883|Could not find the function/i.test(`${err?.code} ${err?.message}`);

export const cachedQuota = () => quota;
export const quotaMissing = () => missing;
export const onQuota = (f) => { subs.add(f); return () => subs.delete(f); };

export async function loadQuota() {
  if (isOffline()) return quota;
  try { missing = false; return keep(await rpc('dl_my_quota')); }
  catch (err) { if (isMissing(err)) { missing = true; return null; } throw err; }
}

export async function addUsage(bytes) {
  if (!bytes) return quota;
  try { return keep(await rpc('dl_add_usage', { p_bytes: Math.min(Math.round(bytes), 209715200) })); }
  catch (err) { if (isMissing(err)) { missing = true; return null; } throw err; }
}

export const room = () => roomOf(quota);

// 다시 채워지는 때 (한국 시간 표기)
export function resetText(q = quota) {
  if (!q?.period_end) return '';
  const d = new Date(q.period_end);
  const f = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', timeZone: 'Asia/Seoul' });
  return f.format(d);
}
