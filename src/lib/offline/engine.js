// 받기 엔진
//   - 4개씩 동시에 받고 실패하면 3번까지 다시 시도
//   - 열어 본 글 저장 공간에 이미 있으면 옮겨 담기만 (서버 전송 없음 → 한도 안 씀)
//   - 서버에서 받은 바이트는 1MB 마다 모아서 기록 → 한도에 닿으면 거기서 멈춤
//   - 받는 동안 화면 켜짐 유지, 받다 만 작업은 job 으로 남겨 다음에 이어 받기
//   - 서비스 워커는 cache: 'no-store' 요청을 건드리지 않음 → 열어 본 글 저장 공간이 밀려나지 않음
import { supabase } from '../supabase.js';
import { SUPABASE_KEY, STORAGE_BUCKET } from '../../config.js';
import { imagePath } from '../md.js';
import { wantAwake } from '../wakeLock.js';
import { objectKey, signKey, putFile, getItem, putItems, deleteFiles, fromViewed, hasFile, kvSet, kvGet } from './store.js';
import { addUsage, cachedQuota, room } from './quota.js';

const FLUSH = 1048576;
const TEXT = 'text/plain; charset=utf-8';

let running = null;   // 지금 하는 작업 { label, done, total, bytes, cancel() }
const subs = new Set();
export const currentJob = () => running;
export const onJob = (f) => { subs.add(f); return () => subs.delete(f); };
const emit = () => subs.forEach((f) => { try { f(running); } catch {} });

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  return { apikey: SUPABASE_KEY, ...(t ? { authorization: `Bearer ${t}` } : {}) };
}

async function fetchRetry(url, init, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...init, cache: 'no-store' });
      if (r.ok) return r;
      if (r.status === 400 || r.status === 401 || r.status === 403 || r.status === 404) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
      last = new Error(`HTTP ${r.status}`);
    } catch (e) { last = e; if (e.status) throw e; }
    await new Promise((res) => setTimeout(res, 600 * (i + 1)));
  }
  throw last;
}

async function signMany(paths) {
  const out = {};
  for (let i = 0; i < paths.length; i += 100) {
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrls(paths.slice(i, i + 100), 3600);
    if (error) throw error;
    for (const d of data || []) if (d.signedUrl) out[d.path] = d.signedUrl;
  }
  return out;
}

/**
 * 할 일 목록을 받음
 *   tasks: [{ id, kind: 'object' | 'signed', path, fresh?: true(바뀐 것: 열어 본 저장본 안 씀), type?, after?(res) → 기록 }]
 *   label: 진행 창에 보일 이름
 */
async function runTasks(tasks, label, { resumeKey = null } = {}) {
  if (running) throw new Error('BUSY');
  const job = { label, done: 0, total: tasks.length, bytes: 0, net: 0, stopped: null, failed: 0, cancelled: false };
  job.cancel = () => { job.cancelled = true; };
  running = job; emit();
  wantAwake('download', true);
  if (resumeKey !== false) await kvSet('job', { label, tasks: tasks.map(({ after, ...t }) => t), at: Date.now() });

  const headers = await authHeaders();
  let pendingBytes = 0;
  const flush = async () => {
    if (!pendingBytes) return;
    const b = pendingBytes; pendingBytes = 0;
    try { await addUsage(b); } catch { pendingBytes += b; }
    const q = cachedQuota();
    if (q && !q.unlimited && room() <= 0) job.stopped = 'quota';
  };
  const signed = {};
  const signedNeed = tasks.filter((t) => t.kind === 'signed').map((t) => t.path);
  try { if (signedNeed.length) Object.assign(signed, await signMany([...new Set(signedNeed)])); } catch {}

  let i = 0;
  const left = new Set(tasks.map((_, n) => n));
  const worker = async () => {
    while (!job.cancelled && !job.stopped && i < tasks.length) {
      const n = i++;
      const t = tasks[n];
      try {
        const key = t.kind === 'signed' ? signKey(t.path) : objectKey(t.path);
        let body = null; let fromNet = false;
        if (!t.fresh) {
          const hit = await fromViewed(key);
          if (hit) body = await hit.blob();
        }
        if (!body && t.kind === 'signed' && !t.fresh && await hasFile(key)) body = 'skip';
        if (!body) {
          const url = t.kind === 'signed' ? signed[t.path] : key;
          if (!url) throw new Error('no url');
          const r = await fetchRetry(url, t.kind === 'signed' ? {} : { headers });
          body = await r.blob(); fromNet = true;
        }
        let size = 0;
        if (body !== 'skip') {
          size = body.size;
          await putFile(key, body, t.type || body.type || TEXT);
        }
        if (fromNet) { job.net += size; pendingBytes += size; }
        job.bytes += size;
        if (t.after) await t.after({ size, key });
        left.delete(n);
        job.done++;
        if (pendingBytes >= FLUSH) await flush();
      } catch (e) {
        job.failed++;
        if (e?.status === 401 || e?.status === 403) job.stopped = 'auth';
      }
      emit();
      if (resumeKey !== false && job.done % 10 === 0) await kvSet('job', { label, tasks: [...left].map((x) => { const { after, ...r } = tasks[x]; return r; }), at: Date.now() });
    }
  };
  try {
    await Promise.all([worker(), worker(), worker(), worker()]);
    await flush();
  } finally {
    wantAwake('download', false);
    const rest = [...left].map((x) => { const { after, ...r } = tasks[x]; return r; });
    if (resumeKey !== false) {
      // 취소했거나 한도에 닿았으면 이어 받기로 남기지 않음, 끊긴 경우(실패·화면 닫힘)만 남김
      if (!rest.length || job.cancelled || job.stopped === 'quota') await kvSet('job', undefined);
      else await kvSet('job', { label, tasks: rest, at: Date.now() });
    }
    running = null; emit();
  }
  return { ...job, rest: [...left].length };
}

