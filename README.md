# Travel Planner

Describe a trip in your own words and get a structured, day-by-day itinerary.

React + Vite on the front end, Express on the back end, and OpenRouter (free models) for generation.

## How it works

1. The browser POSTs your prompt to `/api/plan-trip`.
2. `server/llm.js` calls OpenRouter's OpenAI-compatible `/api/v1/chat/completions` endpoint, asking for a JSON object matching `shared/tripSchema.js`.
3. The response is validated with zod against `shared/tripSchema.js`. If the model returns malformed JSON, the request fails with a friendly error.
4. The validated object is sent back and rendered by `src/components/TripResult.jsx`.

## Setup

```bash
npm install
```

1. Create a free API key at [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys).
2. Copy `.env.example` to `.env` and set `OPENROUTER_API_KEY`.
3. Run both processes:

```bash
npm run dev
```

The Vite dev server runs on `http://localhost:5173` and proxies `/api` to the Express server on port `5000`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | — | Required. OpenRouter API key. |
| `OPENROUTER_MODEL` | `openrouter/free` | Primary model. `openrouter/free` is a router that picks a free model supporting the parameters you send. |
| `OPENROUTER_FALLBACK_MODELS` | `qwen/qwen3.8-27b:free,google/gemma-4-31b-it:free,nvidia/nemotron-3-super-120b-a12b:free` | Comma-separated fallbacks tried when the primary model has no available provider. |
| `LLM_TIMEOUT_MS` | `120000` | Per-request timeout. Free models are slow; raise this for long itineraries. |
| `PORT` | `5000` | Express port. |

Any model id from the [OpenRouter catalog](https://openrouter.ai/models) can be used in `OPENROUTER_MODEL`. Free models have a `:free` suffix. Currency defaults to INR — see `shared/currency.js`.

## Free-tier limits

Free models (`*:free`) are rate limited, and extra keys or accounts do not raise the caps:

- **20 requests per minute**
- **50 requests per day** without credits, **1000/day** once you have bought at least $10 of credits

Check your remaining quota with `GET https://openrouter.ai/api/v1/key`. If you hit the daily cap, use a paid model id or wait for the UTC day to roll over.

If a request fails on a rate limit or a provider outage, `server/llm.js` reports the upstream message straight back so you can see what happened. There is no automatic retry — click the button again to retry.

## Scripts

```bash
npm run dev     # server + client with hot reload
npm run build   # production build
npm run lint    # eslint
```
