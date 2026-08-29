import type { ConnectResponse, GameLobby, SessionResponse } from '@ironfronts/protocol';

export const AUTH_URL = (import.meta.env.VITE_AUTH_URL as string | undefined)?.replace(/\/$/, '')
  ?? 'http://127.0.0.1:3001';

async function request<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${AUTH_URL}${pathname}`, {
    credentials: 'include',
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error ?? `Request failed (${response.status}).`);
  return value;
}

export const getSession = (): Promise<SessionResponse> => request('/v1/auth/session');
export const getGame = (): Promise<GameLobby> => request('/v1/game');
export const joinGame = (countryId: number): Promise<{ assignment: { gameId: string; countryId: number } }> =>
  request('/v1/game/join', { method: 'POST', body: JSON.stringify({ countryId }) });
export const connectGame = (): Promise<ConnectResponse> => request('/v1/game/connect', { method: 'POST', body: '{}' });
export const logout = (): Promise<void> => request('/v1/auth/logout', { method: 'POST', body: '{}' });
export const login = (username: string, password: string): Promise<SessionResponse> =>
  request('/v1/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
export const register = (username: string, password: string): Promise<SessionResponse> =>
  request('/v1/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) });
