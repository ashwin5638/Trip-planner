import { planTrip } from '../server/llm.js'

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

  try {
    return Response.json({ trip: await planTrip(prompt) })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
