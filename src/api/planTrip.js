/**
 * Streams an itinerary from POST /api/plan-trip.
 *
 * EventSource cannot issue a POST, so the response body is read directly and
 * the `event:` / `data:` frames are parsed by hand. `onMeta` and `onDay` fire as
 * each day lands; the promise resolves with the final validated trip.
 */
const planTrip = async (prompt, { signal, onMeta, onDay, onReset } = {}) => {
  const res = await fetch('/api/plan-trip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ prompt }),
    signal,
  })
  // Failures raised before the stream opens (a 400 for an empty prompt, say)
  // come back as ordinary JSON.
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.error || `Could not plan your trip. (status ${res.status})`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const nextFrame = () => {
    const boundary = buffer.indexOf('\n\n')
    if (boundary === -1) return null
    const frame = buffer.slice(0, boundary)
    buffer = buffer.slice(boundary + 2)

    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n')

    if (!data) return { type: 'message', data: null }
    try {
      return JSON.parse(data)
    } catch {
      return { type: 'message', data: null }
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let event
    while ((event = nextFrame())) {
      if (event.type === 'error') throw new Error(event.message)
      if (event.type === 'meta') onMeta?.(event)
      else if (event.type === 'day') onDay?.(event.day)
      else if (event.type === 'reset') onReset?.()
      else if (event.type === 'done') return event.trip
    }
  }

  throw new Error('The connection closed before the itinerary was finished.')
}

export default planTrip
