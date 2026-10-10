/** A service: any class built without arguments. Its dependencies come from `inject`. */
export type ServiceClass<T = unknown> = new () => T
