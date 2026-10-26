import type { Mailer } from '../../../../shared/mail/mailer'
import type { CardSearch } from '../../search/card-search'

/** What the context configures the cards with. */
export type Card_Options = {
  /** What tells an assignee: the console in development, a list in a test. */
  mailer: Mailer
  /** Where people open boards: the links of its emails start there. */
  publicUrl: string
  /** Where the cards are searched: an index the cards keep as each one changes. */
  search: CardSearch
}
