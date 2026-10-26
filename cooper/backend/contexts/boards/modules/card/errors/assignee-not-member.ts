import { ValidationError } from 'newt/core'

/** A card is assigned only to someone of its workspace: the request named anyone else. */
export class AssigneeNotMember extends ValidationError {
  readonly code = 'card.assignee_not_member'
  constructor(userId: string) {
    super(`${userId} is not a member of this workspace: a card is assigned to one of its members`)
  }
}
