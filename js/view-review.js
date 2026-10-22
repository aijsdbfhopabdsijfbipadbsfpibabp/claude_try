// 改訂と不一致（仕様書 §5.2-5）と、要確認リスト（§5.2-6）。

import { UNKNOWN_SOURCE } from './schema.js';
import {
  h, clear, fmtValue, fmtOku, fmtUsd, fmtPeriod, fmtPct, fmtRatio, fmtDiff, srcLink, srcName, srcSub,
  swatch, basisLabel, statusLabel, scopeChips, checkBadge, calc,
} from './format.js';

const lineLink = (o, reveal) => {
  const a = h('a', { href: `#row-${o._line}`, class: 'line-link', title: '一覧表のこの行へ' }, `${o._line}行目`);
  a.addEventListener('click', (e) => { e.preventDefault(); reveal(o._line); });
  return a;
};

const defLine = (o, flags, { status = false } = {}) => h('div', { class: 'card-def' },
  h('span', { class: 'rc-basis' }, swatch(o.basis), basisLabel(o.basis)),
  status ? h('span', { class: 'tag' }, statusLabel(o.status)) : null,
  scopeChips(o.$.scope, flags));

export function renderRevisions(root, ledger, { reveal }) {
  clear(root);
  const { revisions, mismatches, flags } = ledger;

  root.append(h('h3', null, '改訂', h('span', { class: 'count-pill' }, revisions.length)));
  root.append(h('p', { class: 'section-lead' }, '同じ発行元・同じ期間・同じ定義で、発行日の違う数字（予測 → 実績など）。'));
  if (!revisions.length) root.append(h('p', { class: 'empty' }, '改訂はまだありません。'));
  const revList = h('div', { class: 'cards' });
  for (const g of revisions) {
    const a = g.rows[0];
    const first = g.rows[0];
    const last = g.rows[g.rows.length - 1];
    const diff = last.$.cmp != null && first.$.cmp != null ? last.$.cmp - first.$.cmp : null;
    revList.append(h('article', { class: 'card' },
      h('h4', null, `${a.$.src.publisher} · ${a.$.seg.name} · ${fmtPeriod(a.period, a.period_type)}`),
      defLine(a, flags),
      h('div', { class: 'scroll-x' }, h('table', { class: 'mini' },
        h('thead', null, h('tr', null, ['発表', '状態', '値', '経由先', '確認', ''].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', null, g.rows.map((o) => h('tr', { class: o.$.superseded ? 'is-old' : null },
          h('td', { class: 'nowrap' }, srcLink(o.$.src, { label: o.$.published ? `${o.$.published} 発表` : '発表日不明' })),
          h('td', null, statusLabel(o.status)),
          h('td', { class: 'num' }, fmtValue(o)),
          h('td', null, o.$.via ? srcLink(o.$.via) : '—'),
          h('td', null, checkBadge(o.check, { all: true })),
          h('td', null, lineLink(o, reveal)),
        ))))),
      diff != null && first !== last
        ? h('p', { class: 'card-foot' }, '最初の発表から最新の発表までの差: ', calc(fmtDiff(diff, a.$.cur)),
          first.$.cmp ? ['（', calc(fmtPct(diff / first.$.cmp)), '）'] : null)
        : null,
    ));
  }
  root.append(revList);

  root.append(h('h3', null, '不一致', h('span', { class: 'count-pill' }, mismatches.length)));
  root.append(h('p', { class: 'section-lead' }, '同じ原典を名乗るのに、経由先によって値が違う数字。原典の文面で確かめるまで、どちらも引用しないほうが安全です。'));
  if (!mismatches.length) root.append(h('p', { class: 'empty' }, '不一致はありません。'));
  const misList = h('div', { class: 'cards' });
  for (const g of mismatches) {
    const a = g.rows[0];
    const vals = g.rows.map((o) => o.$.cmp).filter((v) => v != null);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    misList.append(h('article', { class: 'card card-warn' },
      h('h4', null, `${srcName(a.$.src)} · ${a.$.seg.name} · ${fmtPeriod(a.period, a.period_type)}`),
      a.$.src ? h('div', { class: 'muted small' }, `原典とされる資料: ${a.$.src.title}`) : null,
      defLine(a, flags, { status: true }),
      h('div', { class: 'scroll-x' }, h('table', { class: 'mini' },
        h('thead', null, h('tr', null, ['経由先', '値', '確認', '注記', ''].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', null, g.rows.map((o) => h('tr', null,
          h('td', null, o.$.via ? srcLink(o.$.via) : '原典で直接'),
          h('td', { class: 'num' }, fmtValue(o)),
          h('td', null, checkBadge(o.check, { all: true })),
          h('td', { class: 'small' }, o.note || '—'),
          h('td', null, lineLink(o, reveal)),
        ))))),
      h('p', { class: 'card-foot' }, '最大と最小の差: ', calc(a.$.cur === 'JPY' ? fmtOku(max - min) : fmtUsd(max - min)),
        min > 0 ? ['（最大は最小の ', calc(fmtRatio(max / min)), '）'] : null),
    ));
  }
  root.append(misList);
}

