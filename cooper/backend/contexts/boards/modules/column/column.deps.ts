import type { Board_Module } from '../board/board.module'
import type { Member_Module } from '../member/member.module'

export interface Column_Deps {
  /** That the board a column is added to exists, in the current workspace. */
  board: Board_Module
  member: Member_Module
}
