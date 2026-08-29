/**
 * Strategic in-game UI state.
 *
 * This is the ONLY contract between the renderer/game systems and the player
 * HUD. Game systems publish typed state through `UiStore.patch(...)`; the HUD
 * subscribes and renders. The HUD never reads renderer internals and never
 * scrapes the debug DOM (no MutationObserver on `#debug-*`). The debug
 * inspector and the player HUD are independent consumers of the same
 * underlying game state.
 */

import type { QualityLevel } from '../graphics/quality';

export type MapMode = 'balanced' | 'political' | 'diplomacy' | 'clear';

export type UiPhase = 'lobby' | 'loading' | 'in-game';

export interface PlayerCountry {
  readonly name: string;
  /** CSS colour string for the flag swatch. */
  readonly color: string;
}

export type ResourceId = 'money' | 'manpower' | 'food' | 'stone' | 'metal' | 'oil';

export interface ResourceLine {
  readonly id: ResourceId;
  readonly label: string;
  /**
   * `null` means the underlying economy system does not exist yet: the HUD
   * renders a disabled "--". A number is a real, authoritative value.
   */
  readonly value: number | null;
  /** Per-tick change, when known. */
  readonly delta?: number | null;
  /** Clearly-labelled demo value (dev/preview only), never a real save. */
  readonly demo?: boolean;
}

export interface StrategicClock {
  /** e.g. "Morning · 08:00". */
  readonly label: string;
  /** Day-stage token, e.g. "morning". */
  readonly phase: string;
}

export interface WeatherState {
  readonly raining: boolean;
  readonly label: string;
}

/**
 * Deposit quantities held in a province's ground — abstract strategic
 * abundance, NOT production/day. Precomputed by the renderer; `null` when the
 * province has no known deposits.
 */
export interface ProvinceResourceTotals {
  readonly stone: number;
  readonly metal: number;
  readonly oil: number;
}

export interface SelectedProvince {
  /** 0-based province id (matches FrameStats.hoveredProvince / renderer ids). */
  readonly id: number;
  readonly name: string;
  readonly owner: string;
  readonly ownerColor: string;
  readonly terrain: string;
  /**
   * Aggregated deposit quantities, or `null` when none are known. Under fog of
   * war this is `null` for provinces the player does not own — foreign deposit
   * detail must not leak (§ fog).
   */
  readonly resources: ProvinceResourceTotals | null;
  /** True when the player commands this province — unlocks full detail. */
  readonly isOwn?: boolean;
  /** Province has sea access (drives the water / naval marker). */
  readonly coastal?: boolean;
  /** Deposit control/extraction state, own provinces only. */
  readonly deposits?: {
    readonly controlled: boolean;
    readonly extracting: boolean;
  } | null;
  /** Units this province can build right now (own + has the building). */
  readonly producible?: readonly {
    readonly id: string;
    readonly name: string;
    readonly costLabel: string;
  }[];
  /** Current production queue (unit names), own provinces only. */
  readonly queue?: readonly string[];
  /** Buildings this province can start right now (own + urban + affordable). */
  readonly buildable?: readonly {
    readonly id: string;
    readonly name: string;
    readonly costLabel: string;
  }[];
  /** Buildings currently under construction here (labels), own provinces only. */
  readonly construction?: readonly string[];
}

export type NavId =
  | 'armies' | 'provinces' | 'production' | 'research'
  | 'diplomacy' | 'economy' | 'intelligence' | 'events';

export type NotificationKind =
  | 'warning' | 'combat' | 'completed' | 'diplomacy' | 'information';

export interface GameNotification {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body?: string;
  /** epoch ms */
  readonly at: number;
}

export type CombatStatus = 'idle' | 'moving' | 'engaged' | 'retreating';

export interface ArmyUnitGroupView {
  readonly label: string;
  readonly count: number;
  /** 0..1 */
  readonly health: number;
}

