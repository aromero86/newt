import type { Member_Module } from '../member/member.module'

export interface Board_Deps {
  /** Who may enter each workspace: its routes run in the workspace scope it gives. */
  member: Member_Module
}
