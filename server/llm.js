import { z } from 'zod'
import { tripSchema, daySchema } from '../shared/tripSchema.js'
import { DEFAULT_CURRENCY } from '../shared/currency.js'

const API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b'
// gpt-oss is a reasoning model. Left unset it burns the whole budget on
// reasoning and returns an empty completion, so always send it explicitly.
// Groq accepts only low | medium | high.
const REASONING_EFFORT = process.env.GROQ_REASONING_EFFORT || 'low'
const MAX_TOKENS = Number(process.env.LLM_MAX_TOKENS) || 8192
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 120_000
// The free tier caps output tokens per minute per model, so 429s are routine
// rather than exceptional. One retry with backoff turns most of them into a
// slightly slower answer instead of an error.
const RETRIES = Number(process.env.LLM_RETRIES ?? 1)

const PRIMARY_MODE = process.env.GROQ_RESPONSE_MODE || 'prompt'


const TRIP_JSON_SCHEMA = (() => {
  const schema = z.toJSONSchema(tripSchema, { io: 'output' })
  delete schema[String.fromCharCode(36) + 'schema']
  return schema
})()

const RESPONSE_FORMATS = {
  strict: {
    type: 'json_schema',
    json_schema: { name: 'trip_itinerary', strict: true, schema: TRIP_JSON_SCHEMA },
  },
}

// Deliberately short: in `strict` mode the API enforces field formats and
// structure, so only the cross-field rules the schema cannot express belong
// here. `prompt` mode has to carry the schema itself, since nothing enforces it.
const BASE_RULES = `- Every amount is in Indian Rupees (${DEFAULT_CURRENCY}). If the traveller quotes a budget or prices in another currency, convert to ${DEFAULT_CURRENCY} first, then quote realistic local amounts.
- budget.estimated is the total cost of the whole trip, so it must be greater than 0. Activity costs are per-activity estimates; they do not have to add up to it, because transport, lodging and entry are not all tied to one activity.
- Be concrete and specific to the destination. Never pad.
- Output only the JSON object.`

const systemPromptFor = (mode) =>
  `You plan trips for Indian travellers.

Rules:
${BASE_RULES}${
    mode === 'prompt'
      ? `\n\nThe object must validate against this JSON Schema:\n${JSON.stringify(TRIP_JSON_SCHEMA)}`
      : ''
  }`

