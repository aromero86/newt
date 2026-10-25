import { BoundedContext } from 'newt/runtime'
import { FileStore } from 'newt/adapter-files'
import { serve } from 'newt/http'
import { Note_Module } from './modules/note/note.module'
import { NotesBase } from './notes-base'

/**
 * The application's only context. Who sends each request is told by a header here,
 * to keep the example short: a real one reads its session cookie.
 */
export class Notes_Context extends BoundedContext<NotesBase> {

  private constructor(base: NotesBase, readonly notes: Note_Module) {
    super('notes', base)
  }

  static async open(folder: string): Promise<Notes_Context> {
    const base = new NotesBase({ name: 'notes', store: await FileStore.open({ folder }) })
    base.http.authenticateWith(async request => {
      const userId = request.headers.get('x-user')
      return userId ? { userId } : null
    })
    return new Notes_Context(base, Note_Module.initialize(base))
  }

  serve(port: number) {
    return serve({ port, router: this.base.http })
  }
}
