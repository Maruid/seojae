// 받기 창 (회차 · 칼럼 고르기)
//   - 위: 추천 버튼(묶음 전체에 한 번에) · 다 읽은 것 빼기 · 이번 달 남은 한도 막대
//   - 가운데: 묶음(소설)별 목록. 묶음이 하나면 바로 펼침, 여러 개면 묶음 머리 + 펼치기(그 묶음만 추천 적용)
//   - 용량 맞추기: 전부 들어가는 것만 / ★ + 이어 읽는 순서 / 골고루 (+ 칼럼은 글만)
//   - 한도를 넘으면 "고르는 양을 줄여 주세요" + 받기 버튼 꺼짐
import { html, mount, onAction } from '../lib/dom.js';
import { fmtBytes, fitSelection } from '../lib/offline/plan.js';
import { roomOf } from '../lib/offline/plan.js';
import { resetText } from '../lib/offline/quota.js';

const NS = [10, 30, 50, 100];

/**
 * opts:
 *   title, unit('화' | '개'), groups: [{ id, title, star, items: [{ key, label, sub, bytes, textBytes?, zero, exact, badge?: [text, cls] }], preset(mode, n, skip) → Set }]
 *   presets: [[key, label]]  ('next' · 'recent' 는 N 이 붙음), mode, n
 *   textOnly: undefined(칼럼 아님) | boolean, skipLabel
 *   quota: dl_my_quota 결과
 * 반환: Promise<{ sel: Map(groupId → Set), textOnly } | null>
 */
