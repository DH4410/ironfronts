import type { GameLobby, LobbyCountry } from '@ironfronts/protocol';

export function assignedCountry(lobby: GameLobby): LobbyCountry | null {
  if (lobby.assignedCountryId === null) return null;
  return lobby.countries.find((country) => country.id === lobby.assignedCountryId) ?? null;
}

export function selectableCountries(lobby: GameLobby): LobbyCountry[] {
  return lobby.countries.filter((country) => country.alive && !country.claimed);
}
