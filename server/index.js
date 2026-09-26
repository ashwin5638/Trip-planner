import express from 'express'
import 'dotenv/config'
import { planTrip } from './llm.js'
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
    console.error('Could not plan trip:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

app.listen(process.env.PORT || 5000, () => {
  console.log(`server running at port ${process.env.PORT || 5000}`)
})
