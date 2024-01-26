export async function streamToUint8Array(readableStream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = readableStream.getReader()
  const chunks = [] // Array to hold the chunks of data
  let size = 0   // To keep track of the total size

  // Process the stream
  while (true) {
    const { done, value } = await reader.read()
    if (done) { break }

    chunks.push(value)
    size += value.length
  }

  // Concatenate the chunks into a single Uint8Array
  const uint8Array = new Uint8Array(size)
  let position = 0
  for (const chunk of chunks) {
    uint8Array.set(chunk, position)
    position += chunk.length
  }
  reader.releaseLock()

  return uint8Array
}