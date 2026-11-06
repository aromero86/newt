/**
 * Sends a file to the address an `uploadStart` gave: the storage's, not the API's, so it
 * goes as it is, with no session. Only `uploadConfirm` says whether it was accepted.
 */
export async function uploadFile(address: string, file: File): Promise<void> {
  const response = await fetch(address, { method: 'PUT', body: file, headers: { 'content-type': file.type } })
  if (!response.ok) throw new Error('The file could not be sent')
}
