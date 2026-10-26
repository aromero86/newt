// The contract comes from the backend module; the client is ours.
export type { ColumnAddDTO, ColumnDTO, ColumnMoveDTO, ColumnRenameDTO } from '../../../backend/contexts/boards/modules/column/column.schema'
// Plain zod: safe to bring into the browser, for the forms to validate with.
export { ColumnAddSchema, ColumnRenameSchema, MAX_COLUMNS } from '../../../backend/contexts/boards/modules/column/column.schema'
export * from './column.api'
