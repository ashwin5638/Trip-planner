import { tripSchema } from '../shared/tripSchema.js'
import { DEFAULT_CURRENCY } from '../shared/currency.js'

const API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_MODEL = 'openrouter/free'
const DEFAULT_FALLBACK_MODELS = [
  'qwen/qwen3.8-27b:free',
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
]
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504, 529])

export class LlmError extends Error {
  constructor(message, { code = 'UPSTREAM', status = 502 } = {}) {
    super(message)
    this.name = 'LlmError'
    this.code = code
    this.status = status
  }
}

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

const repairPrompt = (reason) => `That response was not valid for the required schema: ${reason}

Return the corrected itinerary as a single valid JSON object and nothing else. No markdown, no code fences, no commentary.`

function parseModelList(value, defaults) {
  const models = String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  return models.length > 0 ? models : defaults
}

function getConfig() {
  return {
    apiKey: (process.env.OPENROUTER_API_KEY || '').trim(),
    model: (process.env.OPENROUTER_MODEL || '').trim() || DEFAULT_MODEL,
    fallbackModels: parseModelList(process.env.OPENROUTER_FALLBACK_MODELS, DEFAULT_FALLBACK_MODELS),
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS) || 120_000,
    maxTokens: Number(process.env.LLM_MAX_TOKENS) || 8192,
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function retryAfterMs(response) {
  const header = response?.headers?.get?.('retry-after')
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return seconds * 1000
  const date = Date.parse(header)
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now())
}

function upstreamError(status, message) {
  const detail = typeof message === 'string' ? message.trim() : ''
  const suffix = detail ? ` (${detail})` : ''

  if (status === 401) {
    return new LlmError('OPENROUTER_API_KEY is invalid or missing. Check the key in your .env file.', {
      code: 'BAD_KEY',
      status: 500,
    })
  }
  if (status === 402) {
    return new LlmError('Your OpenRouter account has no credits available. Add credits at openrouter.ai/settings/credits.', {
      code: 'NO_CREDITS',
      status: 402,
    })
  }
  if (status === 429) {
    return new LlmError('OpenRouter free-tier limit reached (20 requests/min, 50/day). Wait a moment and try again.', {
      code: 'RATE_LIMIT',
      status: 429,
    })
  }
  if (status === 404 || /is not a valid model id|unknown model|no endpoints found/i.test(detail)) {
    return new LlmError('The configured OpenRouter model does not exist. Check OPENROUTER_MODEL in your .env file.', {
      code: 'BAD_MODEL',
      status: 500,
    })
  }
  if (status === 400) {
    return new LlmError(`OpenRouter rejected the request.${suffix}`, { code: 'BAD_REQUEST', status: 502 })
  }
  return new LlmError(`OpenRouter request failed with status ${status}.${suffix}`, { code: 'UPSTREAM', status: 502 })
}

async function callOpenRouter(config, messages) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.APP_URL || 'http://localhost:5000',
        'X-Title': 'Travel Planner',
      },
      body: JSON.stringify({
        model: config.model,
        models: config.fallbackModels,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: config.maxTokens,
      }),
    })

    const payload = await response.json().catch(() => null)

    if (!response.ok) {
      const err = upstreamError(response.status, payload?.error?.message || payload?.message)
      err.upstreamStatus = response.status
      err.retryAfterMs = retryAfterMs(response)
      throw err
    }

    const content = payload?.choices?.[0]?.message?.content

    if (typeof content !== 'string' || !content.trim()) {
      throw new LlmError('OpenRouter returned an empty response.', { code: 'EMPTY_RESPONSE', status: 502 })
    }

    return { content, model: payload?.model || config.model, retryAfterMs: retryAfterMs(response) }
  } catch (err) {
    if (err instanceof LlmError) throw err
    if (err?.name === 'AbortError') {
      const seconds = config.timeoutMs / 1000
      const label = Number.isInteger(seconds) ? seconds : seconds.toFixed(1)
      throw new LlmError(
        `OpenRouter did not respond within ${label}s. Free models can be slow — try again or raise LLM_TIMEOUT_MS.`,
        { code: 'TIMEOUT', status: 504 },
      )
    }
    throw new LlmError(`Could not reach OpenRouter: ${err?.message || 'network error'}`, {
      code: 'NETWORK',
      status: 502,
    })
  } finally {
    clearTimeout(timer)
  }
}

function shouldRetry(err, attempt) {
  if (attempt >= 2) return false
  if (err?.code === 'TIMEOUT') return attempt === 0
  if (err?.code === 'NETWORK') return true
  return RETRYABLE_STATUS.has(err?.upstreamStatus)
}

async function requestWithRetries(config, messages) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await callOpenRouter(config, messages)
    } catch (err) {
      if (!shouldRetry(err, attempt)) throw err
      const backoff = 1000 * 2 ** attempt + Math.random() * 500
      const delay = err.retryAfterMs ?? backoff
      console.warn(
        `OpenRouter request failed (${err.code}); retrying in ${Math.round(delay)}ms [attempt ${attempt + 1}/2]`,
      )
      await wait(delay)
    }
  }
}

function extractJson(content) {
  const withoutFences = content.replace(/```json?/gi, '').replace(/```/g, '').trim()
  const start = withoutFences.indexOf('{')
  const end = withoutFences.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  return withoutFences.slice(start, end + 1)
}

function readTrip(content) {
  const json = extractJson(content)
  if (!json) return { ok: false, reason: 'no JSON object was found in the response' }

  let parsed
  try {
    parsed = JSON.parse(json)
  } catch (err) {
    return { ok: false, reason: `the JSON could not be parsed (${err.message})` }
  }

  const result = tripSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 4)
      .map((issue) => `${issue.path.join('.') || 'root'} ${issue.message}`)
      .join('; ')
    return { ok: false, reason: `schema validation failed: ${issues}` }
  }

  return { ok: true, trip: result.data }
}

export async function planTrip(prompt) {
  const config = getConfig()

  if (!config.apiKey) {
    throw new LlmError('OPENROUTER_API_KEY is not set. Add it to your .env file and restart the server.', {
      code: 'NO_API_KEY',
      status: 500,
    })
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ]

  const first = await requestWithRetries(config, messages)
  const parsed = readTrip(first.content)

  if (parsed.ok) {
    console.log(`Trip planned by model: ${first.model}`)
    return parsed.trip
  }

  console.warn(`Model returned an invalid itinerary (${parsed.reason}); attempting one repair pass`)

  const repaired = await requestWithRetries(config, [
    ...messages,
    { role: 'assistant', content: first.content },
    { role: 'user', content: repairPrompt(parsed.reason) },
  ])
  const repairedTrip = readTrip(repaired.content)

  if (!repairedTrip.ok) {
    throw new LlmError('The model could not produce a valid itinerary. Try rephrasing your trip with clearer details.', {
      code: 'INVALID_JSON',
      status: 502,
    })
  }

  console.log(`Trip planned after repair by model: ${repaired.model}`)
  return repairedTrip.trip
}
