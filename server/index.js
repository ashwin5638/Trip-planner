import express from 'express'
import 'dotenv/config'
import {planTrip} from './llm'
const app = express()

app.use(express.json())

app.post('/api/plan-trip', async (req,res) => {
    const prompt = String(req.body.prompt).trim()

      if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required.' })
  }

  try{
    const rawResponse = await planTrip(prompt)

    const tripData = JSON.parse(rawResponse)

    return res.json({trip : tripData})
      
  }catch(err){
    console.error('Error occurred while planning trip:', err)
    return res.status(500).json({ error: 'An error occurred while planning the trip.' })
  }
})


app.listen(5000, () => {
    console.log("server running at port 5000")
})