/** Which application, and which process of it, a monitor endpoint is (`GET /v1/identity`). */
export type MonitorIdentity = {
  name: string
  /** The version of newt it runs. */
  newt: string
  instance: {
    /** A new one each time the process starts. */
    id: string
    /** The machine's name: in a container, the container's. */
    host: string
    pid: number
  }
  startedAt: string
  /** The commit it was built from (`MonitorOptions.commit`): null when it does not know it. */
  commit: string | null
}
