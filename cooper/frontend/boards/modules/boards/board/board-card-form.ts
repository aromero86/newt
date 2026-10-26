import { z } from 'zod'

// The forms say the limits of the backend's card schema (`CardSchema`) in their
// own words, for the person typing; the backend checks them again.

/** A card's title and description, as someone types them. */
export const CardFormSchema = z.object({
  title: z.string().trim().min(1, 'Give it a title').max(200, 'Keep it under 200 characters'),
  description: z.string().trim().max(5_000, 'Keep it under 5000 characters'),
})

/** An opened card: its words, and where it is and who does it, all saved together. */
export const CardDialogFormSchema = CardFormSchema.extend({
  columnId: z.string().min(1),
  /** A member's id, or `CARD_NOBODY`. */
  assigneeId: z.string().min(1),
})

/** The assignee picker's value for nobody: Radix's select takes no empty value. */
export const CARD_NOBODY = 'nobody'

/** What the card forms say for a backend failure that belongs to no field. */
export const CARD_FORM_MESSAGES = {
  'card.too_many': 'This board has as many cards as a board can hold. Delete cards you no longer need, or start another board.',
}
