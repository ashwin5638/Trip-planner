import 'dotenv/config'
import { tripSchema, daySchema } from '../shared/tripSchema.js'
import { DEFAULT_CURRENCY } from '../shared/currency.js'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b'

// Caps how much the model may write. Left to its own default it can overrun the
// output-token-per-minute quota and come back 429.
const MAX_TOKENS = Number(process.env.LLM_MAX_TOKENS) || 8192

// Our own safety net, not a Groq setting: stops a stalled request from holding
// the function open until Vercel kills it.
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 120_000

// What the user sees when something goes wrong on our side. The real reason is
// always written to the server log instead, so nothing about the model, the
// quota or the account ends up in the browser.
const UNAVAILABLE = 'The trip planner is unavailable right now. Please try again.'

// The shape is spelled out by hand rather than generated from shared/tripSchema.js
// with z.toJSONSchema(). The generated schema runs about 9,000 tokens, which is
// over Groq's 8,000 tokens-per-minute limit, so every request came back 413.
// Zod still validates the response, so the two can never drift apart in a way
// that reaches the UI.
const SYSTEM_PROMPT = `You plan trips for Indian travellers.

Rules:
- Every amount is in Indian Rupees (${DEFAULT_CURRENCY}). Convert any other currency the traveller quotes first.
- budget.estimated is the cost of the whole trip — transport, lodging and entry included, not just the activities listed.
- Be concrete and specific. Never pad.
- Output only the JSON object below. No prose, no markdown fences.

{
  "destination": "Manali, Himachal Pradesh",
  "durationDays": 2,
  "days": [
    {
      "day": 1,
      "date": "",
      "title": "Old City and Forts",
      "activities": [
        {
          "time": "09:30",
          "title": "Sunrise at Hidimba Beach",
          "description": "One short practical sentence.",
          "location": "Manali",
          "cost": 0
        }
      ]
    }
  ],
  "budget": { "estimated": 8000, "currency": "${DEFAULT_CURRENCY}" },
  "tips": ["One short practical tip."]
}

Notes:
- day numbers start at 1 and increase by 1 with no gaps.
- time is 24-hour HH:MM. cost is a plain number, 0 if free.
- date is YYYY-MM-DD when the request implied a start date, otherwise "".
- destination and title are written the way an Indian traveller would say them.
- tips holds at most 5 strings.`

/** The header fields the UI shows while the trip is still generating. */
function readMeta(text) {
  const meta = {}
  const destination = /"destination"\s*:\s*"([^"]*)"/.exec(text)
  const durationDays = /"durationDays"\s*:\s*(\d+)/.exec(text)
  if (destination) meta.destination = destination[1]
  if (durationDays) meta.durationDays = Number(durationDays[1])
  return Object.keys(meta).length ? meta : null
}

function parseDay(slice) {
  try {
    const result = daySchema.safeParse(JSON.parse(slice))
    return result.success ? result.data : null
  } catch {
    return null
  }
}

/**
 * Watches the JSON as it streams in and hands back each itinerary day the
 * moment its closing brace lands, so the UI can paint days one at a time.
 * Only a display aid: the real trip is parsed from the full text at the end,
 * so a miscount here can never corrupt the result.
 */
function createDayReader() {
  const seen = new Set()
  let text = ''
  let scan = -1
  let depth = 0
  let start = 0
  let inString = false

  return {
    get text() {
      return text
    },

    push(delta) {
      text += delta
      const found = []

      if (scan === -1) {
        // Days are the objects inside the "days" array, so start after its "[".
        const key = text.indexOf('"days"')
        const open = key === -1 ? -1 : text.indexOf('[', key)
        if (open === -1) return found
        scan = open + 1
      }

      for (; scan < text.length; scan += 1) {
        const char = text[scan]

        // Step over string contents so braces in a title cannot skew the count.
        if (inString) {
          if (char === '\\') scan += 1
          else if (char === '"') inString = false
          continue
        }
        if (char === '"') {
          inString = true
          continue
        }
        if (char === ']') {
          if (depth === 0) break // reached the end of the days array
          continue
        }
        if (char === '{') {
          if (depth === 0) start = scan
          depth += 1
          continue
        }
        if (char === '}' && depth > 0 && --depth === 0) {
          const day = parseDay(text.slice(start, scan + 1))
          if (day && !seen.has(day.day)) {
            seen.add(day.day)
            found.push(day)
          }
        }
      }

      return found
    },
  }
}

