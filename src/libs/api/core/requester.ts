import { ApiError } from './api-error'
import type { QueryParams } from './query-params'

const BASE_URL = '/api'

/**
 * What every API client shares: the base URL, query params, JSON in and out, and
 * turning a failed answer into an `ApiError`. A client only says its `path` and
 * which requests it makes.
 */
export abstract class Requester {

  /** Called when the backend says the session is gone (401), wherever the request came from. */
  static onUnauthorized: (() => void) | null = null

  /** The client's part of the URL, after `/api`: `/proposals`. */
  protected abstract readonly path: string

  protected get<T>(path: string, params?: QueryParams): Promise<T> {
    return this.call<T>('GET', path, undefined, params)
  }

  protected post<T>(path: string, body?: unknown): Promise<T> {
    return this.call<T>('POST', path, body)
  }

  protected put<T>(path: string, body?: unknown): Promise<T> {
    return this.call<T>('PUT', path, body)
  }

  protected patch<T>(path: string, body?: unknown): Promise<T> {
    return this.call<T>('PATCH', path, body)
  }

  protected delete<T>(path: string): Promise<T> {
    return this.call<T>('DELETE', path)
  }

  private async call<T>(method: string, path: string, body?: unknown, params?: QueryParams): Promise<T> {
    let response: Response
    try {
      response = await fetch(this.url(path, params), {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
      })
    } catch (error) {
      throw new ApiError(0, error instanceof Error ? error.message : 'Request failed')
    }

    if (!response.ok) {
      if (response.status === 401) Requester.onUnauthorized?.()
      const failure = (await response.json().catch(() => null)) as { error?: string, code?: string } | null
      throw new ApiError(response.status, failure?.error ?? response.statusText ?? 'Request failed', failure?.code)
    }

    return (response.status === 204 ? undefined : await response.json()) as T
  }

  private url(path: string, params?: QueryParams): string {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined) query.set(key, String(value))
    }
    const search = query.size ? `?${query}` : ''
    return `${BASE_URL}${this.path}${path}${search}`
  }
}
