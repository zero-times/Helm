import { describe, expect, it } from 'vitest';

import { healthResponseSchema } from '../src/health';

describe('healthResponseSchema', () => {
  it('accepts a structured healthy response', () => {
    const result = healthResponseSchema.parse({
      status: 'ok',
      service: 'helm-server',
      version: '0.1.0',
      timestamp: '2026-08-11T00:00:00.000Z',
      checks: { database: 'ok' },
    });

    expect(result.checks?.database).toBe('ok');
  });

  it('rejects an unknown health status', () => {
    const result = healthResponseSchema.safeParse({
      status: 'degraded',
      service: 'helm-server',
      version: '0.1.0',
      timestamp: '2026-08-11T00:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });
});
