// 時系列グラフ（仕様書 §5.2-2・§6）。
// 系列（source・basis・period_type・segment・scope が同じ点）ごとに線で結ぶ。定義が違う点は結ばない。
// 横軸は連続した時間で、各期間の中心に点を置く（暦年は7月1日、年度は10月1日）。
// 実績は実線、予測は破線、推計は点線、速報は白抜きの点。円建てとドル建ては別のグラフにする。

import { BASIS } from './schema.js';
import {
  h, s, clear, fmtOku, fmtOkuTick, fmtUsd, fmtUsdTick, fmtPeriod, fmtPct, niceTicks,
  srcName, srcDetail, swatch, basisColor, basisLabel, statusLabel, periodTypeTag, scopeChips,
  checkBadge, viaTag, calc, showTip, hideTip,
} from './format.js';

const H = 300;
const M = { top: 26, right: 18, bottom: 30, left: 56 };
let observers = [];

export function renderSeries(root, ledger, { segId }) {
  observers.forEach((ob) => ob.disconnect());
  observers = [];
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

  root.append(styleKeys(list));

  // 円建てとドル建てのグラフで横軸（年）をそろえる
  const allX = list.flatMap((sr) => sr.rows.map((o) => o.$.x));
  const xDomain = [Math.floor(Math.min(...allX) / 12) * 12, (Math.floor(Math.max(...allX) / 12) + 1) * 12];

  const hl = { set: () => {} };
  const panels = [];
  for (const [cur, fmt, tick, unit, title] of [
    ['JPY', fmtOku, fmtOkuTick, '億円', null],
    ['USD', fmtUsd, fmtUsdTick, '百万ドル', 'ドル建ての数字（円に換算せず、別の軸で表示）'],
  ]) {
    const group = list.filter((sr) => sr.cur === cur);
    if (!group.length) continue;
    if (title) root.append(h('h4', { class: 'sub-heading' }, title));
    const wrap = h('div', { class: 'sc-panel' });
    root.append(wrap);
    panels.push(wrap);
    const draw = () => drawPanel(wrap, group, ledger, { fmt, tick, unit, xDomain });
    let last = 0;
    const ob = new ResizeObserver(() => {
      const w = Math.round(wrap.clientWidth);
      if (w && w !== last) { last = w; draw(); }
    });
    ob.observe(wrap);
    observers.push(ob);
  }

  hl.set = (sid) => {
    for (const p of panels) {
      p.classList.toggle('is-dim', !!sid);
      p.querySelectorAll('.sc-series').forEach((g) => g.classList.toggle('is-hl', g.dataset.sid === sid));
    }
  };
  root.append(seriesLegend(list, ledger, hl));
  root.append(h('p', { class: 'footnote' },
    '年度の点は暦年より3か月右（10月1日の位置）に置いています。「?」の付いた点は年度か暦年か分からない数字で、暦年の位置に置いています。'
    + '同じ系列・同じ期間に複数の数字があるときは1つを標準表示にし、ほかは薄く表示します。凡例にポインターを合わせると、その系列だけを強調します。'));
}

/** 線と点の見方 */
function styleKeys(list) {
  const rows = list.flatMap((sr) => sr.rows);
  const has = (fn) => rows.some(fn);
  const line = (dash) => s('svg', { width: 28, height: 10, 'aria-hidden': 'true' },
    s('line', { x1: 1, y1: 5, x2: 27, y2: 5, class: 'key-line', 'stroke-dasharray': dash ?? null }));
  const dot = (hollow) => s('svg', { width: 14, height: 14, 'aria-hidden': 'true' },
    s('circle', { cx: 7, cy: 7, r: 4, class: hollow ? 'key-dot-hollow' : 'key-dot' }));
  const items = [
    [line(), '実績'],
    has((o) => o.status === 'forecast') ? [line('6 4'), '予測'] : null,
    has((o) => o.status === 'estimate') ? [line('1.5 3.5'), '推計'] : null,
    has((o) => o.status === 'preliminary' || o.status === 'estimate') ? [dot(true), '速報・推計の点'] : null,
    has((o) => o.$.uncertain) ? [h('span', { class: 'key-q', 'aria-hidden': 'true' }, '?'), '年度か暦年か不明'] : null,
    has((o) => o.$.shadow || o.$.superseded) ? [h('span', { class: 'key-faded', 'aria-hidden': 'true' }, dot(false)), '薄い点: 改訂前、または同じ期間の別の数字'] : null,
    has((o) => o.$.mismatch) ? [h('span', { class: 'key-q', 'aria-hidden': 'true' }, '≠'), '不一致（同じ原典なのに経由先で値が違う）'] : null,
  ].filter(Boolean);
  return h('ul', { class: 'legend legend-keys', 'aria-label': '線と点の見方' }, items.map(([k, t]) => h('li', null, k, t)));
}

