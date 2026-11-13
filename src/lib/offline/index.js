// 오프라인 보관함: 화면에서 쓰는 기능 모음
//   - 받은 것 조회 · 지우기 · 서버와 비교 · 읽을 때 저장본 쓰기
//   - reconcile(): 온라인일 때 한 번씩 → 권한 확인, 서버에서 내려간 것 지우기, 사라진 회차 지우기,
//                  바뀐 회차·다시 나뉜 소설은 한도 안에서 자동으로 받기(모바일 데이터면 미룸)
import { objectKey, signKey, getItem, putItems, deleteItems, itemsOfKind, itemsOfNovel, deleteFiles, getFile, putFile,
  addNotice, markOnline, lastOnline, kvGet } from './store.js';
import { diffChapters, resplitRange, chapterBytes, isLockedAt } from './plan.js';
import { loadQuota, room, cachedQuota } from './quota.js';
import { downloadNovels, downloadColumns, currentJob } from './engine.js';

const subs = new Set();
export const onSaved = (f) => { subs.add(f); return () => subs.delete(f); };
export const changedSaved = () => subs.forEach((f) => { try { f(); } catch {} });

// ---- 조회 ----
const memo = { novels: null, columns: null };   // 화면에서 바로 쓰는 요약 (id → …)
export async function refreshIndex() {
  const [novels, chapters, columns] = await Promise.all([itemsOfKind('novel'), itemsOfKind('chapter'), itemsOfKind('column')]);
  const byNovel = new Map();
  for (const c of chapters) {
    if (!byNovel.has(c.novelId)) byNovel.set(c.novelId, new Map());
    byNovel.get(c.novelId).set(c.key, c);
  }
  memo.novels = new Map(novels.map((n) => {
    const saved = byNovel.get(n.novelId) || new Map();
    let bytes = 0; for (const c of saved.values()) bytes += c.bytes || 0;
    return [n.novelId, { rec: n, saved, bytes }];
  }));
  memo.columns = new Map(columns.map((c) => [c.colId, c]));
  changedSaved();
  return memo;
}
export const savedNovelsNow = () => memo.novels || new Map();
export const savedColumnsNow = () => memo.columns || new Map();
export const isNovelSaved = (id) => !!memo.novels?.get(id)?.saved.size;
export const savedKeysOf = (id) => memo.novels?.get(id)?.saved || new Map();
export const isColumnSaved = (id) => !!memo.columns?.has(id);

// 회차 목록과 비교한 상태 (화면 표시용)
export function novelDiff(id, server) {
  const s = memo.novels?.get(id);
  if (!s || !server) return { fresh: [], changed: [], gone: [], resplit: false };
  return diffChapters(server, s.saved, new Set(s.rec.knownKeys || []));
}

// ---- 읽기: 저장본이 최신이면 그걸, 아니면 서버에서 받아 저장본도 바꿔 넣음 (한도 안 씀) ----
export async function savedChapterText(ch) {
  if (!ch?.novel_id) return null;
  const r = await getItem(`c:${ch.novel_id}/${ch.key}`);
  if (!r) return null;
  const same = !ch.content_hash || !r.hash || r.hash === ch.content_hash;
  if (!same && navigator.onLine) return { rec: r, stale: true };
  const f = await getFile(objectKey(r.path)).catch(() => null);
  return f ? { rec: r, text: await f.text() } : null;
}
export async function replaceChapter(ch, text) {
  const r = await getItem(`c:${ch.novel_id}/${ch.key}`);
  if (!r) return;
  await putFile(objectKey(ch.path), text, 'text/plain; charset=utf-8');
  if (r.path !== ch.path) await deleteFiles([objectKey(r.path)]);
  await putItems([{ ...r, path: ch.path, hash: ch.content_hash || r.hash, bytes: new Blob([text]).size, savedAt: Date.now() }]);
  refreshIndex();
}
export async function savedColumnMd(col) {
  const r = await getItem(`col:${col.id}`);
  if (!r) return null;
  const same = !col.content_hash || !r.hash || r.hash === col.content_hash;
  if (!same && navigator.onLine) return { rec: r, stale: true };
  const f = await getFile(objectKey(r.md_path)).catch(() => null);
  return f ? { rec: r, text: await f.text() } : null;
}
export async function replaceColumnMd(col, text) {
  const r = await getItem(`col:${col.id}`);
  if (!r) return;
  await putFile(objectKey(col.md_path), text, 'text/markdown; charset=utf-8');
  await putItems([{ ...r, hash: col.content_hash || r.hash, mdBytes: new Blob([text]).size, savedAt: Date.now() }]);
}
// 저장해 둔 이미지 → blob 주소 (없으면 null)
const blobUrls = new Map();
export async function savedImageUrl(path) {
  if (blobUrls.has(path)) return blobUrls.get(path);
  const f = await getFile(signKey(path)).catch(() => null);
  if (!f) return null;
  const u = URL.createObjectURL(await f.blob());
  blobUrls.set(path, u);
  return u;
}

