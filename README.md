# Travel Planner

Describe a trip in your own words and get a structured, day-by-day itinerary.

React + Vite on the front end, Express on the back end, and [Groq](https://console.groq.com) for generation.

## How it works

1. The browser POSTs your prompt to `/api/plan-trip`.
2. `server/llm.js` calls Groq's OpenAI-compatible `/openai/v1/chat/completions` endpoint with `stream: true`.
3. The JSON Schema is derived from `shared/tripSchema.js` with `z.toJSONSchema(tripSchema, { io: 'output' })`, so the two can never drift apart.
4. As each day finishes generating, the server forwards it over SSE (`meta` → `day` → `day` → … → `done`) and the UI renders it immediately.
5. The final object is validated with zod against `shared/tripSchema.js` and sent in the terminal `done` event.

### Strict schema vs. streaming

Groq accepts `response_format: json_schema` together with `stream: true`, but it **buffers the whole response and emits it as a single delta** — the request succeeds, yet nothing renders until the end. So the two goals, guaranteed schema conformance and progressive rendering, cannot both come from the API.

`server/llm.js` therefore runs one of two modes, selected by `GROQ_RESPONSE_MODE`:

- **`prompt`** (default) — the schema is placed in the system prompt and nothing is enforced server-side. Tokens stream normally and the first day paints roughly twice as early (measured ~0.8s vs ~1.9s for a 3-day Manali trip). The model occasionally drifts from the schema, so the response is still validated by zod.
- **`strict`** — the schema goes in `response_format`, so conformance is guaranteed. Output arrives in one lump, so the UI waits for the whole itinerary.

`prompt` mode failing validation is not a dead end: `streamTrip` automatically replays the request in `strict` mode, emitting a `reset` event first so the UI discards the days streamed from the failed attempt. Malformed output therefore costs latency, not correctness. Only `INVALID_JSON`, `INVALID_SHAPE`, `EMPTY_RESPONSE` and `TRUNCATED` trigger the repair; rate limits and network errors are not retried twice, since a throttled account would only burn more quota.

Because the schema carries the field rules, the system prompt only holds the cross-field rules the schema cannot express (INR conversion, what the trip total should cover, no padding). In `prompt` mode the schema is appended to that prompt.

### Reading the budget

`budget.estimated` is the cost of the whole trip and should match what the traveller actually budgeted. The per-activity `cost` values are itemised estimates and deliberately do **not** have to add up to it — transport, lodging and entry are not all tied to one activity, so summing the activities understates the trip.

A zero total on a trip whose activities cost money is treated as a shape error rather than a free holiday: it is the signature of the model omitting `budget` and zod filling in its default, which would otherwise render a priced itinerary as costing nothing. It therefore triggers the strict-mode retry like any other malformed response.

## Setup

```bash
npm install
```

1. Create an API key at [console.groq.com/keys](https://console.groq.com/keys).
2. Copy `.env.example` to `.env` and set `GROQ_API_KEY`.
3. Run both processes:

```bash
npm run dev
```

The Vite dev server runs on `http://localhost:5173` and proxies `/api` to the Express server on port `5000`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `GROQ_API_KEY` | — | Required. Groq API key. |
| `GROQ_MODEL` | `openai/gpt-oss-20b` | Any model id your account can reach. See [Available models](#available-models). |
| `GROQ_REASONING_EFFORT` | `low` | `low`, `medium` or `high`. Required — see below. |
| `GROQ_RESPONSE_MODE` | `prompt` | `prompt` for progressive rendering, `strict` for guaranteed schema conformance. |
| `LLM_MAX_TOKENS` | `8192` | Output cap via `max_completion_tokens`. Must stay within the model's output-token-per-minute quota. |
| `LLM_TIMEOUT_MS` | `120000` | Per-request timeout. |
| `LLM_RETRIES` | `1` | Retries on 429/5xx/network errors, with exponential backoff honouring `retry-after`. |
| `PORT` | `5000` | Express port. |

Currency defaults to INR — see `shared/currency.js`.

### Reasoning effort is mandatory

`GROQ_REASONING_EFFORT` must always be sent. If it is omitted, `gpt-oss` spends the entire output budget on reasoning and returns **no content at all**, which surfaces as an unparseable response rather than an obvious error. Groq accepts only `low`, `medium` and `high` — unlike OpenAI, there is no `none`, so `low` is the cheapest option.

### Available models

Model access depends on the account, so check what is actually reachable before choosing:

```bash
curl -H "Authorization: Bearer $GROQ_API_KEY" https://api.groq.com/openai/v1/models
```

### Cost and limits

Groq has a free tier, and the binding constraint is the **output tokens per minute** quota, not spend. A request whose `max_completion_tokens` exceeds that quota is rejected outright with a 429 before generation starts, so `LLM_MAX_TOKENS` has to fit inside it — a long itinerary can trip the limit even when the cap looks generous. This is why `LLM_RETRIES` defaults to `1`: with a tight quota, 429s are routine, and one retry usually turns them into a slower answer instead of a failure. The server log reports Groq's `queue_time`, `prompt_time` and `completion_time`, which separates queue wait from actual generation.

Exact per-model quotas and pricing live at [console.groq.com/docs/rate-limits](https://console.groq.com/docs/rate-limits).

## Prompt caching

Groq caches repeated prompt prefixes automatically and cached tokens are exempt from rate limits. The system prompt is fixed across requests, so the prefix is stable and should hit — no extra configuration is needed.

## Scripts

```bash
npm run dev     # server + client with hot reload
npm run build   # production build
npm run lint    # eslint
```