function drawPanel(wrap, list, ledger, { fmt, tick, unit, xDomain }) {
  clear(wrap);
  const W = Math.max(300, wrap.clientWidth);
  const pw = W - M.left - M.right;
  const ph = H - M.top - M.bottom;

  const pts = list.flatMap((sr) => sr.rows);
  const [x0, x1] = xDomain;
  const { top, ticks } = niceTicks(Math.max(...pts.map((o) => o.$.cmp)));
  const sx = (x) => M.left + ((x - x0) / (x1 - x0)) * pw;
  const sy = (v) => M.top + (1 - Math.max(0, v) / top) * ph;

  const svg = s('svg', {
    class: 'sc', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', tabindex: '0',
    'aria-label': `時系列グラフ（${unit}）。左右の矢印キーで期間を移動できます。`,
  });

  // 目盛りと罫線
  const axis = s('g', { class: 'sc-axis', 'aria-hidden': 'true' });
  for (const t of ticks) {
    axis.append(
      s('line', { x1: M.left, x2: W - M.right, y1: sy(t), y2: sy(t), class: t === 0 ? 'sc-base' : 'sc-grid' }),
      s('text', { x: M.left - 8, y: sy(t), class: 'sc-ytick', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, tick(t)),
    );
  }
  const years = (x1 - x0) / 12;
  const every = [1, 2, 5, 10].find((n) => (pw / years) * n >= 44) ?? 10;
  for (let x = x0; x <= x1; x += 12) {
    axis.append(s('line', { x1: sx(x), x2: sx(x), y1: M.top, y2: H - M.bottom, class: 'sc-vgrid' }));
    const y = x / 12;
    if (x < x1 && y % every === 0) {
      axis.append(s('text', { x: sx(x + 6), y: H - M.bottom + 18, class: 'sc-xtick', 'text-anchor': 'middle' }, `${y}`));
    }
  }
  svg.append(axis);
  svg.append(s('text', { x: M.left, y: 12, class: 'sc-unit' }, unit));

  // 系列
  const plot = s('g', { class: 'sc-plot' });

  // 不一致（同じ原典なのに経由先で値が違う）は、値どうしを縦の点線と「≠」で結んで目立たせる
  const seen = new Set();
  for (const o of pts) {
    const g = o.$.mismatch;
    if (!g || seen.has(g)) continue;
    seen.add(g);
    const vals = g.rows.map((r) => r.$.cmp);
    const x = sx(o.$.x);
    const ya = sy(Math.min(...vals));
    const yb = sy(Math.max(...vals));
    plot.append(
      s('line', { x1: x, x2: x, y1: ya, y2: yb, class: 'sc-mismatch' }),
      s('text', { x: x - 7, y: (ya + yb) / 2, class: 'sc-mismatch-mark', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, '≠'),
    );
  }
  for (const sr of list) {
    const color = basisColor(sr.basis);
    const g = s('g', { class: 'sc-series', 'data-sid': sr.id, style: { '--c': color } });
    for (let i = 1; i < sr.line.length; i++) {
      const a = sr.line[i - 1];
      const b = sr.line[i];
      const st = [a.status, b.status];
      const dash = st.includes('forecast') ? '6 4' : st.includes('estimate') ? '1.5 3.5' : null;
      const faded = a.$.superseded || b.$.superseded;
      g.append(s('line', {
        x1: sx(a.$.x), y1: sy(a.$.cmp), x2: sx(b.$.x), y2: sy(b.$.cmp),
        class: `sc-line${faded ? ' is-faded' : ''}`, 'stroke-dasharray': dash,
      }));
    }
    for (const o of sr.rows) {
      const hollow = o.status === 'preliminary' || o.status === 'estimate';
      const faded = o.$.shadow || o.$.superseded;
      const cx = sx(o.$.x);
      const cy = sy(o.$.cmp);
      g.append(s('circle', { cx, cy, r: hollow ? 4 : 4.5, class: `sc-dot${hollow ? ' is-hollow' : ''}${faded ? ' is-faded' : ''}`, 'data-line': o._line }));
      if (o.$.uncertain) g.append(s('text', { x: cx + 6, y: cy - 6, class: 'sc-q' }, '?'));
    }
    plot.append(g);
  }
  svg.append(plot);

  directLabels(svg, list, { sx, sy, W });

  // ホバー: 縦の補助線が一番近い期間に吸い付き、その位置の数字をすべて出す
  const stops = [...new Set(pts.map((o) => o.$.x))].sort((a, b) => a - b);
  const cross = s('line', { y1: M.top, y2: H - M.bottom, class: 'sc-cross', visibility: 'hidden' });
  svg.append(cross);
  const hit = s('rect', { x: M.left, y: M.top, width: pw, height: ph, class: 'sc-hit' });
  svg.append(hit);

  let idx = -1;
  const show = (i, clientX, clientY) => {
    idx = Math.max(0, Math.min(stops.length - 1, i));
    const x = stops[idx];
    cross.setAttribute('x1', sx(x));
    cross.setAttribute('x2', sx(x));
    cross.setAttribute('visibility', 'visible');
    svg.querySelectorAll('.sc-dot.is-on').forEach((c) => c.classList.remove('is-on'));
    const here = pts.filter((o) => o.$.x === x).sort((a, b) => b.$.cmp - a.$.cmp);
    for (const o of here) svg.querySelector(`.sc-dot[data-line="${o._line}"]`)?.classList.add('is-on');
    if (clientX == null) {
      const r = svg.getBoundingClientRect();
      clientX = r.left + (sx(x) / W) * r.width;
      clientY = r.top + M.top;
    }
    showTip(tipList(here, ledger, fmt), clientX, clientY);
  };
  const hide = () => {
    cross.setAttribute('visibility', 'hidden');
    svg.querySelectorAll('.sc-dot.is-on').forEach((c) => c.classList.remove('is-on'));
    hideTip();
  };
  const nearest = (clientX) => {
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    let best = 0;
    stops.forEach((x, i) => { if (Math.abs(sx(x) - px) < Math.abs(sx(stops[best]) - px)) best = i; });
    return best;
  };
  hit.addEventListener('pointermove', (e) => show(nearest(e.clientX), e.clientX, e.clientY));
  hit.addEventListener('pointerleave', hide);
  svg.addEventListener('focus', () => show(idx < 0 ? stops.length - 1 : idx));
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      show(idx + (e.key === 'ArrowRight' ? 1 : -1));
    } else if (e.key === 'Escape') hide();
  });

  wrap.append(svg);
}

