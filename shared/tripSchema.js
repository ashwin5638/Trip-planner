import {z} from 'zod'
import {DEFAULT_CURRENCY} from './currency.js'

export const activitySchema = z.object({
    time : z.string(),
    title: z.string(),
  description: z.string().default(''),
  location: z.string().default(''),
  cost: z.number().nonnegative().default(0),
})

export const daySchema = z.object({
  day: z.number().int().positive(),
  date: z.string().optional(),
  title: z.string(),
  activities: z.array(activitySchema).min(1),
})

export const tripSchema = z.object({
  destination: z.string().min(1),
  durationDays: z.number().int().positive(),
  days: z.array(daySchema).min(1),
  budget: z.object({
    estimated: z.number().nonnegative().default(0),
    currency: z.string().default(DEFAULT_CURRENCY),
  }).default({ estimated: 0, currency: DEFAULT_CURRENCY }),
  tips: z.array(z.string()).default([]),
})