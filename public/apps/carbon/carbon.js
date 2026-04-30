import { registerPwa } from '/public/libs/flare/pwa.js';
import { fs } from '/public/libs/flare/fs.js';
import { createCarbonEditor } from '/public/apps/carbon/codemirror-carbon.js';

registerPwa('carbon');

const STORAGE_ROOT = '/home/.carbon';
const TABS_DIR = STORAGE_ROOT + '/tabs';
const STATE_PATH = STORAGE_ROOT + '/state.json';
const AUTOSAVE_DELAY_MS = 450;
const EMPTY_TITLE = 'Untitled';
const FILE_EXTENSION = '.txt';

const ui = {
  desktopTabStrip: document.getElementById('desktop-tab-strip'),
  mobileTabList: document.getElementById('mobile-tab-list'),
  editorHost: document.getElementById('editor-host'),
  toolbarStatus: document.getElementById('toolbar-status'),
  newTabButton: document.getElementById('new-tab-button'),
  menuButton: document.getElementById('menu-button'),
  sidebarBackdrop: document.getElementById('sidebar-backdrop'),
  mobileSidebar: document.getElementById('mobile-sidebar'),
  sidebarCloseButton: document.getElementById('sidebar-close-button')
};

let tabs = [];
let activeTabId = null;
let editorView = null;
let pendingSave = null;
let isSidebarOpen = false;
let dragState = null;
let saveState = 'Loading tabs...';

ui.newTabButton.addEventListener('click', () => {
  void createTabAtCurrentPosition();
});
ui.menuButton.addEventListener('click', () => setSidebarOpen(true));
ui.sidebarCloseButton.addEventListener('click', () => setSidebarOpen(false));
ui.sidebarBackdrop.addEventListener('click', (event) => {
  if (event.target === ui.sidebarBackdrop) {
    setSidebarOpen(false);
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && isSidebarOpen) {
    setSidebarOpen(false);
  }
});
window.addEventListener('resize', syncLayoutOffset);
window.addEventListener('pagehide', () => {
  void flushPendingSave({ silent: true });
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    void flushPendingSave({ silent: true });
  }
});

await initialize();

async function initialize() {
  syncLayoutOffset();
  observeSyncBar();
  bindPointerDropTargets(ui.desktopTabStrip, 'horizontal');
  bindPointerDropTargets(ui.mobileTabList, 'vertical');
  await ensureDir(TABS_DIR);
  tabs = await loadTabs();

  if (tabs.length === 0) {
    await createTab({ activate: true, index: 0 });
  } else {
    activeTabId = pickInitialActiveTab();
    render();
    mountEditorForActiveTab();
    updateStatus('All changes saved');
  }
}

async function loadTabs() {
  const [{ order = [], activeId = null } = {}, fileEntries = []] = await Promise.all([
    readState(),
    listTabFiles()
  ]);
  const knownIds = new Set();
  const orderedIds = [];

  for (const id of order) {
    if (fileEntries.includes(id) && !knownIds.has(id)) {
      knownIds.add(id);
      orderedIds.push(id);
    }
  }

  for (const id of fileEntries) {
    if (!knownIds.has(id)) {
      knownIds.add(id);
      orderedIds.push(id);
    }
  }

  const loadedTabs = [];
  for (const id of orderedIds) {
    try {
      loadedTabs.push({
        id,
        content: await fs.promises.readFile(tabPath(id), { encoding: 'utf8' })
      });
    } catch {
    }
  }

  if (activeId && loadedTabs.some((tab) => tab.id === activeId)) {
    activeTabId = activeId;
  }

  return loadedTabs;
}

function pickInitialActiveTab() {
  if (activeTabId && tabs.some((tab) => tab.id === activeTabId)) {
    return activeTabId;
  }
  return tabs[0]?.id || null;
}

async function createTabAtCurrentPosition() {
  await flushPendingSave({ silent: true });
  const currentIndex = tabs.findIndex((tab) => tab.id === activeTabId);
  const nextIndex = currentIndex === -1 ? tabs.length : currentIndex + 1;
  await createTab({ activate: true, index: nextIndex });
}

async function createTab({ activate = true, index = tabs.length } = {}) {
  const id = crypto.randomUUID();
  const tab = { id, content: '' };
  tabs.splice(index, 0, tab);
  activeTabId = activate ? id : activeTabId || id;

  try {
    await fs.promises.writeFile(tabPath(id), tab.content);
    await writeState();
  } catch (error) {
    tabs = tabs.filter((candidate) => candidate.id !== id);
    activeTabId = tabs[0]?.id || null;
    updateStatus('Could not create a new tab: ' + error.message);
    render();
    mountEditorForActiveTab();
    return null;
  }

  render();
  mountEditorForActiveTab();
  updateStatus('All changes saved');
  return tab;
}

