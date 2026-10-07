function int(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export interface Config {
  port: number;
  /** Shared secret LiveHub tools send in `X-Api-Key`. Empty = no API key check (local dev). */
  apiKey: string;
  /** Protects /api/admin/*. Empty = admin routes disabled unless apiKey is also empty. */
  adminKey: string;
  /** Lifetime of an auth token, in minutes. */
  tokenTtlMinutes: number;
  /** Wrong-data verification attempts before the bot continues unverified (flowchart: 2). */
  maxAuthAttempts: number;
  /** Badly-formatted inputs (e.g. a 7-digit TIS-ID) tolerated before continuing unverified. */
  maxFormatErrors: number;
  defaultLanguage: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: int(env, "PORT", 8080),
    apiKey: env.API_KEY ?? "",
    adminKey: env.ADMIN_KEY ?? "",
    tokenTtlMinutes: int(env, "TOKEN_TTL_MINUTES", 30),
    maxAuthAttempts: int(env, "MAX_AUTH_ATTEMPTS", 2),
    maxFormatErrors: int(env, "MAX_FORMAT_ERRORS", 3),
    defaultLanguage: env.DEFAULT_LANGUAGE ?? "de",
  };
}
