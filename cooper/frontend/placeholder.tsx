// Only here so tsconfig.frontend.json has a file to check until the frontends exist:
// delete it then. It proves the browser's project has JSX and the DOM.
export function Placeholder() {
  return <p>{document.title}</p>
}
