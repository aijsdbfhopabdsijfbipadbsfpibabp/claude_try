// 市場ページ（market.html?id=…）。仕様書 §5.2 の6つのビューを上から順に置く。

import { loadCatalog, loadLedger, annualYears, comparisonYear, LoadError } from './load.js';
import { h, clear } from './format.js';
import { boot, SITE_NAME } from './page-common.js';
import { renderRange } from './view-range.js';
import { renderSeries } from './view-series.js';
import { renderMatrix } from './view-matrix.js';
import { renderTable } from './view-table.js';
import { renderRevisions, renderTodo } from './view-review.js';

const SECTIONS = [
  ['range', '定義の幅', 'Range'],
  ['series', '時系列', 'Time series'],
  ['matrix', '定義マトリクス', 'Definitions'],
  ['table', '一覧表', 'Ledger'],
  ['revisions', '改訂と不一致', 'Revisions'],
  ['todo', '要確認リスト', 'To check'],
];

boot(async (main) => {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  if (!id) throw new LoadError('市場IDが指定されていません（market.html?id=cosmetics-jp の形で開いてください）');

  const catalog = await loadCatalog();
  const ledger = await loadLedger(catalog, id);
  const { market, stats } = ledger;
  document.title = `${market.name} | ${SITE_NAME}`;

  // 状態（URL に残して、同じ画面を開き直せるようにする）
  const state = {
    segId: ledger.segById.has(params.get('seg')) ? params.get('seg') : ledger.root?.id,
    year: Number(params.get('year')) || null,
  };
  const fixYear = () => {
    const years = annualYears(ledger, state.segId);
    if (!years.includes(state.year)) state.year = comparisonYear(ledger, state.segId);
    return years;
  };
  const saveUrl = () => {
    const p = new URLSearchParams({ id });
    if (state.segId) p.set('seg', state.segId);
    if (state.year) p.set('year', String(state.year));
    history.replaceState(null, '', `?${p}${location.hash}`);
  };

  // ---- 見出し ----
  clear(main);
  const tile = (label, value, unit, cls) => h('div', { class: cls ?? null },
    h('dt', null, label), h('dd', null, String(value), unit ? h('small', null, unit) : null));
  main.append(h('div', { class: 'page-head' },
    h('nav', { class: 'breadcrumb', 'aria-label': 'パンくず' }, h('a', { href: './' }, '市場一覧'), ' › ', market.name),
    h('p', { class: 'eyebrow' }, `Market · ${market.geo}`),
    h('h1', null, market.name),
    market.note ? h('p', { class: 'lead' }, market.note) : null,
    h('dl', { class: 'stat-tiles' },
      tile('台帳の数字', stats.rows, '行'),
      tile('出典', stats.sources, '件'),
      tile('未確認・要確認', stats.todo, '行'),
      tile('最終更新', stats.lastRetrieved ?? '—', null, 'is-date')),
  ));

  // ---- セグメントの選択（1〜3のビューに効く） ----
  const segSelect = h('select', { id: 'seg' },
    [['市場規模', false], ['関連指標（市場規模そのものではない）', true]].map(([label, related]) => {
      const segs = ledger.segments.filter((sg) => !!sg.related === related);
      return segs.length ? h('optgroup', { label }, segs.map((sg) =>
        h('option', { value: sg.id }, `${'　'.repeat(sg.depth)}${sg.name}`))) : null;
    }));
  segSelect.value = state.segId;
  main.append(h('div', { class: 'toolbar' },
    h('label', { class: 'field' }, h('span', null, 'セグメント'), segSelect),
    h('nav', { class: 'toc', 'aria-label': 'このページの内容' }, SECTIONS.map(([sid, label]) => h('a', { href: `#${sid}` }, label))),
  ));

  // ---- 各セクション ----
  const sec = {};
  const segHeading = {};
  for (const [i, [sid, label, en]] of SECTIONS.entries()) {
    const title = h('h2', null, label);
    const body = h('div', { class: 'section-body' });
    const el = h('section', { id: sid, class: 'section', 'aria-labelledby': `${sid}-h` },
      h('div', { class: 'section-head' },
        h('div', null, h('p', { class: 'eyebrow' }, `${String(i + 1).padStart(2, '0')} — ${en}`), title)),
      body);
    title.id = `${sid}-h`;
    sec[sid] = { el, body, head: el.firstChild };
    if (['range', 'series', 'matrix'].includes(sid)) {
      segHeading[sid] = h('span', { class: 'seg-name' });
      title.append(segHeading[sid]);
    }
    main.append(el);
  }
  sec.range.el.querySelector('.section-head').after(h('p', { class: 'section-lead' },
    'その年の数字を出典ごとに棒で並べます。同じ年・同じ市場でも、数え方（出荷か小売か、国内生産だけか輸入を含むか、年度か暦年か）で数字は大きく変わります。'));
  sec.series.el.querySelector('.section-head').after(h('p', { class: 'section-lead' },
    '出典・数え方・期間の種類・範囲がすべて同じ点だけを線で結びます。定義の違う点どうしは結びません。'));
  sec.matrix.el.querySelector('.section-head').after(h('p', { class: 'section-lead' },
    'どの数字が何を含むかを表で比べます。'));
  sec.table.el.querySelector('.section-head').after(h('p', { class: 'section-lead' },
    '台帳の全行です。出典名から原典・経由先のページへ飛べます。'));

  // 年の選択（定義の幅だけに効く）
  const yearSelect = h('select', { id: 'year', 'aria-label': '年' });
  const older = h('button', { type: 'button', class: 'button-quiet', title: '前の年', 'aria-label': '前の年' }, '◀');
  const newer = h('button', { type: 'button', class: 'button-quiet', title: '次の年', 'aria-label': '次の年' }, '▶');
  sec.range.head.append(h('div', { class: 'year-picker' }, older, yearSelect, newer));

  const table = renderTable(sec.table.body, ledger);
  const reveal = (line) => table.reveal(line);
  renderRevisions(sec.revisions.body, ledger, { reveal });
  renderTodo(sec.todo.body, ledger, { reveal });

  const drawRange = (years) => {
    clear(yearSelect).append(...years.map((y) => h('option', { value: String(y) }, `${y}年`)));
    yearSelect.value = String(state.year);
    const i = years.indexOf(state.year);
    older.disabled = i < 0 || i >= years.length - 1;
    newer.disabled = i <= 0;
    yearSelect.disabled = !years.length;
    renderRange(sec.range.body, ledger, state);
  };

  const drawAll = () => {
    const years = fixYear();
    const name = ledger.segById.get(state.segId)?.name ?? '';
    for (const el of Object.values(segHeading)) el.textContent = `：${name}`;
    drawRange(years);
    renderSeries(sec.series.body, ledger, state);
    renderMatrix(sec.matrix.body, ledger, state);
    saveUrl();
  };

  segSelect.addEventListener('change', () => { state.segId = segSelect.value; drawAll(); });
  yearSelect.addEventListener('change', () => { state.year = Number(yearSelect.value); drawRange(fixYear()); saveUrl(); });
  const step = (d) => {
    const years = annualYears(ledger, state.segId);
    const i = years.indexOf(state.year) + d;
    if (i >= 0 && i < years.length) { state.year = years[i]; drawRange(years); saveUrl(); }
  };
  older.addEventListener('click', () => step(1));
  newer.addEventListener('click', () => step(-1));

  drawAll();

  // URL の #row-12 で開いたら、その行を見せる
  const m = /^#row-(\d+)$/.exec(location.hash);
  if (m) reveal(Number(m[1]));
  else if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
});
