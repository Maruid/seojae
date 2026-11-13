// 받기 흐름: 확인(온라인·한도·모바일 데이터·기기 공간) → 받기 창 → 진행 창 → 결과
import { toast } from '../lib/dom.js';
import { loadChapters } from '../lib/novels.js';
import { novelReading, getReading, statusOf, loadReading } from '../lib/progress.js';
import { continueTarget, chapterTitleLine } from '../lib/novelText.js';
import { fmtBytes, chapterBytes, columnBytes, presetKeys, roomOf } from '../lib/offline/plan.js';
import { loadQuota, cachedQuota, quotaMissing, resetText } from '../lib/offline/quota.js';
import { downloadNovels, downloadColumns, currentJob, onJob, pendingJob, resumeJob, dropJob } from '../lib/offline/engine.js';
import { refreshIndex, savedNovelsNow, savedColumnsNow, novelDiff, onCellular } from '../lib/offline/index.js';
import { objectKey, CONTENT_CACHE } from '../lib/offline/store.js';
import { openDlSheet } from './dlSheet.js';
import { confirmBox, infoBox, progressBox } from './modal.js';

const NOVEL_PRESETS = [['all', '전체'], ['unread', '안 읽은 회차부터'], ['next', '다음 N화']];
const COLUMN_PRESETS = [['unread', '이 분류의 안 읽은 글'], ['recent', '최근 N개']];

async function viewedKeys() {
  try { return new Set((await (await caches.open(CONTENT_CACHE)).keys()).map((r) => r.url)); } catch { return new Set(); }
}

// 받기 전에: 온라인 · 한도 표 있음 · 한도 남음
async function ready() {
  if (currentJob()) { toast('지금 받는 중이에요. 끝난 뒤 다시 눌러 주세요.'); return null; }
  if (!navigator.onLine) { await infoBox({ title: '인터넷에 연결되어 있지 않아요', body: '받기는 연결된 상태에서만 할 수 있어요.' }); return null; }
  let q = null;
  try { q = await loadQuota(); } catch { q = cachedQuota(); }
  if (quotaMissing()) { await infoBox({ title: '다운로드 준비가 아직 안 됐어요', body: '관리자가 서버 설정(migration_009)을 마치면 받을 수 있어요.' }); return null; }
  if (!q) { toast('한도를 확인하지 못했어요. 잠시 후 다시 해 주세요.'); return null; }
  if (!q.unlimited && roomOf(q) <= 0) {
    await infoBox({ title: '이번 달 다운로드 한도를 다 썼어요',
      body: `${fmtBytes(q.limit)}를 모두 썼어요. ${resetText(q)}에 다시 채워져요. 더 필요하면 관리자에게 말해 주세요. 받아 둔 글은 계속 읽을 수 있어요.` });
    return null;
  }
  return q;
}

// 받기 직전에: 모바일 데이터 확인 · 기기 공간 확인 · 저장 공간 유지 요청
async function preflight(bytes, what) {
  if (onCellular()) {
    const ok = await confirmBox({ title: '와이파이가 아니에요', body: `모바일 데이터로 ${what} · 약 ${fmtBytes(bytes)}를 받을까요?`, ok: '받기' });
    if (!ok) return false;
  }
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.quota && est.quota - (est.usage || 0) < bytes * 1.2 + 5 * 1048576) {
      await infoBox({ title: '기기 공간이 부족해요', body: '휴대폰 저장 공간을 비우거나 받는 양을 줄여 주세요.' });
      return false;
    }
  } catch {}
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted?.())) await navigator.storage.persist(); } catch {}
  return true;
}

// 진행 창을 띄우고 일 → 결과 안내
async function withProgress(title, run) {
  let box = null;
  const off = onJob((j) => { if (j && box) box.update({ done: j.done, total: j.total, sub: `${fmtBytes(j.bytes)} · 앱을 닫으면 멈추고, 다음에 열 때 이어 받아요.` }); });
  box = progressBox({ title, onCancel: () => currentJob()?.cancel() });
  let r = null;
  try { r = await run(); }
  catch (e) { toast(e?.message === 'BUSY' ? '지금 받는 중이에요.' : '받다가 문제가 생겼어요.'); }
  finally { off(); box.close(); }
  await refreshIndex();
  if (!r) return r;
  if (r.stopped === 'quota') {
    await infoBox({ title: '이번 달 한도에 닿았어요', body: `${r.done}개까지 받고 멈췄어요. ${resetText()}에 다시 채워져요.` });
  } else if (r.stopped === 'auth') {
    await infoBox({ title: '받을 권한이 없어요', body: '다시 로그인하거나 관리자에게 권한을 확인해 주세요.' });
  } else if (r.cancelled) toast(`${r.done}개까지 받고 멈췄어요.`);
  else if (r.failed) toast(`${r.done}개 받음 · ${r.failed}개는 실패했어요. 관리 창에서 다시 받을 수 있어요.`);
  else toast(`${r.done}개 받았어요 · ${fmtBytes(r.bytes)}`);
  return r;
}