class LlmError extends Error {
  constructor(message, code, status) {
    super(message)
    this.name = 'LlmError'
    this.code = code
    this.status = status
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function retryAfterMs(response) {
  const header = response.headers.get('retry-after')
  if (!header) return 0
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 15_000)
  const date = Date.parse(header)
  return Number.isFinite(date) ? Math.min(Math.max(date - Date.now(), 0), 15_000) : 0
}

function httpError(status, body) {
  // Groq returns `{ error: { message, type } }`.
  const raw = body?.error
  const message =
    (typeof raw === 'string' ? raw : raw?.message) || `Groq returned status ${status}`
  if (status === 401 || status === 403) return new LlmError(message, 'BAD_KEY', status)
  if (status === 429) {
    // Groq caps output tokens per minute per model, so an itinerary that is
    // simply too long lands here too. Say which, otherwise it reads as noise.
    const detail = /output tokens per minute/i.test(message)
      ? `${message} This model has a low output-token quota, so a long itinerary can trip it — try fewer days.`
      : `${message} Rate limited — wait a moment and try again.`
    return new LlmError(detail, 'RATE_LIMIT', status)
  }
  if (status === 400 || status === 404) return new LlmError(message, 'BAD_REQUEST', status)
  return new LlmError(message, 'UPSTREAM', status)
}

/**
 * Watches the growing JSON text and hands back each itinerary day the instant
 * its closing brace arrives, so the UI can render progressively. Purely a UX
 * aid: the authoritative object is parsed from the full text at the end, so a
 * misfire here can never corrupt the result.
 */
function createDayReader() {
  const seen = new Set()
  let raw = ''
  let scan = -1
  let collecting = false
  let inString = false
  let escaped = false
  let depth = 0
  let start = 0

  return {
    get text() {
      return raw
    },
    push(delta) {
      raw += delta
      const emitted = []

      if (scan === -1) {
        const key = raw.match(/"days"\s*:/)
        if (!key) return emitted
        const open = raw.indexOf('[', key.index)
        if (open === -1) return emitted
        scan = open + 1
      }

      while (scan < raw.length) {
        const char = raw[scan]

        if (collecting) {
          if (inString) {
            if (escaped) escaped = false
            else if (char === '\\') escaped = true
            else if (char === '"') inString = false
          } else if (char === '"') inString = true
          else if (char === '{' || char === '[') depth += 1
          else if (char === '}' || char === ']') {
            depth -= 1
            if (depth === 0) {
              const slice = raw.slice(start, scan + 1)
              scan += 1
              collecting = false
              const day = parseDay(slice)
              if (day && !seen.has(day.day)) {
                seen.add(day.day)
                emitted.push(day)
              }
              continue
            }
          }
          scan += 1
          continue
        }

        if (char === '{') {
          collecting = true
          inString = false
          escaped = false
          depth = 1
          start = scan
        } else if (char === ']') {
          scan = raw.length
          break
        }
        scan += 1
      }

      return emitted
    },
  }
}

function parseDay(slice) {
  let value
  try {
    value = JSON.parse(slice)
  } catch {
    return null
  }
  const result = daySchema.safeParse(value)
  return result.success ? result.data : null
}

function readMeta(raw) {
  const destination = /"destination"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(raw)
  const durationDays = /"durationDays"\s*:\s*(\d+)/.exec(raw)
  if (!destination && !durationDays) return null
  let name
  if (destination) {
    try {
      name = JSON.parse(`"${destination[1]}"`)
    } catch {
      name = undefined
    }
  }
  return {
    destination: name,
    durationDays: durationDays ? Number(durationDays[1]) : undefined,
  }
}

/**
 * Pulls the first complete top-level JSON object out of a model response.
 *
 * Brace counting is string-aware, so braces inside quoted text are ignored, and
 * it stops at the object that actually closes rather than the last `}` in the
 * buffer. That matters because models often append a stray remark after the
 * JSON ("...enjoy your trip!}"), and taking the last brace would splice prose
 * into the payload.
 */
function extractJsonObject(text) {
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i += 1) {
    const char = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function readTrip(raw) {
  const text = raw.replace(/```\w*/g, '')
  const json = extractJsonObject(text)
  if (json === null) {
    throw new LlmError('The model did not return a complete JSON object. Please try again.', 'INVALID_JSON')
  }

  let trip
  try {
    trip = JSON.parse(json)
  } catch {
    throw new LlmError('The model did not return valid JSON. Please try again.', 'INVALID_JSON')
  }

  const result = tripSchema.safeParse(trip)
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || 'root'} ${issue.message}`)
      .join('; ')
    throw new LlmError(`The itinerary came back in the wrong shape (${issues}). Please try again.`, 'INVALID_SHAPE')
  }

  // A zero total for a trip that costs money is a silent failure: the schema
  // allows 0, so zod accepts the default it fills in when the model omits the
  // budget, and the UI would render a priced itinerary as costing nothing.
  // Treat it as a shape error so the strict-mode retry gets a second chance.
  const itinerary = result.data
  const activityTotal = itinerary.days
    .flatMap((day) => day.activities)
    .reduce((total, activity) => total + activity.cost, 0)
  if (itinerary.budget.estimated === 0 && activityTotal > 0) {
    throw new LlmError(
      `The itinerary came back with no budget (activities total ${activityTotal}). Please try again.`,
      'INVALID_SHAPE',
    )
  }

  return itinerary
}

function buildBody(messages, mode) {
  const body = {
    model: MODEL,
    messages,
    reasoning_effort: REASONING_EFFORT,
    max_completion_tokens: MAX_TOKENS,
    temperature: 0.3,
    stream: true,
    stream_options: { include_usage: true },
  }
  const responseFormat = RESPONSE_FORMATS[mode]
  if (responseFormat) body.response_format = responseFormat
  return body
}

async function openStream(body, signal) {
  for (let attempt = 0; ; attempt += 1) {
    let response
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    } catch (err) {
      if (signal?.aborted) throw err
      if (attempt < RETRIES) {
        await wait(500 * 2 ** attempt)
        continue
      }
      if (err.name === 'TimeoutError') {
        throw new LlmError(`The request took longer than ${TIMEOUT_MS}ms and was cut off.`, 'TIMEOUT')
      }
      throw new LlmError(`Could not reach Groq: ${err.message}`, 'NETWORK')
    }

    if (response.ok && response.body) return response

    const payload = await response.json().catch(() => null)
    const error = httpError(response.status, payload)
    const retryable = response.status === 429 || response.status >= 500
    if (attempt < RETRIES && retryable) {
      const delay = retryAfterMs(response) || 500 * 2 ** attempt
      console.warn(`[groq] ${error.code} (${response.status}); retrying in ${delay}ms [attempt ${attempt + 1}/${RETRIES}]`)
      await wait(delay)
      continue
    }
    throw error
  }
}

