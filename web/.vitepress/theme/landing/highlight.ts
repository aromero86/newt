/**
 * A small highlighter for the landing's own snippets: comments, strings, decorators, keywords,
 * types and numbers. The snippets are ours, so the HTML it returns is safe to render.
 */
const TOKEN = /(\/\/.*$|(?:^|(?<=\s))--\s.*$)|('(?:[^'\\\n]|\\.)*'|`(?:[^`\\\n]|\\.)*`|"(?:[^"\\\n]|\\.)*")|(@\w+)|\b(const|let|await|async|return|new|if|throw|export|class|extends|static|import|from|function|private|interface|type|readonly|constructor|super|this)\b|\b([A-Z][A-Za-z]*_?[A-Za-z]*)\b|\b(\d+(?:\.\d+)?)\b/gm

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function highlight(code: string): string {
  let html = ''
  let last = 0
  for (const match of code.matchAll(TOKEN)) {
    const index = match.index ?? 0
    html += escape(code.slice(last, index))
    const kind = match[1] ? 'c' : match[2] ? 's' : match[3] ? 'd' : match[4] ? 'k' : match[5] ? 't' : 'n'
    html += `<span class="tok-${kind}">${escape(match[0])}</span>`
    last = index + match[0].length
  }
  return html + escape(code.slice(last))
}
