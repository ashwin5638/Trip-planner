import { useState } from 'react'

const TripForm = ({ onSubmit, busy }) => {
  const [prompt, setPrompt] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (prompt.trim()) onSubmit(prompt.trim())
  }

  return (
    <form className="trip-form" onSubmit={handleSubmit}>
      <label htmlFor="prompt">Describe your trip</label>
      <textarea
        id="prompt"
        rows="4"
        placeholder="e.g. A 3-day trip to Manali on a ₹6,000 budget"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <button type="submit" disabled={busy || !prompt.trim()}>
        {busy ? 'Planning...' : 'Plan my trip'}
      </button>
    </form>
  )
}

export default TripForm