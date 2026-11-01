import { TableRepository } from 'newt-kit/repository'
import type { z } from 'zod'
import type { MonitorBase } from '../../../../monitor-base'
import { App, type AppSchema } from './app'
import { AppNameTaken } from './errors/app-name-taken'

export type AppRow = z.infer<typeof AppSchema> & { version: number }

export class App_Repository extends TableRepository<App, AppRow, MonitorBase> {

  constructor(base: MonitorBase) {
    // No scope: the monitor has no tenants; every application is the admin's.
    super(base, base.store.table<AppRow>('app'), { scope: 'none' })
  }

  protected toEntity(row: AppRow): App {
    return App.fromDTO(row)
  }

  /** Whether another application than `except` has this name, whatever its case. */
  async isNameTaken(name: string, except?: string): Promise<boolean> {
    return (await this.count({ name: { ieq: name }, ...(except ? { id: { ne: except } } : {}) })) > 0
  }

  /**
   * Saves an application only if no other one has its name, whatever the case:
   * counted again after writing it, in its transaction, guarding the name in lower
   * case, so two saves of `cooper` and `Cooper` at once cannot both have it.
   */
  async persistWithNameFree(app: App): Promise<void> {
    const { name } = app
    await this.save([app], each => this.write(each), {
      guard: [`appName:${name.replace(/[A-Z]/g, letter => letter.toLowerCase())}`],
      after: async () => {
        if (await this.count({ name: { ieq: name } }) > 1) throw new AppNameTaken(name)
      },
    })
  }
}
