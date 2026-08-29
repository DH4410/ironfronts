import { z } from 'zod';

export const PROTOCOL_VERSION = 1 as const;
export const GAME_ID = 'world-at-war-1' as const;
export const GAME_VERSION = 'world-at-war@1' as const;

export const commandPayloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('moveArmy'), armyId: z.string(), x: z.number().finite(), z: z.number().finite() }),
  z.object({ type: z.literal('attackArmy'), armyId: z.string(), x: z.number().finite(), z: z.number().finite() }),
  z.object({ type: z.literal('stopArmy'), armyId: z.string() }),
  z.object({ type: z.literal('extract'), armyId: z.string() }),
  z.object({ type: z.literal('produce'), provinceId: z.number().int().nonnegative(), unitTypeId: z.string() }),
  z.object({ type: z.literal('build'), provinceId: z.number().int().nonnegative(), buildingId: z.enum(['barracks', 'tankPlant', 'ordnance']) }),
  z.object({ type: z.literal('setRally'), provinceId: z.number().int().nonnegative(), target: z.object({ x: z.number().finite(), z: z.number().finite() }).nullable() }),
]);
export type CommandPayload = z.infer<typeof commandPayloadSchema>;

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('authenticate'), protocolVersion: z.literal(PROTOCOL_VERSION), ticket: z.string().min(1) }),
  z.object({ type: z.literal('command'), commandId: z.string().min(1).max(100), command: commandPayloadSchema }),
  z.object({ type: z.literal('resync'), afterRevision: z.number().int().nonnegative().optional() }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export interface PublicCountry {
  id: number;
  name: string;
  color: string;
  controller: 'player' | 'ai' | 'neutral';
  alive: boolean;
}

export interface ProjectedArmy {
  id: string;
  name: string;
  ownerCountryId: number;
  ownerName: string;
  ownerColor: string;
  x: number;
  z: number;
  own: boolean;
  contact: 'contact' | 'visible';
  status: string;
  composition: null | {
    unitCount: number;
    health: number;
    speed: number;
    groups: ReadonlyArray<{ typeId: string; count: number; health: number }>;
  };
  moveOrder: { x: number; z: number } | null;
}

export interface PlayerProjection {
  gameTimeHours: number;
  viewerCountryId: number;
  startCamera: { x: number; z: number; distance: number };
  countries: Record<number, PublicCountry>;
  provinceOwners: Record<number, number>;
  provinceBuildings: Record<number, { barracks: number; tankPlant: number; ordnance: number }>;
  productionQueues: Record<number, unknown[]>;
  constructionQueues: Record<number, unknown[]>;
  rallyPoints: Record<number, { x: number; z: number }>;
  armies: Record<string, ProjectedArmy>;
  resourceNodes: Record<number, unknown>;
  ownCountry: null | Record<string, unknown>;
  relations: Record<string, 'peace' | 'war'>;
}

export interface PresentationCatalogs {
  units: ReadonlyArray<Record<string, unknown>>;
  buildings: ReadonlyArray<Record<string, unknown>>;
}

export interface WorldDescriptor {
  version: string;
  hash: string;
  assetBaseUrl: string;
}

export type ProjectionDelta = {
  changed: Partial<Omit<PlayerProjection, 'countries' | 'provinceOwners' | 'provinceBuildings' | 'productionQueues' | 'constructionQueues' | 'rallyPoints' | 'armies' | 'resourceNodes' | 'relations'>>;
  upserts: Partial<{ [K in 'countries' | 'provinceOwners' | 'provinceBuildings' | 'productionQueues' | 'constructionQueues' | 'rallyPoints' | 'armies' | 'resourceNodes' | 'relations']: Record<string, unknown> }>;
  removals: Partial<Record<'countries' | 'provinceOwners' | 'provinceBuildings' | 'productionQueues' | 'constructionQueues' | 'rallyPoints' | 'armies' | 'resourceNodes' | 'relations', string[]>>;
  redactions: string[];
};

export type ServerMessage =
  | { type: 'hello'; gameId: string; gameVersion: string; protocolVersion: 1; capabilities: string[]; world: WorldDescriptor; countryId: number }
  | { type: 'baseline'; revision: number; state: PlayerProjection; catalogs: PresentationCatalogs }
  | { type: 'delta'; fromRevision: number; revision: number; delta: ProjectionDelta; events: FilteredEvent[] }
  | { type: 'commandAck'; commandId: string; ok: boolean; reason?: string }
  | { type: 'event'; event: FilteredEvent }
  | { type: 'error'; code: string; message: string; retryable?: boolean };

export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'), gameId: z.string(), gameVersion: z.string(),
    protocolVersion: z.literal(PROTOCOL_VERSION), capabilities: z.array(z.string()),
    world: z.object({ version: z.string(), hash: z.string(), assetBaseUrl: z.url() }),
    countryId: z.number().int().positive(),
  }),
  z.object({ type: z.literal('baseline'), revision: z.number().int().nonnegative(), state: z.custom<PlayerProjection>((value) => Boolean(value && typeof value === 'object')), catalogs: z.custom<PresentationCatalogs>((value) => Boolean(value && typeof value === 'object')) }),
  z.object({ type: z.literal('delta'), fromRevision: z.number().int().nonnegative(), revision: z.number().int().nonnegative(), delta: z.custom<ProjectionDelta>((value) => Boolean(value && typeof value === 'object')), events: z.array(z.custom<FilteredEvent>((value) => Boolean(value && typeof value === 'object'))) }),
  z.object({ type: z.literal('commandAck'), commandId: z.string(), ok: z.boolean(), reason: z.string().optional() }),
  z.object({ type: z.literal('event'), event: z.custom<FilteredEvent>((value) => Boolean(value && typeof value === 'object')) }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string(), retryable: z.boolean().optional() }),
]);

export interface FilteredEvent { id: string; kind: string; message?: string; [key: string]: unknown }

export interface GameTicketClaims {
  accountId: string;
  gameId: string;
  countryId: number;
  audience: 'game-server';
  protocolVersion: 1;
  expiresAt: number;
  nonce: string;
}

export interface LobbyCountry { id: number; name: string; color: string; startingCities: number; alive: boolean; claimed: boolean }
export interface GameLobby {
  gameId: string;
  name: string;
  gameVersion: string;
  protocolVersion: 1;
  assignedCountryId: number | null;
  countries: LobbyCountry[];
}

export interface SessionResponse { authenticated: boolean; account?: { id: string; username: string }; assignment?: { gameId: string; countryId: number } | null }
export interface ConnectResponse { ticket: string; websocketUrl: string; protocolVersion: 1 }

export const credentialsSchema = z.object({
  username: z.string().trim().min(3).max(32),
  password: z.string().min(8).max(256),
});
export const joinGameSchema = z.object({ countryId: z.number().int().positive() });
