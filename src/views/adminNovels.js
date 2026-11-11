// 관리 탭 › 소설: 작가 · 장르(여러 개) · 태그 편집
//   - 장르는 정해진 목록(migration_007 genre_list)에서만: 아래 목록 칩을 누르거나, 입력하면 자동완성
//       띄어쓰기 무시 · 별칭(현판 → 현대판타지) · 목록에 없는 건 "#… 태그로 넣기" (붙여 넣은 건 자동으로 태그로)
//   - 태그 입력칸은 이미 쓴 이름을 자동완성
//   - 장르·태그 모두 칩: Enter · 쉼표 · 탭 · '/' 로 추가 (여러 개를 한 번에 붙여 넣어도 하나씩), × 로 빼기, 빈 칸 Backspace 로 마지막 빼기
//   - 태그는 '#' 을 붙이든 안 붙이든 #태그 로 보이고, '#' 앞에서도 나눔 ("#회귀 #먼치킨" → 두 개), 태그 안 공백은 없앰
import { html, toast } from '../lib/dom.js';
import { rpc, errorMessage } from '../lib/supabase.js';
import { loadNovels } from '../lib/novels.js';
import { splitList, genresOf, normalizeTag } from '../lib/novelText.js';
import { genreList, loadGenreList, canonGenre, suggestGenres } from '../lib/genres.js';

const LIMIT = { genres: 10, tags: 20 };
const MAXLEN = { genres: 30, tags: 20 };

