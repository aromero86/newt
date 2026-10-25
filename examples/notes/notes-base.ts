import { Base } from 'newt/runtime'
import type { FileStore } from 'newt/adapter-files'
import { HttpRouter } from 'newt/http'

/** What the modules of this application receive: the framework's base, on files, with a router. */
export class NotesBase extends Base<FileStore> {
  readonly http = new HttpRouter()
}