// ---- 지우기 ----
export async function deleteChapters(novelId, keys) {
  const recs = (await Promise.all(keys.map((k) => getItem(`c:${novelId}/${k}`)))).filter(Boolean);
  await deleteFiles(recs.map((r) => objectKey(r.path)));
  await deleteItems(recs.map((r) => r.id));
}
export async function deleteNovel(novelId) {
  const recs = await itemsOfNovel(novelId);
  const novel = await getItem(`n:${novelId}`);
  await deleteFiles(recs.filter((r) => r.kind === 'chapter').map((r) => objectKey(r.path)));
  if (novel?.meta?.cover_path) await deleteFiles([signKey(novel.meta.cover_path)]);
  await deleteItems([...recs.map((r) => r.id), `n:${novelId}`]);
  await refreshIndex();
}
export async function deleteColumns(ids) {
  const all = await itemsOfKind('column');
  const drop = all.filter((c) => ids.includes(c.colId));
  const keepImgs = new Set(all.filter((c) => !ids.includes(c.colId)).flatMap((c) => c.images || []));
  const files = [];
  for (const c of drop) {
    files.push(objectKey(c.md_path));
    for (const p of c.images || []) if (!keepImgs.has(p)) files.push(signKey(p));
  }
  await deleteFiles(files);
  await deleteItems(drop.map((c) => c.id));
  await refreshIndex();
}
export async function setStar(novelId, star) {
  const r = await getItem(`n:${novelId}`);
  if (r) { r.star = !!star; await putItems([r]); await refreshIndex(); }
}

// ---- 30일 잠금 ----
let lockedMemo = false;
export async function checkLock(online) {
  if (online) { await markOnline(); lockedMemo = false; return false; }
  lockedMemo = isLockedAt(await lastOnline());
  return lockedMemo;
}
export const isLocked = () => lockedMemo;
export const lastOnlineAt = () => lastOnline();

// ---- 모바일 데이터 여부 (알 수 있을 때만) ----
export const onCellular = () => {
  const c = typeof navigator !== 'undefined' ? navigator.connection : null;
  return !!c && (c.type === 'cellular' || (c.type === undefined && c.saveData === true));
};

