const hmac = (key: string | Uint8Array, text: string) =>
  new Bun.CryptoHasher('sha256', key).update(text).digest()

const sha256 = (text: string) => new Bun.CryptoHasher('sha256').update(text).digest('hex')

const encoded = (text: string) =>
  encodeURIComponent(text).replace(/[!'()*]/g, sign => `%${sign.charCodeAt(0).toString(16).toUpperCase()}`)

/**
 * `address`, an upload address Bun presigned, signed again with its length among its headers,
 * which Bun cannot do: S3 then takes a `PUT` of that length and no other. Where it points, its
 * region and its dates stay Bun's. A browser sends `Content-Length` by itself, so no CORS rule
 * has to allow it.
 */
export function withSignedLength(address: string, length: number, secretAccessKey: string): string {
  const url = new URL(address)
  url.searchParams.delete('X-Amz-Signature')
  url.searchParams.set('X-Amz-SignedHeaders', 'content-length;host')

  const query = [...url.searchParams]
    .map(([name, value]) => `${encoded(name)}=${encoded(value)}`)
    .sort()
    .join('&')
  const request = ['PUT', url.pathname, query, `content-length:${length}`, `host:${url.host}`, '', 'content-length;host', 'UNSIGNED-PAYLOAD'].join('\n')

  const date = url.searchParams.get('X-Amz-Date')!
  const scope = url.searchParams.get('X-Amz-Credential')!.split('/').slice(1)
  const key = scope.reduce<string | Uint8Array>((signed, part) => hmac(signed, part), `AWS4${secretAccessKey}`)
  const signature = new Bun.CryptoHasher('sha256', key)
    .update(['AWS4-HMAC-SHA256', date, scope.join('/'), sha256(request)].join('\n'))
    .digest('hex')

  return `${url.origin}${url.pathname}?${query}&X-Amz-Signature=${signature}`
}
