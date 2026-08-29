import path from 'node:path';

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`);
  return value;
}

function secret(name: string, fallback: string): string {
  const value = process.env[name] ?? fallback;
  if (process.env.NODE_ENV === 'production' && value === fallback) throw new Error(`${name} is required in production.`);
  return value;
}

export const config = {
  port: numberEnv('GAME_PORT', 3002),
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://127.0.0.1:5173',
  publicHttpUrl: process.env.GAME_PUBLIC_HTTP_URL ?? 'http://127.0.0.1:3002',
  worldDirectory: path.resolve(process.cwd(), process.env.WORLD_DIRECTORY ?? 'public/world'),
  ticketSecret: secret('TICKET_SECRET', 'ironfronts-local-ticket-secret-change-me'),
  internalSecret: secret('INTERNAL_SERVICE_SECRET', 'ironfronts-local-service-secret-change-me'),
} as const;
