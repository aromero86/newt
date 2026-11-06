const ZIP_BASED = ['application/zip', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation']

type Signature = { bytes: (number | null)[], at?: number, types: string[] }

/** The bytes files of a type start with; `null` is any byte. */
const SIGNATURES: Signature[] = [
  { bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], types: ['image/png'] },
  { bytes: [0xFF, 0xD8, 0xFF], types: ['image/jpeg'] },
  { bytes: [0x47, 0x49, 0x46, 0x38], types: ['image/gif'] },
  { bytes: [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50], types: ['image/webp'] },
  { bytes: [0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], at: 4, types: ['image/avif'] },
  { bytes: [0x25, 0x50, 0x44, 0x46, 0x2D], types: ['application/pdf'] },
  { bytes: [0x50, 0x4B, 0x03, 0x04], types: ZIP_BASED },
  { bytes: [0x1F, 0x8B], types: ['application/gzip'] },
  { bytes: [0x66, 0x74, 0x79, 0x70], at: 4, types: ['video/mp4', 'audio/mp4'] },
  { bytes: [0x1A, 0x45, 0xDF, 0xA3], types: ['video/webm', 'audio/webm'] },
  // Programs: no type a module would accept says it is one, so one under any name is refused.
  { bytes: [0x4D, 0x5A], types: ['application/vnd.microsoft.portable-executable'] },
  { bytes: [0x7F, 0x45, 0x4C, 0x46], types: ['application/x-elf'] },
]

const KNOWN = new Set(SIGNATURES.flatMap(signature => signature.types))

/** How many of a file's first bytes `matchesType` needs. */
export const SNIFF_BYTES = 16

const fits = (head: Uint8Array, { bytes, at = 0 }: Signature) =>
  bytes.every((byte, index) => byte === null || head[at + index] === byte)

/**
 * Whether a file's first bytes may be of `contentType`. A type with a signature must have
 * it. One without (text, CSV, SVG) cannot be told by its bytes: it passes unless the bytes
 * are those of something else, so such a type must never be served to run in a browser.
 */
export function matchesType(head: Uint8Array, contentType: string): boolean {
  const type = contentType.split(';')[0]!.trim().toLowerCase()
  const found = SIGNATURES.find(signature => fits(head, signature))
  return found ? found.types.includes(type) : !KNOWN.has(type)
}
