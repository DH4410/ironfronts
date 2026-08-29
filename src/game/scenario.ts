/**
 * Scenario / menu-selection types.
 *
 * The menu produces a typed `ScenarioSelection`; nothing downstream re-reads the
 * selected HTML row. `GameSession` consumes a `ScenarioSelection` plus the
 * loaded world and derives concrete theatre bounds and the opening camera from
 * data — the scenario never bakes pixel rectangles into the renderer.
 */

export type GameMode = 'campaign' | 'sandbox';

/** Which slice of the world a scenario focuses on. The map always holds the
 *  whole generated world; this only steers initial framing and which countries
 *  participate. */
export type TheaterId = 'global' | 'eastern-front' | 'western-europe' | 'free';

export interface ScenarioDef {
  readonly id: string;
  readonly name: string;
  readonly theater: TheaterId;
  readonly theaterLabel: string;
  /** Display date; also the campaign clock's start date. */
  readonly startDate: string;
  readonly mode: GameMode;
  /**
   * Playable countries. `'all'` = every country with territory (World at War,
   * Sandbox). Otherwise a curated, scenario-specific faction list by name,
   * resolved against the loaded world at session init.
   */
  readonly playableCountries: readonly string[] | 'all';
  /** Countries surfaced first in the picker; the rest stay available for 'all'. */
  readonly featuredCountries: readonly string[];
  readonly fogOfWar: boolean;
  /** Campaign requires a working economy to build; sandbox does not. */
  readonly economyEnabled: boolean;
  readonly blurb: string;
}

/** The typed hand-off from menu to game. */
export interface ScenarioSelection {
  readonly scenarioId: string;
  readonly theater: TheaterId;
  readonly startDate: string;
  readonly playerCountryId: number;
  readonly sandbox: boolean;
}
