// 市場一覧（index.html）。仕様書 §5.1。
// 上の大きなカードには、最初の市場の「最新年の全体の幅」を小さな横棒で出す。

import { BASIS } from './schema.js';
import { loadCatalog, loadAllLedgers, comparisonYear, rowsForYear, rangeOf, isCurrent } from './load.js';
import { h, clear, fmtOku, okuRangeNodes, fmtRatio, calc, basisColor, periodTypeLabel } from './format.js';
import { boot } from './page-common.js';

const marketUrl = (id, extra = '') => `market.html?id=${encodeURIComponent(id)}${extra}`;

/** 市場の「全体」について、比べる年・行・幅 */
function headline(lg) {
  const { root } = lg;
  if (!root) return null;
  const year = comparisonYear(lg, root.id);
  if (year == null) return null;
  const rows = rowsForYear(lg, root.id, year);
  const range = rangeOf(rows);
  if (!range) return null;
  const bars = rows.filter((o) => isCurrent(o) && o.$.cur === 'JPY').sort((a, b) => a.$.cmp - b.$.cmp);
  return { year, range, bars };
}

function featureCard(lg, hl) {
  const { market, root } = lg;
  const { year, range, bars } = hl;
  return h('a', { class: 'feature', href: marketUrl(market.id, `&seg=${encodeURIComponent(root.id)}&year=${year}#range`) },
    h('p', { class: 'eyebrow' }, 'Featured'),
    h('p', { class: 'feature-label' }, `${year}年・${market.name}の「${root.name}」`),
    h('p', { class: 'feature-range' }, okuRangeNodes(range.min, range.max)),
    h('p', { class: 'feature-sub' }, `数え方の違う ${range.n}件の数字。`,
      range.n >= 2 && range.min > 0 ? ['最大は最小の ', calc(fmtRatio(range.max / range.min)), '。'] : null),
    h('ul', { class: 'feature-bars', 'aria-label': '数え方ごとの数字（小さい順）' },
      bars.map((o) => h('li', null,
        h('span', { class: 'fb-label' }, `${BASIS[o.basis]?.short ?? o.basis}・${periodTypeLabel(o.period_type)}`),
        h('span', { class: 'fb-track', 'aria-hidden': 'true' },
          h('span', { class: 'fb-bar', style: { width: `${(o.$.cmp / range.max) * 100}%`, '--c': basisColor(o.basis) } })),
        h('span', { class: 'fb-value' }, fmtOku(o.$.cmp)),
      ))),
    h('span', { class: 'feature-link' }, '定義の幅を見る', h('span', { 'aria-hidden': 'true' }, '→')),
  );
}

function marketCard(lg, hl) {
  const { market, stats, root } = lg;
  const body = hl
    ? [
      h('p', { class: 'mc-range-label' }, `${hl.year}年の「${root.name}」の幅`),
      h('p', { class: 'mc-range' }, okuRangeNodes(hl.range.min, hl.range.max)),
      h('p', { class: 'muted small' }, `${hl.range.n}件の数字`,
        hl.range.n >= 2 && hl.range.min > 0 ? ['・最大は最小の ', calc(fmtRatio(hl.range.max / hl.range.min))] : null),
    ]
    : h('p', { class: 'muted' }, '「全体」の数字はまだありません。');

  return h('li', null, h('a', { class: 'market-card', href: marketUrl(market.id) },
    h('div', { class: 'mc-top' },
      h('p', { class: 'eyebrow' }, `Market · ${market.geo}`),
      h('span', { class: 'mc-arrow', 'aria-hidden': 'true' }, '→')),
    h('h3', null, market.name),
    h('div', { class: 'mc-body' }, lg.error ? h('p', { class: 'warn-text' }, lg.error) : body),
    h('dl', { class: 'stats' },
      [['出典', stats.sources], ['行', stats.rows], ['要確認', stats.todo], ['最終更新', stats.lastRetrieved ?? '—']]
        .map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, String(v))))),
  ));
}

boot(async () => {
  const catalog = await loadCatalog();
  const ledgers = await loadAllLedgers(catalog);

  const list = document.getElementById('markets');
  clear(list);
  for (const lg of ledgers) list.append(marketCard(lg, headline(lg)));
  if (!ledgers.length) list.append(h('li', { class: 'empty' }, 'data/markets.json に市場がありません。'));

  // 上の特集カード: 幅が出せる最初の市場
  const first = ledgers.find((lg) => !lg.error && headline(lg));
  if (first) {
    clear(document.getElementById('hero-feature')).append(featureCard(first, headline(first)));
    const cta = document.getElementById('hero-cta');
    cta.href = marketUrl(first.market.id);
    cta.firstChild.textContent = `${first.market.name}を見る `;
  }
});
