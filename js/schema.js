// 台帳の列挙値と項目の定義（仕様書 §4）。
// 画面（ブラウザ）と tools/validate.mjs の両方がこのファイルを読む。
// 値を足すときはここだけを直せば、検証と表示の両方に反映される。

export const PERIOD_TYPE = {
  FY:       { label: '年度',         desc: '4月〜翌3月の年度' },
  CY:       { label: '暦年',         desc: '1月〜12月の暦年' },
  FY_other: { label: 'その他の年度', desc: 'それ以外の年度・決算期（note に期間を書く）' },
  unknown:  { label: '期間不明',     desc: '年度か暦年か分からない' },
};

export const STATUS = {
  actual:      { label: '実績', desc: '実績' },
  preliminary: { label: '速報', desc: '速報値' },
  estimate:    { label: '推計', desc: '推計（実績期間についての見込み）' },
  forecast:    { label: '予測', desc: '予測（将来期間）' },
};

// color は css/style.css の --basis-N に対応する（0 は「不明」用の灰色）。
// 色は値ではなく basis に固定で割り当てる（絞り込みで色が変わらないように）。
export const BASIS = {
  maker_shipment:      { label: 'ブランドメーカー出荷額', short: 'メーカー出荷', desc: 'ブランドを持つメーカーの出荷金額', color: 1 },
  production_shipment: { label: '国内生産の出荷額',       short: '国内生産',     desc: '国内工場で生産された分の出荷金額', color: 2 },
  retail:              { label: '小売・購入額',           short: '小売',         desc: '消費者が支払った金額に近い数え方', color: 3 },
  business_revenue:    { label: '事業者売上高',           short: '事業者売上',   desc: '対象事業者の売上の合計（OEM など）', color: 4 },
  trade_export:        { label: '輸出額',                 short: '輸出',         desc: '貿易統計の輸出', color: 5 },
  trade_import:        { label: '輸入額',                 short: '輸入',         desc: '貿易統計の輸入', color: 6 },
  unknown:             { label: '不明',                   short: '不明',         desc: '原典で定義を確認できていない', color: 0 },
};

// perOku: 「億円 = value / perOku」。null は円に換算しない（別の軸で表示する）。
export const UNIT = {
  oku_yen:     { label: '億円',     perOku: 1,         currency: 'JPY' },
  million_yen: { label: '百万円',   perOku: 100,       currency: 'JPY' },
  yen:         { label: '円',       perOku: 100000000, currency: 'JPY' },
  million_usd: { label: '百万ドル', perOku: null,      currency: 'USD' },
};

export const CHECK = {
  verified:   { label: '確認済み', desc: '原典の文面で数字を確認した' },
  unverified: { label: '未確認',   desc: '経由先でしか確認していない' },
  doubtful:   { label: '要確認',   desc: '年・定義・原典のいずれかに疑問がある' },
};

export const SOURCE_TYPE = {
  government:    { label: '政府・公的統計',     desc: '官公庁・自治体の統計や発表' },
  association:   { label: '業界団体',           desc: '業界団体の統計や発表' },
  research_firm: { label: '調査会社',           desc: '民間調査会社のレポート・プレスリリース' },
  company_ir:    { label: '企業IR',             desc: '企業の決算資料・IR資料' },
  media:         { label: '報道・専門メディア', desc: '新聞・雑誌・ウェブメディアの記事' },
  aggregator:    { label: 'まとめサイト',       desc: 'ほかの資料の数字を集めて載せているサイト' },
};

export const ACCESS = {
  free:         { label: '無料',         desc: '全文を無料で読める' },
  free_summary: { label: '要約のみ無料', desc: '要約（プレスリリースなど）だけ無料で、本体は有料' },
  paid:         { label: '有料',         desc: '読むのにお金がかかる' },
};

export const LICENSE = {
  open:       { label: '出典明記で再利用可', desc: '出典を書けば数字を再利用できる（各サイトの利用規約で条件を確認する）' },
  restricted: { label: '転載に許諾が必要',   desc: '転載に許諾が必要。公開版では数字を伏せる' },
  unknown:    { label: '不明',               desc: '再利用の条件を確認していない。公開版では数字を伏せる' },
};

// 原典が分からないときに source に書く値。
export const UNKNOWN_SOURCE = 'unknown';

export const PERIOD_RE = /^(\d{4})(?:-Q([1-4])|-(0[1-9]|1[0-2]))?$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 項目の定義。
//   req:  キーが必須か
//   type: string / number / boolean / object / array / date / period / enum
//   null: null を許すか
const f = (key, type, req, extra = {}) => ({ key, type, req, ...extra });

export const FIELDS = {
  market: [
    f('id', 'string', true),
    f('name', 'string', true),
    f('geo', 'string', true),
    f('segments', 'array', true),
    f('scope_flags', 'array', true),
    f('note', 'string', false),
  ],
  segment: [
    f('id', 'string', true),
    f('name', 'string', true),
    f('parent', 'string', false),
    f('related', 'boolean', false),
  ],
  scope_flag: [
    f('id', 'string', true),
    f('label', 'string', true),
  ],
  source: [
    f('id', 'string', true),
    f('publisher', 'string', true),
    f('title', 'string', true),
    f('published', 'date', false, { null: true }),
    f('url', 'string', false, { null: true }),
    f('type', 'enum', true, { values: SOURCE_TYPE }),
    f('access', 'enum', true, { values: ACCESS }),
    f('license', 'enum', true, { values: LICENSE }),
    f('note', 'string', false),
  ],
  observation: [
    f('market', 'string', true),
    f('segment', 'string', true),
    f('period', 'period', true),
    f('period_type', 'enum', true, { values: PERIOD_TYPE }),
    f('status', 'enum', true, { values: STATUS }),
    f('basis', 'enum', true, { values: BASIS }),
    f('value', 'number', true),
    f('unit', 'enum', true, { values: UNIT }),
    f('scope', 'object', true),
    f('source', 'string', true),
    f('via', 'string', true, { null: true }),
    f('check', 'enum', true, { values: CHECK }),
    f('retrieved', 'date', true),
    f('note', 'string', false),
  ],
};
