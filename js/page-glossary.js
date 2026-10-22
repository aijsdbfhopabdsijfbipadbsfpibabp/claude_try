// 用語集（glossary.html）。列挙値の表は js/schema.js から作り、定義と食い違わないようにする。

import { PERIOD_TYPE, STATUS, BASIS, UNIT, CHECK, SOURCE_TYPE, ACCESS, LICENSE } from './schema.js';
import { h, swatch } from './format.js';

const ENUMS = { PERIOD_TYPE, STATUS, BASIS, UNIT, CHECK, SOURCE_TYPE, ACCESS, LICENSE };

for (const el of document.querySelectorAll('[data-enum]')) {
  const name = el.dataset.enum;
  const defs = ENUMS[name];
  if (!defs) continue;
  const isBasis = name === 'BASIS';
  const isUnit = name === 'UNIT';
  el.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'ledger enum' },
    h('thead', null, h('tr', null,
      h('th', { scope: 'col' }, '値'), h('th', { scope: 'col' }, '表示'),
      isUnit ? h('th', { scope: 'col' }, '億円への換算') : h('th', { scope: 'col' }, '意味'))),
    h('tbody', null, Object.entries(defs).map(([k, d]) => h('tr', null,
      h('td', null, h('code', null, k)),
      h('td', null, isBasis ? [swatch(k), d.label] : d.label),
      h('td', null, isUnit ? (d.perOku ? `値 ÷ ${d.perOku.toLocaleString('ja-JP')}` : '換算しない（別の軸で表示）') : (d.desc ?? '—')),
    ))),
  )));
}
