import { streamTrip } from '../server/llm.js'
import { sseHeaders, toSseStream } from '../server/sse.js'

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

  const controller = new AbortController()
  request.signal?.addEventListener('abort', () => controller.abort(), { once: true })

  return new Response(toSseStream(streamTrip(prompt, { signal: controller.signal })), {
    status: 200,
    headers: sseHeaders(),
  })
}
