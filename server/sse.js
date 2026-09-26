export function sseHeaders() {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Stops nginx-style proxies from buffering the stream into one lump.
    'X-Accel-Buffering': 'no',
  }
}

export function sseFrame(event) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

/** Adapts an async iterable of `{ type, ... }` events into an SSE body. */
export function toSseStream(events) {
  const encoder = new TextEncoder()
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const event of events) {
          controller.enqueue(encoder.encode(sseFrame(event)))
        }
      } catch (err) {
        // streamTrip reports failures as events; this is a last-resort net for
        // anything that escapes it.
        controller.enqueue(encoder.encode(sseFrame({ type: 'error', code: 'UPSTREAM', message: err.message })))
      } finally {
        controller.close()
      }
    },
  })
}
