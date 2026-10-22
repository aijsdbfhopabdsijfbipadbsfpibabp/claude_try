// 市場一覧（index.html）。仕様書 §5.1。

import { loadCatalog, loadAllLedgers, comparisonYear, rowsForYear, rangeOf } from './load.js';
import { h, clear, fmtOkuRange, fmtRatio, calc } from './format.js';
import { boot } from './page-common.js';

boot(async (main) => {
  const catalog = await loadCatalog();
  const ledgers = await loadAllLedgers(catalog);
  const list = document.getElementById('markets');
  clear(list);

  for (const lg of ledgers) {
    const { market, stats, root } = lg;
    const year = root ? comparisonYear(lg, root.id) : null;
    const range = year != null ? rangeOf(rowsForYear(lg, root.id, year)) : null;

    const rangeBlock = range
      ? [
        h('p', { class: 'mc-range-label' }, `${year}年の「${root.name}」の幅`),
        h('p', { class: 'mc-range' }, fmtOkuRange(range.min, range.max)),
        h('p', { class: 'muted small' }, `${range.n}件の数字`,
          range.n >= 2 && range.min > 0 ? ['・最大は最小の ', calc(fmtRatio(range.max / range.min))] : null),
      ]
      : h('p', { class: 'muted' }, '「全体」の数字はまだありません。');

    list.append(h('li', null, h('a', { class: 'market-card', href: `market.html?id=${encodeURIComponent(market.id)}` },
      h('h2', null, market.name, h('span', { class: 'geo' }, market.geo)),
      lg.error ? h('p', { class: 'warn-text' }, lg.error) : rangeBlock,
      h('dl', { class: 'stats stats-compact' },
        [['出典', stats.sources], ['行', stats.rows], ['要確認', stats.todo], ['最終更新', stats.lastRetrieved ?? '—']]
          .map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, String(v))))),
    )));
  }
  if (!ledgers.length) list.append(h('li', { class: 'empty' }, 'data/markets.json に市場がありません。'));
});
