// 台帳のルール（仕様書 §6・§7）を、DOM を使わない関数として置く。
// 画面と tools/validate.mjs が同じ判定を使うためのファイル。

import { UNIT, PERIOD_RE, DATE_RE } from './schema.js';

/** YYYY-MM-DD で、かつ実在する日付か */
export function isRealDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** "2025" / "2025-Q1" / "2025-04" を分解する。形式が違えば null */
export function parsePeriod(period) {
  const m = PERIOD_RE.exec(period ?? '');
  if (!m) return null;
  const year = Number(m[1]);
  if (m[2]) return { year, quarter: Number(m[2]), grain: 'quarter' };
  if (m[3]) return { year, month: Number(m[3]), grain: 'month' };
  return { year, grain: 'year' };
}

/**
 * 時系列の横軸上の位置（§6-2）。単位は「西暦0年1月からの月数」。
 * 期間の中心に置く: 暦年2024 → 2024年7月1日、年度2024 → 2024年10月1日。
 * FY_other / unknown は暦年の位置に置き、uncertain を立てる（点に「?」を付ける）。
 */
export function periodX(period, periodType) {
  const p = parsePeriod(period);
  if (!p) return null;
  const fy = periodType === 'FY';
  const uncertain = periodType === 'FY_other' || periodType === 'unknown';
  const base = p.year * 12;
  if (p.grain === 'year') return { x: base + (fy ? 9 : 6), uncertain };
  if (p.grain === 'quarter') return { x: base + (fy ? 3 : 0) + (p.quarter - 1) * 3 + 1.5, uncertain };
  return { x: base + (p.month - 1) + 0.5, uncertain: false };
}

/** scope を市場の scope_flags にそろえる。書いていない項目は null（不明）扱い */
export function normScope(scope, flags) {
  const out = {};
  for (const fl of flags) {
    const v = scope?.[fl.id];
    out[fl.id] = v === true || v === false ? v : null;
  }
  return out;
}

export function scopeKey(scope, flags) {
  const s = normScope(scope, flags);
  return flags.map((fl) => `${fl.id}=${s[fl.id] === true ? 1 : s[fl.id] === false ? 0 : '?'}`).join(',');
}

export function currencyOf(unit) {
  return UNIT[unit]?.currency ?? null;
}

/** 億円に換算した値。ドル建てなど換算しない単位は null */
export function toOku(value, unit) {
  const per = UNIT[unit]?.perOku;
  if (per == null || typeof value !== 'number') return null;
  return value / per;
}

/** 同じ通貨どうしで比べられる値（円は億円、ドルは百万ドル） */
export function comparable(o) {
  const v = currencyOf(o.unit) === 'JPY' ? toOku(o.value, o.unit) : o.value;
  return typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : null;
}

const key = (...parts) => JSON.stringify(parts);

/** 完全な重複（§7）: この9項目がすべて同じ行 */
export function duplicateKey(o) {
  return key(o.market, o.segment, o.period, o.period_type, o.basis, o.status, o.source, o.via ?? null, comparable(o));
}

/** 不一致（§7）: via 以外がそろう組。通貨が違う行どうしは比べない */
export function mismatchKey(o) {
  return key(o.market, o.segment, o.period, o.period_type, o.basis, o.status, o.source, currencyOf(o.unit));
}

/**
 * 系列（§6-1）: source・basis・period_type・segment・scope がすべて同じ点だけを線で結ぶ。
 * 通貨と期間の粒度（年・四半期・月）が違うものも別の系列にする。
 */
export function seriesKey(o, flags) {
  return key(o.market, o.segment, o.source, o.basis, o.period_type, scopeKey(o.scope, flags),
    currencyOf(o.unit), parsePeriod(o.period)?.grain ?? null);
}

/**
 * 改訂（§5.2-5）: 同じ発行元・同じ期間・同じ定義の組。
 * この組の中で発行日の違う出典が並ぶと「改訂」になる。
 */
export function revisionKey(o, flags, publisher) {
  return key(o.market, o.segment, o.period, o.period_type, o.basis, scopeKey(o.scope, flags),
    currencyOf(o.unit), publisher);
}

/** 不一致の組を探す: 同じ原典を名乗るのに、via が違い、値も違う行の組 */
export function findMismatches(rows) {
  const groups = new Map();
  for (const o of rows) {
    if (comparable(o) == null) continue;
    const k = mismatchKey(o);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o);
  }
  const out = [];
  for (const [k, g] of groups) {
    if (g.length < 2) continue;
    const hit = g.some((a) => g.some((b) => (a.via ?? null) !== (b.via ?? null) && comparable(a) !== comparable(b)));
    if (hit) out.push({ key: k, rows: g });
  }
  return out;
}
