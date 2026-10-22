// 表示まわりの共通部品: DOM の組み立て、数字・期間の書式、バッジ、ツールチップ。
// データ由来の文字列は必ずテキストノードとして入れる（innerHTML は使わない）。

import { PERIOD_TYPE, STATUS, BASIS, UNIT, CHECK, SOURCE_TYPE } from './schema.js';

// ---------- DOM ----------

function setAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [p, val] of Object.entries(v)) if (val != null) el.style.setProperty(p, val);
    } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  return el;
}

function addKids(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

/** HTML 要素を作る。h('a', { href }, '文字', 子要素, ...) */
export const h = (tag, attrs, ...kids) => addKids(setAttrs(document.createElement(tag), attrs), kids);

const SVG_NS = 'http://www.w3.org/2000/svg';
/** SVG 要素を作る */
export const s = (tag, attrs, ...kids) => addKids(setAttrs(document.createElementNS(SVG_NS, tag), attrs), kids);

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

// ---------- 数字 ----------

const nf = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 });
export const num = (v) => nf.format(v);

/** 億円の値を「2兆6,430億円」の形にする */
export function fmtOku(v, { unit = true } = {}) {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v < 0 ? '−' : '';
  const a = Math.round(Math.abs(v) * 100) / 100;
  const cho = Math.floor(a / 10000);
  const oku = Math.round((a - cho * 10000) * 100) / 100;
  const tail = unit ? '円' : '';
  if (cho > 0) return `${sign}${nf.format(cho)}兆${oku ? `${nf.format(oku)}億` : ''}${tail}`;
  return `${sign}${nf.format(oku)}億${tail}`;
}

/** 「1兆3,745億〜3兆2,246億円」 */
export function fmtOkuRange(min, max) {
  if (min === max) return fmtOku(min);
  return `${fmtOku(min, { unit: false })}〜${fmtOku(max)}`;
}

/** 軸の目盛り用の短い書き方（0 / 5,000億 / 1兆 / 1.5兆） */
export function fmtOkuTick(v) {
  if (v === 0) return '0';
  if (Math.abs(v) >= 10000) return `${nf.format(v / 10000)}兆`;
  return `${nf.format(v)}億`;
}

export const fmtUsd = (v) => (v == null ? '—' : `${nf.format(v)}百万ドル`);
export const fmtUsdTick = (v) => (v === 0 ? '0' : nf.format(v));

/** 行の値を表示用に（円は億円にそろえ、ドルは換算しない） */
export function fmtValue(o) {
  return o.$.cur === 'JPY' ? fmtOku(o.$.oku) : fmtUsd(o.value);
}

/** 原典に書かれたままの値と単位 */
export const fmtRaw = (o) => `${nf.format(o.value)}${UNIT[o.unit]?.label ?? o.unit}`;

export const fmtPct = (r) => `${(r * 100).toFixed(1)}%`.replace('-', '−');

/** 0 から始まる、きりのよい目盛り */
export function niceTicks(max, count = 4) {
  if (!(max > 0)) return { top: 1, ticks: [0, 1] };
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((st) => st >= raw);
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let i = 0; i * step <= top + step / 2; i++) ticks.push(Math.round(i * step * 1e6) / 1e6);
  return { top, ticks };
}
export const fmtRatio = (r) => `${r.toFixed(2)}倍`;

/** 差分（億円）を符号付きで */
export function fmtDiff(d, cur) {
  if (d == null) return '—';
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±';
  const a = Math.abs(d);
  return cur === 'JPY' ? `${sign}${fmtOku(a)}` : `${sign}${fmtUsd(a)}`;
}

// ---------- 期間・日付 ----------

/** 「2024年度」「2024年」「2024年（年度/暦年不明）」など */
export function fmtPeriod(period, type) {
  const m = /^(\d{4})(?:-Q([1-4])|-(\d{2}))?$/.exec(period ?? '');
  if (!m) return String(period);
  const [, y, q, mo] = m;
  const fy = type === 'FY';
  let base;
  if (q) base = `${y}年${fy ? '度' : ''} 第${q}四半期`;
  else if (mo) base = `${y}年${Number(mo)}月`;
  else base = `${y}年${fy ? '度' : ''}`;
  if (type === 'FY_other') return `${base}（決算期）`;
  if (type === 'unknown' && !mo) return `${base}（年度/暦年 不明）`;
  return base;
}

export const fmtDate = (d) => d ?? '日付不明';

// ---------- 出典の名前 ----------

/** 発行元（原典不明なら「原典不明」） */
export const srcName = (src) => (src ? src.publisher : '原典不明');

/** 同じ発行元の資料を見分けるための補足（発行日か資料名） */
export function srcSub(src) {
  if (!src) return '';
  return src.published ? `${src.published} 発表` : src.title;
}

/** 発行日と資料名の両方（凡例・マトリクスなど、同じ発行元・同じ日の資料を見分けたい所で使う） */
export function srcDetail(src) {
  if (!src) return '';
  return [src.published ? `${src.published} 発表` : null, src.title].filter(Boolean).join(' · ');
}

export function srcLink(src, { label } = {}) {
  if (!src) return h('span', { class: 'src-unknown' }, '原典不明');
  const text = label ?? src.publisher;
  if (!src.url) return h('span', { title: `${src.title}（URL 未登録）` }, text);
  return h('a', { href: src.url, target: '_blank', rel: 'noopener noreferrer', title: src.title }, text);
}

// ---------- ラベル・バッジ ----------

export const periodTypeLabel = (t) => PERIOD_TYPE[t]?.label ?? t;
export const statusLabel = (t) => STATUS[t]?.label ?? t;
export const basisLabel = (b) => BASIS[b]?.label ?? b;
export const sourceTypeLabel = (t) => SOURCE_TYPE[t]?.label ?? t;