export function createNovelAdmin(redraw) {
  let novels = null;
  let error = null;
  let editing = null;      // { id, author, genres: [], tags: [], draft: { genres, tags } }
  let saving = false;

  const allTags = () => [...new Set((novels || []).flatMap((n) => n.tags || []))].sort();

  async function load(force = false) {
    try { [novels] = await Promise.all([loadNovels({ force }), loadGenreList()]); error = null; } catch (err) { error = errorMessage(err); }
    redraw();
  }

  // ---- 장르: 목록에서 고르기 + 입력 자동완성 ----
  let gItems = [];   // 지금 보이는 자동완성 [{ kind: 'genre' | 'tag', v }]
  let gIdx = 0;
  const genreField = () => {
    const e = editing;
    return html`
      <div class="nv-field"><span id="genres-label">장르</span>
        <div class="nv-tagbox" role="group" aria-labelledby="genres-label">
          ${e.genres.map((t, i) => html`<span class="nv-tag">${t}<button type="button" data-action="nv-unchip" data-f="genres" data-i="${i}" aria-label="${t} 빼기">×</button></span>`)}
          <input data-genre-input value="${e.draft.genres}" placeholder="${e.genres.length ? '' : '입력하면 찾아요 (예: 현판)'}" autocomplete="off"
            role="combobox" aria-autocomplete="list" aria-controls="nv-gsug" aria-label="장르 찾기">
        </div>
        <div class="nv-gsug" id="nv-gsug" role="listbox" data-gsug></div>
        <div class="nv-gpal" role="group" aria-label="장르 목록에서 고르기">
          ${genreList().map((g) => { const on = e.genres.includes(g); return html`<button type="button" class="nv-gp ${on ? 'is-on' : ''}" data-action="nv-gpick" data-v="${g}" aria-pressed="${String(on)}">${g}</button>`; })}
        </div>
        <small class="text-xs text-muted">목록에서 누르거나 입력해서 고르기 · 여러 개 가능(최대 ${LIMIT.genres}개) · 목록에 없는 건 태그로 넣어요</small>
      </div>`;
  };
  const genreItems = (text) => {
    const t = text.trim();
    if (!t) return [];
    const exact = canonGenre(t);
    const { picks, contained } = suggestGenres(t, editing.genres);
    const items = [];
    if (exact && !editing.genres.includes(exact)) items.push({ kind: 'genre', v: exact });
    for (const g of picks) if (g !== exact) items.push({ kind: 'genre', v: g });
    const tag = normalizeTag(t);
    if (!exact && tag && !editing.tags.includes(tag)) items.push({ kind: 'tag', v: tag });
    for (const g of contained) items.push({ kind: 'genre', v: g });
    return items;
  };
  const drawSug = (root) => {
    const box = root.querySelector('[data-gsug]');
    const inp = root.querySelector('[data-genre-input]');
    if (!box || !inp) return;
    gItems = genreItems(inp.value);
    if (gIdx >= gItems.length) gIdx = 0;
    inp.setAttribute('aria-expanded', String(!!gItems.length));
    box.innerHTML = '';
    gItems.forEach((it, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(i === gIdx));
      b.className = `nv-gs ${i === gIdx ? 'is-on' : ''} ${it.kind === 'tag' ? 'is-tag' : ''}`;
      b.dataset.action = it.kind === 'tag' ? 'nv-gtag' : 'nv-gsel';
      b.dataset.v = it.v;
      b.textContent = it.kind === 'tag' ? `#${it.v} 태그로 넣기` : it.v;
      box.append(b);
    });
  };
  const addGenre = (g) => {
    if (!g || editing.genres.includes(g)) return;
    if (editing.genres.length >= LIMIT.genres) { toast(`장르는 ${LIMIT.genres}개까지예요.`); return; }
    editing.genres.push(g);
  };
  const addTag = (t) => {
    if (!t || editing.tags.includes(t)) return true;
    if (editing.tags.length >= LIMIT.tags || t.length > MAXLEN.tags) return false;
    editing.tags.push(t);
    return true;
  };
  // 쉼표·/ 로 여러 개 붙여 넣은 장르: 목록에 있으면 장르, 없으면 태그로
  const addGenreText = (text) => {
    const moved = [];
    for (const part of splitList(text)) {
      const c = canonGenre(part);
      if (c) addGenre(c);
      else if (addTag(normalizeTag(part))) moved.push(`#${normalizeTag(part)}`);
    }
    if (moved.length) toast(`목록에 없는 장르는 태그로 넣었어요: ${moved.join(' ')}`);
  };
  const focusGenre = (root) => { const i = root.querySelector('[data-genre-input]'); i?.focus(); };

  // 칩 입력칸 (장르·태그 공용)
  const chipField = (field, label, ph, dl, mark) => {
    const e = editing;
    return html`
      <div class="nv-field"><span id="${field}-label">${label}</span>
        <div class="nv-tagbox" role="group" aria-labelledby="${field}-label">
          ${e[field].map((t, i) => html`<span class="nv-tag">${mark}${t}<button type="button" data-action="nv-unchip" data-f="${field}" data-i="${i}" aria-label="${t} 빼기">×</button></span>`)}
          <input data-chip-input="${field}" value="${e.draft[field]}" placeholder="${e[field].length ? '' : ph}" list="${dl}" autocomplete="off" aria-label="${label} 추가">
        </div>
        <small class="text-xs text-muted">Enter · 쉼표 · 탭 · / 로 나눠서 여러 개 · 최대 ${LIMIT[field]}개${field === 'tags' ? ' · # 은 자동으로 붙어요' : ''}</small>
      </div>`;
  };

  const card = (n) => {
    if (editing?.id === n.id) {
      const e = editing;
      return html`
        <li class="ad-card" data-novel="${n.id}">
          <strong class="text-[16px]">${n.title}</strong>
          <form data-novel-form class="flex flex-col gap-3">
            <label class="nv-field"><span>작가</span>
              <input name="author" value="${e.author}" maxlength="60" placeholder="작가 이름" autocomplete="off"></label>
            ${genreField()}
            ${chipField('tags', '태그', '#회귀 #먼치킨 처럼 입력', 'dl-tags', '#')}
            <datalist id="dl-tags">${allTags().filter((t) => !e.tags.includes(t)).map((t) => html`<option value="${t}"></option>`)}</datalist>
            <div class="ad-actions">
              <button type="submit" class="ad-btn is-main" ${saving ? 'disabled' : ''}>${saving ? '저장 중…' : '저장'}</button>
              <button type="button" class="ad-btn" data-action="nv-cancel">취소</button>
            </div>
          </form>
        </li>`;
    }
    return html`
      <li class="ad-card" data-novel="${n.id}">
        <div class="ad-top">
          <div class="ad-who">
            <span class="ad-name">${n.title}</span>
            <span class="ad-mail">${[n.author || '작가 미입력', genresOf(n).join(', ') || '장르 미입력'].join(' · ')} · ${n.chapter_count.toLocaleString()}화</span>
          </div>
          <button type="button" class="ad-btn" data-action="nv-edit" data-id="${n.id}">편집</button>
        </div>
        ${(n.tags || []).length ? html`<div class="flex flex-wrap gap-1.5">${n.tags.map((t) => html`<span class="nv-tag is-static">#${t}</span>`)}</div>`
          : html`<p class="ad-note">태그 없음</p>`}
      </li>`;
  };

  const render = () => {
    if (!novels) return html`<p class="text-sm text-muted">${error || '불러오는 중…'}</p>`;
    if (!novels.length) return html`<p class="text-sm text-muted">올라온 소설이 없어요.</p>`;
    const missing = novels.filter((n) => !genresOf(n).length).length;
    return html`
      <p class="m-0 text-[13px] text-muted">${novels.length}편${missing ? ` · 장르 미입력 ${missing}편` : ''} · 여기서 입력한 내용은 소설 목록의 장르·태그 필터에 쓰여요.</p>
      <ul class="ad-list">${[...novels].sort((a, b) => a.title.localeCompare(b.title, 'ko')).map(card)}</ul>`;
  };

  // 입력 중인 값 보존 (다시 그려도 날아가지 않게)
  const syncForm = (root) => {
    const f = root.querySelector('[data-novel-form]');
    if (!f || !editing) return;
    editing.author = f.author.value;
    for (const i of f.querySelectorAll('[data-chip-input]')) editing.draft[i.dataset.chipInput] = i.value;
    const g = f.querySelector('[data-genre-input]');
    if (g) editing.draft.genres = g.value;
  };
  // 칸에 쓴 글을 나눠서 칩으로 (중복·길이·개수 제한)
  const addDraft = (field) => {
    if (!field || field === 'genres') { addGenreText(editing.draft.genres); editing.draft.genres = ''; }
    const fields = field ? [field].filter((f) => f !== 'genres') : ['tags'];
    let over = false;
    for (const fd of fields) {
      for (const v of splitList(editing.draft[fd], { tag: fd === 'tags' })) {
        if (editing[fd].includes(v)) continue;
        if (editing[fd].length >= LIMIT[fd] || v.length > MAXLEN[fd]) { over = true; continue; }
        editing[fd].push(v);
      }
      editing.draft[fd] = '';
    }
    if (over) toast('너무 길거나 개수를 넘은 항목은 빼고 넣었어요.');
  };
  const focusChip = (root, field) => { root.querySelector(`[data-chip-input="${field}"]`)?.focus(); };

  const handlers = {
    'nv-edit'(b) {
      const n = novels.find((x) => x.id === b.dataset.id);
      editing = { id: n.id, author: n.author || '', genres: [], tags: [...(n.tags || [])], draft: { genres: '', tags: '' } };
      // 예전 장르를 목록 이름으로 맞춤 (현대 판타지 → 현대판타지), 목록에 없는 건 태그로
      addGenreText(genresOf(n).join(','));
      redraw();
    },
    'nv-cancel'() { editing = null; redraw(); },
    'nv-unchip'(b) {
      syncForm(b.closest('.ad-list') || document);
      editing[b.dataset.f].splice(+b.dataset.i, 1);
      redraw();
    },
    'nv-gpick'(b) {
      const root = b.closest('.ad-list') || document;
      syncForm(root);
      const g = b.dataset.v;
      if (editing.genres.includes(g)) editing.genres = editing.genres.filter((x) => x !== g);
      else addGenre(g);
      redraw();
    },
    'nv-gsel'(b) {
      const root = b.closest('.ad-list') || document;
      syncForm(root); addGenre(b.dataset.v); editing.draft.genres = ''; gIdx = 0;
      redraw(); focusGenre(root);
    },
    'nv-gtag'(b) {
      const root = b.closest('.ad-list') || document;
      syncForm(root);
      if (!addTag(b.dataset.v)) toast('태그가 너무 길거나 20개를 넘었어요.');
      editing.draft.genres = ''; gIdx = 0;
      redraw(); focusGenre(root);
    },
  };

  // 칩 입력: Enter · 쉼표 · Tab(글이 있을 때) · '/' → 추가, 빈 칸 Backspace → 마지막 빼기
  const onKeydown = (e, root) => {
    // 장르 입력: ↑↓ 로 고르기, Enter 로 넣기, 쉼표·/·Tab 은 여러 개 입력, 빈 칸 Backspace 는 마지막 빼기
    if (e.target.matches?.('[data-genre-input]') && editing && !e.isComposing) {
      const v = e.target.value;
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && gItems.length) {
        e.preventDefault();
        gIdx = (gIdx + (e.key === 'ArrowDown' ? 1 : -1) + gItems.length) % gItems.length;
        drawSug(root);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (!v.trim()) return;
        const it = gItems[gIdx];
        syncForm(root);
        if (it?.kind === 'genre') addGenre(it.v);
        else if (it?.kind === 'tag') { if (!addTag(it.v)) toast('태그가 너무 길거나 20개를 넘었어요.'); }
        editing.draft.genres = ''; gIdx = 0;
        redraw(); focusGenre(root);
      } else if (e.key === ',' || e.key === '/' || (e.key === 'Tab' && v.trim())) {
        e.preventDefault();
        syncForm(root); addGenreText(v); editing.draft.genres = ''; gIdx = 0;
        redraw(); focusGenre(root);
      } else if (e.key === 'Backspace' && !v && editing.genres.length) {
        syncForm(root); editing.genres.pop(); redraw(); focusGenre(root);
      } else if (e.key === 'Escape' && v) {
        e.preventDefault(); e.target.value = ''; gIdx = 0; drawSug(root);
      }
      return;
    }
    const field = e.target.dataset?.chipInput;
    if (!field || !editing || e.isComposing) return;
    const has = e.target.value.trim();
    if (e.key === 'Enter' || e.key === ',' || e.key === '/' || (e.key === 'Tab' && has)) {
      e.preventDefault();
      syncForm(root); addDraft(field); redraw(); focusChip(root, field);
    } else if (e.key === 'Backspace' && !e.target.value && editing[field].length) {
      syncForm(root); editing[field].pop(); redraw(); focusChip(root, field);
    }
  };
  // 붙여 넣기 · 자동완성 선택 · 구분자가 들어간 입력 → 바로 칩으로
  const onInput = (e, root) => {
    if (e.target.matches?.('[data-genre-input]') && editing) {
      const v = e.target.value;
      if (/[,，、\t\n/]/.test(v) || e.inputType === 'insertFromPaste') {
        syncForm(root); addGenreText(v); editing.draft.genres = ''; gIdx = 0;
        redraw(); focusGenre(root);
      } else { gIdx = 0; drawSug(root); }   // 입력 중에는 자동완성 칸만 다시 (한글 조합이 끊기지 않게)
      return;
    }
    const field = e.target.dataset?.chipInput;
    if (!field || !editing) return;
    const v = e.target.value;
    const known = allTags().includes(splitList(v, { tag: true })[0]);
    const picked = known && e.inputType !== 'insertText' && e.inputType !== 'deleteContentBackward' && e.inputType !== 'insertCompositionText';
    if (/[,，、\t\n/]/.test(v) || e.inputType === 'insertFromPaste' || picked) {
      syncForm(root); addDraft(field); redraw(); focusChip(root, field);
    }
  };
  const onSubmit = async (e, root) => {
    if (!e.target.matches?.('[data-novel-form]')) return;
    e.preventDefault();
    syncForm(root); addDraft();
    const ed = editing;
    saving = true; redraw();
    try {
      try {
        await rpc('admin_update_novel', { p_id: ed.id, p_author: ed.author, p_genres: ed.genres, p_tags: ed.tags });
      } catch (err) {
        // migration_004 전이면 장르 한 칸짜리 함수로 (첫 번째 장르만 저장)
        if (!/function|PGRST202/i.test(`${err?.code} ${err?.message}`)) throw err;
        await rpc('admin_update_novel', { p_id: ed.id, p_author: ed.author, p_genre: ed.genres[0] || '', p_tags: ed.tags });
        toast('장르는 첫 번째만 저장됐어요. migration_004 를 실행해 주세요.');
      }
      const n = novels.find((x) => x.id === ed.id);
      Object.assign(n, { author: ed.author.trim() || null, genres: ed.genres, genre: ed.genres[0] || null, tags: ed.tags });
      editing = null;
      toast('저장했어요.');
      loadNovels({ force: true }).catch(() => {});
    } catch (err) { toast(errorMessage(err)); }
    saving = false; redraw();
  };

  return { load, render, handlers, onKeydown, onInput, onSubmit, get loaded() { return !!novels; } };
}
