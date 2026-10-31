import { z } from 'zod'
import { Entity, now, SecretToken, type EntityInput } from 'newt/core'
import { TokenSchema, type TokenPairDTO, type TokenVerifiedDTO } from './token.schema'

export * from './token.schema'

/** The tokens as they are kept: what anyone sees, and their hashes. */
const TokenEntitySchema = TokenSchema.extend({
  accessTokenHash: z.string().min(1),
  refreshTokenHash: z.string().min(1),
  /** The refresh token this one replaced: kept among the spent ones, as each before it. */
  previousRefreshTokenHash: z.string().nullable(),
})

export type TokenEntityDTO = z.infer<typeof TokenEntitySchema>

/** What each token starts with, so that people and secret scanners recognize it. */
const PREFIX = { access: 'cooper_at_', refresh: 'cooper_rt_' } as const

/** How long each token lasts, as auth is configured. */
export type TokenLifetime = { accessMinutes: number, refreshDays: number }

const minutesFromNow = (minutes: number) => new Date(now().getTime() + minutes * 60_000).toISOString()

/** A fresh pair of tokens, their hashes, and when each one expires. */
function fresh(lifetime: TokenLifetime) {
  const access = SecretToken.generate()
  const refresh = SecretToken.generate()
  return {
    pair: { accessToken: `${PREFIX.access}${access}`, refreshToken: `${PREFIX.refresh}${refresh}`, expiresIn: lifetime.accessMinutes * 60 },
    hashes: { accessTokenHash: SecretToken.hash(access), refreshTokenHash: SecretToken.hash(refresh) },
    expiry: { accessExpiresAt: minutesFromNow(lifetime.accessMinutes), refreshExpiresAt: minutesFromNow(lifetime.refreshDays * 24 * 60) },
  }
}

/**
 * The access and refresh tokens a grant was traded for. The client holds them; the
 * store only their hashes. Each refresh replaces both, so a refresh token works once.
 */
export class Token extends Entity<typeof TokenEntitySchema, typeof TokenSchema> {

  private constructor(input: EntityInput<TokenEntityDTO>, isNew: boolean) {
    super(TokenEntitySchema, input, isNew, TokenSchema)
  }

  static fromDTO(dto: TokenEntityDTO & { version: number }): Token {
    return new Token(dto, false)
  }

  /** The first tokens of a grant whose code was just redeemed. */
  static issue(grant: { grantId: string, userId: string, clientId: string, productId: string, resource: string | null }, lifetime: TokenLifetime): { token: Token, pair: TokenPairDTO } {
    const { pair, hashes, expiry } = fresh(lifetime)
    return { token: new Token({ ...grant, ...hashes, ...expiry, previousRefreshTokenHash: null }, true), pair }
  }

  /** What the store keeps of a token of this kind; null when it cannot be one. */
  static hashOf(kind: keyof typeof PREFIX, value: string): string | null {
    const parsed = SecretToken.schema.safeParse(value.startsWith(PREFIX[kind]) ? value.slice(PREFIX[kind].length) : '')
    return parsed.success ? SecretToken.hash(parsed.data) : null
  }

  get grantId(): string {
    return this.data.grantId
  }

  get clientId(): string {
    return this.data.clientId
  }

  /** The refresh token its last change replaced, still to be kept among the spent ones; null when it replaced none. */
  get refreshTokenSpent(): string | null {
    return this.getChanges()?.previousRefreshTokenHash ?? null
  }

  isAccessValid(at = now()): boolean {
    return new Date(this.data.accessExpiresAt) > at
  }

  isRefreshValid(at = now()): boolean {
    return new Date(this.data.refreshExpiresAt) > at
  }

  /** New tokens for its refresh token: the ones before stop working. */
  rotate(lifetime: TokenLifetime): TokenPairDTO {
    const { pair, hashes, expiry } = fresh(lifetime)
    this.change({ ...hashes, ...expiry, previousRefreshTokenHash: this.data.refreshTokenHash })
    return pair
  }

  /** Given back, or its grant was copied: it opens nothing. Tokens are not history: its row goes. */
  revoke(): void {
    this.markAsDeleted()
  }

  verified(): TokenVerifiedDTO {
    const { userId, clientId, productId, resource, accessExpiresAt } = this.data
    return { userId, clientId, productId, resource, expiresAt: accessExpiresAt }
  }
}
