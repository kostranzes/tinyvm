import 'dotenv/config';
import { z } from 'zod';
import path from 'node:path';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  TINYVM_SESSION_BIN: z.string().min(1).default('../engine/build/tinyvm-session'),
  TINYVM_SESSION_MODE: z.enum(['docker', 'host']).default('docker'),
  TINYVM_SESSION_IMAGE: z.string().min(1).default('tinyvm-engine'),
  RATE_LIMIT_GENERAL_PER_MIN: z.coerce.number().int().min(1).default(300),
  RATE_LIMIT_HEAVY_PER_MIN: z.coerce.number().int().min(1).default(30),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().int().min(1).default(10),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = {
  databaseUrl: parsed.data.DATABASE_URL,
  port: parsed.data.PORT,
  corsOrigin: parsed.data.CORS_ORIGIN,
  sessionBin: path.resolve(parsed.data.TINYVM_SESSION_BIN),
  sessionMode: parsed.data.TINYVM_SESSION_MODE,
  sessionImage: parsed.data.TINYVM_SESSION_IMAGE,
  rateLimitGeneralPerMin: parsed.data.RATE_LIMIT_GENERAL_PER_MIN,
  rateLimitHeavyPerMin: parsed.data.RATE_LIMIT_HEAVY_PER_MIN,
  cookieSecure: parsed.data.COOKIE_SECURE === 'true',
  rateLimitAuthPerMin: parsed.data.RATE_LIMIT_AUTH_PER_MIN,
};