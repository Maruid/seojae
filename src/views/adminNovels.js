// 관리 탭 › 소설: 작가 · 장르(여러 개) · 태그 편집
//   - 장르·태그 입력칸은 이미 쓴 이름을 자동완성으로 보여줘서 "로판"/"로맨스 판타지" 같은 중복을 줄임
//   - 장르·태그 모두 칩: Enter · 쉼표 · 탭 · '/' 로 추가 (여러 개를 한 번에 붙여 넣어도 하나씩), × 로 빼기, 빈 칸 Backspace 로 마지막 빼기
//   - 태그는 '#' 을 붙이든 안 붙이든 #태그 로 보이고, '#' 앞에서도 나눔 ("#회귀 #먼치킨" → 두 개), 태그 안 공백은 없앰
import { html, toast } from '../lib/dom.js';
import { rpc, errorMessage } from '../lib/supabase.js';
import { loadNovels } from '../lib/novels.js';
import { splitList, genresOf } from '../lib/novelText.js';

const LIMIT = { genres: 10, tags: 20 };
const MAXLEN = { genres: 30, tags: 20 };

export function createNovelAdmin(redraw) {
  let novels = null;
  let error = null;
  let editing = null;      // { id, author, genres: [], tags: [], draft: { genres, tags } }
  let saving = false;

  const allGenres = () => [...new Set((novels || []).flatMap(genresOf))].sort();
  const allTags = () => [...new Set((novels || []).flatMap((n) => n.tags || []))].sort();

  async function load(force = false) {
    try { novels = await loadNovels({ force }); error = null; } catch (err) { error = errorMessage(err); }
    redraw();
  }

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
            ${chipField('genres', '장르', '예: 무협, 현대 판타지', 'dl-genres', '')}
            ${chipField('tags', '태그', '#회귀 #먼치킨 처럼 입력', 'dl-tags', '#')}
            <datalist id="dl-genres">${allGenres().filter((g) => !e.genres.includes(g)).map((g) => html`<option value="${g}"></option>`)}</datalist>
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
  };
  // 칸에 쓴 글을 나눠서 칩으로 (중복·길이·개수 제한)
  const addDraft = (field) => {
    const fields = field ? [field] : ['genres', 'tags'];
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
      editing = { id: n.id, author: n.author || '', genres: [...genresOf(n)], tags: [...(n.tags || [])], draft: { genres: '', tags: '' } };
      redraw();
    },
    'nv-cancel'() { editing = null; redraw(); },
    'nv-unchip'(b) {
      syncForm(b.closest('.ad-list') || document);
      editing[b.dataset.f].splice(+b.dataset.i, 1);
      redraw();
    },
  };

  // 칩 입력: Enter · 쉼표 · Tab(글이 있을 때) · '/' → 추가, 빈 칸 Backspace → 마지막 빼기
  const onKeydown = (e, root) => {
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
    const field = e.target.dataset?.chipInput;
    if (!field || !editing) return;
    const v = e.target.value;
    const known = (field === 'tags' ? allTags() : allGenres()).includes(splitList(v, { tag: field === 'tags' })[0]);
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
