/** A service that holds something to release (a subscription, a timer) when it goes away. */
export interface Disposable {
  dispose(): void
}
