// 소설 "이어 읽기" 대상 (홈 · 소설 목록 공용)
//   - 그 소설에서 가장 최근에 연 회차 기록을 봄
//   - 아직 다 안 읽었으면 그 회차의 읽던 위치로, 다 읽었으면 그다음 회차의 처음으로
//   - 다음 회차가 없으면(마지막 화까지 다 읽음) done → 홈에서 뺌. 새 회차가 올라오면 다음 회차가 생겨 다시 나옴
//   - 회차 목록 전체(수천 행)를 받지 않고, 필요한 회차 한두 줄만 물어봄. 결과는 기기에 기억(기록이 바뀌면 다시)
import { supabase, isOffline } from './supabase.js';
import { novelReading, statusOf } from './progress.js';
import { cachedChapters, countNewSince } from './novels.js';
import { lastOpened } from './novelText.js';

const KEY = 'cache:cont';
let memo = null;
const load = () => { if (!memo) { try { memo = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { memo = {}; } } return memo; };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(memo)); } catch {} };

// 가장 최근에 연 회차 기록 { key, r }
export function latestOf(nid) {
  let best = null;
  for (const [key, r] of Object.entries(novelReading(nid))) {
    if (!best || String(r.updated_at) > String(best.r.updated_at)) best = { key, r };
  }
  return best;
}

const stampOf = (n, b) => `${b.key}|${b.r.updated_at}|${b.r.finished_at || ''}|${n.last_added_at || ''}|${n.chapter_count}`;
const COLS = 'key,seq,title,display_title';

// 기억해 둔 결과 (없거나 기록이 바뀌었으면 null)
export function contCached(n) {
  const b = latestOf(n.id);
  if (!b) return null;
  const m = load()[n.id];
  return m && m.stamp === stampOf(n, b) ? m.val : null;
}

/**
 * 이어 읽을 곳: { chapter: {key,seq,title,display_title}, progress, fresh(다음 화 처음부터), done, newCount }
 * 읽은 기록이 없으면 null
 */
export async function resolveCont(n) {
  const b = latestOf(n.id);
  if (!b) return null;
  const hit = contCached(n);
  if (hit) return hit;

  const list = cachedChapters(n.id);
  let cur = list?.find((c) => c.key === b.key) || null;
  if (isOffline() && (!list || !cur)) return null;   // 오프라인: 기기에 목록이 없으면 다음에
  let val;
  if (statusOf(b.r) !== 'read') {
    if (!cur) {
      const { data } = await supabase.from('novel_chapters').select(COLS).eq('novel_id', n.id).eq('key', b.key).maybeSingle();
      cur = data;
    }
    val = cur ? { chapter: cur, progress: b.r.progress || 0, fresh: false, done: false } : null;
  } else {
    // 다 읽은 회차 → 다음 회차 (목록에 있으면 목록에서, 없으면 서버에 한 줄만)
    let next = null;
    if (list && cur) next = list[list.indexOf(cur) + 1] || null;
    if (!next && isOffline()) return null;
    if (!next) {
      if (!cur) {
        const { data } = await supabase.from('novel_chapters').select(COLS).eq('novel_id', n.id).eq('key', b.key).maybeSingle();
        cur = data;
      }
      if (cur) {
        const { data } = await supabase.from('novel_chapters').select(COLS).eq('novel_id', n.id)
          .gt('seq', cur.seq).order('seq').limit(1);
        next = data?.[0] || null;
      }
    }
    val = next ? { chapter: next, progress: 0, fresh: true, done: false } : { chapter: cur, progress: 1, fresh: false, done: true };
  }
  if (!val?.chapter) return null;
  // 마지막으로 연 뒤 새로 올라온 회차 수
  const since = lastOpened(novelReading(n.id));
  val.newCount = since && n.last_added_at && n.last_added_at > since ? await countNewSince(n.id, since).catch(() => 0) : 0;
  load()[n.id] = { stamp: stampOf(n, b), val };
  save();
  return val;
}
