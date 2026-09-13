import type { RemoteGameSession } from './remote-session';

/** Server-wide visual-clock controls. They never alter elapsed gameplay time. */
export function installTimelineDebugControls(container: HTMLElement | null | undefined, session: () => RemoteGameSession | undefined): () => void {
  if (!container) return () => undefined;
  const clockLabel = document.createElement('label');
  clockLabel.textContent = 'World date/time ';
  const clock = document.createElement('input');
  clock.type = 'datetime-local'; clock.step = '1'; clock.setAttribute('aria-label', 'Visual world date and time');
  const apply = document.createElement('button');
  apply.type = 'button'; apply.textContent = 'Set game time';
  apply.addEventListener('click', () => {
    const current = session();
    const offset = current?.readClock().utcOffsetMinutes ?? 0;
    const epoch = Date.parse(`${clock.value}Z`) - offset * 60_000;
    if (Number.isFinite(epoch)) session()?.setDevClock(epoch);
  });
  clockLabel.append(clock, apply);
  const link = document.createElement('button');
  link.type = 'button'; link.textContent = 'Link to my timezone';
  link.addEventListener('click', () => {
    session()?.linkDevClockToTimezone(-new Date().getTimezoneOffset());
  });
  container.append(clockLabel, link);
  return () => {
    const current = session();
    if (!current) return;
    const reading = current.readClock();
    link.textContent = reading.timezoneLinked ? 'Timezone linked' : 'Link to my timezone';
    if (document.activeElement !== clock) clock.value = new Date(current.readEpochMs() + reading.utcOffsetMinutes * 60_000).toISOString().slice(0, 19);
  };
}
