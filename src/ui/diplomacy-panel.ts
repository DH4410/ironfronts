import { createFlag } from './flags';
import { createIcon, type IconName } from './icons';
import type {
  DiplomacyCountryView, DiplomacyProposalView, DiplomacyRelation, DiplomacyView,
} from './ui-state';

export interface DiplomacyPanelActions {
  close(): void;
  selectCountry(countryId: number): void;
  sendMessage(countryId: number, body: string): void;
  proposeAlliance(countryId: number): void;
  offerPeace(countryId: number): void;
  declareWar(countryId: number): void;
  endAlliance(countryId: number): void;
  respondProposal(proposalId: string, accept: boolean): void;
}

export interface DiplomacyPanelHandle {
  readonly element: HTMLElement;
  render(open: boolean, view: DiplomacyView): void;
}

export function diplomacyRelationLabel(relation: DiplomacyRelation): string {
  if (relation === 'allied') return 'Allied';
  if (relation === 'war') return 'At war';
  return 'Neutral';
}

export function diplomacyContactBlock(country: DiplomacyCountryView): string | null {
  if (!country.alive) return 'This country has been defeated. Its diplomatic channel is closed.';
  if (country.controller !== 'player') {
    return 'No player commands this country. Messages and treaties require another player.';
  }
  return null;
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function actionButton(
  label: string, icon: IconName, className = '', disabled = false,
): HTMLButtonElement {
  const button = node('button', `ifg-dip__action${className ? ` ${className}` : ''}`);
  button.type = 'button';
  button.disabled = disabled;
  button.append(createIcon(icon, 'ifg-dip__action-icon'), node('span', undefined, label));
  return button;
}

function proposalLabel(proposal: DiplomacyProposalView): string {
  return proposal.kind === 'alliance' ? 'Alliance proposal' : 'Peace offer';
}

/** A non-modal field-communications drawer. The game map remains operable around it. */
export function createDiplomacyPanel(actions: DiplomacyPanelActions): DiplomacyPanelHandle {
  const panel = node('section', 'ifg-dip');
  panel.id = 'ifg-diplomacy-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', 'ifg-diplomacy-heading');

  const header = node('div', 'ifg-dip__header');
  const titleBlock = node('div', 'ifg-dip__title');
  titleBlock.append(createIcon('diplomacy', 'ifg-dip__title-icon'));
  const titleCopy = node('div');
  const heading = node('h2', undefined, 'Diplomatic cables');
  heading.id = 'ifg-diplomacy-heading';
  titleCopy.append(heading, node('p', undefined, 'Foreign office / secure circuit'));
  titleBlock.append(titleCopy);
  const close = node('button', 'ifg-dip__close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close diplomacy');
  close.append(createIcon('close'));
  close.addEventListener('click', actions.close);
  header.append(titleBlock, close);

  const body = node('div', 'ifg-dip__body');
  panel.append(header, body);

  const drafts = new Map<number, string>();
  let renderedView: DiplomacyView | null = null;
  let wasOpen = false;

  const render = (open: boolean, view: DiplomacyView): void => {
    if (open === wasOpen && view === renderedView) return;
    const activeDraft = body.querySelector<HTMLTextAreaElement>('.ifg-dip__composer textarea');
    const previousView = renderedView;
    if (activeDraft && previousView?.selectedCountryId !== null && previousView?.selectedCountryId !== undefined) {
      drafts.set(previousView.selectedCountryId, activeDraft.value);
    }

    const opening = open && !wasOpen;
    wasOpen = open;
    renderedView = view;
    panel.hidden = !open;
    panel.classList.toggle('is-open', open);
    if (!open) return;

    const roster = node('nav', 'ifg-dip__roster');
    roster.setAttribute('aria-label', 'Foreign countries');
    const rosterHeading = node('p', 'ifg-dip__section-label', 'Country ledger');
    roster.append(rosterHeading);

    const list = node('div', 'ifg-dip__country-list');
    if (view.countries.length === 0) {
      list.append(node('p', 'ifg-dip__empty', 'No foreign countries are listed.'));
    }
    for (const country of view.countries) {
      const button = node('button', 'ifg-dip__country');
      button.type = 'button';
      button.dataset.relation = country.relation;
      button.classList.toggle('is-selected', country.id === view.selectedCountryId);
      button.setAttribute('aria-pressed', String(country.id === view.selectedCountryId));
      button.setAttribute('aria-label', `${country.name}, ${diplomacyRelationLabel(country.relation)}`);
      button.addEventListener('click', () => actions.selectCountry(country.id));
      const signal = node('i', 'ifg-dip__signal');
      signal.setAttribute('aria-hidden', 'true');
      const identity = node('span', 'ifg-dip__country-identity');
      identity.append(createFlag(country.name, country.color), node('strong', undefined, country.name));
      const meta = node('span', 'ifg-dip__country-meta');
      meta.append(node('span', 'ifg-dip__relation', diplomacyRelationLabel(country.relation)));
      const attention = (country.incomingProposalCount ?? 0) + (country.unreadCount ?? 0);
      if (attention > 0) {
        meta.append(node('b', 'ifg-dip__attention', String(attention)));
      }
      button.append(signal, identity, meta);
      list.append(button);
    }
    roster.append(list);

    const cable = node('section', 'ifg-dip__cable');
    const country = view.countries.find((entry) => entry.id === view.selectedCountryId) ?? null;
    if (!country) {
      const empty = node('div', 'ifg-dip__empty-cable');
      empty.append(createIcon('diplomacy'), node('h3', undefined, 'Select a country'),
        node('p', undefined, 'Open a foreign cable to review relations and send a message.'));
      cable.append(empty);
    } else {
      const cableHead = node('header', 'ifg-dip__cable-head');
      const identity = node('div', 'ifg-dip__cable-identity');
      identity.append(createFlag(country.name, country.color, 'command'));
      const identityCopy = node('div');
      identityCopy.append(node('h3', undefined, country.name));
      const controller = country.controller === 'player' ? 'Player command'
        : country.controller === 'ai' ? 'Military administration' : 'Unclaimed command';
      identityCopy.append(node('p', undefined, controller));
      identity.append(identityCopy);
      const status = node('strong', 'ifg-dip__status', diplomacyRelationLabel(country.relation));
      status.dataset.relation = country.relation;
      cableHead.append(identity, status);

      const messages = node('div', 'ifg-dip__messages');
      messages.setAttribute('role', 'log');
      messages.setAttribute('aria-label', `Messages with ${country.name}`);
      if (view.messages.length === 0) {
        messages.append(node('p', 'ifg-dip__empty', 'No cables exchanged on this circuit.'));
      } else {
        for (const message of view.messages) {
          const outgoing = message.fromCountryId === view.viewerCountryId;
          const item = node('article', `ifg-dip__message ${outgoing ? 'is-outgoing' : 'is-incoming'}`);
          item.append(
            node('small', undefined, `${outgoing ? 'Your office' : country.name} / tick ${message.sentAtTick.toLocaleString()}`),
            node('p', undefined, message.body),
          );
          messages.append(item);
        }
      }

      const pendingIncoming = view.proposals.filter((proposal) =>
        proposal.status === 'pending' && proposal.toCountryId === view.viewerCountryId);
      const pendingOutgoing = view.proposals.find((proposal) =>
        proposal.status === 'pending' && proposal.fromCountryId === view.viewerCountryId);
      const blocked = diplomacyContactBlock(country);
      const busy = view.busy !== null;

      const controls = node('div', 'ifg-dip__controls');
      for (const proposal of pendingIncoming) {
        const sheet = node('section', 'ifg-dip__proposal');
        sheet.append(
          node('p', 'ifg-dip__proposal-kind', proposalLabel(proposal)),
          node('h4', undefined, proposal.kind === 'alliance' ? 'Join forces?' : 'End hostilities?'),
          node('p', undefined, proposal.kind === 'alliance'
            ? `${country.name} asks your government to enter a formal alliance.`
            : `${country.name} offers a negotiated return to peace.`),
        );
        const responses = node('div', 'ifg-dip__proposal-actions');
        const accept = actionButton('Accept', 'note-completed', 'is-primary', busy);
        const decline = actionButton('Decline', 'close', '', busy);
        accept.addEventListener('click', () => actions.respondProposal(proposal.id, true));
        decline.addEventListener('click', () => actions.respondProposal(proposal.id, false));
        responses.append(accept, decline);
        sheet.append(responses);
        controls.append(sheet);
      }

      const relationshipActions = node('div', 'ifg-dip__relationship-actions');
      if (!pendingOutgoing) {
        if (country.relation === 'neutral') {
          const alliance = actionButton('Propose alliance', 'diplomacy', 'is-primary', busy || Boolean(blocked));
          alliance.addEventListener('click', () => actions.proposeAlliance(country.id));
          const war = actionButton('Declare war', 'stat-attack', 'is-hostile', busy || Boolean(blocked));
          war.addEventListener('click', () => actions.declareWar(country.id));
          relationshipActions.append(alliance, war);
        } else if (country.relation === 'war') {
          const peace = actionButton('Offer peace', 'diplomacy', 'is-primary', busy || Boolean(blocked));
          peace.addEventListener('click', () => actions.offerPeace(country.id));
          relationshipActions.append(peace);
        } else {
          const end = actionButton('End alliance', 'close', 'is-hostile', busy || Boolean(blocked));
          end.addEventListener('click', () => actions.endAlliance(country.id));
          relationshipActions.append(end);
        }
      } else {
        relationshipActions.append(node('p', 'ifg-dip__pending',
          `${proposalLabel(pendingOutgoing)} awaiting reply.`));
      }
      controls.append(relationshipActions);

      if (blocked) controls.append(node('p', 'ifg-dip__blocked', blocked));
      if (view.feedback) {
        const feedback = node('p', 'ifg-dip__feedback', view.feedback);
        feedback.setAttribute('role', 'status');
        controls.append(feedback);
      }

      const form = node('form', 'ifg-dip__composer');
      const label = node('label', undefined, `Message ${country.name}`);
      label.htmlFor = `ifg-dip-message-${country.id}`;
      const text = node('textarea');
      text.id = label.htmlFor;
      text.name = 'message';
      text.rows = 2;
      text.maxLength = 500;
      text.placeholder = blocked ? 'Diplomatic channel unavailable' : 'Write a secure cable...';
      text.disabled = Boolean(blocked) || busy;
      text.value = drafts.get(country.id) ?? '';
      const send = actionButton('Send cable', 'diplomacy', 'is-primary', Boolean(blocked) || busy);
      send.type = 'submit';
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const message = text.value.trim();
        if (!message || text.disabled) return;
        drafts.set(country.id, '');
        text.value = '';
        actions.sendMessage(country.id, message);
      });
      form.append(label, text, send);

      controls.append(form);
      cable.append(cableHead, messages, controls);
    }

    body.replaceChildren(roster, cable);
    const log = body.querySelector<HTMLElement>('.ifg-dip__messages');
    if (log) log.scrollTop = log.scrollHeight;
    if (opening) close.focus({ preventScroll: true });
  };

  return { element: panel, render };
}
