import { z } from 'zod'

// The backend's card schema brings newt's filters along with it, so the forms repeat
// its limits; the backend checks them again.

/** A card's title and description, as someone types them. */
export const CardFormSchema = z.object({
  title: z.string().trim().min(1, 'Give it a title').max(200, 'Keep it under 200 characters'),
  description: z.string().trim().max(5_000, 'Keep it under 5000 characters'),
})
