import { streamTrip } from '../lib/llm.js'

// A long itinerary can take a while to generate, so give the function room.
export const config = { maxDuration: 300 }

const sseHeaders = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // Stops nginx-style proxies from buffering the stream into one lump.
  'X-Accel-Buffering': 'no',
}

/** One event in the SSE wire format: a name, a JSON payload, a blank line. */
const sseFrame = (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`

/** Turns the generator from _llm.js into the stream the browser reads. */
function toSseStream(events) {
  const encoder = new TextEncoder()
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const event of events) {
          controller.enqueue(encoder.encode(sseFrame(event)))
        }
      } catch (err) {
        controller.enqueue(encoder.encode(sseFrame({ type: 'error', message: err.message })))
      } finally {
        controller.close()
      }
    },
  })
}

export default async function handler(request) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed.' }, { status: 405 })
  }

  let prompt
  try {
    prompt = String((await request.json())?.prompt ?? '').trim()
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (!prompt) {
    return Response.json({ error: 'Prompt is required.' }, { status: 400 })
  }

  // If the browser goes away or the user hits Cancel, stop paying for the rest
  // of the itinerary. Fires on normal completion too, but by then the
  // generator has already finished.
  const controller = new AbortController()
  request.signal?.addEventListener('abort', () => controller.abort(), { once: true })

  return new Response(toSseStream(streamTrip(prompt, { signal: controller.signal })), {
    status: 200,
    headers: sseHeaders,
  })
}
