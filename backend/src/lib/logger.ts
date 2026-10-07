import pino from "pino";

// Pretty output only for `npm run dev` (LOG_PRETTY=1); the bundled build always logs JSON.
const pretty = process.env.LOG_PRETTY === "1";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  redact: ["req.headers.authorization", "req.headers['x-api-key']", "req.headers['x-admin-key']"],
  ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true } } } : {}),
});
