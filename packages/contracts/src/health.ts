import { z } from 'zod';

export const healthStatusSchema = z.enum(['ok', 'error']);

export const healthResponseSchema = z.object({
  status: healthStatusSchema,
  service: z.literal('helm-server'),
  version: z.string().min(1),
  timestamp: z.iso.datetime(),
  checks: z.record(z.string(), healthStatusSchema).optional(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
