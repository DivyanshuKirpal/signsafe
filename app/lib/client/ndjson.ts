/**
 * Reads a streamed NDJSON body (one JSON value per line) and hands each value
 * to `onValue` as soon as its line is complete. Used for the streamed
 * /api/analyze answer, so the page can show each step and the verdict early.
 */
export async function readNdjson<T>(body: ReadableStream<Uint8Array>, onValue: (value: T) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onValue(JSON.parse(line) as T);
      newline = buffer.indexOf("\n");
    }
    if (done) break;
  }
  const rest = (buffer + decoder.decode()).trim();
  if (rest) onValue(JSON.parse(rest) as T);
}
