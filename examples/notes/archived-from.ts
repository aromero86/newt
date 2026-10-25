/** Which a list asks for by `?archived=`: `true` the archived ones, `false` the others, absent (or anything else) all of them. */
export function archivedFrom(request: Request): boolean | undefined {
  const archived = new URL(request.url).searchParams.get('archived')
  return archived === 'true' ? true : archived === 'false' ? false : undefined
}
