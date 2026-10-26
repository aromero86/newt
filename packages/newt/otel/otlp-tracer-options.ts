export type OtlpTracerOptions = {
  /** Where the collector listens for OTLP over HTTP: `http://localhost:4318`. Spans go to its `/v1/traces`. */
  endpoint: string
  /** What the application is called in its traces: their `service.name`. */
  service: string
  /** What each export sends besides: an API key, for one. */
  headers?: Record<string, string>
  /** How often it sends the spans that ended: every 5 seconds unless told. */
  intervalMs?: number
}
