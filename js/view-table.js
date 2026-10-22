// 一覧表・フィルタ（仕様書 §5.2-4）。
// 全行を表で出し、セグメント・年・basis・status・check で絞り込む。各行から出典URLへ飛べる。

import { BASIS, STATUS, CHECK } from './schema.js';
import {
  h, clear, fmtValue, fmtRaw, fmtPeriod, fmtPct, srcLink, srcSub, swatch, basisLabel,
  statusLabel, scopeChips, checkBadge, calc,
} from './format.js';

const ALL = '';

const COLUMNS = [
  { id: 'segment', label: 'セグメント', sort: (o) => [o.$.seg.order] },
  { id: 'period', label: '期間', sort: (o) => [o.$.x ?? 0, o.$.seg.order] },
  { id: 'status', label: '状態' },
  { id: 'basis', label: '数え方' },
  { id: 'value', label: '値', num: true, sort: (o) => [o.$.cur === 'JPY' ? 0 : 1, o.$.cmp ?? 0] },
  { id: 'scope', label: '範囲' },
  { id: 'source', label: '原典' },
  { id: 'via', label: '経由先' },
  { id: 'check', label: '確認' },
  { id: 'yoy', label: '前年比（計算）', num: true, sort: (o) => [o.$.yoy ? 0 : 1, o.$.yoy?.ratio ?? 0] },
  { id: 'share', label: '構成比（計算）', num: true, sort: (o) => [o.$.share ? 0 : 1, o.$.share?.ratio ?? 0] },
  { id: 'retrieved', label: '取得日', sort: (o) => [o.retrieved] },
  { id: 'note', label: '注記' },
];

const cmpArr = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
};

/** 一覧表を描く。戻り値の reveal(line) で、その行が見える状態にしてスクロールする */
export function renderTable(root, ledger) {
  clear(root);
  const rows = ledger.rows;
  const state = { segment: ALL, year: ALL, basis: ALL, status: ALL, check: ALL, sort: null, desc: false };

  const opt = (value, label) => h('option', { value }, label);
  const select = (key, label, options) => {
    const el = h('select', { id: `f-${key}`, 'data-key': key },
      opt(ALL, 'すべて'), options.map(([v, l]) => opt(v, l)));
    el.addEventListener('change', () => { state[key] = el.value; update(); });
    return h('label', { class: 'field' }, h('span', null, label), el);
  };

  const years = [...new Set(rows.map((o) => o.$.year).filter((y) => y != null))].sort((a, b) => b - a);
  const present = (key, defs) => Object.keys(defs).filter((k) => rows.some((o) => o[key] === k)).map((k) => [k, defs[k].label]);

  const filters = h('div', { class: 'filters' },
    select('segment', 'セグメント', ledger.segments.filter((sg) => rows.some((o) => o.segment === sg.id))
      .map((sg) => [sg.id, `${'　'.repeat(sg.depth)}${sg.name}`])),
    select('year', '年', years.map((y) => [String(y), `${y}年`])),
    select('basis', '数え方', present('basis', BASIS)),
    select('status', '状態', present('status', STATUS)),
    select('check', '確認', present('check', CHECK)),
  );
  const reset = h('button', { type: 'button', class: 'button-quiet' }, '絞り込みを解除');
  reset.addEventListener('click', () => resetFilters());
  const count = h('p', { class: 'count', 'aria-live': 'polite' });
  filters.append(reset);

  const headRow = h('tr');
  const thead = h('thead', null, headRow);
  for (const col of COLUMNS) {
    const th = h('th', { scope: 'col', class: col.num ? 'num' : null });
    if (col.sort) {
      const btn = h('button', { type: 'button', class: 'th-sort' }, col.label, h('span', { class: 'th-arrow', 'aria-hidden': 'true' }));
      btn.addEventListener('click', () => {
        if (state.sort === col.id) state.desc = !state.desc;
        else { state.sort = col.id; state.desc = false; }
        update();
      });
      th.append(btn);
    } else {
      th.append(col.label);
    }
    th.dataset.col = col.id;
    headRow.append(th);
  }
  const tbody = h('tbody');
  root.append(filters, count, h('div', { class: 'table-wrap' }, h('table', { class: 'ledger ledger-main' }, thead, tbody)));

  function resetFilters() {
    for (const k of ['segment', 'year', 'basis', 'status', 'check']) state[k] = ALL;
    filters.querySelectorAll('select').forEach((el) => { el.value = ALL; });
    update();
  }

  function update() {
    const shown = rows.filter((o) =>
      (state.segment === ALL || o.segment === state.segment)
      && (state.year === ALL || String(o.$.year) === state.year)
      && (state.basis === ALL || o.basis === state.basis)
      && (state.status === ALL || o.status === state.status)
      && (state.check === ALL || o.check === state.check));

    const col = COLUMNS.find((c) => c.id === state.sort);
    const base = (o) => [o.$.seg.order, o.$.x ?? 0, o.$.cmp ?? 0, o._line];
    shown.sort((a, b) => {
      const r = col ? cmpArr(col.sort(a), col.sort(b)) * (state.desc ? -1 : 1) : 0;
      return r || cmpArr(base(a), base(b));
    });
    for (const th of headRow.children) {
      const on = th.dataset.col === state.sort;
      th.setAttribute('aria-sort', on ? (state.desc ? 'descending' : 'ascending') : 'none');
      const arrow = th.querySelector('.th-arrow');
      if (arrow) arrow.textContent = on ? (state.desc ? '▼' : '▲') : '';
    }

    count.textContent = `${rows.length}件中 ${shown.length}件を表示`;
    clear(tbody);
    for (const o of shown) tbody.append(rowEl(o, ledger));
    if (!shown.length) tbody.append(h('tr', null, h('td', { colspan: COLUMNS.length, class: 'empty' }, '条件に合う行はありません。')));
  }

  update();

  return {
    reveal(line) {
      resetFilters();
      const tr = tbody.querySelector(`tr[data-line="${line}"]`);
      if (!tr) return;
      tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
      tr.classList.remove('is-flash');
      void tr.offsetWidth;
      tr.classList.add('is-flash');
    },
  };
}

