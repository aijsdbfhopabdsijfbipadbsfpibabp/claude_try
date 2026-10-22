// データの読み込み（JSON / JSONL のパース）と ID の解決。
// 読み込んだ行に、画面で使う派生情報を o.$ として付ける。元の項目は書き換えない。

import { UNKNOWN_SOURCE } from './schema.js';
import {
  parsePeriod, periodX, normScope, scopeKey, currencyOf, toOku, comparable,
  seriesKey, revisionKey, findMismatches,
} from './rules.js';

const DATA = new URL('../data/', import.meta.url);

export class LoadError extends Error {}

async function getText(name) {
  let res;
  try {
    res = await fetch(new URL(name, DATA), { cache: 'no-cache' });
  } catch (e) {
    throw new LoadError(`data/${name} を読み込めませんでした（${e.message}）`);
  }
  if (!res.ok) throw new LoadError(`data/${name} を読み込めませんでした（HTTP ${res.status}）`);
  return res.text();
}

async function getJson(name) {
  const text = await getText(name);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new LoadError(`data/${name} を JSON として読めません（${e.message}）`);
  }
}

/** JSON Lines を読む。空行は飛ばし、各行に行番号 _line を付ける */
export function parseJsonl(text, name) {
  const rows = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    try {
      rows.push({ ...JSON.parse(line), _line: i + 1 });
    } catch (e) {
      throw new LoadError(`${name} の ${i + 1}行目を JSON として読めません（${e.message}）`);
    }
  });
  return rows;
}

/** markets.json と sources.json */
export async function loadCatalog() {
  const [markets, sources] = await Promise.all([getJson('markets.json'), getJson('sources.json')]);
  return {
    markets,
    sources,
    marketById: new Map(markets.map((m) => [m.id, m])),
    sourceById: new Map(sources.map((s) => [s.id, s])),
  };
}

/** 1つの市場の台帳を読み、派生情報を付けて返す */
export async function loadLedger(catalog, marketId) {
  const market = catalog.marketById.get(marketId);
  if (!market) throw new LoadError(`市場ID「${marketId}」は data/markets.json にありません`);
  const name = `observations/${encodeURIComponent(marketId)}.jsonl`;
  const rows = parseJsonl(await getText(name), `data/${name}`);
  return buildLedger(catalog, market, rows);
}

/** すべての市場の台帳（市場一覧・出典カタログ用）。読めない台帳は error に入れる */
export async function loadAllLedgers(catalog) {
  return Promise.all(catalog.markets.map(async (m) => {
    try {
      return await loadLedger(catalog, m.id);
    } catch (e) {
      return { ...buildLedger(catalog, m, []), error: e.message };
    }
  }));
}

// ---------- 派生情報 ----------

const CHECK_RANK = { verified: 0, unverified: 1, doubtful: 2 };

function prevPeriod(period) {
  const p = parsePeriod(period);
  if (!p) return null;
  if (p.grain === 'year') return String(p.year - 1);
  if (p.grain === 'quarter') return `${p.year - 1}-Q${p.quarter}`;
  return `${p.year - 1}-${String(p.month).padStart(2, '0')}`;
}

