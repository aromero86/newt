import { pageRequestFrom } from 'newt/http'
import { archivedFrom } from '../../archived-from'
import type { NotesBase } from '../../notes-base'
import type { NoteCreateDTO, NoteUpdateDTO } from './note'
import type { Note_Module } from './note.module'

/** Each route reads the request, calls a use case and answers: nothing else. */
export function registerNoteRoutes(base: NotesBase, notes: Note_Module): void {
  base.http.get('/notes', async request => Response.json(await notes.list({ archived: archivedFrom(request) }, pageRequestFrom(request))))

  base.http.post('/notes', async request => Response.json(await notes.create(await request.json() as NoteCreateDTO), { status: 201 }))

  base.http.get('/notes/:id', async request => Response.json(await notes.get(request.params.id)))

  base.http.patch('/notes/:id', async request => Response.json(await notes.update(request.params.id, await request.json() as NoteUpdateDTO)))

  base.http.delete('/notes/:id', async request => {
    await notes.delete(request.params.id)
    return new Response(null, { status: 204 })
  })
}
