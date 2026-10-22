# 市場規模の出典台帳

一つの市場について、出典ごとにバラバラな「市場規模」の数字を、**定義と一緒に**並べて見るための台帳です。
同じ年の同じ市場でも、数え方（出荷か小売か、国内生産だけか輸入を含むか、年度か暦年か）で数字は倍以上変わります。その違いを見える形にして、引用するときに取り違えないようにします。

仕様書: [docs/spec.md](docs/spec.md)

## 見かた

ビルド工程のない静的サイトです。ファイルを直接（`file://`）開くとブラウザがデータの読み込みを止めるので、簡易サーバーで開きます。

```sh
npx serve .                 # または: python3 -m http.server 8000
```

表示された URL（例: http://localhost:3000/）を開きます。GitHub Pages でもそのまま配信できます。

| ページ | 内容 |
|---|---|
| `index.html` | 市場一覧。最新年の「全体」の幅、出典数、行数、要確認の数、最終更新日 |
| `market.html?id=cosmetics-jp` | 市場ページ。定義の幅 → 時系列 → 定義マトリクス → 一覧表 → 改訂と不一致 → 要確認リスト |
| `sources.html` | 出典カタログ（種類ごと） |
| `glossary.html` | 用語集 |

市場ページの URL には選んだセグメントと年が残ります（例: `market.html?id=cosmetics-jp&seg=import-kr&year=2024`）。`#row-39` を付けると、一覧表のその行（台帳の39行目）を開きます。

## 数字を足す

1. 数字の出典が `data/sources.json` になければ追加する（原典と経由先の両方）。
2. `data/observations/{市場ID}.jsonl` の末尾に、数字1つにつき1行を足す。
3. `node tools/validate.mjs`（または `npm run validate`）で検証する。
4. commit する。push すると GitHub Actions でも同じ検証が走ります。

1行の例:

```json
{"market":"cosmetics-jp","segment":"total","period":"2025","period_type":"FY","status":"actual","basis":"maker_shipment","value":26430,"unit":"oku_yen","scope":{"imports":true,"quasi_drugs":true},"source":"yano-2026-cosmetics","via":null,"check":"verified","retrieved":"2026-10-22","note":""}
```

書き方のルール（1数字1行、定義が分からなければ `unknown` / `null`、確認したことだけ書く、原典と経由先を分ける、計算値は保存しない、古い数字も消さない）は仕様書 §2、項目と列挙値は §4 と用語集にあります。

市場を増やすときは、`data/markets.json` に市場（セグメントと `scope_flags`）を足し、同じ ID の `data/observations/{ID}.jsonl` を作ります。

## 構成

```
index.html / market.html / sources.html / glossary.html
css/style.css
js/
  schema.js        列挙値と項目の定義（画面と検証スクリプトの両方が読む）
  rules.js         系列・重複・不一致・期間の位置などの判定（DOM を使わない）
  load.js          データ読み込み（JSON / JSONL のパース、ID 解決、派生情報）
  format.js        数字・期間の書式、バッジ、ツールチップ
  view-range.js    「定義の幅」グラフ
  view-series.js   時系列グラフ
  view-matrix.js   定義マトリクス
  view-table.js    一覧表・フィルタ
  view-review.js   改訂と不一致、要確認リスト
  page-*.js        各ページの組み立て
data/
  markets.json     市場とセグメントの定義
  sources.json     出典カタログ
  observations/    数字の台帳（市場ごとに1ファイル、JSON Lines）
tools/validate.mjs データ検証（Node 18 以上、依存なし）
.github/workflows/validate.yml
```

列挙値を足すときは `js/schema.js` だけを直せば、検証と表示の両方に反映されます。

## 初版で決めたこと（仕様書 §11 の未決事項のうち、作るために仮に決めたもの）

- **グラフ**: ライブラリを使わず、SVG と HTML を自前で描いています（依存なし・ビルドなし）。
- **見た目**: 仮のスタイルです。ライト／ダーク両対応、色は数え方（basis）ごとに固定で、色だけに頼らず文字のラベルも付けています。
- **サイト名**: 仕様書の題名「市場規模の出典台帳」を仮に使っています。
- 画面で計算した値（前年比・倍率・構成比）は、斜体と「計算」の印で原典の値と区別しています。
- 同じ系列・同じ期間に複数の数字があるとき（不一致など）は、確認済み → 原典で直接読んだもの → 経由先の発行日が新しいもの の順に1つを標準表示にし、ほかは薄く表示します。不一致は時系列上でも「≠」で結んで示します。

## 公開について（仕様書 §9）

当面は手元用です。**リポジトリを公開すると、画面に出さない数字も JSON ごと誰でも見られます。** 調査会社の数字（`license: restricted` / `unknown`）は転載に許諾が必要な場合があるので、公開版を作るときは `open` の行だけを抜き出すスクリプトを用意し、元データは非公開リポジトリに置く予定です（§10 の手順5、未着手）。
