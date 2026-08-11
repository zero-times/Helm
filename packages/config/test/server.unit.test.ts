import { describe, expect, it } from 'vitest';

import { loadServerConfig } from '../src/server';

describe('loadServerConfig', () => {
  it('provides development-safe local defaults', () => {
    const config = loadServerConfig({});

    expect(config.PORT).toBe(3000);
    expect(config.DATABASE_URL).toBe(
      'postgres://helm:helm@localhost:5432/helm',
    );
  });

  it('coerces a valid port and rejects invalid input', () => {
    expect(loadServerConfig({ PORT: '3100' }).PORT).toBe(3100);
    expect(() => loadServerConfig({ PORT: '70000' })).toThrow();
  });
});
