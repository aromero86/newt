/**
 * Where signing in or up leads: the authorization request the person came with
 * (`?authorization=<id>`), or auth's own start. Kept in the address, so a reload, or
 * going from signing in to signing up, keeps it.
 */
export function nextOf(search: URLSearchParams): { authorization: string | null, next: string } {
  const authorization = search.get('authorization')
  return { authorization, next: authorization ? `/authorize/${encodeURIComponent(authorization)}` : '/' }
}

/** Another of these pages, keeping the request the person came with. */
export function keepingAuthorization(path: string, authorization: string | null): string {
  return authorization ? `${path}?${new URLSearchParams({ authorization })}` : path
}