export interface ArmyStackView {
  readonly id: string;
  readonly country: string;
  readonly countryColor: string;
  readonly name: string;
  readonly unitCount: number;
  /** 0..1 */
  readonly strength: number;
  /** 0..1 */
  readonly health: number;
  readonly selected: boolean;
  readonly combat: CombatStatus;
  /**
   * False for a foreign stack seen only at contact range — position and owner
   * are known, composition is not. The card shows an "unidentified" readout and
   * `unitCount` / `health` / `groups` carry no real data (§ fog).
   */
  readonly identified?: boolean;
  /** Optional pending move order, world-space target. */
  readonly moveOrder?: { readonly x: number; readonly z: number } | null;
  /** Per-unit-type composition (§10, §44). */
  readonly groups?: readonly ArmyUnitGroupView[];
  /** World units per game-hour (slowest unit). */
  readonly speed?: number;
  /** True when the player commands this stack (enables order buttons). */
  readonly own?: boolean;
  /** Which order buttons are currently valid. */
  readonly canExtract?: boolean;
  /** UI is waiting for a map click to set the move destination. */
  readonly awaitingMoveTarget?: boolean;
}

export interface StrategicUiState {
  readonly phase: UiPhase;
  readonly playerCountry: PlayerCountry | null;
  readonly mapMode: MapMode;
  readonly clock: StrategicClock | null;
  readonly weather: WeatherState;
  readonly resources: readonly ResourceLine[];
  readonly selectedProvince: SelectedProvince | null;
  readonly selectedArmy: ArmyStackView | null;
  readonly notifications: readonly GameNotification[];
  readonly quality: QualityLevel;
  /** Backing-store scale actually in use (diagnostics / verification). */
  readonly effectiveRenderScale: number;
  readonly paused: boolean;
  /** Resource-deposit marker overlay toggle (off by default). */
  readonly resourceOverlay: boolean;
  /** Whether the debug/world-inspector affordances are exposed at all. */
  readonly debugEnabled: boolean;
}

/** Resources are declared up-front so the top bar has stable slots. */
export const DEFAULT_RESOURCES: readonly ResourceLine[] = [
  { id: 'money', label: 'Funds', value: null },
  { id: 'manpower', label: 'Manpower', value: null },
  { id: 'food', label: 'Food', value: null },
  { id: 'stone', label: 'Stone', value: null },
  { id: 'metal', label: 'Metal', value: null },
  { id: 'oil', label: 'Oil', value: null },
];

export function createInitialState(overrides: Partial<StrategicUiState> = {}): StrategicUiState {
  return {
    phase: 'lobby',
    playerCountry: null,
    mapMode: 'balanced',
    clock: null,
    weather: { raining: false, label: 'Clear' },
    resources: DEFAULT_RESOURCES,
    selectedProvince: null,
    selectedArmy: null,
    notifications: [],
    quality: 'high',
    effectiveRenderScale: 1,
    paused: false,
    resourceOverlay: false,
    debugEnabled: false,
    ...overrides,
  };
}

export type UiListener = (state: StrategicUiState) => void;

export interface UiStore {
  get(): StrategicUiState;
  /** Shallow-merge a partial update and notify listeners (coalesced). */
  patch(update: Partial<StrategicUiState>): void;
  subscribe(listener: UiListener): () => void;
}

/**
 * Minimal event-driven store. Notifications are coalesced to one microtask so
 * a burst of `patch()` calls in the same frame produces a single render. No
 * per-frame polling, no layout reads.
 */
export function createUiStore(initial: StrategicUiState): UiStore {
  let state = initial;
  const listeners = new Set<UiListener>();
  let scheduled = false;

  const flush = (): void => {
    scheduled = false;
    for (const listener of listeners) listener(state);
  };

  return {
    get: () => state,
    patch(update) {
      let changed = false;
      for (const key of Object.keys(update) as Array<keyof StrategicUiState>) {
        if (!Object.is(state[key], update[key])) { changed = true; break; }
      }
      if (!changed) return;
      state = { ...state, ...update };
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