function report({ startedAt, firstTokenAt, servedModel, serviceTier, usage, prompt, mode }) {
  const total = Date.now() - startedAt
  const ttft = firstTokenAt ? firstTokenAt - startedAt : null
  const parts = [`total ${(total / 1000).toFixed(1)}s`]
  if (ttft !== null) parts.push(`ttft ${(ttft / 1000).toFixed(1)}s`)
  if (usage) {
    // Groq reports server-side phase timings, which separates queue wait from
    // actual generation and makes latency regressions diagnosable.
    if (typeof usage.queue_time === 'number') {
      parts.push(`queue ${(usage.queue_time * 1000).toFixed(0)}ms`)
    }
    if (typeof usage.prompt_time === 'number') {
      parts.push(`prompt ${(usage.prompt_time * 1000).toFixed(0)}ms`)
    }
    parts.push(`in ${usage.prompt_tokens}`)
    parts.push(`out ${usage.completion_tokens}`)
    if (usage.completion_tokens_details?.reasoning_tokens) {
      parts.push(`reasoning ${usage.completion_tokens_details.reasoning_tokens}`)
    }
  } else {
    parts.push('no usage reported')
  }
  console.log(
    `[groq] ${MODEL} | ${mode} | ${servedModel || 'unknown'} | tier ${serviceTier || 'default'} | ${parts.join(' | ')} | "${prompt.slice(0, 60)}"`,
  )
}

