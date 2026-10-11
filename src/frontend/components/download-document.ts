/** Saves a Markdown document from newt on the person's computer, under its own name. */
export function downloadDocument(document: { fileName: string, markdown: string }): void {
  const url = URL.createObjectURL(new Blob([document.markdown], { type: 'text/markdown;charset=utf-8' }))
  const link = Object.assign(window.document.createElement('a'), { href: url, download: document.fileName })
  link.click()
  URL.revokeObjectURL(url)
}
