import type { Page } from 'newt/contract'
import type { AppDTO, AppRegisterDTO, AppUpdateDTO } from '../../../src/contexts/monitor/modules/app/app.schema'
import { type PageRequest, Requester } from 'newt-react'

/** Which applications a list shows. */
export type AppStatus = 'active' | 'archived' | 'all'

/** The monitor's `app` module: the applications it watches. */
export class AppApi extends Requester {
  protected readonly path = '/apps'

  list(status: AppStatus = 'active', page?: PageRequest) {
    return this.get<Page<AppDTO>>('', { status, ...page })
  }

  app(id: string) {
    return this.get<AppDTO>(`/${id}`)
  }

  /** Saved only if it answers with that key: a 400 `app.unreachable`, `app.key_rejected` or `app.bad_answer` otherwise. */
  register(input: AppRegisterDTO) {
    return this.post<AppDTO>('', input)
  }

  /** A new address or key is saved only if it answers with them. */
  update(id: string, input: AppUpdateDTO) {
    return this.patch<AppDTO>(`/${id}`, input)
  }

  archive(id: string) {
    return this.post<AppDTO>(`/${id}/archive`)
  }

  restore(id: string) {
    return this.post<AppDTO>(`/${id}/restore`)
  }

  /** Only an archived one: everything known of it goes with it. */
  remove(id: string) {
    return this.delete<void>(`/${id}`)
  }
}
