const MAX_REMOTE_JSON_BODY_BYTES = 64 * 1024

export async function readJsonBody<T>(request: AsyncIterable<Buffer | string | Uint8Array>): Promise<T> {
  const chunks: Buffer[] = []
  let totalBytes = 0

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.byteLength
    if (totalBytes > MAX_REMOTE_JSON_BODY_BYTES) {
      throw new Error('Remote request body is too large.')
    }
    chunks.push(buffer)
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
}
