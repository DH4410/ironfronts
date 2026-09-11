import { z } from 'zod';
import type { ServerMessage } from './index';

const finite = z.number().finite();
const nonnegative = finite.nonnegative();
const integer = z.number().int().nonnegative();
const point = z.object({ x: finite, z: finite });
const buildingId = z.enum(['barracks', 'tankPlant', 'ordnance', 'missileSite']);
const stockpile = z.object({ funds: finite, manpower: finite, food: finite, stone: finite, metal: finite, oil: finite });
const country = z.object({ id: integer, name: z.string(), color: z.string(), controller: z.enum(['player', 'ai', 'neutral']), alive: z.boolean() });
const buildings = z.object({ barracks: integer, tankPlant: integer, ordnance: integer, missileSite: integer });
const queue = z.object({ id: z.string(), ownerCountryId: integer, progressHours: nonnegative, totalHours: finite.positive() });
const unitQueue = queue.extend({ unitTypeId: z.string() });
const buildingQueue = queue.extend({ buildingId });
const resource = point.extend({ id: integer, kind: z.enum(['stone', 'metal', 'oil']), remaining: nonnegative,
  initialAmount: nonnegative, controllerCountryId: integer, provinceId: z.number().int(), accessNodeId: z.number().int(),
  extractorArmyId: z.string().nullable(), status: z.enum(['idle', 'secured', 'extracting', 'exhausted']),
  provenance: z.enum(['generatedNatural', 'scenarioGuarantee']) });
const record = <T extends z.ZodType>(schema: T) => z.record(z.string(), schema);
const army = point.extend({
  id: z.string(), name: z.string(), ownerCountryId: integer, ownerName: z.string(), ownerColor: z.string(), own: z.boolean(),
  contact: z.enum(['contact', 'visible']), status: z.enum(['idle', 'moving', 'extracting', 'engaged', 'retreating', 'embarking', 'atSea', 'disembarking', 'unknown']),
  graphNodeId: integer.optional(),
  composition: z.object({ unitCount: integer, health: nonnegative.max(1), speed: nonnegative,
    groups: z.array(z.object({ typeId: z.string(), count: integer, health: nonnegative.max(1) })) }).nullable(),
  moveOrder: point.nullable(), moveRoute: z.array(point).optional(), moveIntent: z.enum(['move', 'attack']).optional(),
  motion: z.object({ targetX: finite, targetZ: finite, durationMs: nonnegative, route: z.array(point).optional(), sampledAtEpochMs: finite.optional(), generation: integer.optional() }).optional(),
  actions: z.object({ canExtract: z.boolean(), extractableNodeId: integer.nullable(), extractReason: z.string().optional() }).optional(),
  suspendedOrder: point.extend({ intent: z.enum(['move', 'attack']) }).nullable().optional(),
  battleFronts: z.array(z.object({ id: z.string(), directionNodeId: integer, role: z.enum(['attack', 'defense']),
    friendlyHp: nonnegative, friendlyBaselineHp: nonnegative, enemyHp: nonnegative, enemyBaselineHp: nonnegative, reinforcementCount: integer })).optional(),
  legalRetreatExits: z.array(point.extend({ firstNodeId: integer, destinationProvinceId: integer, bearing: z.string().optional() })).optional(),
  artillery: z.object({ range: nonnegative, targetArmyId: z.string().nullable(), manualTarget: z.boolean() }).nullable().optional(),
});
const timeline = z.object({ elapsedSeconds: nonnegative, speed: nonnegative.max(32), movementSpeed: nonnegative.max(32), sampledAtEpochMs: finite, generation: integer });
const ownCountry = z.object({ id: integer, name: z.string(), color: z.string(), controller: z.enum(['player', 'ai', 'neutral']),
  stockpile, income: stockpile, industryCapacity: nonnegative, warheads: nonnegative.optional(),
  extraction: z.object({ stone: nonnegative, metal: nonnegative, oil: nonnegative }).optional() });
const diplomacyMessage = z.object({ id: z.string(), fromCountryId: integer, toCountryId: integer, body: z.string(), sentAtTick: integer });
const diplomacyProposal = z.object({ id: z.string(), fromCountryId: integer, toCountryId: integer,
  kind: z.enum(['alliance', 'peace']), status: z.enum(['pending', 'accepted', 'declined', 'withdrawn']),
  createdAtTick: integer, resolvedAtTick: integer.optional() });
const outcome = z.object({ result: z.enum(['victory', 'defeat']), reason: z.string(), atGameHours: nonnegative });
export const projectionSchema = z.object({ simulationTick: integer, timeline: timeline.optional(), viewerCountryId: integer,
  startCamera: point.extend({ distance: finite.positive() }), countries: record(country), provinceOwners: record(integer),
  provinceBuildings: record(buildings), provinceActions: record(z.object({
    production: z.array(z.object({ unitTypeId: z.string(), available: z.boolean(), affordable: z.boolean(), reason: z.string().optional() })),
    construction: z.array(z.object({ buildingId, available: z.boolean(), affordable: z.boolean(), reason: z.string().optional() })),
    canSetRally: z.boolean(), rallyReason: z.string().optional(),
  })), productionQueues: record(z.array(unitQueue)), constructionQueues: record(z.array(buildingQueue)),
  rallyPoints: record(point.extend({ route: z.array(point).optional() })), armies: record(army), resourceNodes: record(resource),
  ownCountry: ownCountry.nullable(), relations: record(z.enum(['peace', 'allied', 'war'])),
  diplomacy: z.object({ messages: z.array(diplomacyMessage), proposals: z.array(diplomacyProposal) }).optional(),
  outcome: outcome.optional() });
