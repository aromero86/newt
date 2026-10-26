/** What the context configures the activity with. */
export type Activity_Options = {
  /** Where a line about each move goes as it happens: the console when tracing, nowhere otherwise. */
  log: (line: string) => void
}
