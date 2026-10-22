#!/usr/bin/env node
// 台帳データの検証（仕様書 §7）。
//   node tools/validate.mjs
// エラーがあれば終了コード 1 で止める。警告は一覧に出すだけで止めない。

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIELDS, UNIT, CHECK, UNKNOWN_SOURCE } from '../js/schema.js';
import { isRealDate, parsePeriod, duplicateKey, findMismatches } from '../js/rules.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const IN_ACTIONS = process.env.GITHUB_ACTIONS === 'true';

const errors = [];   // { file, line, msg }
const warnings = []; // { kind, file, line, msg, detail? }

const error = (file, line, msg) => errors.push({ file, line, msg });
const warn = (kind, file, line, msg, detail) => warnings.push({ kind, file, line, msg, detail });

const WARN_KINDS = {
  mismatch:    '不一致（同じ原典を名乗るのに、経由先によって値が違う）',
  check:       '未確認・要確認の行',
  no_url:      'URL が null の出典',
  unknown_key: '定義にない項目（綴りの誤り？）',
  via_same:    'via が source と同じ（原典で直接読んだなら via は null）',
  no_ledger:   '台帳ファイルがない市場',
};

// ---------- 読み込み ----------

async function readJson(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    error(rel(file), null, 'ファイルを読めません');
    return { text: '', data: null };
  }
  try {
    return { text, data: JSON.parse(text) };
  } catch (e) {
    error(rel(file), null, `JSON として読めません: ${e.message}`);
    return { text, data: null };
  }
}

/** "id": "xxx" が書かれている行番号（JSON 配列の中の位置を示すため）。nth 番目の出現を探す */
function lineOfId(text, id, nth = 0) {
  if (typeof id !== 'string') return null;
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`"id"\\s*:\\s*"${esc}"`, 'g');
  let m;
  for (let i = 0; (m = re.exec(text)); i++) {
    if (i === nth) return text.slice(0, m.index).split('\n').length;
  }
  return null;
}

/** 同じ ID が何回目に出てきたかを数える */
function counter() {
  const seen = new Map();
  return (id) => {
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    return n;
  };
}

// ---------- 項目の検査 ----------

const enumList = (values) => Object.keys(values).join(' / ');

function typeMessage(fd, v) {
  switch (fd.type) {
    case 'number': return `${fd.key} が数値ではありません: ${JSON.stringify(v)}`;
    case 'date':   return `${fd.key} が YYYY-MM-DD の日付ではありません: ${JSON.stringify(v)}`;
    case 'period': return `period の形式が違います: ${JSON.stringify(v)}（"2025" / "2025-Q1" / "2025-04" の形）`;
    case 'enum':   return `${fd.key} の値 ${JSON.stringify(v)} は定義にありません（使える値: ${enumList(fd.values)}）`;
    default:       return `${fd.key} の型が違います（${fd.type} であるべき）: ${JSON.stringify(v)}`;
  }
}

function typeOk(fd, v) {
  if (v === null) return !!fd.null;
  switch (fd.type) {
    case 'string':  return typeof v === 'string';
    case 'number':  return typeof v === 'number' && Number.isFinite(v);
    case 'boolean': return typeof v === 'boolean';
    case 'object':  return typeof v === 'object' && !Array.isArray(v);
    case 'array':   return Array.isArray(v);
    case 'date':    return isRealDate(v);
    case 'period':  return parsePeriod(v) !== null;
    case 'enum':    return typeof v === 'string' && Object.hasOwn(fd.values, v);
    default:        return false;
  }
}

/** FIELDS の定義どおりかを見る。問題がなければ true */
function checkFields(obj, kind, file, line, label) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    error(file, line, `${label}: オブジェクトではありません`);
    return false;
  }
  let ok = true;
  const known = new Set();
  for (const fd of FIELDS[kind]) {
    known.add(fd.key);
    const has = Object.hasOwn(obj, fd.key);
    const v = obj[fd.key];
    const blank = fd.type === 'string' && fd.req && typeof v === 'string' && v.trim() === '';
    if (!has || blank) {
      if (fd.req) {
        error(file, line, `${label}: 必須項目 "${fd.key}" がありません`);
        ok = false;
      }
      continue;
    }
    if (!typeOk(fd, v)) {
      error(file, line, `${label}: ${typeMessage(fd, v)}`);
      ok = false;
    }
  }
  for (const k of Object.keys(obj)) {
    if (!known.has(k)) warn('unknown_key', file, line, `${label}: 定義にない項目 "${k}"`);
  }
  return ok;
}

// ---------- markets.json ----------

