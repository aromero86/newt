// The contract comes from the backend module; the client is ours.
export {
  ReleasePublishSchema,
  type ReleaseArtifactDTO,
  type ReleaseChangeDTO,
  type ReleaseChangeKind,
  type ReleaseDocumentDTO,
  type ReleaseDTO,
} from '../../../backend/modules/release/release.schema'
export * from './release.api'
