import { TableRepository } from '@newt-kit/newt/repository'
import type { MonitorBase } from '../../../../monitor-base'
import { assertAppThere, unlessAppGone } from '../../../../shared/app-gone'
import { StructureVersion, type StructureVersionDTO } from './structure'

export type StructureVersionRow = StructureVersionDTO & { version: number }

export class StructureVersion_Repository extends TableRepository<StructureVersion, StructureVersionRow, MonitorBase> {

  constructor(base: MonitorBase) {
    // No scope: the monitor has no tenants. Each version says its application.
    super(base, base.store.table<StructureVersionRow>('structure_version', { types: { description: 'json' } }), { scope: 'none' })
  }

  protected toEntity(row: StructureVersionRow): StructureVersion {
    return StructureVersion.fromDTO(row)
  }

  /** An application's last version: its ids are UUIDv7, so the greatest is the newest. */
  latest(appId: string): Promise<StructureVersion | undefined> {
    return this.first({ appId }, { orderBy: [{ field: 'id', direction: 'desc' }] })
  }

  /**
   * Saves a new version only if the one before it is still the last: two refreshes
   * at once read the same last version, and only one of them takes the next. The
   * other runs again (`conflict`), and finds its structure taken. Nor if its
   * application was deleted while it was read, its versions forgotten: whether it saved.
   */
  persistAfter(version: StructureVersion, previous: StructureVersion | undefined, isThere: () => Promise<boolean>): Promise<boolean> {
    return unlessAppGone(() => this.save([version], each => this.write(each), {
      guard: [`structure:${version.appId}`],
      after: async () => {
        await assertAppThere(isThere)
        const [last, before] = await this.find({ appId: version.appId }, { orderBy: [{ field: 'id', direction: 'desc' }], limit: 2 })
        if (last?.id !== version.id || before?.id !== previous?.id) this.conflict()
      },
    }))
  }

  /** Everything of an application, for good: it was deleted. */
  async purgeApp(appId: string): Promise<void> {
    await this.purge({ appId })
  }
}
