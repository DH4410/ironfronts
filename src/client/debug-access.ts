export interface DebugHandles {
  readonly renderer?: unknown;
  readonly combatEffects?: unknown;
  readonly session?: unknown;
}

type DebugTarget = Record<string, unknown>;

/** Install or remove browser-only QA handles after server authentication. */
export function setDebugHandles(target: DebugTarget, enabled: boolean, handles: DebugHandles): void {
  delete target.__ironfrontsRenderer;
  delete target.__ironfrontsCombatEffects;
  delete target.__ironfrontsSession;
  if (!enabled) return;
  if (handles.renderer !== undefined) target.__ironfrontsRenderer = handles.renderer;
  if (handles.combatEffects !== undefined) target.__ironfrontsCombatEffects = handles.combatEffects;
  if (handles.session !== undefined) target.__ironfrontsSession = handles.session;
}
