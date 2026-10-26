import type { Card_Module } from '../card/card.module'
import type { Member_Module } from '../member/member.module'

export interface Activity_Deps {
  /** What happens to the cards: what the log records. */
  card: Card_Module
  /** That who reads a card's activity belongs to its workspace (its routes). */
  member: Member_Module
}
