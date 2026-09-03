import {
  getDevIconMapping,
  listZeroAdIcons,
  setDevIconMapping,
  type FacilityIconSlot,
} from './icons';

const SLOTS: ReadonlyArray<{ slot: FacilityIconSlot; label: string; note: string }> = [
  { slot: 'barracks', label: 'Barracks', note: 'Infantry and engineer training' },
  { slot: 'tankPlant', label: 'Tank plant', note: 'Armoured vehicle production' },
  { slot: 'ordnance', label: 'Ordnance works', note: 'Artillery production' },
];

function labelForPath(path: string): string {
  return path.replace(/^\.\/assets\/icons\/0ad\//, '');
}

function iconImage(url: string, className: string): HTMLImageElement {
  const image = document.createElement('img');
  image.className = className;
  image.src = url;
  image.alt = '';
  image.draggable = false;
  return image;
}

export function mountIconMapper(container: HTMLElement): void {
  const entries = listZeroAdIcons();
  let mapping = getDevIconMapping();
  let activeSlot: FacilityIconSlot | null = null;

  const heading = document.createElement('div');
  heading.className = 'icon-mapper__heading';
  heading.innerHTML = '<strong>0 A.D. ICON CATALOG</strong><small>DEV ONLY · selections stay in this browser</small>';

  const intro = document.createElement('p');
  intro.className = 'icon-mapper__intro';
  intro.textContent = 'Choose a committed 0 A.D. icon for the facilities that already exist in Ironfronts. The mapper never exposes a new gameplay action.';

  const actions = document.createElement('div');
  actions.className = 'icon-mapper__actions';
  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.textContent = 'Export mapping';
  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.textContent = 'Reset defaults';
  const status = document.createElement('span');
  status.className = 'icon-mapper__status';
  actions.append(exportButton, resetButton, status);

  const mappingList = document.createElement('div');
  mappingList.className = 'icon-mapper__mapping';
  const catalog = document.createElement('div');
  catalog.className = 'icon-mapper__catalog';
  const catalogHeading = document.createElement('div');
  catalogHeading.className = 'icon-mapper__catalog-heading';
  catalogHeading.innerHTML = '<strong>CATALOG</strong><span>Select an icon after choosing Change</span>';
  const grid = document.createElement('div');
  grid.className = 'icon-mapper__grid';

  const renderMapping = (): void => {
    mappingList.replaceChildren(...SLOTS.map(({ slot, label, note }) => {
      const row = document.createElement('article');
      row.className = 'icon-mapper__slot';
      row.dataset.slot = slot;
      const path = mapping[slot];
      const selected = entries.find((entry) => entry.path === path) ?? entries.find((entry) =>
        entry.path.endsWith(slot === 'tankPlant' ? 'production.png' : slot === 'ordnance' ? 'construction.png' : 'training.png'));
      if (selected) row.append(iconImage(selected.url, 'icon-mapper__slot-art'));
      const copy = document.createElement('span');
      copy.className = 'icon-mapper__slot-copy';
      copy.innerHTML = `<strong>${label}</strong><small>${note}</small><code>${selected ? labelForPath(selected.path) : 'default'}</code>`;
      const change = document.createElement('button');
      change.type = 'button';
      change.textContent = activeSlot === slot ? 'Choosing…' : 'Change';
      change.addEventListener('click', () => {
        activeSlot = slot;
        status.textContent = `Choose an icon for ${label}.`;
        renderMapping();
        renderGrid();
      });
      row.append(copy, change);
      return row;
    }));
  };

  const renderGrid = (): void => {
    grid.replaceChildren(...entries.map((entry) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'icon-mapper__candidate';
      button.title = entry.path;
      button.dataset.path = entry.path;
      button.append(iconImage(entry.url, 'icon-mapper__candidate-art'));
      const name = document.createElement('span');
      name.textContent = labelForPath(entry.path);
      button.append(name);
      if (entry.path === (activeSlot ? mapping[activeSlot] : '')) button.classList.add('is-selected');
      button.addEventListener('click', () => {
        if (!activeSlot) {
          status.textContent = 'Choose Change beside a facility first.';
          return;
        }
        mapping = { ...mapping, [activeSlot]: entry.path };
        setDevIconMapping(mapping);
        status.textContent = `${entry.filename} mapped to ${SLOTS.find((item) => item.slot === activeSlot)?.label}.`;
        activeSlot = null;
        renderMapping();
        renderGrid();
      });
      return button;
    }));
  };

  exportButton.addEventListener('click', () => {
    const payload = JSON.stringify(mapping, null, 2);
    if (!navigator.clipboard) {
      status.textContent = payload;
      return;
    }
    void navigator.clipboard.writeText(payload).then(
      () => { status.textContent = 'Mapping JSON copied to clipboard.'; },
      () => { status.textContent = payload; },
    );
  });
  resetButton.addEventListener('click', () => {
    mapping = {};
    setDevIconMapping(mapping);
    activeSlot = null;
    status.textContent = 'Defaults restored.';
    renderMapping();
    renderGrid();
  });

  catalog.append(catalogHeading, grid);
  container.replaceChildren(heading, intro, actions, mappingList, catalog);
  renderMapping();
  renderGrid();
}
