// 소설 목록 · 회차 목록 · 회차 본문 불러오기
import { supabase, isOffline, offlineError } from './supabase.js';
import { STORAGE_BUCKET } from '../config.js';
import { savedChapterText, replaceChapter } from './offline/index.js';
import { getItem, objectKey, fromViewed } from './offline/store.js';

const LIST_KEY = 'list:novels';
const chKey = (id) => `list:novel:${id}`;
const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

let novels = null;
let novelsAt = 0;
export const cachedNovels = () => novels || (novels = read(LIST_KEY));
export const novelById = (id) => (cachedNovels() || []).find((n) => n.id === id) || null;

export async function loadNovels({ force = false } = {}) {
  if (!force && novels && Date.now() - novelsAt < 120_000) return novels;
  if (isOffline()) { if (cachedNovels()) return novels; throw offlineError(); }
  const q = (cols) => supabase.from('novels').select(cols).order('last_added_at', { ascending: false, nullsFirst: false });
  // 마이그레이션이 덜 됐으면(칸 없음 42703) 있는 칸만으로라도 목록은 보이게: 006(큰 표지) → 004(장르 목록·표지) → 003(작가·장르·태그) → 기본
  let { data, error } = await q('id,title,author,genre,genres,tags,cover_path,cover_large_path,chapter_count,last_added_at,key_mode,updated_at');
  if (error?.code === '42703') ({ data, error } = await q('id,title,author,genre,genres,tags,cover_path,chapter_count,last_added_at,key_mode,updated_at'));
  if (error?.code === '42703') ({ data, error } = await q('id,title,author,genre,tags,chapter_count,last_added_at,key_mode,updated_at'));
  if (error?.code === '42703') ({ data, error } = await q('id,title,chapter_count,last_added_at,key_mode,updated_at'));
  if (error) { if (cachedNovels()) return novels; throw error; }
  novels = data;
  novelsAt = Date.now();
  write(LIST_KEY, data);
  return novels;
}

// 회차 목록 (seq 순서). 887화 같은 긴 소설도 1,000개씩 나눠 받음
const chapters = new Map();   // id → { at, list }
const BASE_COLS = 'key,seq,title,display_title,char_count,added_at,path,content_hash';
let sizeCols = true;
export const cachedChapters = (id) => chapters.get(id)?.list || read(chKey(id))?.map((c) => ({ ...c, novel_id: id })) || null;

export async function loadChapters(id, { force = false } = {}) {
  const c = chapters.get(id);
  if (!force && c && Date.now() - c.at < 120_000) return c.list;
  if (isOffline()) {
    const old = cachedChapters(id) || (await getItem(`n:${id}`))?.chapters?.map((x) => ({ ...x, novel_id: id }));
    if (old) return old;
    throw offlineError();
  }
  const list = [];
  // 008(크기 칸) 전이면 size_bytes 없이
  let cols = sizeCols ? `${BASE_COLS},size_bytes` : BASE_COLS;
  for (let from = 0; ; from += 1000) {
    let { data, error } = await supabase.from('novel_chapters').select(cols)
      .eq('novel_id', id).order('seq').range(from, from + 999);
    if (error?.code === '42703' && cols !== BASE_COLS) {
      sizeCols = false; cols = BASE_COLS;
      ({ data, error } = await supabase.from('novel_chapters').select(cols).eq('novel_id', id).order('seq').range(from, from + 999));
    }
    if (error) {
      const old = cachedChapters(id) || (await getItem(`n:${id}`))?.chapters;   // 오프라인: 기기 목록 → 받아 둔 소설 목록
      if (old) return old.map((c) => ({ ...c, novel_id: id }));
      throw error;
    }
    list.push(...data.map((c) => ({ ...c, novel_id: id })));
    if (data.length < 1000) break;
  }
  chapters.set(id, { at: Date.now(), list });
  write(chKey(id), list.map(({ novel_id, ...c }) => c));
  return list;
}

// 새 회차 수 (그 소설을 마지막으로 연 뒤 추가된 회차)
export async function countNewSince(id, since) {
  if (isOffline()) return null;
  const { count, error } = await supabase.from('novel_chapters')
    .select('key', { count: 'exact', head: true }).eq('novel_id', id).gt('added_at', since);
  if (error) return null;
  return count;
}

// 회차 본문: 메모리 캐시 (다음 회차 미리 받기에도 사용)
const texts = new Map();
const pending = new Map();
//   받아 둔 회차는 저장본이 최신이면 그걸 바로 씀. 바뀐 회차를 온라인에서 열면 서버에서 받아 저장본도 바꿔 넣음 (한도 안 씀)
export function fetchChapterText(ch) {
  if (texts.has(ch.path)) return Promise.resolve(texts.get(ch.path));
  if (pending.has(ch.path)) return pending.get(ch.path);
  const job = (async () => {
    const saved = await savedChapterText(ch).catch(() => null);
    if (saved?.text != null) return saved.text;
    if (isOffline()) {
      // 오프라인: 열어 본 글 저장 공간에서 바로 (서버를 부르면 토큰 갱신을 기다리느라 오래 걸림)
      const hit = await fromViewed(objectKey(ch.path)).catch(() => null);
      if (hit) return hit.text();
      throw offlineError();
    }
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(ch.path);
    if (error) {
      // 서버에 못 닿으면 옛 저장본이라도
      const old = saved?.stale ? await savedChapterText({ ...ch, content_hash: null }).catch(() => null) : null;
      if (old?.text != null) return old.text;
      throw error;
    }
    const text = await data.text();
    if (saved?.stale) replaceChapter(ch, text).catch(() => {});
    return text;
  })().then((t) => {
    texts.set(ch.path, t);
    if (texts.size > 12) texts.delete(texts.keys().next().value);
    return t;
  }).finally(() => pending.delete(ch.path));
  pending.set(ch.path, job);
  return job;
}
export const prefetchChapter = (ch) => { if (ch) fetchChapterText(ch).catch(() => {}); };

// 회차 정렬 (회차 목록 화면과 읽기 화면의 회차 패널이 같은 설정을 씀, 소설별·기기별)
export function chapterSortDesc(id) { try { return localStorage.getItem(`ui:nvSort:${id}`) === 'desc'; } catch { return false; } }
export function setChapterSortDesc(id, desc) { try { localStorage.setItem(`ui:nvSort:${id}`, desc ? 'desc' : 'asc'); } catch {} }