async function selectTab(id) {
  if (id === activeTabId || !tabs.some((tab) => tab.id === id)) {
    return;
  }

  await flushPendingSave({ silent: true });
  activeTabId = id;
  await writeState();
  render();
  mountEditorForActiveTab();
  setSidebarOpen(false);
  updateStatus('All changes saved');
}

async function closeTab(id) {
  const tab = tabs.find((candidate) => candidate.id === id);
  if (!tab) {
    return;
  }

  const title = tabTitle(tab.content);
  if (!window.confirm('Close ' + title + '? This deletes the saved tab.')) {
    return;
  }

  if (pendingSave?.id === id) {
    clearTimeout(pendingSave.timer);
    pendingSave = null;
  }

  const index = tabs.findIndex((candidate) => candidate.id === id);
  tabs.splice(index, 1);

  if (activeTabId === id) {
    activeTabId = tabs[index]?.id || tabs[index - 1]?.id || null;
  }

  try {
    await fs.promises.unlink(tabPath(id));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      tabs.splice(index, 0, tab);
      activeTabId = id;
      render();
      mountEditorForActiveTab();
      updateStatus('Could not close tab: ' + error.message);
      return;
    }
  }

  if (tabs.length === 0) {
    await createTab({ activate: true, index: 0 });
    updateStatus('Opened a fresh tab');
    return;
  }

  await writeState();
  render();
  mountEditorForActiveTab();
  setSidebarOpen(false);
  updateStatus('Tab closed');
}

function render() {
  renderTabCollection(ui.desktopTabStrip, 'horizontal');
  renderTabCollection(ui.mobileTabList, 'vertical');
  updateToolbarText();
}

function renderTabCollection(container, axis) {
  container.replaceChildren(...tabs.map((tab) => createTabNode(tab, axis)));
}

function createTabNode(tab, axis) {
  const item = document.createElement('div');
  item.className = axis === 'horizontal' ? 'tab-card' : 'tab-list-item';
  item.dataset.id = tab.id;
  item.draggable = true;
  if (tab.id === activeTabId) {
    item.classList.add('active');
  }

  item.addEventListener('dragstart', (event) => {
    dragState = { id: tab.id, axis, targetId: null, after: false };
    item.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', tab.id);
  });

  item.addEventListener('dragover', (event) => {
    handleDragOver(event, item, axis);
  });

  item.addEventListener('drop', (event) => {
    event.preventDefault();
    void completeDrop(item.dataset.id);
  });

  item.addEventListener('dragend', () => {
    clearDropState();
  });

  const mainButton = document.createElement('button');
  mainButton.type = 'button';
  mainButton.className = 'tab-main';
  mainButton.addEventListener('click', () => {
    void selectTab(tab.id);
  });

  const title = document.createElement('span');
  title.className = 'tab-title';
  title.textContent = tabTitle(tab.content);
  mainButton.appendChild(title);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'tab-close';
  closeButton.textContent = '✕';
  closeButton.setAttribute('aria-label', 'Close ' + tabTitle(tab.content));
  closeButton.addEventListener('click', (event) => {
    event.stopPropagation();
    void closeTab(tab.id);
  });

  item.append(mainButton, closeButton);
  return item;
}

function handleDragOver(event, item, axis) {
  if (!dragState || dragState.id === item.dataset.id) {
    return;
  }

  event.preventDefault();
  const rect = item.getBoundingClientRect();
  const midpoint = axis === 'horizontal'
    ? rect.left + (rect.width / 2)
    : rect.top + (rect.height / 2);
  const after = axis === 'horizontal'
    ? event.clientX >= midpoint
    : event.clientY >= midpoint;

  dragState.targetId = item.dataset.id;
  dragState.after = after;
  refreshDropIndicators();
}

function refreshDropIndicators() {
  document.querySelectorAll('.drop-before, .drop-after').forEach((node) => {
    node.classList.remove('drop-before', 'drop-after');
  });

  if (!dragState?.targetId) {
    return;
  }

  document.querySelectorAll('[data-id="' + dragState.targetId + '"]').forEach((node) => {
    node.classList.add(dragState.after ? 'drop-after' : 'drop-before');
  });
}

async function completeDrop(targetId) {
  if (!dragState || !targetId) {
    clearDropState();
    return;
  }

  const movingId = dragState.id;
  const insertAfter = dragState.after;
  clearDropState();
  await reorderTabs(movingId, targetId, insertAfter);
}

function clearDropState() {
  document.querySelectorAll('.dragging').forEach((node) => node.classList.remove('dragging'));
  document.querySelectorAll('.drop-before, .drop-after').forEach((node) => {
    node.classList.remove('drop-before', 'drop-after');
  });
  dragState = null;
}

function bindPointerDropTargets(container, axis) {
  container.addEventListener('dragover', (event) => {
    if (!dragState || event.target !== container) {
      return;
    }

    event.preventDefault();
    const targetId = axis === 'horizontal' ? tabs.at(-1)?.id : tabs.at(-1)?.id;
    if (targetId) {
      dragState.targetId = targetId;
      dragState.after = true;
      refreshDropIndicators();
    }
  });

  container.addEventListener('drop', (event) => {
    if (!dragState) {
      return;
    }

    event.preventDefault();
    const targetId = dragState.targetId || tabs.at(-1)?.id;
    void completeDrop(targetId);
  });
}

