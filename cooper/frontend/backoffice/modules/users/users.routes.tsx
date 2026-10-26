import { Route, Routes } from 'react-router'
import { NotFound } from '../../pages/not-found/not-found'
import { Users } from './users'
import { UsersDetail } from './users-detail/users-detail'

/** The users zone: the list, and one account's page. */
export function UsersRoutes() {
  return (
    <Routes>
      <Route index element={<Users />} />
      <Route path=":userId" element={<UsersDetail />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
