/** A record as the files store keeps it: anything JSON can say, with an id. */
export type FileRecord = { id: string, [field: string]: unknown }
