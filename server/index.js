import express from 'express'
import 'dotenv/config'
import { streamTrip } from './llm.js'
import { sseHeaders, sseFrame } from './sse.js'
const app = express()

app.use(express.json())

app.post('/api/plan-trip', async (req, res) => {
  const prompt = String(req.body?.prompt ?? '').trim()

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required.' })
  }

  const controller = new AbortController()
  // If the browser goes away or the user hits Cancel, stop paying for the rest
  // of the itinerary. Fires on normal completion too, but by then the
  // generator has already finished.
  res.on('close', () => controller.abort())

  res.writeHead(200, sseHeaders())
  res.flushHeaders()

  for await (const event of streamTrip(prompt, { signal: controller.signal })) {
    if (res.writableEnded) break
    res.write(sseFrame(event))
  }
  res.end()
})

app.listen(process.env.PORT || 5000, () => {
  console.log(`server running at port ${process.env.PORT || 5000}`)
})
