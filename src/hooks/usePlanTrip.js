import { useCallback, useState } from 'react'
import { planTrip } from '../api/planTrip.js'

export const STATUS = {
  IDLE: 'idle',
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error',
}

export function usePlanTrip() {
  const [status, setStatus] = useState(STATUS.IDLE)
  const [trip, setTrip] = useState(null)
  const [error, setError] = useState(null)

  const run = useCallback(async (prompt) => {
    const text = String(prompt || '').trim()

    if (text.length < 10) {
      setStatus(STATUS.ERROR)
      setError({ code: 'EMPTY', message: 'Describe your trip in at least a sentence.' })
      setTrip(null)
      return
    }

    setStatus(STATUS.LOADING)
    setError(null)
    setTrip(null)

    try {
      const result = await planTrip(text)
      setTrip(result)
      setStatus(STATUS.SUCCESS)
    } catch (err) {
      setError({ code: 'NETWORK', message: err.message })
      setStatus(STATUS.ERROR)
    }
  }, [])

  const reset = useCallback(() => {
    setStatus(STATUS.IDLE)
    setTrip(null)
    setError(null)
  }, [])

  return { status, trip, error, run, reset }
}