function nextStep(group) {
  if (group.source === UNKNOWN_SOURCE) return '原典を特定する（経由先の記事の出典表記を確かめ、sources.json に登録する）。';
  if (group.src && !group.src.url) return '原典の URL を調べて sources.json に追記し、原典の文面で数字を確かめる。';
  if (group.doubtful) return '原典で年・定義を確かめ、疑問が解けたら check を verified にする。';
  return '原典（リンク先）の文面で数字を確かめ、check を verified にする。';
}

export function renderTodo(root, ledger, { reveal }) {
  clear(root);
  const { todo } = ledger;
  const total = todo.reduce((n, g) => n + g.rows.length, 0);
  root.append(h('p', { class: 'section-lead' },
    `check が「未確認」「要確認」の行と、原典が分からない行。次に原典を当たる対象です。原典ごとにまとめています（${todo.length}原典・${total}行）。`));
  if (!todo.length) {
    root.append(h('p', { class: 'empty' }, '要確認の行はありません。'));
    return;
  }
  for (const g of todo) {
    const open = g.source === UNKNOWN_SOURCE || g.doubtful || g.rows.length <= 4;
    root.append(h('details', { class: 'todo', open },
      h('summary', null,
        h('span', { class: 'todo-title' }, g.src ? srcLink(g.src) : h('strong', null, '原典不明')),
        g.src ? h('span', { class: 'muted small' }, ` ${srcSub(g.src)}`) : null,
        h('span', { class: 'count-pill' }, `${g.rows.length}行`),
        g.src && !g.src.url ? h('span', { class: 'tag tag-mismatch' }, 'URL未登録') : null,
        g.doubtful ? checkBadge('doubtful') : null,
      ),
      h('div', { class: 'todo-body' },
        h('p', { class: 'small' }, h('strong', null, '次にやること: '), nextStep(g)),
        g.vias.length ? h('p', { class: 'small' }, '読んだ経由先: ', g.vias.map((v, i) => [i ? '、' : '', srcLink(v)])) : null,
        h('div', { class: 'table-wrap' }, h('table', { class: 'mini' },
          h('thead', null, h('tr', null, ['セグメント', '期間', '数え方', '値', '確認', '経由先', '注記', ''].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', null, g.rows.map((o) => h('tr', null,
            h('td', null, o.$.seg.name),
            h('td', { class: 'nowrap' }, fmtPeriod(o.period, o.period_type)),
            h('td', null, basisLabel(o.basis)),
            h('td', { class: 'num nowrap' }, fmtValue(o)),
            h('td', { class: 'nowrap' }, checkBadge(o.check, { all: true })),
            h('td', null, o.$.via ? srcLink(o.$.via) : '—'),
            h('td', { class: 'small' }, o.note || '—'),
            h('td', null, lineLink(o, reveal)),
          ))),
        )),
      ),
    ));
  }
}
