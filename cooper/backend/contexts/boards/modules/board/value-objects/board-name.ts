import type { ValueObject } from 'newt/core'
import { z } from 'zod'
import { InvalidBoardName } from '../errors/invalid-board-name'

const MAX_LENGTH = 60

/**
 * A board's name: 1 to 60 characters, without spaces around it nor two in a row, so
 * ` Road  map ` and `Road map` are one name. A string at runtime; to the compiler, only
 * one that went through `BoardName.from` or `BoardName.schema` is a `BoardName`.
 */
export type BoardName = string & z.$brand<'BoardName'>

export const BoardName = {
  /** How it is kept: what `from` makes of what someone typed. */
  schema: z.string()
    .min(1)
    .max(MAX_LENGTH)
    .refine(name => name === tidy(name), 'A board\'s name has no spaces around it, nor two in a row')
    .brand<'BoardName'>(),
  from(value: string): BoardName {
    const name = tidy(value)
    if (name.length === 0 || name.length > MAX_LENGTH) throw new InvalidBoardName(value)
    return name as BoardName
  },
} satisfies ValueObject<BoardName, string>

function tidy(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}