// ---------------------------------------------------------------------
// 소설
// ---------------------------------------------------------------------
async function novelGroup(novel, viewed) {
  const chapters = await loadChapters(novel.id);
  const rows = novelReading(novel.id);
  const cont = continueTarget(chapters, rows);
  const start = Math.max(0, cont ? chapters.findIndex((c) => c.key === cont.chapter.key) : 0);
  const saved = savedNovelsNow().get(novel.id);
  const have = new Set(saved ? saved.saved.keys() : []);
  const d = novelDiff(novel.id, chapters);
  const changed = new Set(d.changed);
  const fresh = new Set(d.fresh);
  const read = new Set(chapters.filter((c) => statusOf(rows[c.key]) === 'read').map((c) => c.key));
  // 이어 읽는 순서: 읽던 회차부터 끝까지, 그다음 앞쪽
  const fitOrder = [...chapters.slice(start), ...chapters.slice(0, start)].map((c) => c.key);
  const items = chapters.map((c) => {
    const { bytes, exact } = chapterBytes(c);
    const st = statusOf(rows[c.key]);
    return {
      key: c.key, label: chapterTitleLine(c), bytes, exact,
      zero: !changed.has(c.key) && !have.has(c.key) && viewed.has(objectKey(c.path)),
      sub: `${st === 'read' ? '다 읽음 · ' : st === 'reading' ? '읽는 중 · ' : ''}${fmtBytes(bytes)}`,
      badge: changed.has(c.key) ? ['바뀜', 'is-acc'] : have.has(c.key) ? ['받음', 'is-ok'] : fresh.has(c.key) ? ['새', 'is-new'] : null,
    };
  });
  // 목록은 1화부터 보여 주고, 용량 맞추기는 이어 읽는 위치부터
  return {
    id: novel.id, title: novel.title, star: !!saved?.rec?.star, novel, chapters,
    note: saved ? `받은 ${have.size}화` : '',
    items, fitOrder,
    preset: (mode, n, skip) => presetKeys({ chapters, start, have, changed, read, mode, n, skipRead: skip }),
  };
}

function sumBytes(groups, plans) {
  let b = 0;
  for (const p of plans) {
    const g = groups.find((x) => x.id === p.novel.id);
    const m = new Map(g.items.map((it) => [it.key, it]));
    for (const k of p.keys) { const it = m.get(k); if (it && !it.zero) b += it.bytes; }
  }
  return b;
}

export async function openNovelDownload(novels, { mode = 'unread' } = {}) {
  const q = await ready();
  if (!q) return null;
  await loadReading().catch(() => null);
  const viewed = await viewedKeys();
  let groups;
  try { groups = await Promise.all(novels.map((nv) => novelGroup(nv, viewed))); }
  catch { toast('회차 목록을 불러오지 못했어요.'); return null; }
  const res = await openDlSheet({ title: novels.length > 1 ? `회차 받기 · ${novels.length}편` : '회차 받기', groups, presets: NOVEL_PRESETS, mode, n: 50, quota: q, unit: '화' });
  if (!res) return null;
  const plans = groups.map((g) => ({ novel: g.novel, chapters: g.chapters, keys: g.chapters.map((c) => c.key).filter((k) => res.sel.get(g.id)?.has(k)) })).filter((p) => p.keys.length);
  if (!plans.length) return null;
  const bytes = sumBytes(groups, plans);
  const count = plans.reduce((s, p) => s + p.keys.length, 0);
  if (!(await preflight(bytes, `${count}화`))) return null;
  return withProgress(plans.length > 1 ? `${plans.length}편 받는 중` : `${plans[0].novel.title} 받는 중`, () => downloadNovels(plans, plans.length > 1 ? `소설 ${plans.length}편` : plans[0].novel.title));
}

// 카드 메뉴의 "다음 N화 바로 받기" (선택 창 없이, 확인은 그대로)
export async function quickNext(novel, n = 50) {
  const q = await ready();
  if (!q) return null;
  await loadReading().catch(() => null);
  const g = await novelGroup(novel, await viewedKeys()).catch(() => null);
  if (!g) { toast('회차 목록을 불러오지 못했어요.'); return null; }
  const keys = g.preset('next', n, true);
  if (!keys.size) { toast('받을 회차가 없어요.'); return null; }
  const bytes = g.items.filter((it) => keys.has(it.key) && !it.zero).reduce((s, it) => s + it.bytes, 0);
  if (!q.unlimited && bytes > roomOf(q)) {
    toast('남은 한도보다 많아요. 회차를 골라서 받아 주세요.');
    return openNovelDownload([novel], { mode: 'next' });
  }
  if (!(await preflight(bytes, `${keys.size}화`))) return null;
  const plan = { novel, chapters: g.chapters, keys: g.chapters.map((c) => c.key).filter((k) => keys.has(k)) };
  return withProgress(`${novel.title} 받는 중`, () => downloadNovels([plan], novel.title));
}

