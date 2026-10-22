// ページ共通の部品。

import { h, clear } from './format.js';

export const SITE_NAME = '市場規模の出典台帳';

/** 読み込みに失敗したときの表示 */
export function showError(main, err) {
  clear(main);
  const local = location.protocol === 'file:';
  main.append(h('div', { class: 'error-box', role: 'alert' },
    h('h1', null, 'データを読み込めませんでした'),
    h('p', null, err?.message ?? String(err)),
    local
      ? h('p', null, 'ファイルを直接（file://）開くと、ブラウザがデータの読み込みを止めます。リポジトリのフォルダで ',
        h('code', null, 'npx serve'), ' などの簡易サーバーを起動し、表示された URL で開いてください。')
      : h('p', null, '台帳のファイルを直したあとは、', h('code', null, 'node tools/validate.mjs'), ' で検証してください。'),
  ));
  console.error(err);
}

/** 主要な処理を実行し、失敗したらエラー表示にする */
export async function boot(fn) {
  const main = document.getElementById('main');
  try {
    await fn(main);
  } catch (e) {
    showError(main, e);
  }
}
