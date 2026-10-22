// 定義マトリクス（仕様書 §5.2-3）。
// 行が系列、列が basis・period_type・各 scope_flags。✓ / ✗ / ? で埋め、どの数字が何を含むかを比べる。

import { BASIS, PERIOD_TYPE } from './schema.js';
import { h, clear, srcName, srcDetail, srcLink, swatch, basisLabel, periodTypeLabel } from './format.js';

const CELL = {
  yes: { mark: '✓', word: '該当' },
  no:  { mark: '✗', word: '該当しない' },
  unk: { mark: '?', word: '不明' },
};

const cell = (k) => h('td', { class: `mx mx-${k}` },
  h('span', { 'aria-hidden': 'true' }, CELL[k].mark), h('span', { class: 'sr-only' }, CELL[k].word));

export function renderMatrix(root, ledger, { segId }) {
  clear(root);
  const basisOrder = Object.keys(BASIS);
  const list = ledger.series
    .filter((sr) => sr.segment === segId)
    .sort((a, b) => basisOrder.indexOf(a.basis) - basisOrder.indexOf(b.basis)
      || srcName(a.src).localeCompare(srcName(b.src), 'ja')
      || (a.src?.published ?? '').localeCompare(b.src?.published ?? ''));
  if (!list.length) {
    root.append(h('p', { class: 'empty' }, 'このセグメントには数字がありません。'));
    return;
  }

  // 列: この画面に出てくる basis（不明は全列「?」で表す）、年度・暦年（＋その他の年度があれば）、scope_flags
  const bases = basisOrder.filter((b) => b !== 'unknown' && list.some((sr) => sr.basis === b));
  const ptypes = ['FY', 'CY', ...(list.some((sr) => sr.period_type === 'FY_other') ? ['FY_other'] : [])];
  const flags = ledger.flags;

  const head1 = h('tr', null,
    h('th', { rowspan: 2, scope: 'col', class: 'mx-name' }, '系列（出典）'),
    bases.length ? h('th', { colspan: bases.length, scope: 'colgroup' }, '数え方') : null,
    h('th', { colspan: ptypes.length, scope: 'colgroup' }, '期間'),
    flags.length ? h('th', { colspan: flags.length, scope: 'colgroup' }, '範囲') : null,
    h('th', { rowspan: 2, scope: 'col' }, '数字'),
  );
  const head2 = h('tr', null,
    bases.map((b) => h('th', { scope: 'col', title: BASIS[b].desc }, swatch(b), BASIS[b].short)),
    ptypes.map((t) => h('th', { scope: 'col', title: PERIOD_TYPE[t].desc }, periodTypeLabel(t))),
    flags.map((fl) => h('th', { scope: 'col', title: fl.label }, fl.label.replace(/を含む$/, ''))),
  );

  const body = h('tbody');
  for (const sr of list) {
    const ys = sr.rows.map((o) => o.$.year);
    const span = Math.min(...ys) === Math.max(...ys) ? `${ys[0]}` : `${Math.min(...ys)}–${Math.max(...ys)}`;
    const vias = [...new Map(sr.rows.filter((o) => o.$.via).map((o) => [o.via, o.$.via])).values()];
    const todo = sr.rows.filter((o) => o.check !== 'verified').length;
    body.append(h('tr', null,
      h('th', { scope: 'row', class: 'mx-name' },
        h('div', null, h('strong', null, srcName(sr.src)), sr.src ? h('span', { class: 'muted' }, ` ${srcDetail(sr.src)}`) : null),
        sr.basis === 'unknown' ? h('div', { class: 'muted small' }, `数え方: ${basisLabel('unknown')}`) : null,
        vias.length ? h('div', { class: 'small via' }, '経由: ', vias.map((v, i) => [i ? '、' : '', srcLink(v)])) : null,
      ),
      bases.map((b) => cell(sr.basis === 'unknown' ? 'unk' : sr.basis === b ? 'yes' : 'no')),
      ptypes.map((t) => cell(sr.period_type === 'unknown' ? 'unk' : sr.period_type === t ? 'yes' : 'no')),
      flags.map((fl) => cell(sr.scope[fl.id] === true ? 'yes' : sr.scope[fl.id] === false ? 'no' : 'unk')),
      h('td', { class: 'mx-count' }, `${sr.rows.length}件`, h('div', { class: 'muted small' }, span),
        todo ? h('div', { class: 'small' }, `未確認・要確認 ${todo}`) : null),
    ));
  }

  root.append(
    h('div', { class: 'table-wrap' },
      h('table', { class: 'matrix' }, h('thead', null, head1, head2), body)),
    h('p', { class: 'footnote' }, '✓ = 該当する／含む、✗ = 該当しない／含まない、? = 原典で確認できていない。数え方が「不明」の系列は数え方の列がすべて「?」になります。'),
  );
}