// 관리 창의 업데이트: 새 회차 · 바뀐 회차 (+ 다시 나뉜 소설은 예전 범위)
export async function openNovelUpdate(novels, extraKeys = {}) {
  const q = await ready();
  if (!q) return null;
  await loadReading().catch(() => null);
  const viewed = await viewedKeys();
  let groups;
  try { groups = await Promise.all(novels.map((nv) => novelGroup(nv, viewed))); }
  catch { toast('회차 목록을 불러오지 못했어요.'); return null; }
  for (const g of groups) {
    const d = novelDiff(g.id, g.chapters);
    const base = new Set([...d.fresh, ...d.changed, ...(extraKeys[g.id] || [])]);
    const orig = g.preset;
    g.preset = (mode, n, skip) => (mode === 'update' ? new Set(base) : orig(mode, n, skip));
  }
  const res = await openDlSheet({ title: `업데이트 · ${novels.length}편`, groups, presets: [['update', '새 회차 · 바뀐 회차'], ...NOVEL_PRESETS], mode: 'update', n: 50, quota: q, unit: '화' });
  if (!res) return null;
  const plans = groups.map((g) => ({ novel: g.novel, chapters: g.chapters, keys: g.chapters.map((c) => c.key).filter((k) => res.sel.get(g.id)?.has(k)) })).filter((p) => p.keys.length);
  if (!plans.length) return null;
  const bytes = sumBytes(groups, plans);
  if (!(await preflight(bytes, `${plans.reduce((s, p) => s + p.keys.length, 0)}화`))) return null;
  return withProgress('업데이트 받는 중', () => downloadNovels(plans, '업데이트'));
}

// ---------------------------------------------------------------------
// 칼럼
// ---------------------------------------------------------------------
export async function openColumnDownload(cols, { title = '칼럼 받기', mode = 'unread' } = {}) {
  const q = await ready();
  if (!q) return null;
  await loadReading().catch(() => null);
  const viewed = await viewedKeys();
  const saved = savedColumnsNow();
  const items = cols.map((c) => {
    const full = columnBytes(c, false); const text = columnBytes(c, true);
    const st = statusOf(getReading('column', c.id));
    const have = saved.get(c.id);
    const changed = have && c.content_hash && have.hash && have.hash !== c.content_hash;
    return {
      key: c.id, label: c.title, bytes: full.bytes, textBytes: text.bytes, exact: full.exact,
      zero: false,
      sub: `${(c.published_at || '').slice(0, 10).replaceAll('-', '.')}${st === 'read' ? ' · 다 읽음' : ''}${c.image_count != null ? ` · 이미지 ${c.image_count}개` : ''}`,
      badge: changed ? ['바뀜', 'is-acc'] : have ? ['받음', 'is-ok'] : viewed.has(objectKey(c.md_path)) ? ['열어 봄', 'is-ok'] : null,
      read: st === 'read', have: !!have && !changed,
    };
  });
  const group = {
    id: 'cols', title, items,
    preset: (m, n, skip) => {
      const pool = items.filter((it) => !it.have && !(skip && it.read));
      return new Set((m === 'recent' ? pool.slice(0, n) : pool.filter((it) => !it.read)).map((it) => it.key));
    },
  };
  const res = await openDlSheet({ title, groups: [group], presets: COLUMN_PRESETS, mode, n: 10, quota: q, unit: '개', textOnly: false, skipLabel: '다 읽은 글 빼기' });
  if (!res) return null;
  const picked = cols.filter((c) => res.sel.get('cols')?.has(c.id));
  if (!picked.length) return null;
  const bytes = picked.reduce((s, c) => s + columnBytes(c, res.textOnly).bytes, 0);
  if (!(await preflight(bytes, `글 ${picked.length}개`))) return null;
  return withProgress(`칼럼 ${picked.length}개 받는 중`, () => downloadColumns(picked.map((c) => ({ col: c, textOnly: res.textOnly })), `칼럼 ${picked.length}개`));
}

// ---------------------------------------------------------------------
// 받다 만 작업 (앱 시작 때)
// ---------------------------------------------------------------------
export async function offerResume() {
  const j = await pendingJob().catch(() => null);
  if (!j?.tasks?.length || !navigator.onLine || currentJob()) return;
  const ok = await confirmBox({ title: '받다 만 것이 있어요', body: `${j.label} · 남은 ${j.tasks.length}개를 이어 받을까요? 한도는 실제로 받은 만큼만 세요.`, ok: '이어 받기', cancel: '나중에' });
  if (!ok) return;
  const q = await ready();
  if (!q) return;
  await withProgress(`${j.label} 이어 받는 중`, () => resumeJob());
}
export { dropJob };
