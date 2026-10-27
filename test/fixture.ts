export type Line = [' ' | '+' | '-', string] | ['@@', string] | ['comment', string];

// Mirrors the markup of GitHub's React "Files changed" view.
const header = (range: string) =>
  `<tr class="diff-line-row"><td class="diff-hunk-cell" colspan="4"><div class="d-flex flex-row">` +
  `<button aria-label="Expand">^</button><div class="diff-text-cell hunk"><div class="diff-text-inner">${range}</div></div>` +
  `</div></td></tr>`;

export const code = (cls: string, text: string) =>
  `<td class="diff-text-cell"><code class="diff-text ${cls}"><div class="diff-text-inner">${text}</div></code></td>`;

const line = ([kind, text]: Line) => {
  if (kind === '@@') return header(text);
  if (kind === 'comment') return `<tr><td colspan="4"><div class="comment">${text}</div></td></tr>`;
  const cls = kind === '+' ? 'addition' : kind === '-' ? 'deletion' : '';
  return `<tr class="diff-line-row"><td></td><td></td>${code(cls, text)}</tr>`;
};

const trailer = `<tr class="diff-line-row"><td class="diff-hunk-cell"><div class="d-flex flex-row"><button>v</button></div></td></tr>`;

export function renderFile(lines: Line[], path = 'src/a.ts'): HTMLTableElement {
  document.body.innerHTML =
    `<div id="diff-abc"><div><h3>${path}</h3></div>` +
    `<table data-diff-anchor="diff-abc" aria-label="Diff for: ${path}"><tbody>${lines.map(line).join('')}${trailer}</tbody></table></div>`;
  return document.querySelector('table') as HTMLTableElement;
}

// One "@@" section with two hunks separated by a context line, then a second section.
export const sample: Line[] = [
  ['@@', '@@ -1,6 +1,6 @@'],
  [' ', 'a'],
  ['-', 'old'],
  ['+', 'new'],
  ['comment', 'looks good'],
  [' ', 'b'],
  ['+', 'added'],
  [' ', 'c'],
  ['@@', '@@ -20,2 +20,3 @@ fn'],
  [' ', 'd'],
  ['-', 'gone'],
  [' ', 'e'],
];