// ---- 서버와 맞추기 (온라인일 때 앱 시작 후 한 번, 관리 창을 열 때) ----
let reconciling = null;
export function reconcile(ctx) {
  if (!reconciling) reconciling = doReconcile(ctx).finally(() => { reconciling = null; });
  return reconciling;
}
async function doReconcile({ canNovel, canColumn, loadNovels, loadChapters, loadColumns, auto = true }) {
  if (!navigator.onLine) return null;
  await refreshIndex();
  const out = { autoKeys: 0, pending: 0 };
  const novels = await itemsOfKind('novel');
  const cols = await itemsOfKind('column');

  // 권한이 없어졌으면 그 구역 받은 것 모두 지움
  if (!canNovel && novels.length) { for (const n of novels) await deleteNovel(n.novelId); await addNotice('소설 열람 권한이 없어져 받아 둔 소설을 지웠어요.'); }
  if (!canColumn && cols.length) { await deleteColumns(cols.map((c) => c.colId)); await addNotice('칼럼 열람 권한이 없어져 받아 둔 칼럼을 지웠어요.'); }

  const plans = [];
  if (canNovel && novels.length) {
    const list = await loadNovels({ force: true }).catch(() => null);
    if (list) {
      const ids = new Set(list.map((n) => n.id));
      for (const n of novels) {
        if (!ids.has(n.novelId)) { await deleteNovel(n.novelId); await addNotice(`서버에서 내려간 소설 「${n.meta?.title || n.novelId}」을 지웠어요.`); continue; }
        const server = await loadChapters(n.novelId, { force: true }).catch(() => null);
        if (!server) continue;
        const saved = memo.novels?.get(n.novelId)?.saved || new Map();
        const d = diffChapters(server, saved, new Set(n.knownKeys || []));
        const meta = list.find((x) => x.id === n.novelId);
        if (d.resplit) {
          // 다시 나뉨: 예전 범위를 새 목록에서 비슷하게 → 다 받으면 옛 회차 지움
          const oldList = n.chapters || [];
          const oldIdx = [...saved.keys()].map((k) => oldList.findIndex((c) => c.key === k)).filter((x) => x >= 0);
          const keys = resplitRange({ oldTotal: oldList.length, oldIdx }, server);
          await putItems([{ ...n, resplit: true, meta: meta || n.meta }]);
          plans.push({ novel: meta || n.meta, chapters: server, keys, resplit: true, old: [...saved.keys()].filter((k) => !server.some((c) => c.key === k)) });
          continue;
        }
        if (d.gone.length) await deleteChapters(n.novelId, d.gone);
        await putItems([{ ...n, meta: meta || n.meta, chapters: server }]);
        if (d.changed.length) plans.push({ novel: meta || n.meta, chapters: server, keys: d.changed });
      }
    }
  }
  const colPlans = [];
  if (canColumn && cols.length) {
    const list = await loadColumns({ force: true }).catch(() => null);
    if (list) {
      const byId = new Map(list.map((c) => [c.id, c]));
      const gone = cols.filter((c) => !byId.has(c.colId));
      if (gone.length) { await deleteColumns(gone.map((c) => c.colId)); await addNotice(`서버에서 내려간 칼럼 ${gone.length}개를 지웠어요.`); }
      for (const c of cols) {
        const s = byId.get(c.colId);
        if (s && s.content_hash && c.hash && s.content_hash !== c.hash) colPlans.push({ col: s, textOnly: c.textOnly });
      }
    }
  }
  await refreshIndex();

  // 자동 받기: 바뀐 회차·다시 나뉜 회차만, 한도 안에서, 모바일 데이터가 아닐 때
  const total = plans.reduce((s, p) => s + p.keys.length, 0) + colPlans.length;
  if (!auto || !total || currentJob()) { out.pending = total; return out; }
  if (onCellular()) { out.pending = total; return out; }
  const q = await loadQuota().catch(() => cachedQuota());
  if (!q) { out.pending = total; return out; }
  let left = room();
  const fit = [];
  for (const p of plans) {
    const keys = [];
    for (const k of p.keys) {
      const c = p.chapters.find((x) => x.key === k);
      const b = chapterBytes(c).bytes;
      if (b > left) break;
      keys.push(k); left -= b;
    }
    if (keys.length) fit.push({ ...p, keys });
    out.pending += p.keys.length - keys.length;
  }
  if (fit.length) {
    const r = await downloadNovels(fit, '바뀐 회차 받는 중');
    out.autoKeys = r.done;
    // 다시 나뉜 소설: 새 범위를 다 받았으면 옛 회차 지우고 표시 해제
    for (const p of fit.filter((x) => x.resplit)) {
      if (p.keys.length === plans.find((x) => x.novel?.id === p.novel?.id)?.keys.length && !r.rest) {
        await deleteChapters(p.novel.id, p.old);
        const n = await getItem(`n:${p.novel.id}`);
        if (n) await putItems([{ ...n, resplit: false }]);
      }
    }
  }
  if (colPlans.length && left > 0) await downloadColumns(colPlans, '바뀐 칼럼 받는 중').catch(() => null);
  await refreshIndex();
  return out;
}

export { kvGet };