/** basis の色見本 */
export function swatch(basis, kind = 'rect') {
  const n = BASIS[basis]?.color ?? 0;
  return h('span', { class: `swatch swatch-${kind}`, style: { '--c': `var(--basis-${n})` }, 'aria-hidden': 'true' });
}
export const basisColor = (basis) => `var(--basis-${BASIS[basis]?.color ?? 0})`;

/** 確認状態のバッジ（§6-4）。確認済みは all=true のときだけ出す */
export function checkBadge(check, { all = false } = {}) {
  if (check === 'unverified') return h('span', { class: 'badge badge-warn', title: CHECK.unverified.desc }, h('span', { 'aria-hidden': 'true' }, '△'), '未確認');
  if (check === 'doubtful') return h('span', { class: 'badge badge-serious', title: CHECK.doubtful.desc }, h('span', { 'aria-hidden': 'true' }, '!'), '要確認');
  if (all && check === 'verified') return h('span', { class: 'badge badge-good', title: CHECK.verified.desc }, h('span', { 'aria-hidden': 'true' }, '✓'), '確認済み');
  return null;
}

/** 実績以外の状態（予測・速報・推計）のタグ */
export function statusTag(status, { all = false } = {}) {
  if (status === 'actual' && !all) return null;
  return h('span', { class: `tag tag-status tag-${status}`, title: STATUS[status]?.desc }, statusLabel(status));
}

export function periodTypeTag(type) {
  const odd = type === 'unknown' || type === 'FY_other';
  return h('span', { class: `tag${odd ? ' tag-unknown' : ''}`, title: PERIOD_TYPE[type]?.desc }, periodTypeLabel(type));
}

/** 「経由: ○○」 */
export function viaTag(viaSrc) {
  if (!viaSrc) return null;
  return h('span', { class: 'via' }, '経由: ', srcLink(viaSrc));
}

const shortFlag = (label) => label.replace(/を含む$/, '');

/** scope を「輸入品 ✓」「医薬部外品 ?」の形で並べる */
export function scopeChips(scope, flags) {
  if (!flags.length) return null;
  return h('span', { class: 'scope' }, flags.map((fl) => {
    const v = scope[fl.id];
    const mark = v === true ? '✓' : v === false ? '✗' : '?';
    const word = v === true ? '含む' : v === false ? '含まない' : '不明';
    const cls = v === true ? 'yes' : v === false ? 'no' : 'unk';
    return h('span', { class: `scope-chip scope-${cls}`, title: `${shortFlag(fl.label)}: ${word}` },
      shortFlag(fl.label), h('span', { class: 'scope-mark', 'aria-hidden': 'true' }, mark),
      h('span', { class: 'sr-only' }, word));
  }));
}

/** 画面で計算した値であることが分かる表示（§6-6） */
export function calc(text, title = '原典の値ではなく、画面で計算した値') {
  return h('span', { class: 'calc', title }, text, h('span', { class: 'calc-tag' }, '計算'));
}

// ---------- ツールチップ（1つを使い回す） ----------

let tipEl = null;

export function showTip(content, clientX, clientY) {
  if (!tipEl) {
    tipEl = h('div', { class: 'tooltip', role: 'tooltip' });
    document.body.append(tipEl);
  }
  clear(tipEl).append(content);
  tipEl.hidden = false;
  const pad = 12;
  const { width, height } = tipEl.getBoundingClientRect();
  let x = clientX + pad;
  let y = clientY + pad;
  if (x + width > window.innerWidth - 8) x = Math.max(8, clientX - width - pad);
  if (y + height > window.innerHeight - 8) y = Math.max(8, clientY - height - pad);
  tipEl.style.left = `${x}px`;
  tipEl.style.top = `${y}px`;
}

export function hideTip() {
  if (tipEl) tipEl.hidden = true;
}

/** 要素の位置にツールチップを出す（キーボード操作用） */
export function showTipAt(el, content) {
  const r = el.getBoundingClientRect();
  showTip(content, r.left + Math.min(r.width, 40), r.bottom);
}

/** 1行分の詳しい説明（ツールチップや一覧で使う） */
export function rowDetail(o, flags) {
  return h('div', { class: 'tip-row' },
    h('div', { class: 'tip-value' }, fmtValue(o),
      o.$.cur === 'JPY' && o.unit !== 'oku_yen' ? h('span', { class: 'tip-raw' }, `（原典: ${fmtRaw(o)}）`) : null),
    h('div', { class: 'tip-name' }, swatch(o.basis, 'line'), `${srcName(o.$.src)}`,
      o.$.src ? h('span', { class: 'muted' }, ` ${srcSub(o.$.src)}`) : null),
    h('div', { class: 'tip-meta' },
      `${o.$.seg.name} · ${fmtPeriod(o.period, o.period_type)} · ${basisLabel(o.basis)} · ${statusLabel(o.status)}`),
    flags.length ? h('div', { class: 'tip-meta' }, scopeChips(o.$.scope, flags)) : null,
    h('div', { class: 'tip-meta' }, checkBadge(o.check, { all: true }), viaTag(o.$.via)),
    o.$.superseded ? h('div', { class: 'tip-meta' }, `新しい発表で改訂済み（${o.$.superseded[0].$.published} 発表）`) : null,
    o.$.yoy ? h('div', { class: 'tip-meta' }, '前年比 ', calc(fmtPct(o.$.yoy.ratio))) : null,
    o.$.share ? h('div', { class: 'tip-meta' }, `${o.$.share.base.$.seg.name}に占める割合 `, calc(fmtPct(o.$.share.ratio))) : null,
    o.note ? h('div', { class: 'tip-note' }, o.note) : null,
  );
}