export function openDlSheet(opts) {
  return new Promise((resolve) => {
    const { title, groups, presets, unit = '화', quota } = opts;
    const multi = groups.length > 1;
    let mode = opts.mode || presets[0][0];
    let n = opts.n || 50;
    let skip = true;
    let textOnly = opts.textOnly;
    let fitOpen = false;
    const open = new Set(multi ? [] : groups.map((g) => g.id));
    let sel = new Map();
    const apply = (gs = groups) => { for (const g of gs) sel.set(g.id, g.preset(mode, n, skip)); };
    apply();

    const room = roomOf(quota);
    const unlimited = !!quota?.unlimited;
    const sizeOf = (it) => (it.zero ? 0 : textOnly && it.textBytes != null ? it.textBytes : it.bytes);
    const totals = () => {
      let count = 0; let bytes = 0; let exact = true; let gs = 0;
      for (const g of groups) {
        const s = sel.get(g.id); if (!s?.size) continue;
        gs++;
        for (const it of g.items) if (s.has(it.key)) { count++; bytes += sizeOf(it); if (!it.exact && !it.zero) exact = false; }
      }
      return { count, bytes, exact, gs };
    };

    const back = document.createElement('div');
    back.className = 'nv-sheet-back';
    const el = document.createElement('section');
    el.className = 'nv-sheet dls';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', title);
    document.body.append(back, el);
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    const groupSize = (g) => { let c = 0; let b = 0; const s = sel.get(g.id); for (const it of g.items) if (s?.has(it.key)) { c++; b += sizeOf(it); } return { c, b }; };
    const presetBtns = (gid = null) => presets.map(([k, l]) => html`
      <button type="button" class="${gid ? 'dls-pill' : `dls-qb ${mode === k ? 'is-on' : ''}`}" data-action="preset" data-k="${k}" ${gid ? html`data-g="${gid}"` : ''}
        aria-pressed="${String(!gid && mode === k)}">${k === 'next' || k === 'recent' ? l.replace('N', String(n)) : l}</button>`);

    const draw = () => {
      const t = totals();
      const over = !unlimited && t.bytes > room;
      const usedPct = unlimited || !quota?.limit ? 0 : Math.min(100, (quota.used / quota.limit) * 100);
      const selPct = unlimited || !quota?.limit ? 0 : Math.min(100 - usedPct, (t.bytes / quota.limit) * 100);
      const approx = t.exact ? '' : '약 ';
      mount(el, html`
        <header><strong>${title}</strong>
          <span class="flex gap-1">
            <button type="button" data-action="fit" aria-expanded="${String(fitOpen)}">용량 맞추기</button>
            <button type="button" data-action="clear">선택 해제</button>
          </span>
        </header>
        <div class="dls-top">
          <div class="dls-qbs">${presetBtns()}<button type="button" class="dls-qb" data-action="cycle" aria-label="N 바꾸기">${n} ▾</button></div>
          <label class="dls-chk"><input type="checkbox" data-action="skip" ${skip ? 'checked' : ''}>${opts.skipLabel || '다 읽은 회차 빼기'}</label>
          ${textOnly !== undefined ? html`<label class="dls-chk"><input type="checkbox" data-action="text" ${textOnly ? 'checked' : ''}>이미지 없이 글만 받기</label>` : ''}
          ${fitOpen ? html`
            <div class="dls-fit" role="menu" aria-label="용량 맞추기">
              ${multi ? html`<button type="button" role="menuitem" data-action="fitdo" data-how="whole"><b>전부 들어가는 것만</b><small>남은 한도 안에 다 받을 수 있는 묶음만 남겨요</small></button>` : ''}
              <button type="button" role="menuitem" data-action="fitdo" data-how="star"><b>${multi ? '★ 먼저 + 이어 읽는 순서대로' : '이어 읽는 순서대로 한도만큼'}</b><small>${multi ? '별표한 소설을 먼저, 남은 한도는 읽던 곳부터 채워요' : '고른 것 중 앞에서부터 한도가 찰 때까지'}</small></button>
              ${multi ? html`<button type="button" role="menuitem" data-action="fitdo" data-how="even"><b>골고루 나누기</b><small>묶음마다 앞에서부터 같은 수씩 채워요</small></button>` : ''}
              <p>기기에 이미 있는 것은 한도를 쓰지 않아 늘 넣어요.</p>
            </div>` : ''}
          ${over ? html`<div class="dls-warn" role="alert"><b>고르는 양을 줄여 주세요.</b> 남은 한도 ${fmtBytes(room)} · 고른 것 ${approx}${fmtBytes(t.bytes)}</div>` : ''}
          <div class="dls-quota">
            ${unlimited ? html`<span>관리자 · 다운로드 한도 없음</span>` : html`
              <div class="dls-qline"><span>이번 달 남은 한도</span><span><b>${fmtBytes(Math.max(0, room - t.bytes))}</b> / ${fmtBytes(room)} 남음</span></div>
              <div class="dl-bar"><i style="width:${usedPct}%"></i><i class="${over ? 'is-over' : 'is-sel'}" style="width:${over ? 100 - usedPct : selPct}%"></i></div>
              <div class="dls-qline is-sub"><span>쓴 양 ${fmtBytes(quota?.used)} · 한도 ${fmtBytes(quota?.limit)}</span><span>${resetText(quota)} 다시 채워짐</span></div>`}
          </div>
        </div>
        <div class="nv-sheet-body dls-list" data-keep-scroll="dls">
          ${groups.map((g) => {
            const s = sel.get(g.id) || new Set();
            const gs = groupSize(g);
            const isOpen = open.has(g.id);
            return html`
              ${multi ? html`
                <div class="dls-gh">
                  <input type="checkbox" data-action="gall" data-g="${g.id}" ${gs.c ? 'checked' : ''} aria-label="${g.title} 모두">
                  <span class="dls-gt"><b>${g.star ? '★ ' : ''}${g.title}</b><small>${gs.c ? `${gs.c}${unit} · ${fmtBytes(gs.b)}` : '고른 것 없음'}${g.note ? ` · ${g.note}` : ''}</small></span>
                  <button type="button" class="dls-ex" data-action="toggle" data-g="${g.id}" aria-expanded="${String(isOpen)}" aria-label="${isOpen ? '접기' : '펼치기'}">${isOpen ? '▴' : '▾'}</button>
                </div>
                ${isOpen ? html`<div class="dls-pills">${presetBtns(g.id)}</div>` : ''}` : ''}
              ${isOpen ? g.items.map((it) => html`
                <label class="dls-row ${multi ? 'is-in' : ''}">
                  <input type="checkbox" data-action="one" data-g="${g.id}" data-k="${it.key}" ${s.has(it.key) ? 'checked' : ''}>
                  <span class="dls-rt"><b>${it.label}</b>${it.sub ? html`<small>${it.sub}</small>` : ''}</span>
                  ${it.zero ? html`<span class="dl-badge is-ok">0MB · 기기에 있음</span>` : it.badge ? html`<span class="dl-badge ${it.badge[1]}">${it.badge[0]}</span>` : ''}
                </label>`) : ''}`;
          })}
        </div>
        <footer>
          <p class="dls-note">${t.count && groups.some((g) => g.items.some((it) => it.zero && sel.get(g.id)?.has(it.key))) ? '기기에 이미 있는 것은 한도를 쓰지 않아요 · ' : ''}받은 뒤 지워도 한도는 돌아오지 않아요</p>
          <button type="button" class="is-main" data-action="go" ${!t.count || over ? 'disabled' : ''}>
            ${over ? `${approx}${fmtBytes(t.bytes)} · 한도를 넘었어요` : `${multi ? `${t.gs}편 · ` : ''}${unit === '화' ? `${t.count}화` : `글 ${t.count}개`} · ${approx}${fmtBytes(t.bytes)} 받기`}
          </button>
        </footer>`);
    };

    const close = (v) => {
      offClick(); offChange();
      document.removeEventListener('keydown', key, true);
      back.remove(); el.remove();
      document.documentElement.style.overflow = prevOverflow;
      resolve(v);
    };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    document.addEventListener('keydown', key, true);
    back.addEventListener('click', () => close(null));

    const offClick = onAction(el, {
      preset(b) {
        if (b.dataset.g) { mode = b.dataset.k; apply(groups.filter((g) => g.id === b.dataset.g)); }
        else { mode = b.dataset.k; apply(); }
        draw();
      },
      cycle() { n = NS[(NS.indexOf(n) + 1) % NS.length]; if (mode === 'next' || mode === 'recent') apply(); draw(); },
      clear() { sel = new Map(groups.map((g) => [g.id, new Set()])); draw(); },
      toggle(b) { const g = b.dataset.g; if (open.has(g)) open.delete(g); else open.add(g); draw(); },
      fit() { fitOpen = !fitOpen; draw(); },
      fitdo(b) {
        const gs = groups.map((g) => {
          const m = new Map(g.items.map((it) => [it.key, it]));
          const order = g.fitOrder ? g.fitOrder.map((k) => m.get(k)).filter(Boolean) : g.items;
          return { id: g.id, star: g.star, items: order.map((it) => ({ key: it.key, bytes: sizeOf(it), zero: it.zero })) };
        });
        sel = fitSelection(gs, sel, room, b.dataset.how);
        fitOpen = false; draw();
      },
      go() { const t = totals(); if (!t.count || (!unlimited && t.bytes > room)) return; close({ sel, textOnly }); },
    });
    // 체크 상자는 change 로 (label 클릭 두 번 방지)
    const offChange = onAction(el, {
      one(b) { const s = sel.get(b.dataset.g) || new Set(); if (b.checked) s.add(b.dataset.k); else s.delete(b.dataset.k); sel.set(b.dataset.g, s); draw(); },
      gall(b) {
        const g = groups.find((x) => x.id === b.dataset.g);
        sel.set(g.id, b.checked ? g.preset(mode, n, skip) : new Set());
        if (b.checked && !sel.get(g.id).size) sel.set(g.id, new Set(g.items.map((it) => it.key)));
        draw();
      },
      skip(b) { skip = b.checked; apply(); draw(); },
      text(b) { textOnly = b.checked; draw(); },
    }, 'change');
    draw();
    el.querySelector('[data-action="go"]')?.focus();
  });
}
