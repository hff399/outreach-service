import { z } from 'zod';

const envSchema = z.object({
  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Telegram
  TG_API_ID: z.coerce.number(),
  TG_API_HASH: z.string().min(1),

  // Security
  JWT_SECRET: z.string().min(32).optional().default('development-jwt-secret-key-32chars!!'),
  ENCRYPTION_KEY: z.string().min(32).optional().default('development-encryption-key-32chars!'),

  // Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

type EnvType = z.infer<typeof envSchema>;

let cachedEnv: EnvType | null = null;

function getEnv(): EnvType {
  if (cachedEnv) return cachedEnv;

  // Skip validation during build time
  if (process.env.NODE_ENV === 'production' && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    // Return dummy values for build time - actual runtime will have real values
    return {
      NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'placeholder',
      TG_API_ID: 0,
      TG_API_HASH: 'placeholder',
      JWT_SECRET: 'development-jwt-secret-key-32chars!!',
      ENCRYPTION_KEY: 'development-encryption-key-32chars!',
      NODE_ENV: 'production',
    };
  }

  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment variables');
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

export const config = {
  get supabase() {
    const env = getEnv();
    return {
      url: env.NEXT_PUBLIC_SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    };
  },
  get telegram() {
    const env = getEnv();
    return {
      apiId: env.TG_API_ID,
      apiHash: env.TG_API_HASH,
    };
  },
  get security() {
    const env = getEnv();
    return {
      jwtSecret: env.JWT_SECRET,
      encryptionKey: env.ENCRYPTION_KEY,
    };
  },
  get isDev() {
    return getEnv().NODE_ENV === 'development';
  },
  get isProd() {
    return getEnv().NODE_ENV === 'production';
  },
} as const;
