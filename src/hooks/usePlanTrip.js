import { useCallback, useRef, useState } from 'react'
import planTrip from "../api/planTrip.js";

export const STATUS = {
  IDLE: 'idle',
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error',
}

const EMPTY_PARTIAL = { destination: '', durationDays: 0, days: [] }

export function usePlanTrip() {
  const [status, setStatus] = useState(STATUS.IDLE)
  const [trip, setTrip] = useState(null)
  const [partial, setPartial] = useState(null)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  // Aborting matters here: the upstream request keeps generating (and billing)
  // until it finishes unless the connection is torn down.
  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const run = useCallback(async (prompt) => {
    const text = String(prompt || '').trim()

    if (text.length < 10) {
      setStatus(STATUS.ERROR)
      setError({ code: 'EMPTY', message: 'Describe your trip in at least a sentence.' })
      setTrip(null)
      setPartial(null)
      return
    }

    stop()
    const controller = new AbortController()
    abortRef.current = controller

    setStatus(STATUS.LOADING)
    setError(null)
    setTrip(null)
    setPartial(EMPTY_PARTIAL)

    try {
      const result = await planTrip(text, {
        signal: controller.signal,
        onMeta: (meta) => setPartial((prev) => (prev ? { ...prev, ...meta } : prev)),
        onDay: (day) => setPartial((prev) => (prev ? { ...prev, days: [...prev.days, day] } : prev)),
        onReset: () => setPartial(EMPTY_PARTIAL),
      })
      if (controller.signal.aborted) return
      setTrip(result)
      setStatus(STATUS.SUCCESS)
    } catch (err) {
      if (err.name === 'AbortError') return
      setError({ code: 'NETWORK', message: err.message })
      setStatus(STATUS.ERROR)
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [stop])

  const reset = useCallback(() => {
    stop()
    setStatus(STATUS.IDLE)
    setTrip(null)
    setPartial(null)
    setError(null)
  }, [stop])

  const cancel = reset

  return { status, trip, partial, error, run, reset, cancel }
}
