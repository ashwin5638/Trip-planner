const planTrip = async (prompt) => {
  const res = await fetch('/api/plan-trip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })

  const data = await res.json().catch(() => null)

  if (!res.ok) {
    throw new Error(data?.message || data?.error || 'Could not plan your trip. Please try again.')
  }

  return data.trip
}


export default planTrip