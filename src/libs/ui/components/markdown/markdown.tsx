import ReactMarkdown, { type Components } from 'react-markdown'

/** Each Markdown element, styled like the rest of newt. No raw HTML gets through. */
const components: Components = {
  h1: props => <h2 className="mt-6 mb-2 text-xl font-semibold tracking-tight first:mt-0" {...strip(props)} />,
  h2: props => <h3 className="mt-6 mb-2 text-lg font-semibold tracking-tight first:mt-0" {...strip(props)} />,
  h3: props => <h4 className="mt-4 mb-2 text-base font-semibold first:mt-0" {...strip(props)} />,
  h4: props => <h5 className="mt-4 mb-1 text-sm font-semibold first:mt-0" {...strip(props)} />,
  p: props => <p className="my-2 leading-relaxed first:mt-0 last:mb-0" {...strip(props)} />,
  ul: props => <ul className="my-2 list-disc space-y-1 pl-6" {...strip(props)} />,
  ol: props => <ol className="my-2 list-decimal space-y-1 pl-6" {...strip(props)} />,
  li: props => <li className="leading-relaxed" {...strip(props)} />,
  blockquote: props => <blockquote className="my-3 border-l-2 border-border pl-4 text-muted-foreground" {...strip(props)} />,
  code: props => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...strip(props)} />,
  pre: props => <pre className="my-3 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs [&_code]:bg-transparent [&_code]:p-0" {...strip(props)} />,
  a: props => <a className="font-medium text-primary underline-offset-4 hover:underline" target="_blank" rel="noreferrer" {...strip(props)} />,
  hr: () => <hr className="my-4 border-border" />,
  strong: props => <strong className="font-semibold" {...strip(props)} />,
}

/** react-markdown hands each element its source position too: the DOM does not want it. */
function strip<T extends { node?: unknown }>({ node: _, ...props }: T): Omit<T, 'node'> {
  return props
}

/** Markdown, shown as text: titles, lists, quotes, code and links. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="min-w-0 text-sm text-foreground">
      <ReactMarkdown components={components} skipHtml>{children}</ReactMarkdown>
    </div>
  )
}