/** ツールチップ: その位置にある数字の一覧（値を先に、系列名を後に） */
function tipList(rows, ledger, fmt) {
  const first = rows[0];
  return h('div', { class: 'tip-list' },
    h('div', { class: 'tip-head' }, fmtPeriod(first.period, first.period_type)),
    rows.map((o) => h('div', { class: `tip-item${o.$.shadow || o.$.superseded ? ' is-faded' : ''}` },
      h('div', { class: 'tip-value' }, fmt(o.$.cmp),
        o.status !== 'actual' ? h('span', { class: 'tag tag-status' }, statusLabel(o.status)) : null,
        checkBadge(o.check)),
      h('div', { class: 'tip-name' }, swatch(o.basis, 'line'), srcName(o.$.src),
        h('span', { class: 'muted' }, ` ${basisLabel(o.basis)}`)),
      o.$.via ? h('div', { class: 'tip-meta' }, viaTag(o.$.via)) : null,
      o.$.superseded ? h('div', { class: 'tip-meta' }, `改訂前（${o.$.superseded[0].$.published} 発表で更新）`) : null,
      o.$.mismatch ? h('div', { class: 'tip-meta' }, h('span', { class: 'tag tag-mismatch' }, '不一致'), '経由先によって値が違う。原典で要確認') : null,
      o.$.shadow && !o.$.mismatch ? h('div', { class: 'tip-meta' }, '同じ系列の別の数字（薄く表示）') : null,
      o.$.yoy ? h('div', { class: 'tip-meta' }, '前年比 ', calc(fmtPct(o.$.yoy.ratio))) : null,
      o.note ? h('div', { class: 'tip-note' }, o.note) : null,
    )),
  );
}

// 文字幅の見積もり（全角は1文字ぶん、半角は0.6文字ぶん）
const textWidth = (t, size) => [...t].reduce((w, c) => w + (c.charCodeAt(0) > 0xff ? size : size * 0.6), 0);

/**
 * 系列が4本以下なら、線の端に発行元の名前を直接書く。
 * ほかの点・線・名前と重なるものは書かない（凡例とツールチップに任せる）。
 */
