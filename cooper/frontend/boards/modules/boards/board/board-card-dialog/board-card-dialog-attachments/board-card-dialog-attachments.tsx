import { useEffect } from 'react'
import { PaperclipIcon, Trash2Icon } from 'lucide-react'
import { ATTACHMENT_RULE } from '@cooper/api/attachment'
import type { CardDTO } from '@cooper/api/card'
import { Alert } from '@newt-kit/react-ui/alert'
import { Box, BoxEmpty, BoxHeader, BoxRow, BoxRowMeta } from '@newt-kit/react-ui/box'
import { Button } from '@newt-kit/react-ui/button'
import { FileButton } from '@newt-kit/react-ui/file-button'
import { Icon } from '@newt-kit/react-ui/icon'
import { TextLink } from '@newt-kit/react-ui/link'
import { Skeleton } from '@newt-kit/react-ui/skeleton'
import { Provide, useService, useValue } from '@newt-kit/react'
import { BoardCardDialogAttachmentsService } from './board-card-dialog-attachments.service'

/** A length as a person reads it. */
function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** A card's files. With its own BoardCardDialogAttachmentsService. */
export function BoardCardDialogAttachments({ card }: { card: CardDTO }) {
  return (
    <Provide services={[BoardCardDialogAttachmentsService]}>
      <BoardCardDialogAttachmentsWrapped card={card} />
    </Provide>
  )
}

function BoardCardDialogAttachmentsWrapped({ card }: { card: CardDTO }) {
  const service = useService(BoardCardDialogAttachmentsService)
  const items = useValue(service.items)
  const loaded = useValue(service.loaded)
  const uploading = useValue(service.uploading)
  const failure = useValue(service.failure)

  useEffect(() => {
    void service.show(card)
  }, [service, card])

  return (
    <Box label="Attachments">
      <BoxHeader actions={(
        <FileButton variant="ghost" size="sm" accept={ATTACHMENT_RULE.types.join(',')} loading={uploading} onPick={file => void service.attach(file)}>
          <Icon icon={PaperclipIcon} size="sm" />
          Attach a file
        </FileButton>
      )}
      >
        Attachments
      </BoxHeader>
      {failure && <BoxRow><Alert tone="bad" title="Could not attach it">{failure}</Alert></BoxRow>}
      {!loaded && <BoxRow><Skeleton lines={1} /></BoxRow>}
      {loaded && items.length === 0 && !failure && <BoxEmpty icon={PaperclipIcon} title="No files yet" description="Images, PDFs and text files, up to 10 MB." />}
      {items.map(attachment => (
        <BoxRow
          key={attachment.id}
          trailing={(
            <Button variant="ghost" size="icon-sm" label={`Remove ${attachment.filename}`} onClick={() => void service.remove(attachment)}>
              <Icon icon={Trash2Icon} />
            </Button>
          )}
        >
          <TextLink href={service.downloadAddress(attachment)} external>{attachment.filename}</TextLink>
          <BoxRowMeta>{sizeOf(attachment.sizeBytes)}</BoxRowMeta>
        </BoxRow>
      ))}
    </Box>
  )
}
