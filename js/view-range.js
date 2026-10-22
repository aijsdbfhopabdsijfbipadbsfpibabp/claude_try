// 「定義の幅」グラフ（仕様書 §5.2-1）。
// 選んだセグメント・年の数字を、出典ごとに横棒で並べる。
// 並びは値の小さい順、色は basis。円建てとドル建ては別の軸（別のグラフ）にする。

import { BASIS } from './schema.js';
import {
  h, clear, fmtOku, fmtOkuRange, fmtOkuTick, fmtUsd, fmtUsdTick, fmtRatio, fmtPeriod, niceTicks,
  srcName, srcDetail, swatch, basisColor, basisLabel, checkBadge, statusTag, periodTypeTag, viaTag,
  scopeChips, calc, showTip, showTipAt, hideTip, rowDetail,
} from './format.js';
import { rowsForYear, rangeOf, isCurrent } from './load.js';

export function renderRange(root, ledger, { segId, year }) {
  clear(root);
  const seg = ledger.segById.get(segId);
  const rows = year == null ? [] : rowsForYear(ledger, segId, year);
  if (!rows.length) {
    root.append(h('p', { class: 'empty' }, 'このセグメントには年単位の数字がありません。'));
    return;
  }

  const jpy = rows.filter((o) => o.$.cur === 'JPY');
  const usd = rows.filter((o) => o.$.cur === 'USD');
  const range = rangeOf(rows);
  const old = rows.filter((o) => !isCurrent(o));

  // 要約
  const segName = `「${seg?.name ?? segId}」`;
  let lead;
  if (range && range.n >= 2) {
    lead = [
      `${year}年の${segName}は、${range.n}件の数字が `,
      h('strong', null, fmtOkuRange(range.min, range.max)),
      ' に分かれています。',
      range.min > 0 ? ['最大は最小の ', calc(fmtRatio(range.max / range.min)), '。'] : null,
    ];
  } else if (range) {
    lead = `${year}年の${segName}で比べられる円建ての数字は1件です。`;
  } else {
    lead = `${year}年の${segName}に円建ての数字はありません。`;
  }
  root.append(h('p', { class: 'range-summary' }, lead));

  const bases = Object.keys(BASIS).filter((b) => rows.some((o) => o.basis === b));
  root.append(h('ul', { class: 'legend', 'aria-label': '棒の色（数え方）' },
    bases.map((b) => h('li', null, swatch(b), basisLabel(b)))));

  if (jpy.length) root.append(barChart(jpy, ledger, { fmt: fmtOku, tick: fmtOkuTick, unit: '億円' }));
  if (usd.length) {
    root.append(
      h('h4', { class: 'sub-heading' }, 'ドル建ての数字（円に換算せず、別の軸で表示）'),
      barChart(usd, ledger, { fmt: fmtUsd, tick: fmtUsdTick, unit: '百万ドル' }),
    );
  }

  const notes = [
    '棒は値の小さい順。棒の長さは 0 からの値です。',
    old.length ? '薄い棒は、同じ発行元の新しい発表で改訂された古い数字です（幅の計算には入れていません）。' : null,
    '四半期・月の数字は、時系列と一覧表に出ます。',
  ].filter(Boolean);
  root.append(h('p', { class: 'footnote' }, notes.join(' ')));
}

function barChart(rows, ledger, { fmt, tick, unit }) {
  const sorted = rows.slice().sort((a, b) => a.$.cmp - b.$.cmp || a._line - b._line);
  const { top, ticks } = niceTicks(Math.max(...sorted.map((o) => o.$.cmp)));
  const pct = (v) => `${(Math.max(0, v) / top) * 100}%`;

  const grid = () => ticks.map((t) => h('span', { class: 'rc-grid', style: { left: pct(t) }, 'aria-hidden': 'true' }));

  const list = h('ol', { class: 'rc', 'aria-label': `数字の一覧（${unit}・小さい順）` });
  for (const o of sorted) {
    const tags = h('div', { class: 'rc-tags' },
      h('span', { class: 'rc-basis' }, swatch(o.basis), basisLabel(o.basis)),
      periodTypeTag(o.period_type),
      statusTag(o.status),
      scopeChips(o.$.scope, ledger.flags),
      checkBadge(o.check),
      viaTag(o.$.via),
      o.$.superseded ? h('span', { class: 'tag tag-old' }, `改訂前（${o.$.superseded[0].$.published} 発表で更新）`) : null,
      o.$.mismatch ? h('span', { class: 'tag tag-mismatch' }, '不一致あり') : null,
    );
    const label = h('div', { class: 'rc-label' },
      h('div', { class: 'rc-src' }, h('strong', null, srcName(o.$.src)), o.$.src ? h('span', { class: 'muted' }, srcDetail(o.$.src)) : null),
      tags,
      o.note ? h('div', { class: 'rc-note', title: o.note }, o.note) : null,
    );
    const plot = h('div', { class: 'rc-plot' },
      grid(),
      h('span', { class: 'rc-bar', style: { width: pct(o.$.cmp), '--c': basisColor(o.basis) } }),
      h('span', { class: 'rc-value', style: { left: pct(o.$.cmp) } }, fmt(o.$.cmp)),
    );
    const item = h('li', {
      class: `rc-row${o.$.superseded ? ' is-old' : ''}`,
      tabindex: '0',
      'aria-label': `${srcName(o.$.src)} ${basisLabel(o.basis)} ${fmtPeriod(o.period, o.period_type)} ${fmt(o.$.cmp)}`,
    }, label, plot);
    item.addEventListener('pointermove', (e) => showTip(rowDetail(o, ledger.flags), e.clientX, e.clientY));
    item.addEventListener('pointerleave', hideTip);
    item.addEventListener('focus', () => showTipAt(plot, rowDetail(o, ledger.flags)));
    item.addEventListener('blur', hideTip);
    list.append(item);
  }

  const axis = h('div', { class: 'rc-axis-row', 'aria-hidden': 'true' },
    h('div', { class: 'rc-axis-unit' }, unit),
    h('div', { class: 'rc-axis' }, ticks.map((t) => h('span', { class: 'rc-tick', style: { left: pct(t) } }, tick(t)))),
  );
  return h('div', { class: 'rc-wrap' }, list, axis);
}
