import { z } from 'zod'
import { DEFAULT_CURRENCY } from './currency.js'



// This schema is the server's contract: the model is told the shape by the
// hand-written prompt in lib/llm.js, and the answer is checked against this
// file. The two must agree. The `.describe()` text documents each field and
// supplies the wording used in validation errors.

export const activitySchema = z.object({
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be 24-hour HH:MM').describe(
    'Start time as 24-hour HH:MM, e.g. "09:30".',
  ),
  title: z.string().min(1).max(80).describe('Short activity name, e.g. "Sunrise at Hidimba Beach".'),
  description: z.string().max(240).describe(
    'One terse practical sentence. No filler, no emoji, max 140 characters.',
  ),
  location: z.string().max(120).describe(
    'Place name an Indian traveller would recognise. Empty string if not specific.',
  ),
  cost: z.number().nonnegative().default(0).describe(
    `Realistic cost in ${DEFAULT_CURRENCY} as a plain number, the way an Indian traveller actually pays. 0 if free.`,
  ),
})

export const daySchema = z.object({
  day: z.number().int().positive().describe('Day number starting at 1, increasing by 1 with no gaps.'),
  date: z.string().default('').describe(
    'Calendar date as YYYY-MM-DD when the request implied a start date, otherwise an empty string.',
  ),
  title: z.string().min(1).max(80).describe('Short theme for the day, e.g. "Old City and Forts".'),
  activities: z.array(activitySchema).min(1).max(8).describe('Ordered by time of day.'),
})

export const tripSchema = z.object({
  destination: z.string().min(1).max(120).describe(
    'Destination as the traveller would say it, e.g. "Manali, Himachal Pradesh".',
  ),
  durationDays: z.number().int().positive().describe('Total number of days. Must equal the length of days.'),
  days: z.array(daySchema).min(1).describe('One entry per day, in order.'),
  budget: z
    .object({
      estimated: z.number().nonnegative().default(0).describe(
        `Total estimated cost of the whole trip in ${DEFAULT_CURRENCY}, covering everything the traveller will pay. Must be greater than 0. Activity costs are per-activity estimates and do not have to add up to this, because transport, lodging and entry are not all tied to one activity.`,
      ),
      currency: z.literal(DEFAULT_CURRENCY).default(DEFAULT_CURRENCY).describe(`Always exactly "${DEFAULT_CURRENCY}".`),
    })
    .default({ estimated: 0, currency: DEFAULT_CURRENCY }),
  tips: z.array(z.string().max(200)).max(5).default([]).describe('Up to 5 short practical tips.'),
})
