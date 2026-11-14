// 가운데 창: 확인 · 안내 · 진행
import { html, mount, onAction } from '../lib/dom.js';

function open(inner, { onKey } = {}) {
  const root = document.createElement('div');
  root.className = 'cf-root';
  mount(root, inner);
  document.body.appendChild(root);
  const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onKey?.(); } };
  document.addEventListener('keydown', key, true);
  return { root, close: () => { document.removeEventListener('keydown', key, true); root.remove(); } };
}

export function confirmBox({ title, body, ok = '확인', cancel = '취소', danger = false }) {
  return new Promise((resolve) => {
    let m = null;
    const done = (v) => { off(); m.close(); resolve(v); };
    m = open(html`
      <div class="cf-back" data-action="no"></div>
      <div class="cf-box" role="alertdialog" aria-modal="true" aria-label="${title}">
        <strong>${title}</strong>
        ${body ? html`<p>${body}</p>` : ''}
        <div class="cf-btns">
          <button type="button" data-action="no">${cancel}</button>
          <button type="button" data-action="yes" class="${danger ? 'is-danger' : 'is-main'}">${ok}</button>
        </div>
      </div>`, { onKey: () => done(false) });
    const off = onAction(m.root, { yes: () => done(true), no: () => done(false) });
    m.root.querySelector('[data-action="yes"]').focus();
  });
}

export function infoBox({ title, body, ok = '확인' }) {
  return new Promise((resolve) => {
    let m = null;
    const done = () => { off(); m.close(); resolve(); };
    m = open(html`
      <div class="cf-back" data-action="ok"></div>
      <div class="cf-box" role="alertdialog" aria-modal="true" aria-label="${title}">
        <strong>${title}</strong>
        ${body ? html`<p>${body}</p>` : ''}
        <div class="cf-btns"><button type="button" data-action="ok" class="is-main">${ok}</button></div>
      </div>`, { onKey: done });
    const off = onAction(m.root, { ok: done });
    m.root.querySelector('[data-action="ok"]').focus();
  });
}

// 진행 창: update({ done, total, label, sub }) / close()
export function progressBox({ title, onCancel, onHide = null }) {
  let st = { done: 0, total: 0, sub: '' };
  const m = open(html`<div class="cf-back"></div><div class="cf-box" role="dialog" aria-modal="true" aria-label="${title}" data-pbox></div>`);
  const box = m.root.querySelector('[data-pbox]');
  const draw = () => {
    const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
    mount(box, html`
      <div class="flex items-center gap-2"><strong class="flex-1">${title}</strong><span class="text-[13px] text-muted">${st.done} / ${st.total}</span></div>
      <div class="dl-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
      <p>${st.sub}</p>
      <div class="cf-btns">${onHide ? html`<button type="button" data-action="hide">숨기기</button>` : ''}<button type="button" data-action="cancel">취소</button></div>`);
  };
  const off = onAction(m.root, { cancel: () => onCancel?.(), hide: () => onHide?.() });
  draw();
  return {
    update(x) { st = { ...st, ...x }; draw(); },
    close() { off(); m.close(); },
  };
}
