import express from 'express'
import 'dotenv/config'
import { planTrip, LlmError } from './llm.js'
const app = express()

app.use(express.json())

app.post('/api/plan-trip', async (req, res) => {
  const prompt = String(req.body.prompt).trim()

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required.' })
  }

  try {
    const trip = await planTrip(prompt)
    return res.json({ trip })
  } catch (err) {
    console.error('Error occurred while planning trip:', err)
    const message = err?.message || 'An error occurred while planning the trip.'
    const status = err instanceof LlmError ? err.status : 500
    return res.status(status).json({
      error: message,
      message,
      code: err?.code || 'UNKNOWN',
    })
  }
})

app.listen(process.env.PORT || 5000, () => {
  console.log(`server running at port ${process.env.PORT || 5000}`)
})