const marketsFile = path.join(DATA, 'markets.json');
const markets = new Map(); // id -> { market, segIds:Set, flagIds:Set }
{
  const { text, data } = await readJson(marketsFile);
  const file = rel(marketsFile);
  if (data !== null && !Array.isArray(data)) error(file, null, '市場の配列（[ ... ]）にしてください');
  const nth = counter();
  for (const [i, m] of (Array.isArray(data) ? data : []).entries()) {
    const line = lineOfId(text, m?.id, nth(m?.id));
    const label = `市場 ${m?.id ?? `#${i + 1}`}`;
    checkFields(m, 'market', file, line, label);
    if (typeof m?.id !== 'string') continue;
    if (markets.has(m.id)) error(file, line, `${label}: 市場IDが重複しています`);

    const segIds = new Set();
    const segs = Array.isArray(m.segments) ? m.segments : [];
    for (const s of segs) {
      const sl = lineOfId(text, s?.id) ?? line;
      checkFields(s, 'segment', file, sl, `${label} のセグメント ${s?.id ?? '?'}`);
      if (typeof s?.id !== 'string') continue;
      if (segIds.has(s.id)) error(file, sl, `${label}: セグメントID "${s.id}" が重複しています`);
      segIds.add(s.id);
    }
    for (const s of segs) {
      if (s?.parent == null) continue;
      const sl = lineOfId(text, s.id) ?? line;
      if (s.parent === s.id) error(file, sl, `${label}: セグメント "${s.id}" の parent が自分自身です`);
      else if (!segIds.has(s.parent)) error(file, sl, `${label}: セグメント "${s.id}" の parent "${s.parent}" が定義にありません`);
    }

    const flagIds = new Set();
    for (const fl of Array.isArray(m.scope_flags) ? m.scope_flags : []) {
      const fline = lineOfId(text, fl?.id) ?? line;
      checkFields(fl, 'scope_flag', file, fline, `${label} の scope_flag ${fl?.id ?? '?'}`);
      if (typeof fl?.id !== 'string') continue;
      if (flagIds.has(fl.id)) error(file, fline, `${label}: scope_flag "${fl.id}" が重複しています`);
      flagIds.add(fl.id);
    }
    markets.set(m.id, { market: m, segIds, flagIds });
  }
}

// ---------- sources.json ----------

const sourcesFile = path.join(DATA, 'sources.json');
const sources = new Map(); // id -> { source, line }
{
  const { text, data } = await readJson(sourcesFile);
  const file = rel(sourcesFile);
  if (data !== null && !Array.isArray(data)) error(file, null, '出典の配列（[ ... ]）にしてください');
  const nth = counter();
  for (const [i, s] of (Array.isArray(data) ? data : []).entries()) {
    const line = lineOfId(text, s?.id, nth(s?.id));
    const label = `出典 ${s?.id ?? `#${i + 1}`}`;
    checkFields(s, 'source', file, line, label);
    if (typeof s?.id !== 'string') continue;
    if (s.id === UNKNOWN_SOURCE) error(file, line, `${label}: "${UNKNOWN_SOURCE}" は「原典不明」用の予約語なので出典IDに使えません`);
    if (sources.has(s.id)) error(file, line, `${label}: 出典IDが重複しています`);
    sources.set(s.id, { source: s, line });
    if (s.url == null) warn('no_url', file, line, `${s.id}  ${s.title ?? ''}`);
  }
}

// ---------- observations/*.jsonl ----------

const obsDir = path.join(DATA, 'observations');
let files = [];
try {
  files = (await readdir(obsDir)).filter((f) => f.endsWith('.jsonl')).sort();
} catch {
  error(rel(obsDir), null, 'フォルダを読めません');
}

const fmtValue = (o) =>
  typeof o.value === 'number' ? `${o.value.toLocaleString('ja-JP')}${UNIT[o.unit]?.label ?? o.unit}` : String(o.value);
const describe = (o) => `${o.segment} ${o.period} ${o.period_type} ${o.basis} ${o.status} ${fmtValue(o)}`;

const goodRows = []; // 項目の検査を通った行（不一致の判定に使う）
const seenFull = new Map(); // duplicateKey -> 位置
const marketsWithLedger = new Set();
let rowCount = 0;

