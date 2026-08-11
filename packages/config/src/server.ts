import { z } from 'zod';

const logLevelSchema = z.enum([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
]);

export const serverConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().max(65_535).default(3000),
  LOG_LEVEL: logLevelSchema.default('info'),
  DATABASE_URL: z
    .url()
    .startsWith('postgres://')
    .or(z.url().startsWith('postgresql://'))
    .default('postgres://helm:helm@localhost:5432/helm'),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  APP_VERSION: z.string().min(1).default('0.1.0'),
});

export type ServerConfig = z.infer<typeof serverConfigSchema>;

export function loadServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  return serverConfigSchema.parse(environment);
}
