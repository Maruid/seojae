// 관리 탭 › 소설: 작가 · 대표 장르 · 태그 편집
//   - 장르·태그 입력칸은 이미 쓴 이름을 자동완성으로 보여줘서 "로판"/"로맨스 판타지" 같은 중복을 줄임
//   - 태그: 입력 후 Enter 나 쉼표로 추가, × 로 빼기, 빈 칸에서 Backspace 로 마지막 태그 빼기
import { html, toast } from '../lib/dom.js';
import { rpc, errorMessage } from '../lib/supabase.js';
import { loadNovels } from '../lib/novels.js';
import { normalizeTag } from '../lib/novelText.js';

export function createNovelAdmin(redraw) {
  let novels = null;
  let error = null;
  let editing = null;      // { id, author, genre, tags: [], draft }
  let saving = false;

  const allGenres = () => [...new Set((novels || []).map((n) => n.genre).filter(Boolean))].sort();
  const allTags = () => [...new Set((novels || []).flatMap((n) => n.tags || []))].sort();

  async function load(force = false) {
    try { novels = await loadNovels({ force }); error = null; } catch (err) { error = errorMessage(err); }
    redraw();
  }

  const card = (n) => {
    if (editing?.id === n.id) {
      const e = editing;
      return html`
        <li class="ad-card" data-novel="${n.id}">
          <strong class="text-[16px]">${n.title}</strong>
          <form data-novel-form class="flex flex-col gap-3">
            <label class="nv-field"><span>작가</span>
              <input name="author" value="${e.author}" maxlength="60" placeholder="작가 이름" autocomplete="off"></label>
            <label class="nv-field"><span>대표 장르</span>
              <input name="genre" value="${e.genre}" maxlength="30" placeholder="예: 로맨스 판타지" list="dl-genres" autocomplete="off"></label>
            <div class="nv-field"><span id="tags-label">태그</span>
              <div class="nv-tagbox" role="group" aria-labelledby="tags-label">
                ${e.tags.map((t, i) => html`<span class="nv-tag">#${t}<button type="button" data-action="nv-untag" data-i="${i}" aria-label="${t} 태그 빼기">×</button></span>`)}
                <input data-tag-input value="${e.draft}" maxlength="20" placeholder="${e.tags.length ? '' : '#회귀 처럼 입력 후 Enter'}" list="dl-tags" autocomplete="off" aria-label="태그 추가">
              </div>
              <small class="text-xs text-muted">Enter 나 쉼표로 추가 · 최대 20개</small>
            </div>
            <datalist id="dl-genres">${allGenres().map((g) => html`<option value="${g}"></option>`)}</datalist>
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
            <span class="ad-mail">${[n.author || '작가 미입력', n.genre || '장르 미입력'].join(' · ')} · ${n.chapter_count.toLocaleString()}화</span>
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
    const missing = novels.filter((n) => !n.genre).length;
    return html`
      <p class="m-0 text-[13px] text-muted">${novels.length}편${missing ? ` · 장르 미입력 ${missing}편` : ''} · 여기서 입력한 내용은 소설 목록의 장르·태그 필터에 쓰여요.</p>
      <ul class="ad-list">${[...novels].sort((a, b) => a.title.localeCompare(b.title, 'ko')).map(card)}</ul>`;
  };

  // 입력 중인 값 보존 (다시 그려도 날아가지 않게)
  const syncForm = (root) => {
    const f = root.querySelector('[data-novel-form]');
    if (!f || !editing) return;
    editing.author = f.author.value;
    editing.genre = f.genre.value;
    editing.draft = f.querySelector('[data-tag-input]').value;
  };
  const addDraft = () => {
    const parts = editing.draft.split(/[,，]/).map(normalizeTag).filter(Boolean);
    for (const t of parts) if (!editing.tags.includes(t) && editing.tags.length < 20 && t.length <= 20) editing.tags.push(t);
    editing.draft = '';
  };
  const focusTag = (root) => { const i = root.querySelector('[data-tag-input]'); if (i) { i.focus(); } };

  const handlers = {
    'nv-edit'(b) {
      const n = novels.find((x) => x.id === b.dataset.id);
      editing = { id: n.id, author: n.author || '', genre: n.genre || '', tags: [...(n.tags || [])], draft: '' };
      redraw();
    },
    'nv-cancel'() { editing = null; redraw(); },
    'nv-untag'(b, e) {
      const root = e.currentTarget || document;
      syncForm(b.closest('.ad-list') || root);
      editing.tags.splice(+b.dataset.i, 1);
      redraw();
    },
  };

  // 태그 입력: Enter / 쉼표 → 추가, 빈 칸 Backspace → 마지막 빼기
  const onKeydown = (e, root) => {
    if (!e.target.matches?.('[data-tag-input]') || !editing) return;
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      syncForm(root); addDraft(); redraw(); focusTag(root);
    } else if (e.key === 'Backspace' && !e.target.value && editing.tags.length) {
      syncForm(root); editing.tags.pop(); redraw(); focusTag(root);
    }
  };
  // 자동완성에서 고르면(입력 이벤트로 들어옴) 바로 추가
  const onInput = (e, root) => {
    if (!e.target.matches?.('[data-tag-input]') || !editing) return;
    if (allTags().includes(normalizeTag(e.target.value)) && e.inputType !== 'insertText' && e.inputType !== 'deleteContentBackward') {
      syncForm(root); addDraft(); redraw(); focusTag(root);
    }
  };
  const onSubmit = async (e, root) => {
    if (!e.target.matches?.('[data-novel-form]')) return;
    e.preventDefault();
    syncForm(root); addDraft();
    const ed = editing;
    saving = true; redraw();
    try {
      await rpc('admin_update_novel', { p_id: ed.id, p_author: ed.author, p_genre: ed.genre, p_tags: ed.tags });
      const n = novels.find((x) => x.id === ed.id);
      Object.assign(n, { author: ed.author.trim() || null, genre: ed.genre.trim() || null, tags: ed.tags });
      editing = null;
      toast('저장했어요.');
      loadNovels({ force: true }).catch(() => {});
    } catch (err) { toast(errorMessage(err)); }
    saving = false; redraw();
  };

  return { load, render, handlers, onKeydown, onInput, onSubmit, get loaded() { return !!novels; } };
}
