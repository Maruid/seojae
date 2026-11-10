// 읽기 기록 (계정별, Supabase reading_state)
//   - 화면에서는 기기 캐시('cache:reading')를 바로 고치고
//   - 서버 저장은 보낼 목록('outbox:reading')에 모아 두었다가 묶어서 보냄
//     (오프라인이어도 기록이 사라지지 않음. 다시 연결되면 자동 전송)
import { supabase } from './supabase.js';

const CACHE = 'cache:reading';
const OUTBOX = 'outbox:reading';

const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return {}; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
export const keyOf = (kind, id) => `${kind}:${id}`;

let state = read(CACHE);          // key → row
let loadedAt = 0;
const listeners = new Set();
export const onReadingChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => { try { fn(); } catch {} });

export function getReading(kind, id) {
  return state[keyOf(kind, id)] || null;
}
export function allReading() { return state; }

// 읽음 상태: 'read' | 'reading' | 'unread'
export function statusOf(row) {
  if (!row) return 'unread';
  if (row.finished_at) return 'read';
  if ((row.progress || 0) > 0.02 || row.anchor) return 'reading';
  return 'unread';
}

// 서버에서 내 기록 전체 받기 (보내지 못한 기록은 그대로 우선)
export async function loadReading({ force = false } = {}) {
  if (!force && Date.now() - loadedAt < 60_000) return state;
  const { data, error } = await supabase
    .from('reading_state')
    .select('item_kind,item_id,novel_id,anchor,progress,finished_at,updated_at');
  if (error) { if (!navigator.onLine) return state; throw error; }
  const pending = read(OUTBOX);
  const next = {};
  for (const r of data || []) next[keyOf(r.item_kind, r.item_id)] = r;
  for (const [k, r] of Object.entries(pending)) next[k] = { ...next[k], ...r };
  state = next;
  loadedAt = Date.now();
  write(CACHE, state);
  emit();
  return state;
}

/**
 * 기록 고치기. patch: { anchor, progress, finished_at, novel_id }
 *   finished_at: true → 지금 시각, null → 안 읽음으로
 */
export function saveReading(kind, id, patch) {
  const k = keyOf(kind, id);
  const prev = state[k] || { item_kind: kind, item_id: id, anchor: null, progress: 0, finished_at: null };
  const row = { ...prev, ...patch, item_kind: kind, item_id: id, updated_at: new Date().toISOString() };
  if (patch.finished_at === true) row.finished_at = prev.finished_at || row.updated_at;
  if (typeof row.progress === 'number') row.progress = Math.max(0, Math.min(1, Math.round(row.progress * 1000) / 1000));
  state = { ...state, [k]: row };
  write(CACHE, state);
  const box = read(OUTBOX);
  box[k] = row;
  write(OUTBOX, box);
  emit();
  scheduleFlush();
  return row;
}

let timer = null;
function scheduleFlush(ms = 4000) {
  clearTimeout(timer);
  timer = setTimeout(flushReading, ms);
}

let flushing = null;
export async function flushReading() {
  if (flushing) return flushing;
  const box = read(OUTBOX);
  const rows = Object.values(box);
  if (!rows.length || !navigator.onLine) return;
  flushing = (async () => {
    const { data: s } = await supabase.auth.getSession();
    const uid = s?.session?.user?.id;
    if (!uid) return;
    const payload = rows.map((r) => ({
      user_id: uid, item_kind: r.item_kind, item_id: r.item_id, novel_id: r.novel_id ?? null,
      anchor: r.anchor ?? null, progress: r.progress ?? 0, finished_at: r.finished_at ?? null, updated_at: r.updated_at,
    }));
    const { error } = await supabase.from('reading_state').upsert(payload, { onConflict: 'user_id,item_kind,item_id' });
    if (error) { scheduleFlush(30_000); return; }
    // 보내는 사이 새로 바뀐 건 남겨 둠
    const now = read(OUTBOX);
    for (const r of rows) {
      const k = keyOf(r.item_kind, r.item_id);
      if (now[k]?.updated_at === r.updated_at) delete now[k];
    }
    write(OUTBOX, now);
  })().finally(() => { flushing = null; });
  return flushing;
}

export function startReadingSync() {
  window.addEventListener('online', () => flushReading());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushReading(); });
  window.addEventListener('pagehide', () => flushReading());
  setInterval(() => flushReading(), 30_000);
  flushReading();
}

// 로그아웃 시 메모리 상태도 비움 (localStorage 는 clearPrivateData 가 지움)
export function resetReading() { state = {}; loadedAt = 0; }
