# Travel Planner

Describe a trip in your own words and get a structured, day-by-day itinerary.

React + Vite on the front end, [Groq](https://console.groq.com) for generation, and one serverless function on [Vercel](https://vercel.com) for the API. There is no Express server.

## How it works

```
src/hooks/usePlanTrip.js
  └─ POST /api/plan-trip
       └─ api/plan-trip.js     the only endpoint
            └─ lib/llm.js      calls Groq, validates the answer
```

1. The browser POSTs your prompt to `/api/plan-trip`.
2. `api/plan-trip.js` checks the prompt and returns an SSE stream.
3. `lib/llm.js` calls Groq's OpenAI-compatible `/openai/v1/chat/completions` endpoint with `stream: true`.
4. As each day finishes generating, it is forwarded over SSE (`meta` → `day` → `day` → … → `done`) and the UI renders it immediately.
5. The full text is validated with zod against `shared/tripSchema.js` and sent in the terminal `done` event.

Every failure is reported as a terminal `error` event rather than an HTTP status, because the client is already reading a stream by that point.

The folder rule is simple: **`api/` holds endpoints, everything else is shared code.** Only files in `api/` become HTTP routes, so a helper can never be exposed by accident. `lib/llm.js` runs in Vercel's Node runtime, which is the only place `GROQ_API_KEY` exists — the browser never sees it.

## Setup

```bash
npm install
```

1. Create an API key at [console.groq.com/keys](https://console.groq.com/keys).
2. Copy `.env.example` to `.env` and set `GROQ_API_KEY`.
3. Start the site and the API together:

```bash
npx vercel dev
```

`vercel dev` serves the Vite build and the API function on the same port, exactly like production. If you only want the front end, `npm run build` then `npm run preview` works too — but the API will not exist.

## Deploying

Push to GitHub and import the repo at [vercel.com/new](https://vercel.com/new). Vercel detects Vite (output `dist/`) and the `api/plan-trip.js` function automatically. Add `GROQ_API_KEY` to the project's environment variables.

Groq's own error text names the model, your quota and your organisation id, so it is only ever written to the server log. The browser gets a generic message.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `GROQ_API_KEY` | — | Required. Groq API key. |
| `GROQ_MODEL` | `openai/gpt-oss-20b` | Any model id your account can reach. |
| `LLM_MAX_TOKENS` | `8192` | Output cap via `max_completion_tokens`. Must stay within the model's output-token-per-minute quota. |
| `LLM_TIMEOUT_MS` | `120000` | Our own guard against a stalled request, not a Groq setting. |

Currency defaults to INR — see `shared/currency.js`.

### Reasoning effort is not sent

Earlier versions passed `reasoning_effort: 'low'` on the grounds that `gpt-oss` needs it, otherwise spends its whole output budget on reasoning and returns nothing. That was never tested. It is: omitting the field returns a complete, valid itinerary, so it was removed.

### The prompt is hand-written, not generated

The JSON shape in `SYSTEM_PROMPT` is written out by hand. It was originally generated with `z.toJSONSchema(tripSchema)`, but that comes to roughly 9,000 tokens — over Groq's 8,000 tokens-per-minute limit — so every request came back `413 Request too large`. The generated schema and the hand-written prompt must therefore be kept in agreement: the prompt tells the model the shape, and `shared/tripSchema.js` is what the response is actually checked against.

### Available models

Model access depends on the account, so check what is actually reachable before choosing:

```bash
curl -H "Authorization: Bearer $GROQ_API_KEY" https://api.groq.com/openai/v1/models
```

### Cost and limits

Groq has a free tier, and the binding constraint is the **output tokens per minute** quota, not spend. A request whose `max_completion_tokens` exceeds that quota is rejected outright with a 429 before generation starts, so `LLM_MAX_TOKENS` has to fit inside it.

Exact per-model quotas and pricing live at [console.groq.com/docs/rate-limits](https://console.groq.com/docs/rate-limits).

### Function duration

`api/plan-trip.js` sets `maxDuration: 300`, but Vercel caps it to 60s on the Hobby plan regardless. A long itinerary can be cut off mid-stream on Hobby, and the browser will report that the connection closed. The 120s `LLM_TIMEOUT_MS` assumes a paid plan.

## Scripts

```bash
npx vercel dev   # site + API, matching production
npm run build    # production build
npm run lint     # eslint
```
