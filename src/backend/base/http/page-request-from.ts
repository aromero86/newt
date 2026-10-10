import type { PageRequest } from '../../core/pagination/page-request'

const DEFAULT_SIZE = 20
const MAX_SIZE = 100

/** The page a request asks for: `?size=20&cursor=<id>`. The size is kept between 1 and 100. */
export function pageRequestFrom(request: Request): PageRequest {
  const params = new URL(request.url).searchParams
  const size = Number.parseInt(params.get('size') ?? '', 10)
  const cursor = params.get('cursor') || undefined
  return { size: Number.isFinite(size) ? Math.min(MAX_SIZE, Math.max(1, size)) : DEFAULT_SIZE, cursor }
}