/** Turns the full streamed text into a validated trip. */
function parseTrip(text) {
  // Models like to wrap the JSON in a ```json fence.
  const json = text.trim().replace(/^```(?:json)?/, '').replace(/```$/, '').trim()

  let value
  try {
    value = JSON.parse(json)
  } catch {
    console.error('[groq] the model did not return JSON:\n', json)
    throw new Error('The model did not return valid JSON. Please try again.')
  }

  const result = tripSchema.safeParse(value)
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || 'root'} ${issue.message}`)
      .join('; ')
    throw new Error(`The itinerary came back in the wrong shape (${issues}). Please try again.`)
  }

  return result.data
}

/**
 * Calls Groq and yields the itinerary as it is written: a `meta` event once the
 * header fields appear, a `day` event per day, then either `done` with the
 * validated trip or a single `error`. Nothing throws, because the client is
 * already reading a stream by this point and cannot use an HTTP status.
 */
export async function* streamTrip(prompt, { signal } = {}) {
  if (!process.env.GROQ_API_KEY) {
    console.error('[groq] GROQ_API_KEY is not set.')
    yield { type: 'error', message: UNAVAILABLE }
    return
  }

  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const upstream = signal ? AbortSignal.any([timeout, signal]) : timeout

  let response
  try {
    response = await fetch(GROQ_URL, {
      method: 'POST',
      signal: upstream,
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        max_completion_tokens: MAX_TOKENS,
        temperature: 0.3,
        stream: true,
      }),
    })
  } catch (err) {
    if (upstream.aborted) {
      yield { type: 'error', message: `The request took longer than ${TIMEOUT_MS}ms and was cut off.` }
      return
    }
    console.error('[groq] request failed:', err.message)
    yield { type: 'error', message: UNAVAILABLE }
    return
  }

  // Groq returns `{ error: { message, type } }` when it refuses a request. It
  // names our model, quota and organisation, so it is logged, never returned.
  if (!response.ok || !response.body) {
    const detail = await response.json().catch(() => null)
    console.error(`[groq] ${response.status}:`, detail?.error)
    yield { type: 'error', message: UNAVAILABLE }
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const days = createDayReader()
  const meta = {}
  let buffer = ''
  let finishReason = null

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      // Groq streams OpenAI-style SSE: one `data: {...}` per line, and the last
      // line is usually cut in half, so it stays in the buffer for next time.
      const lines = (buffer + decoder.decode(value, { stream: true })).split('\n')
      buffer = lines.pop()

      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') continue

        const choice = JSON.parse(data).choices?.[0]
        if (!choice) continue
        if (choice.finish_reason) finishReason = choice.finish_reason

        const text = choice.delta?.content
        if (!text) continue

        for (const day of days.push(text)) yield { type: 'day', day }

        const next = readMeta(days.text)
        if (next && (next.destination !== meta.destination || next.durationDays !== meta.durationDays)) {
          Object.assign(meta, next)
          yield { type: 'meta', ...meta }
        }
      }
    }

    if (finishReason === 'length') {
      throw new Error(`That itinerary is too long for the ${MAX_TOKENS}-token limit. Try asking for fewer days.`)
    }

    yield { type: 'done', trip: parseTrip(days.text) }
  } catch (err) {
    // The browser hit Cancel, or the timeout fired. Either way there is nobody
    // left to send a result to.
    if (upstream.aborted) return
    yield { type: 'error', message: err.message }
  } finally {
    reader.releaseLock()
  }
}
