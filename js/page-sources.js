// 出典カタログ（sources.html）。仕様書 §5.3。

import { SOURCE_TYPE, ACCESS, LICENSE } from './schema.js';
import { loadCatalog, loadAllLedgers } from './load.js';
import { h, clear, srcLink, sourceTypeLabel } from './format.js';
import { boot } from './page-common.js';

boot(async (main) => {
  const catalog = await loadCatalog();
  const ledgers = await loadAllLedgers(catalog);

  // 出典ごとの使用行数（原典として / 経由先として）と、使っている市場
  const use = new Map(catalog.sources.map((s) => [s.id, { asSource: 0, asVia: 0, markets: new Set() }]));
  for (const lg of ledgers) {
    for (const o of lg.rows) {
      const a = use.get(o.source);
      if (a) { a.asSource++; a.markets.add(lg.market.name); }
      const b = o.via ? use.get(o.via) : null;
      if (b) { b.asVia++; b.markets.add(lg.market.name); }
    }
  }

  const body = document.getElementById('catalog');
  clear(body);
  const types = [...Object.keys(SOURCE_TYPE), ...new Set(catalog.sources.map((s) => s.type).filter((t) => !SOURCE_TYPE[t]))];
  document.getElementById('catalog-lead').textContent =
    `${catalog.sources.length}件の出典を種類ごとにまとめています。行数は、その出典を原典（source）・経由先（via）として使っている台帳の行の数です。`;

  for (const type of types) {
    const list = catalog.sources.filter((s) => s.type === type);
    if (!list.length) continue;
    body.append(h('section', { class: 'section', id: `type-${type}` },
      h('h2', null, sourceTypeLabel(type), h('span', { class: 'count-pill' }, list.length)),
      h('div', { class: 'table-wrap' }, h('table', { class: 'ledger sources' },
        h('thead', null, h('tr', null,
          ['発行元', '資料名', '発行日', '入手性', '再利用', '原典として', '経由先として', '注記'].map((t, i) =>
            h('th', { scope: 'col', class: i === 5 || i === 6 ? 'num' : null }, t)))),
        h('tbody', null, list.map((s) => {
          const u = use.get(s.id);
          return h('tr', { id: `src-${s.id}` },
            h('td', null, h('strong', null, s.publisher), h('div', { class: 'muted small mono' }, s.id)),
            h('td', null, srcLink(s, { label: s.title }), s.url ? null : h('div', { class: 'small warn-text' }, 'URL未登録')),
            h('td', { class: 'nowrap' }, s.published ?? h('span', { class: 'muted' }, '不明')),
            h('td', { class: 'nowrap' }, ACCESS[s.access]?.label ?? s.access),
            h('td', null, h('span', { class: `tag tag-license-${s.license}` }, LICENSE[s.license]?.label ?? s.license)),
            h('td', { class: 'num' }, String(u.asSource)),
            h('td', { class: 'num' }, String(u.asVia)),
            h('td', { class: 'small' }, s.note || '—',
              u.markets.size ? h('div', { class: 'muted' }, `使用: ${[...u.markets].join('、')}`) : h('div', { class: 'muted' }, 'どの台帳でも使っていません')),
          );
        })),
      )),
    ));
  }
});
