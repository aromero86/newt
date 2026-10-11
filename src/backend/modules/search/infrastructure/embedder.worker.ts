// Runs the embeddings model in its own thread, so that the server keeps answering
// while it computes. Downloads the model the first time.
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'

declare const self: Worker

type Request = { id: number, texts: string[], as: 'query' | 'document' }

/** How each known model wants its texts and turns them into one vector. */
const PROFILES: Record<string, { pooling: 'cls' | 'mean', query: string, document: string }> = {
  'Snowflake/snowflake-arctic-embed-l-v2.0': { pooling: 'cls', query: 'query: ', document: '' },
}

let model: Promise<FeatureExtractionPipeline> | null = null

self.onmessage = async (event: MessageEvent<{ model: string, modelsPath: string } | Request>) => {
  const message = event.data
  if (!('id' in message)) {
    env.cacheDir = message.modelsPath
    const name = message.model
    model = pipeline('feature-extraction', name, { dtype: 'q8' })
    model.then(() => postMessage({ ready: true }), error => postMessage({ failed: String(error) }))
    self.onmessage = async (next: MessageEvent<Request>) => {
      const { id, texts, as } = next.data
      try {
        const profile = PROFILES[name] ?? { pooling: 'mean', query: '', document: '' }
        const output = await (await model!)(texts.map(text => profile[as] + text), { pooling: profile.pooling, normalize: true })
        postMessage({ id, vectors: (output.tolist() as number[][]).map(vector => new Float32Array(vector)) })
      } catch (error) {
        postMessage({ id, error: String(error) })
      }
    }
  }
}
