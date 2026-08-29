import { createIcon, type IconName } from './icons';
import type { GameNotification, NotificationKind } from './ui-state';

const NOTE_ICON: Record<NotificationKind, IconName> = {
  warning: 'note-warning', combat: 'note-combat', completed: 'note-completed',
  diplomacy: 'note-diplomacy', information: 'note-information',
};

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function buildNotification(
  notification: GameNotification, dismissNotification: (id: string) => void,
): HTMLElement {
  const item = element('article', 'ifg-notify__item');
  item.dataset.kind = notification.kind;
  const body = element('div', 'ifg-notify__body');
  body.append(element('strong', undefined, notification.title));
  if (notification.body) body.append(element('span', undefined, notification.body));
  const dismiss = element('button', 'ifg-notify__dismiss');
  dismiss.type = 'button';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.append(createIcon('close'));
  dismiss.addEventListener('click', () => dismissNotification(notification.id));
  item.append(createIcon(NOTE_ICON[notification.kind], 'ifg-notify__icon'), body, dismiss);
  return item;
}
