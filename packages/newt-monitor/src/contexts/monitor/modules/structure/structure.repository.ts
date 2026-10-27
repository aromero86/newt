import { TableRepository } from 'newt/repository'
import type { MonitorBase } from '../../../../monitor-base'
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
   * other runs again (`conflict`), and finds its structure taken.
   */
  async persistAfter(version: StructureVersion, previous: StructureVersion | undefined): Promise<void> {
    await this.save([version], each => this.write(each), {
      guard: [`structure:${version.appId}`],
      after: async () => {
        const [last, before] = await this.find({ appId: version.appId }, { orderBy: [{ field: 'id', direction: 'desc' }], limit: 2 })
        if (last?.id !== version.id || before?.id !== previous?.id) this.conflict()
      },
    })
  }
}
