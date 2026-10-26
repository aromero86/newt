import { Route, Routes } from 'react-router'
import { NotFound } from '../../pages/not-found/not-found'
import { Board } from './board/board'
import { BoardsList } from './boards-list/boards-list'

/** The boards zone's own routes, below /w/:workspaceId/boards. */
export function BoardsRoutes() {
  return (
    <Routes>
      <Route index element={<BoardsList />} />
      <Route path=":boardId" element={<Board />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
