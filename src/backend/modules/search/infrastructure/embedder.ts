import type { Search_Options } from '../search-options'

/** Whether things can be found by meaning: the model is loading, ready, or could not load. */
export type EmbedderStatus = 'loading' | 'ready' | 'unavailable'

/** After failing, how long until loading the model is tried again. */
const RETRY_MINUTES = 5

/**
 * Turns texts into vectors that are close when the texts mean the same, with a
 * model that runs in its own thread. Nothing waits for it: until it is ready, it
 * says so and returns nothing.
 */
export class Embedder {

  private worker: Worker | null = null
  /** Unavailable until started: scripts never load the model. */
  private state: EmbedderStatus = 'unavailable'
  private failedAt = 0
  private next = 0
  private readonly pending = new Map<number, { resolve: (vectors: Float32Array[]) => void, reject: (error: Error) => void }>()

  constructor(private readonly options: Search_Options) {}

  /** Asking also tries loading again, some minutes after failing. */
  get status(): EmbedderStatus {
    if (this.state === 'unavailable') this.start()
    return this.state
  }

  get model(): string {
    return this.options.model
  }

  /** Loads the model, if it is not loaded or loading. */
  start(): void {
    if (this.worker || (this.failedAt && Date.now() - this.failedAt < RETRY_MINUTES * 60_000)) return
    this.state = 'loading'
    const worker = new Worker(new URL('./embedder.worker.ts', import.meta.url).href)
    worker.onmessage = (event: MessageEvent) => {
      const message = event.data
      if (message.ready) this.state = 'ready'
      else if (message.failed) this.fail(new Error(message.failed))
      else {
        const waiting = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) waiting?.reject(new Error(message.error))
        else waiting?.resolve(message.vectors)
      }
    }
    worker.onerror = event => this.fail(new Error(event.message))
    worker.postMessage({ model: this.options.model, modelsPath: this.options.modelsPath })
    this.worker = worker
  }

  /** One vector per text, or null while the model is not ready. */
  async embed(texts: string[], as: 'query' | 'document'): Promise<Float32Array[] | null> {
    if (this.status !== 'ready' || texts.length === 0) return texts.length === 0 ? [] : null
    const id = ++this.next
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker!.postMessage({ id, texts, as })
    })
  }

  private fail(error: Error): void {
    console.error(`The embeddings model ${this.options.model} could not load; searching by words only. ${error.message}`)
    this.state = 'unavailable'
    this.failedAt = Date.now()
    this.worker?.terminate()
    this.worker = null
    for (const waiting of this.pending.values()) waiting.reject(error)
    this.pending.clear()
  }
}
