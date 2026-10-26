import { z } from 'zod'

/** What can happen to a card: one entry of its activity each. */
export const ACTIVITY_KINDS = ['created', 'edited', 'moved', 'assigned', 'unassigned', 'deleted'] as const

/**
 * Something that happened to a card, once: who did it (`actorId`, null when cooper
 * did it on its own) and how they came in (`via`), and what changed (`detail`). Its
 * id is the id of the event it records, so the same event is recorded once.
 */
export const ActivitySchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.string(),
  boardId: z.string(),
  cardId: z.string(),
  kind: z.enum(ACTIVITY_KINDS),
  actorId: z.string().nullable(),
  via: z.enum(['web', 'mcp']).nullable(),
  /** When it happened: when its event was told. */
  at: z.string(),
  /**
   * What changed, by kind: `number` and `title` (created, deleted), `changed` and
   * `title` (edited), `fromColumnId` and `toColumnId` (moved), `assigneeId` and
   * `previousAssigneeId` (assigned, unassigned).
   */
  detail: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export type ActivityDTO = z.infer<typeof ActivitySchema>
export type ActivityKind = ActivityDTO['kind']