async function* runTrip(prompt, signal, mode) {
  if (!process.env.GROQ_API_KEY) {
    throw new LlmError('GROQ_API_KEY is not set. Add it to your .env file and restart the server.', 'NO_API_KEY')
  }

  const startedAt = Date.now()
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const upstream = signal ? AbortSignal.any([timeout, signal]) : timeout

  const response = await openStream(
    buildBody(
      [
        { role: 'system', content: systemPromptFor(mode) },
        { role: 'user', content: prompt },
      ],
      mode,
    ),
    upstream,
  )

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const days = createDayReader()
  let buffered = ''
  let firstTokenAt = null
  let servedModel = null
  let serviceTier = null
  let usage = null
  let finishReason = null
  let lastMeta = {}
  let cancelled = false

  // Cancel the read directly rather than relying on the fetch implementation to
  // tear down an already-open body stream when the signal fires.
  const onAbort = () => {
    cancelled = true
    reader.cancel().catch(() => {})
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffered += decoder.decode(value, { stream: true })

      let newline
      while ((newline = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, newline).trim()
        buffered = buffered.slice(newline + 1)
        if (!line.startsWith('data:')) continue

        const data = line.slice(5).trim()
        if (data === '[DONE]') continue

        let chunk
        try {
          chunk = JSON.parse(data)
        } catch {
          continue
        }

        if (chunk.usage) usage = chunk.usage
        if (chunk.model) servedModel = chunk.model
        if (chunk.service_tier) serviceTier = chunk.service_tier

        const choice = chunk.choices?.[0]
        if (!choice) continue
        if (choice.finish_reason) finishReason = choice.finish_reason

        const delta = choice.delta?.content
        if (!delta) continue
        if (firstTokenAt === null) firstTokenAt = Date.now()

        for (const day of days.push(delta)) {
          yield { type: 'day', day }
        }

        const meta = readMeta(days.text)
        if (meta && (meta.destination !== lastMeta.destination || meta.durationDays !== lastMeta.durationDays)) {
          lastMeta = { ...lastMeta, ...meta }
          yield { type: 'meta', ...lastMeta }
        }
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }

  if (cancelled) throw new LlmError('Request cancelled.', 'CANCELLED')

  report({ startedAt, firstTokenAt, servedModel, serviceTier, usage, prompt, mode })

  if (finishReason === 'length') {
    throw new LlmError(
      `That itinerary is too long for the ${MAX_TOKENS}-token limit. Ask for fewer days to fit.`,
      'TRUNCATED',
    )
  }
  if (!days.text.trim()) {
    throw new LlmError('The model returned an empty response. Please try again.', 'EMPTY_RESPONSE')
  }

  const trip = readTrip(days.text)
  yield { type: 'done', trip }
}

// Shape problems are the model's fault and are worth one more attempt, in the
// mode that the API itself enforces. Transport-level problems (429, 5xx) are
// already retried inside `openStream` and are deliberately not retried here,
// because a rate-limited account will just burn quota twice.
const REPAIRABLE = new Set(['INVALID_JSON', 'INVALID_SHAPE', 'EMPTY_RESPONSE', 'TRUNCATED'])

/**
 * Yields `meta` / `day` / `done` events, or a single terminal `error` event.
 *
 * Runs in `prompt` mode first so days reach the UI as they are written. If the
 * result fails validation it replays the request in `strict` mode, announcing
 * the switch with a `reset` event so the caller can discard the partial days
 * that were streamed from the failed attempt.
 */
export async function* streamTrip(prompt, options = {}) {
  const modes = PRIMARY_MODE === 'prompt' ? ['prompt', 'strict'] : [PRIMARY_MODE]

  for (let index = 0; ; index += 1) {
    const mode = modes[index]
    try {
      yield* runTrip(prompt, options.signal, mode)
      return
    } catch (err) {
      const canRepair = index + 1 < modes.length && REPAIRABLE.has(err.code)
      if (canRepair) {
        console.warn(`[groq] ${mode} mode returned ${err.code}; retrying in ${modes[index + 1]} mode`)
        yield { type: 'reset' }
        continue
      }

      if (err.code) {
        yield { type: 'error', code: err.code, message: err.message }
      } else if (err.name === 'AbortError' && options.signal?.aborted) {
        yield { type: 'error', code: 'CANCELLED', message: 'Request cancelled.' }
      } else if (err.name === 'AbortError' || err.name === 'TimeoutError') {
        yield {
          type: 'error',
          code: 'TIMEOUT',
          message: `The request took longer than ${TIMEOUT_MS}ms and was cut off.`,
        }
      } else {
        yield { type: 'error', code: 'UPSTREAM', message: err.message || 'Could not plan your trip.' }
      }
      return
    }
  }
}

/** Non-streaming convenience wrapper around {@link streamTrip}. */
export async function planTrip(prompt, options = {}) {
  for await (const event of streamTrip(prompt, options)) {
    if (event.type === 'error') {
      throw new LlmError(event.message, event.code)
    }
    if (event.type === 'done') return event.trip
  }
  throw new LlmError('The model closed the stream before finishing the itinerary.', 'TRUNCATED')
}
