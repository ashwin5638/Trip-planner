import { tripSchema } from '../shared/tripSchema.js'
import { DEFAULT_CURRENCY } from '../shared/currency.js'

const API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MODEL = process.env.OPENROUTER_MODEL || 'openrouter/free'
const FALLBACK_MODELS = (process.env.OPENROUTER_FALLBACK_MODELS ||
  'qwen/qwen3.8-27b:free,google/gemma-4-31b-it:free,nvidia/nemotron-3-super-120b-a12b:free')
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean)
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 120_000

const systemPrompt = `You are a travel planner. Based on the user's request, build a complete day-by-day trip itinerary and return ONLY valid JSON. Do not include markdown, code fences, comments, or any text outside the JSON. Follow this schema exactly:

{
  "destination": "string",
  "durationDays": 10,
  "days": [
    {
      "day": 1,
      "title": "string",
      "activities": [
        {
          "time": "09:00",
          "title": "string",
          "description": "string",
          "location": "string",
          "cost": 0
        }
      ]
    }
  ],
  "budget": { "estimated": 0, "currency": "${DEFAULT_CURRENCY}" },
  "tips": ["string"]
}

Rules:
- durationDays must equal the number of entries in days.
- day numbers must start at 1 and increase by 1 with no gaps or duplicates.
- Each day must have at least one activity, and each activity needs a time, a title, a description, a location and a cost.
- time must be a 24-hour "HH:MM" string.
- Every amount must be in Indian Rupees (${DEFAULT_CURRENCY}), and budget.currency must be exactly "${DEFAULT_CURRENCY}".
- Price activities the way an Indian traveller would actually pay: quote realistic local amounts in INR. If the user gives a budget or prices in another currency, convert it to INR first.
- cost must be a plain number, never a string (use 0 for free activities).
- budget.estimated must be a number that totals the activity costs.
- Use double quotes for every key and string value, and never emit trailing commas.
- Only output the JSON object.`

const askModel = async (messages) => {
  const response = await fetch(API_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'X-Title': 'Travel Planner',
    },
    body: JSON.stringify({
      model: MODEL,
      models: FALLBACK_MODELS,
      messages,
      response_format: { type: 'json_object' },
      max_tokens: 8192,
    }),
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(payload?.error?.message || `OpenRouter returned status ${response.status}`)
  }

  const content = payload?.choices?.[0]?.message?.content
  if (!content) throw new Error('OpenRouter returned an empty response.')
  return content
}

function readTrip(content) {
  const text = content.replace(/```\w*/g, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')

  let trip
  try {
    trip = JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new Error('The model did not return valid JSON. Please try again.')
  }

  const result = tripSchema.safeParse(trip)
  if (!result.success) {
    throw new Error('The model returned an itinerary in the wrong format. Please try again.')
  }

  return result.data
}

export const planTrip = async (prompt) => {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not set. Add it to your .env file and restart the server.')
  }

  const content = await askModel([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ])

  const trip = readTrip(content)
  console.log(`Trip planned by ${MODEL}`)
  return trip
}