async function reorderTabs(movingId, targetId, insertAfter) {
  if (!movingId || !targetId || movingId === targetId) {
    return;
  }

  const fromIndex = tabs.findIndex((tab) => tab.id === movingId);
  const toIndex = tabs.findIndex((tab) => tab.id === targetId);
  if (fromIndex === -1 || toIndex === -1) {
    return;
  }

  const [movingTab] = tabs.splice(fromIndex, 1);
  const adjustedIndex = tabs.findIndex((tab) => tab.id === targetId) + (insertAfter ? 1 : 0);
  tabs.splice(adjustedIndex, 0, movingTab);
  await writeState();
  render();
}

function mountEditorForActiveTab() {
  const tab = tabs.find((candidate) => candidate.id === activeTabId) || tabs[0] || null;
  if (!tab) {
    ui.editorHost.replaceChildren();
    return;
  }

  if (editorView) {
    editorView.destroy();
    editorView = null;
  }

  ui.editorHost.replaceChildren();
  editorView = createCarbonEditor({
    parent: ui.editorHost,
    doc: tab.content,
    onChange(nextContent) {
      tab.content = nextContent;
      render();
      scheduleAutosave(tab.id);
    }
  });
}

function scheduleAutosave(tabId) {
  if (pendingSave?.timer) {
    clearTimeout(pendingSave.timer);
  }

  saveState = 'Autosaving...';
  updateToolbarText();
  pendingSave = {
    id: tabId,
    timer: window.setTimeout(() => {
      void saveTab(tabId);
    }, AUTOSAVE_DELAY_MS)
  };
}

async function saveTab(tabId, { silent = false } = {}) {
  const tab = tabs.find((candidate) => candidate.id === tabId);
  if (!tab) {
    pendingSave = null;
    return;
  }

  if (pendingSave?.id === tabId) {
    clearTimeout(pendingSave.timer);
    pendingSave = null;
  }

  try {
    await fs.promises.writeFile(tabPath(tab.id), tab.content);
    await writeState();
    if (!silent) {
      updateStatus('All changes saved');
    }
  } catch (error) {
    updateStatus('Save failed: ' + error.message);
  }
}

async function flushPendingSave({ silent = false } = {}) {
  if (!pendingSave?.id) {
    return;
  }

  const { id } = pendingSave;
  clearTimeout(pendingSave.timer);
  pendingSave = null;
  await saveTab(id, { silent });
}

async function writeState() {
  const payload = {
    order: tabs.map((tab) => tab.id),
    activeId: activeTabId
  };

  await fs.promises.writeFile(STATE_PATH, JSON.stringify(payload));
}

async function readState() {
  try {
    const raw = await fs.promises.readFile(STATE_PATH, { encoding: 'utf8' });
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function listTabFiles() {
  try {
    const entries = await fs.promises.readdir(TABS_DIR);
    return entries
      .filter((name) => name.endsWith(FILE_EXTENSION))
      .map((name) => name.slice(0, -FILE_EXTENSION.length));
  } catch {
    return [];
  }
}

async function ensureDir(path) {
  const parts = path.split('/').filter(Boolean);
  let current = '';

  for (const part of parts) {
    current += '/' + part;
    try {
      await fs.promises.mkdir(current);
    } catch {
    }
  }
}

function tabPath(id) {
  return TABS_DIR + '/' + id + FILE_EXTENSION;
}

function tabTitle(content) {
  const firstLine = content.split(/\r?\n/, 1)[0]?.trim();
  return firstLine || EMPTY_TITLE;
}

function updateStatus(nextStatus) {
  saveState = nextStatus;
  updateToolbarText();
}

function updateToolbarText() {
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const title = activeTab ? tabTitle(activeTab.content) : EMPTY_TITLE;
  ui.toolbarStatus.textContent = title + ' · ' + saveState;
}

function setSidebarOpen(open) {
  isSidebarOpen = open;
  ui.sidebarBackdrop.classList.toggle('open', open);
  ui.mobileSidebar.classList.toggle('open', open);
  ui.menuButton.setAttribute('aria-expanded', String(open));
  ui.sidebarBackdrop.setAttribute('aria-hidden', String(!open));
}

function syncLayoutOffset() {
  const syncBar = document.querySelector('.flare-sync-bar');
  const height = syncBar?.getBoundingClientRect().height || 42;
  document.documentElement.style.setProperty('--sync-bar-height', Math.ceil(height) + 'px');
}

function observeSyncBar() {
  const syncBar = document.querySelector('.flare-sync-bar');
  if (!syncBar || typeof ResizeObserver === 'undefined') {
    return;
  }

  const observer = new ResizeObserver(() => syncLayoutOffset());
  observer.observe(syncBar);
}
