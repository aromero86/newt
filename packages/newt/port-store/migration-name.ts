/** How a migration is named: `00003_product-code`. */
export function migrationName(version: number, name: string): string {
  return `${String(version).padStart(5, '0')}_${name}`
}