function groupBy(list, keyFn) {
  const m = new Map();
  for (const x of list) {
    const k = keyFn(x);
    if (k == null) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

export function buildLedger(catalog, market, rows) {
  const flags = market.scope_flags ?? [];
  const segments = market.segments ?? [];
  const segById = new Map(segments.map((sg) => [sg.id, sg]));

  // セグメントの深さ（親をたどる。循環していても止まるように上限を置く）
  const depthOf = (sg) => {
    let d = 0;
    for (let cur = sg; cur?.parent && d < 10; cur = segById.get(cur.parent)) d++;
    return d;
  };
  const segInfo = segments.map((sg, i) => ({ ...sg, depth: depthOf(sg), order: i }));
  const segInfoById = new Map(segInfo.map((sg) => [sg.id, sg]));
  const root = segInfo.find((sg) => sg.id === 'total')
    ?? segInfo.find((sg) => !sg.parent && !sg.related) ?? segInfo[0] ?? null;

  const srcOf = (id) => {
    if (id == null || id === UNKNOWN_SOURCE) return null;
    return catalog.sourceById.get(id) ?? { id, publisher: id, title: id, published: null, url: null, missing: true };
  };

  for (const o of rows) {
    const p = parsePeriod(o.period);
    const pos = periodX(o.period, o.period_type);
    const src = srcOf(o.source);
    o.$ = {
      src,
      via: o.via ? srcOf(o.via) : null,
      seg: segInfoById.get(o.segment) ?? { id: o.segment, name: o.segment, depth: 0, order: 999 },
      cur: currencyOf(o.unit),
      oku: toOku(o.value, o.unit),
      cmp: comparable(o),
      year: p?.year ?? null,
      grain: p?.grain ?? null,
      x: pos?.x ?? null,
      uncertain: pos?.uncertain ?? true,
      scope: normScope(o.scope, flags),
      scopeKey: scopeKey(o.scope, flags),
      published: src?.published ?? null,
      shadow: null,      // 同じ系列・同じ期間の別の行が標準表示のとき、その行
      superseded: null,  // 同じ発行元の新しい発表で改訂されたとき、新しい行の配列
      mismatch: null,    // 不一致の組に入っているとき、その組
      yoy: null,         // 前年比（計算）
      share: null,       // 親セグメントに占める割合（計算）
    };
  }

  // 系列（§6-1）。同じ期間に複数の行があれば1つを標準表示にし、ほかは薄く表示する（§6-3）。
  // 同じ系列は同じ原典なので発行日では決まらない。確認済み → 原典で直接読んだ行 →
  // 経由先の発行日が新しい行 → 台帳の後ろの行 の順で標準表示を選ぶ。
  const series = [...groupBy(rows, (o) => (o.$.x == null ? null : seriesKey(o, flags))).values()].map((list, i) => {
    const byPeriod = groupBy(list, (o) => o.period);
    const line = [];
    for (const same of byPeriod.values()) {
      same.sort((a, b) =>
        (CHECK_RANK[a.check] ?? 9) - (CHECK_RANK[b.check] ?? 9)
        || (a.via ? 1 : 0) - (b.via ? 1 : 0)
        || (b.$.via?.published ?? '').localeCompare(a.$.via?.published ?? '')
        || b._line - a._line);
      line.push(same[0]);
      for (const o of same.slice(1)) o.$.shadow = same[0];
    }
    line.sort((a, b) => a.$.x - b.$.x);
    const first = list[0];
    const sr = {
      id: `s${i}`,
      segment: first.segment,
      src: first.$.src,
      source: first.source,
      basis: first.basis,
      period_type: first.period_type,
      scope: first.$.scope,
      cur: first.$.cur,
      grain: first.$.grain,
      rows: list.slice().sort((a, b) => a.$.x - b.$.x || a._line - b._line),
      line,
    };
    for (const o of list) o.$.series = sr;
    return sr;
  });

  // 改訂（§5.2-5）: 同じ発行元・同じ期間・同じ定義で、出典（発行日）の違う行の組
  const revisions = [];
  for (const g of groupBy(rows, (o) => (o.$.src ? revisionKey(o, flags, o.$.src.publisher) : null)).values()) {
    if (new Set(g.map((o) => o.source)).size < 2) continue;
    g.sort((a, b) => (a.$.published ?? '').localeCompare(b.$.published ?? '') || a._line - b._line);
    const dates = g.map((o) => o.$.published).filter(Boolean);
    const latest = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
    const newest = g.filter((o) => o.$.published === latest);
    for (const o of g) {
      if (latest && o.$.published && o.$.published < latest) o.$.superseded = newest;
    }
    revisions.push({ rows: g });
  }

  // 不一致（§5.2-5）
  const mismatches = findMismatches(rows).map((g) => ({ rows: g.rows.slice().sort((a, b) => a._line - b._line) }));
  for (const g of mismatches) for (const o of g.rows) o.$.mismatch = g;

  // 前年比（同じ系列の前年同期間の標準表示の行と比べる）
  for (const sr of series) {
    const byPeriod = new Map(sr.line.map((o) => [o.period, o]));
    for (const o of sr.rows) {
      const prev = byPeriod.get(prevPeriod(o.period));
      if (prev && o.$.cmp != null && prev.$.cmp) o.$.yoy = { ratio: o.$.cmp / prev.$.cmp, base: prev };
    }
  }

  // 構成比（親セグメントの、同じ出典・同じ定義・同じ期間・同じ状態の行と比べる）
  const parentKey = (o, segId) => JSON.stringify([segId, o.source, o.basis, o.period, o.period_type, o.status, o.$.scopeKey, o.$.cur]);
  const parentIdx = groupBy(rows, (o) => parentKey(o, o.segment));
  for (const o of rows) {
    const parent = o.$.seg.parent;
    if (!parent || o.$.cmp == null) continue;
    const cands = (parentIdx.get(parentKey(o, parent)) ?? []).filter((p) => !p.$.shadow && p.$.cmp);
    const base = cands.find((p) => (p.via ?? null) === (o.via ?? null)) ?? cands[0];
    if (base) o.$.share = { ratio: o.$.cmp / base.$.cmp, base };
  }

  // 要確認リスト（§5.2-6）: 原典ごとにまとめる
  const todoRows = rows.filter((o) => o.check === 'unverified' || o.check === 'doubtful' || o.source === UNKNOWN_SOURCE);
  const todo = [...groupBy(todoRows, (o) => o.source).entries()].map(([source, list]) => ({
    source,
    src: srcOf(source),
    rows: list.sort((a, b) => a.$.seg.order - b.$.seg.order || (a.$.x ?? 0) - (b.$.x ?? 0)),
    vias: [...new Map(list.filter((o) => o.$.via).map((o) => [o.via, o.$.via])).values()],
    doubtful: list.some((o) => o.check === 'doubtful'),
  })).sort((a, b) =>
    (a.source === UNKNOWN_SOURCE ? 0 : 1) - (b.source === UNKNOWN_SOURCE ? 0 : 1)
    || (b.doubtful ? 1 : 0) - (a.doubtful ? 1 : 0)
    || b.rows.length - a.rows.length);

  const sourceIds = new Set();
  for (const o of rows) {
    if (o.source && o.source !== UNKNOWN_SOURCE) sourceIds.add(o.source);
    if (o.via) sourceIds.add(o.via);
  }

  return {
    market,
    flags,
    segments: segInfo,
    segById: segInfoById,
    root,
    rows,
    series,
    revisions,
    mismatches,
    todo,
    stats: {
      rows: rows.length,
      sources: sourceIds.size,
      todo: todoRows.length,
      lastRetrieved: rows.reduce((m, o) => (o.retrieved > m ? o.retrieved : m), '') || null,
    },
  };
}

// ---------- 画面で使う問い合わせ ----------

/** そのセグメントの年単位の数字がある年（新しい順） */
export function annualYears(ledger, segId) {
  const ys = new Set(ledger.rows.filter((o) => o.segment === segId && o.$.grain === 'year').map((o) => o.$.year));
  return [...ys].sort((a, b) => b - a);
}

/** その年・セグメントの年単位の行 */
export function rowsForYear(ledger, segId, year) {
  return ledger.rows.filter((o) => o.segment === segId && o.$.grain === 'year' && o.$.year === year);
}

/** 比べる対象になる行（新しい発表で改訂された行は除く） */
export const isCurrent = (o) => !o.$.superseded;

/**
 * 「最新年の幅」に使う年: 比べられる円建ての数字が2つ以上ある最新の年。
 * なければ数字のある最新の年。
 */
export function comparisonYear(ledger, segId) {
  const years = annualYears(ledger, segId);
  for (const y of years) {
    const n = rowsForYear(ledger, segId, y).filter((o) => isCurrent(o) && o.$.cur === 'JPY').length;
    if (n >= 2) return y;
  }
  return years[0] ?? null;
}

/** 円建ての最小〜最大 */
export function rangeOf(rows) {
  const vals = rows.filter((o) => isCurrent(o) && o.$.cur === 'JPY' && o.$.oku != null).map((o) => o.$.oku);
  if (!vals.length) return null;
  return { min: Math.min(...vals), max: Math.max(...vals), n: vals.length };
}