const collectionSchemas = projectionSchema.pick({ countries: true, provinceOwners: true, provinceBuildings: true, provinceActions: true,
  productionQueues: true, constructionQueues: true, rallyPoints: true, armies: true, resourceNodes: true, relations: true });
const delta = z.object({ changed: projectionSchema.pick({ simulationTick: true, timeline: true, viewerCountryId: true, startCamera: true, ownCountry: true, diplomacy: true, outcome: true }).partial(),
  upserts: collectionSchemas.partial(), removals: z.object(Object.fromEntries(Object.keys(collectionSchemas.shape).map((key) => [key, z.array(z.string()).optional()]))),
  redactions: z.array(z.string()) });
const profile = z.object({ soft: nonnegative, light: nonnegative, heavy: nonnegative });
const cost = stockpile.partial();
const catalogs = z.object({ units: z.array(z.object({ id: z.string(), name: z.string(), category: z.enum(['infantry', 'engineer', 'recon', 'armor', 'artillery']),
  armorClass: z.enum(['soft', 'light', 'heavy']), icon: z.string(), maxHp: finite.positive(), speed: nonnegative, attack: profile, defense: profile,
  visionOuter: nonnegative, visionInner: nonnegative, extractionRate: nonnegative, engagementRange: nonnegative, cost, buildTimeHours: finite.positive(), requiredBuilding: buildingId, stackPriority: finite })),
  buildings: z.array(z.object({ id: buildingId, label: z.string(), cost, buildTimeHours: finite.positive() })) });
const eventBase = { id: z.string(), message: z.string().optional() };
const locatedEvent = { ...eventBase, x: finite, z: finite };
const combatCountries = { attacker: integer, defender: integer };
const event = z.discriminatedUnion('kind', [
  z.object({ ...locatedEvent, kind: z.literal('unitCompleted'), ownerCountryId: integer, provinceId: integer, unitTypeId: z.string(), armyId: z.string() }),
  z.object({ ...locatedEvent, kind: z.literal('buildingCompleted'), ownerCountryId: integer, provinceId: integer, buildingId }),
  z.object({ ...locatedEvent, kind: z.literal('capture'), provinceId: integer, fromCountryId: integer, toCountryId: integer }),
  ...(['engaged', 'combatPulse', 'retreat', 'battleEnded'] as const).map((kind) =>
    z.object({ ...locatedEvent, ...combatCountries, kind: z.literal(kind), battleId: z.string(), frontId: z.string() })),
  z.object({ ...locatedEvent, ...combatCountries, kind: z.literal('reinforced'), battleId: z.string(), frontId: z.string(), armyId: z.string() }),
  z.object({ ...locatedEvent, ...combatCountries, kind: z.literal('destroyed'), armyId: z.string(), battleId: z.string().optional(), frontId: z.string().optional() }),
  z.object({ ...locatedEvent, ...combatCountries, kind: z.literal('bombardment'), armyId: z.string(), targetArmyId: z.string() }),
  z.object({ ...locatedEvent, ...combatCountries, kind: z.literal('strike'), provinceId: integer }),
]);
const clock = z.object({ gameStartedAtEpochMs: finite, gameEpochMs: finite, serverEpochMs: finite, speed: nonnegative.max(32), generation: integer, utcOffsetMinutes: z.number().int() });
export const serverMessageSchema: z.ZodType<ServerMessage> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), gameId: z.string(), gameVersion: z.string(), protocolVersion: z.literal(3), capabilities: z.array(z.string()),
    world: z.object({ version: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/), assetBaseUrl: z.url(),
      artifactHashes: record(z.string().regex(/^[a-f0-9]{64}$/)) }), countryId: integer }),
  z.object({ type: z.literal('baseline'), revision: integer, state: projectionSchema, catalogs, clock }),
  z.object({ type: z.literal('delta'), fromRevision: integer, revision: integer, delta, events: z.array(event) }),
  z.object({ type: z.literal('clockSync'), clock }),
  z.object({ type: z.literal('commandAck'), commandId: z.string(), ok: z.boolean(), appliedRevision: integer.optional(), reason: z.string().optional(), requiredWarCountryIds: z.array(integer).optional() }),
  z.object({ type: z.literal('event'), event }),
  z.object({ type: z.literal('pong'), sentAt: finite, serverEpochMs: finite }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string(), retryable: z.boolean().optional() }),
  z.object({ type: z.literal('devSimSpeed'), multiplier: nonnegative.max(32), devControlsEnabled: z.boolean(), movementMultiplier: nonnegative.max(32).optional() }),
  z.object({ type: z.literal('devEnvironment'), timeOfDayHours: finite.min(0).max(24).nullable(), raining: z.boolean(), devControlsEnabled: z.boolean() }),
]);
