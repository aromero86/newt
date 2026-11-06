import type { Avatar_Module } from '../avatar/avatar.module'

export interface User_Deps {
  /** Someone's new picture: where it is read from is kept with who they are. */
  avatar: Avatar_Module
}