function directLabels(svg, list, { sx, sy, W }) {
  if (list.length > 4) return;
  const size = 11;
  const boxes = [];
  const pts = list.flatMap((sr) => sr.rows.map((o) => ({ x: sx(o.$.x), y: sy(o.$.cmp), o })));
  const segs = list.flatMap((sr) => sr.line.slice(1).map((b, i) => [sr.line[i], b]))
    .map(([a, b]) => [sx(a.$.x), sy(a.$.cmp), sx(b.$.x), sy(b.$.cmp)]);
  const qs = pts.filter((p) => p.o.$.uncertain).map((p) => ({ x1: p.x + 2, x2: p.x + 14, y1: p.y - 17, y2: p.y - 1 }));
  const overlaps = (bx, last) => {
    if (bx.x1 < M.left || bx.x2 > W - 2 || bx.y1 < 0 || bx.y2 > H - M.bottom) return true;
    if (qs.some((b) => bx.x1 < b.x2 && bx.x2 > b.x1 && bx.y1 < b.y2 && bx.y2 > b.y1)) return true;
    if (boxes.some((b) => bx.x1 < b.x2 && bx.x2 > b.x1 && bx.y1 < b.y2 && bx.y2 > b.y1)) return true;
    if (pts.some((p) => p.o !== last && p.x > bx.x1 - 6 && p.x < bx.x2 + 6 && p.y > bx.y1 - 6 && p.y < bx.y2 + 6)) return true;
    return segs.some(([ax, ay, bx2, by]) => {
      for (let t = 0; t <= 1; t += 0.05) {
        const x = ax + (bx2 - ax) * t;
        const y = ay + (by - ay) * t;
        if (x > bx.x1 - 2 && x < bx.x2 + 2 && y > bx.y1 - 2 && y < bx.y2 + 2) return true;
      }
      return false;
    });
  };
  for (const sr of list) {
    const last = sr.line[sr.line.length - 1];
    if (!last) continue;
    const text = `${srcName(sr.src)}${sr.src?.published ? ` ${sr.src.published.slice(0, 4)}` : ''}`;
    const w = textWidth(text, size);
    const px = sx(last.$.x);
    const py = sy(last.$.cmp);
    const cands = [
      { x1: px + 9, x2: px + 9 + w, y1: py - 7, y2: py + 7, anchor: 'start', tx: px + 9 },
      { x1: px - 9 - w, x2: px - 9, y1: py - 7, y2: py + 7, anchor: 'end', tx: px - 9 },
      { x1: px - w / 2, x2: px + w / 2, y1: py - 22, y2: py - 8, anchor: 'middle', tx: px },
    ];
    const ok = cands.find((bx) => !overlaps(bx, last));
    if (!ok) continue;
    boxes.push(ok);
    svg.append(s('text', {
      x: ok.tx, y: (ok.y1 + ok.y2) / 2, class: 'sc-label', 'text-anchor': ok.anchor, 'dominant-baseline': 'middle', 'aria-hidden': 'true',
    }, text));
  }
}

/** 系列の凡例。ポインターやフォーカスでその系列を強調する */
function seriesLegend(list, ledger, hl) {
  const ul = h('ul', { class: 'sc-legend', 'aria-label': '系列の一覧' });
  for (const sr of list) {
    const ys = sr.rows.map((o) => o.$.year);
    const span = Math.min(...ys) === Math.max(...ys) ? `${ys[0]}` : `${Math.min(...ys)}–${Math.max(...ys)}`;
    const todo = sr.rows.filter((o) => o.check !== 'verified').length;
    const li = h('li', { tabindex: '0', class: 'sc-legend-item' },
      s('svg', { width: 24, height: 10, 'aria-hidden': 'true', class: 'sc-legend-key', style: { '--c': basisColor(sr.basis) } },
        s('line', { x1: 1, y1: 5, x2: 23, y2: 5 })),
      h('div', { class: 'sc-legend-body' },
        h('div', null, h('strong', null, srcName(sr.src)), sr.src ? h('span', { class: 'muted' }, ` ${srcDetail(sr.src)}`) : null),
        h('div', { class: 'rc-tags' },
          h('span', { class: 'rc-basis' }, swatch(sr.basis), basisLabel(sr.basis)),
          periodTypeTag(sr.period_type),
          scopeChips(sr.scope, ledger.flags),
          h('span', { class: 'muted' }, `${sr.rows.length}点 · ${span}`),
          todo ? h('span', { class: 'badge badge-warn' }, h('span', { 'aria-hidden': 'true' }, '△'), `未確認・要確認 ${todo}`) : null,
        ),
      ),
    );
    li.addEventListener('pointerenter', () => hl.set(sr.id));
    li.addEventListener('pointerleave', () => hl.set(null));
    li.addEventListener('focus', () => hl.set(sr.id));
    li.addEventListener('blur', () => hl.set(null));
    ul.append(li);
  }
  return ul;
}
