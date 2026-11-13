// 읽기 기록 (계정별, Supabase reading_state)
//   - 화면에서는 기기 캐시('cache:reading')를 바로 고치고
//   - 서버 저장은 보낼 목록('outbox:reading')에 모아 두었다가 묶어서 보냄
//     (오프라인이어도 기록이 사라지지 않음. 다시 연결되면 자동 전송)
import { supabase, isOffline } from './supabase.js';

const CACHE = 'cache:reading';
const OUTBOX = 'outbox:reading';

const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return {}; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
export const keyOf = (kind, id) => `${kind}:${id}`;

let state = read(CACHE);          // key → row
// 이 기기에서 쓴 기록 표시 (다른 기기에서 읽은 위치와 구분)
const mine = new Set(Object.values(read(OUTBOX)).map((r) => r.updated_at));
export const isMine = (row) => !!row && mine.has(row.updated_at);
let loadedAt = 0;
const listeners = new Set();
export const onReadingChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => { try { fn(); } catch {} });

export function getReading(kind, id) {
  return state[keyOf(kind, id)] || null;
}
export function allReading() { return state; }

// 소설 하나의 회차 기록들 (key → row)
export function novelReading(novelId) {
  const out = {};
  const prefix = `chapter:${novelId}/`;
  for (const [k, r] of Object.entries(state)) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = r;
  return out;
}

// 읽음 상태: 'read' | 'reading' | 'unread'
export function statusOf(row) {
  if (!row) return 'unread';
  if (row.finished_at) return 'read';
  if ((row.progress || 0) > 0.02 || row.anchor) return 'reading';
  return 'unread';
}

// 서버에서 내 기록 전체 받기 (보내지 못한 기록은 그대로 우선)
export async function loadReading({ force = false, maxAge = 60_000 } = {}) {
  if (!force && Date.now() - loadedAt < maxAge) return state;
  if (isOffline()) return state;
  // 소설 회차까지 합치면 1,000행(서버 1회 최대)을 넘을 수 있어 나눠서 받음
  const data = [];
  for (let from = 0; ; from += 1000) {
    const { data: part, error } = await supabase
      .from('reading_state')
      .select('item_kind,item_id,novel_id,anchor,progress,finished_at,updated_at')
      .order('item_kind').order('item_id')
      .range(from, from + 999);
    if (error) { if (!navigator.onLine) return state; throw error; }
    data.push(...part);
    if (part.length < 1000) break;
  }
  const pending = read(OUTBOX);
  const next = {};
  for (const r of data) next[keyOf(r.item_kind, r.item_id)] = r;
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
  mine.add(row.updated_at);
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
