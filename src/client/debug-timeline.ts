import type { RemoteGameSession } from './remote-session';

/** Server-wide debug controls. Changing civil time never reapplies elapsed damage. */
export function installTimelineDebugControls(container: HTMLElement | null | undefined, session: () => RemoteGameSession | undefined): () => void {
  if (!container) return () => undefined;
  const clockLabel = document.createElement('label');
  clockLabel.textContent = 'Game time (GMT+2) ';
  const clock = document.createElement('input');
  clock.type = 'datetime-local'; clock.step = '1'; clock.setAttribute('aria-label', 'Authoritative game time GMT+2');
  const apply = document.createElement('button');
  apply.type = 'button'; apply.textContent = 'Set game time';
  apply.addEventListener('click', () => {
    const epoch = Date.parse(`${clock.value}Z`) - 120 * 60_000;
    if (Number.isFinite(epoch)) session()?.setDevClock(epoch);
  });
  clockLabel.append(clock, apply);
  const movementLabel = document.createElement('label');
  movementLabel.textContent = 'Movement multiplier ';
  const movement = document.createElement('input');
  movement.type = 'number'; movement.min = '0'; movement.max = '32'; movement.step = '0.25'; movement.value = '1';
  movement.setAttribute('aria-label', 'Movement speed multiplier');
  movement.addEventListener('change', () => {
    const value = Number(movement.value);
    if (Number.isFinite(value)) session()?.setDevMovementSpeed(Math.max(0, Math.min(32, value)));
  });
  movementLabel.append(movement); container.append(clockLabel, movementLabel);
  return () => {
    const current = session();
    if (!current) return;
    if (document.activeElement !== movement) movement.value = String(current.devMovementSpeed);
    if (document.activeElement !== clock) clock.value = new Date(current.readEpochMs() + 120 * 60_000).toISOString().slice(0, 19);
  };
}