// ---------------------------------------------------------------------
// 소설
// ---------------------------------------------------------------------
/**
 * plans: [{ novel, chapters(서버 목록), keys: [받을 key…] }]
 */
export async function downloadNovels(plans, label) {
  const tasks = [];
  const now = Date.now();
  for (const { novel, chapters, keys } of plans) {
    const rec = (await getItem(`n:${novel.id}`)) || { id: `n:${novel.id}`, kind: 'novel', novelId: novel.id, star: false, savedAt: now };
    Object.assign(rec, { meta: novel, chapters, knownKeys: chapters.map((c) => c.key), syncedAt: now, resplit: false });
    await putItems([rec]);
    const byKey = new Map(chapters.map((c) => [c.key, c]));
    const olds = new Map((await Promise.all(keys.map((k) => getItem(`c:${novel.id}/${k}`)))).filter(Boolean).map((r) => [r.key, r]));
    if (novel.cover_path && !(await hasFile(signKey(novel.cover_path)))) {
      tasks.push({ kind: 'signed', path: novel.cover_path, type: 'image/webp', novelId: novel.id });
    }
    for (const k of keys) {
      const c = byKey.get(k);
      if (!c) continue;
      const old = olds.get(k);
      const fresh = !!old && old.hash !== c.content_hash;
      tasks.push({ kind: 'object', path: c.path, novelId: novel.id, key: k, hash: c.content_hash || null, fresh, oldPath: old && old.path !== c.path ? old.path : null });
    }
  }
  return runTasks(withAfter(tasks), label);
}

function withAfter(tasks) {
  return tasks.map((t) => {
    if (t.key) {
      t.after = async ({ size }) => {
        await putItems([{ id: `c:${t.novelId}/${t.key}`, kind: 'chapter', novelId: t.novelId, key: t.key, path: t.path, hash: t.hash, bytes: size, savedAt: Date.now() }]);
        if (t.oldPath) await deleteFiles([objectKey(t.oldPath)]);
      };
    } else if (t.colId) {
      t.after = async ({ size }) => {
        const r = await getItem(`col:${t.colId}`);
        if (!r) return;
        if (t.part === 'md') { r.hash = t.hash; r.mdBytes = size; } else { r.imgBytes = (r.imgBytes || 0) + size; r.imagesDone = [...new Set([...(r.imagesDone || []), t.path])]; }
        r.bytes = (r.mdBytes || 0) + (r.imgBytes || 0);
        await putItems([r]);
      };
    }
    return t;
  });
}

// ---------------------------------------------------------------------
// 칼럼
// ---------------------------------------------------------------------
export function imagesInMd(md) {
  const out = new Set();
  for (const m of String(md || '').matchAll(/(?:\.\/)?images\/[^"'()\s<>?#]+/g)) {
    const p = imagePath(m[0]);
    if (p) out.add(p);
  }
  return [...out];
}

/**
 * plans: [{ col, textOnly }]
 *   md 를 먼저 받아 이미지 목록을 알아낸 뒤 이미지를 받음
 */
export async function downloadColumns(plans, label) {
  const now = Date.now();
  const mdTasks = [];
  for (const { col, textOnly } of plans) {
    const old = await getItem(`col:${col.id}`);
    await putItems([{ ...(old || {}), id: `col:${col.id}`, kind: 'column', colId: col.id, meta: col, md_path: col.md_path, textOnly: !!textOnly,
      images: old?.images || [], imagesDone: textOnly ? [] : old?.imagesDone || [], imgBytes: textOnly ? 0 : old?.imgBytes || 0, savedAt: old?.savedAt || now }]);
    mdTasks.push({ kind: 'object', path: col.md_path, colId: col.id, part: 'md', hash: col.content_hash || null, fresh: !!old && old.hash !== (col.content_hash || null), type: 'text/markdown; charset=utf-8' });
  }
  const r1 = await runTasks(withAfter(mdTasks), label, { resumeKey: false });
  if (r1.cancelled || r1.stopped) return r1;
  // 이미지
  const imgTasks = [];
  for (const { col, textOnly } of plans) {
    const rec = await getItem(`col:${col.id}`);
    if (!rec) continue;
    const md = await (await (await caches.open('seojae-content-dl')).match(objectKey(col.md_path)))?.text();
    const imgs = imagesInMd(md);
    rec.images = imgs;
    await putItems([rec]);
    if (textOnly) continue;
    for (const p of imgs) if (!(await hasFile(signKey(p)))) imgTasks.push({ kind: 'signed', path: p, colId: col.id, part: 'img' });
  }
  if (!imgTasks.length) return r1;
  const r2 = await runTasks(withAfter(imgTasks), label, { resumeKey: false });
  return { ...r2, bytes: r1.bytes + r2.bytes, net: r1.net + r2.net, done: r1.done + r2.done, total: r1.total + r2.total, failed: r1.failed + r2.failed };
}

// ---------------------------------------------------------------------
// 받다 만 작업 이어 받기
// ---------------------------------------------------------------------
export const pendingJob = () => kvGet('job');
export const dropJob = () => kvSet('job', undefined);
export async function resumeJob() {
  const j = await kvGet('job');
  if (!j?.tasks?.length) return null;
  return runTasks(withAfter(j.tasks), j.label);
}