for (const name of files) {
  const full = path.join(obsDir, name);
  const file = rel(full);
  const fileMarket = name.replace(/\.jsonl$/, '');
  const mk = markets.get(fileMarket);
  if (!mk) error(file, null, `ファイル名の市場ID "${fileMarket}" が markets.json にありません`);
  marketsWithLedger.add(fileMarket);

  const lines = (await readFile(full, 'utf8')).split(/\r?\n/);
  for (const [i, raw] of lines.entries()) {
    const line = i + 1;
    if (raw.trim() === '') continue;
    rowCount++;
    let o;
    try {
      o = JSON.parse(raw);
    } catch (e) {
      error(file, line, `JSON として読めません: ${e.message}`);
      continue;
    }
    const label = `${line}行目`;
    let ok = checkFields(o, 'observation', file, line, label);
    if (o === null || typeof o !== 'object' || Array.isArray(o)) continue;

    // ID の参照
    if (typeof o.market === 'string' && o.market !== fileMarket) {
      error(file, line, `${label}: market "${o.market}" がファイル名（${fileMarket}）と一致しません`);
      ok = false;
    }
    if (mk && typeof o.segment === 'string' && !mk.segIds.has(o.segment)) {
      error(file, line, `${label}: segment "${o.segment}" が市場 ${fileMarket} に定義されていません`);
      ok = false;
    }
    if (typeof o.source === 'string' && o.source !== UNKNOWN_SOURCE && !sources.has(o.source)) {
      error(file, line, `${label}: source "${o.source}" が sources.json にありません`);
      ok = false;
    }
    if (typeof o.via === 'string') {
      if (o.via === UNKNOWN_SOURCE) {
        error(file, line, `${label}: via に "${UNKNOWN_SOURCE}" は使えません（経由先の出典IDを書くか、原典で直接読んだなら null）`);
        ok = false;
      } else if (!sources.has(o.via)) {
        error(file, line, `${label}: via "${o.via}" が sources.json にありません`);
        ok = false;
      } else if (o.via === o.source) {
        warn('via_same', file, line, `${label}: via と source が同じ "${o.via}"`);
      }
    }

    // 原典不明なのに確認済み
    if (o.source === UNKNOWN_SOURCE && o.check === 'verified') {
      error(file, line, `${label}: source が "${UNKNOWN_SOURCE}" なのに check が verified です`);
      ok = false;
    }

    // scope は市場の scope_flags の項目だけ、値は true / false / null
    if (mk && o.scope && typeof o.scope === 'object' && !Array.isArray(o.scope)) {
      for (const [k, v] of Object.entries(o.scope)) {
        if (!mk.flagIds.has(k)) {
          error(file, line, `${label}: scope の "${k}" は市場 ${fileMarket} の scope_flags にありません`);
          ok = false;
        } else if (!(v === true || v === false || v === null)) {
          error(file, line, `${label}: scope.${k} は true / false / null のどれかにしてください: ${JSON.stringify(v)}`);
          ok = false;
        }
      }
    }

    if (!ok) continue;

    // 完全な重複
    const dk = duplicateKey(o);
    if (seenFull.has(dk)) {
      error(file, line, `${label}: ${seenFull.get(dk)} と完全に重複しています`);
      continue;
    }
    seenFull.set(dk, `${file}:${line}`);

    if (o.check === 'unverified' || o.check === 'doubtful') {
      const via = o.via ? ` via=${o.via}` : '';
      warn('check', file, line, `${CHECK[o.check].label}  ${describe(o)}  source=${o.source}${via}`);
    }
    goodRows.push({ ...o, _file: file, _line: line });
  }
}

for (const id of markets.keys()) {
  if (!marketsWithLedger.has(id)) warn('no_ledger', rel(marketsFile), null, `${id}（data/observations/${id}.jsonl がありません）`);
}

for (const g of findMismatches(goodRows)) {
  const a = g.rows[0];
  const lines = g.rows.map((o) => o._line);
  const detail = g.rows.map((o) => `${fmtValue(o)}  経由 ${o.via ?? '（原典で直接）'}（${o._line}行目）`);
  warn('mismatch', a._file, lines[0],
    `${a.segment} ${a.period} ${a.period_type} ${a.basis} ${a.status} / 原典 ${a.source}（${lines.join('・')}行目）`, detail);
}

// ---------- 出力 ----------

const loc = (x) => (x.line ? `${x.file}:${x.line}` : x.file);
const ghEscape = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

console.log('台帳データの検証');
console.log(`  市場 ${markets.size} ・ 出典 ${sources.size} ・ 行 ${rowCount}（台帳 ${files.length}ファイル）`);
console.log('');

if (errors.length) {
  console.log(`エラー ${errors.length}件`);
  for (const e of errors) {
    console.log(`  ${loc(e)}  ${e.msg}`);
    if (IN_ACTIONS) console.log(`::error file=${e.file}${e.line ? `,line=${e.line}` : ''}::${ghEscape(e.msg)}`);
  }
} else {
  console.log('エラー なし');
}
console.log('');

if (warnings.length) {
  console.log(`警告 ${warnings.length}件`);
  for (const [kind, title] of Object.entries(WARN_KINDS)) {
    const list = warnings.filter((w) => w.kind === kind);
    if (!list.length) continue;
    console.log(`  ■ ${title}  ${list.length}件`);
    for (const w of list) {
      console.log(`    ${loc(w)}  ${w.msg}`);
      for (const d of w.detail ?? []) console.log(`        ${d}`);
      if (IN_ACTIONS && kind === 'mismatch') {
        console.log(`::warning file=${w.file}${w.line ? `,line=${w.line}` : ''}::${ghEscape(`不一致: ${w.msg}`)}`);
      }
    }
  }
} else {
  console.log('警告 なし');
}
console.log('');

if (errors.length) {
  console.log(`結果: NG（エラー ${errors.length}件・警告 ${warnings.length}件）`);
  process.exitCode = 1;
} else {
  console.log(`結果: OK（エラー 0件・警告 ${warnings.length}件）`);
}
