import type { KeyCipher } from '../../../../shared/key-cipher'

export type App_Options = {
  /** What seals and opens the applications' keys, with the monitor's secret. */
  cipher: KeyCipher
}
