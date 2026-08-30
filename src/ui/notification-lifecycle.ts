import type { NotificationKind } from './ui-state';

/**
 * Per-kind toast lifetime in ms. `null` means action-required: the toast stays
 * until the player dismisses it. Timings are deliberate, not magic numbers:
 * info is glanceable, warnings need a beat longer, combat is a call to action.
 */
export const NOTIFICATION_TTL_MS: Record<NotificationKind, number | null> = {
  information: 5_000,
  completed: 6_000,
  diplomacy: 6_000,
  warning: 8_000,
  combat: null,
};

/** Lifetime to use when a normally-sticky kind is explicitly made transient. */
export const NOTIFICATION_FALLBACK_TTL_MS = 8_000;

/** Whether a toast of `kind` stays until dismissed, honouring an explicit override. */
export function isSticky(kind: NotificationKind, override?: boolean): boolean {
  return override ?? NOTIFICATION_TTL_MS[kind] === null;
}

/** ms before a non-sticky toast auto-dismisses. `null` when it is sticky. */
export function autoDismissDelay(kind: NotificationKind, override?: boolean): number | null {
  if (isSticky(kind, override)) return null;
  return NOTIFICATION_TTL_MS[kind] ?? NOTIFICATION_FALLBACK_TTL_MS;
}