function rowEl(o, ledger) {
  const extra = [
    o.$.superseded ? h('span', { class: 'tag tag-old', title: '同じ発行元の新しい発表で改訂された数字' }, `改訂前（${o.$.superseded[0].$.published} 発表で更新）`) : null,
    o.$.mismatch ? h('span', { class: 'tag tag-mismatch', title: '同じ原典を名乗るのに、経由先によって値が違う' }, '不一致あり') : null,
    o.$.shadow ? h('span', { class: 'tag', title: '同じ系列・同じ期間の別の数字が標準表示になっている' }, '同期間に別の数字') : null,
  ];
  return h('tr', { 'data-line': o._line, id: `row-${o._line}`, class: o.$.superseded ? 'is-old' : null },
    h('td', null, `${'　'.repeat(o.$.seg.depth)}${o.$.seg.name}`, o.$.seg.related ? h('span', { class: 'muted small' }, '（関連指標）') : null),
    h('td', { class: 'nowrap' }, fmtPeriod(o.period, o.period_type)),
    h('td', { class: 'nowrap' }, statusLabel(o.status)),
    h('td', null, h('span', { class: 'rc-basis' }, swatch(o.basis), basisLabel(o.basis))),
    h('td', { class: 'num nowrap' }, fmtValue(o), o.$.cur === 'JPY' && o.unit !== 'oku_yen' ? h('div', { class: 'muted small' }, `原典: ${fmtRaw(o)}`) : null),
    h('td', null, scopeChips(o.$.scope, ledger.flags) ?? '—'),
    h('td', { class: 'col-source' }, srcLink(o.$.src), o.$.src ? h('div', { class: 'muted small' }, srcSub(o.$.src)) : null,
      o.$.src && !o.$.src.url ? h('div', { class: 'small warn-text' }, 'URL未登録') : null),
    h('td', { class: 'col-via' }, o.$.via ? srcLink(o.$.via) : h('span', { class: 'muted' }, '—（原典で直接）')),
    h('td', { class: 'nowrap' }, checkBadge(o.check, { all: true })),
    h('td', { class: 'num' }, o.$.yoy ? calc(fmtPct(o.$.yoy.ratio)) : '—'),
    h('td', { class: 'num' }, o.$.share ? calc(fmtPct(o.$.share.ratio), `${o.$.share.base.$.seg.name}（同じ出典・同じ定義）に占める割合。画面で計算した値`) : '—'),
    h('td', { class: 'nowrap' }, o.retrieved),
    h('td', { class: 'note-cell' }, o.note || null, extra),
  );
}
