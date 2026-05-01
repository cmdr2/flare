import { registerPwa } from '/public/libs/flare/pwa.js';
import { fs } from '/public/libs/flare/fs.js';
import {
  CARBON_LANGUAGE_OPTIONS,
  DEFAULT_CARBON_LANGUAGE,
  createCarbonEditor
} from '/public/apps/carbon/codemirror-carbon.js';

registerPwa('carbon');

const STORAGE_ROOT = '/home/.carbon';
const TABS_DIR = STORAGE_ROOT + '/tabs';
const STATE_PATH = STORAGE_ROOT + '/state.json';
const AUTOSAVE_DELAY_MS = 450;
const EMPTY_TITLE = 'Untitled';
const FILE_EXTENSION = '.txt';
const STATE_VERSION = 1;
const MOBILE_BREAKPOINT_PX = 720;
const MOBILE_OPEN_SWIPE_DISTANCE_PX = 180;
const MOBILE_CLOSE_SWIPE_DISTANCE_PX = 50;
const MOBILE_SWIPE_MAX_VERTICAL_DRIFT_PX = 28;
const MOBILE_SWIPE_LOCK_PX = 10;
const MOBILE_LONG_PRESS_MS = 320;
const MOBILE_DRAG_START_DISTANCE_PX = 8;
const LANGUAGE_IDS = new Set(CARBON_LANGUAGE_OPTIONS.map((option) => option.id));

const ui = {
  desktopTabStrip: document.getElementById('desktop-tab-strip'),
  mobileTabList: document.getElementById('mobile-tab-list'),
  editorHost: document.getElementById('editor-host'),
  statusText: document.getElementById('status-text'),
  syntaxSelect: document.getElementById('syntax-select'),
  newTabButton: document.getElementById('new-tab-button'),
  menuButton: document.getElementById('menu-button'),
  sidebarBackdrop: document.getElementById('sidebar-backdrop'),
  mobileSidebar: document.getElementById('mobile-sidebar'),
  sidebarCloseButton: document.getElementById('sidebar-close-button')
};

let tabs = [];
let activeTabId = null;
let editorSession = null;
let pendingSave = null;
let isSidebarOpen = false;
let dragState = null;
let saveState = 'Loading tabs...';
let sidebarSwipeState = null;
let mobileLongPress = null;
let mobileDragState = null;

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
ui.syntaxSelect.addEventListener('change', () => {
  void updateActiveTabLanguage(ui.syntaxSelect.value);
});

document.addEventListener('keydown', handleDocumentKeydown, true);
window.addEventListener('resize', syncLayoutOffset);
document.addEventListener('pointermove', handleGlobalPointerMove, { capture: true, passive: false });
document.addEventListener('pointerup', handleGlobalPointerUp, { capture: true, passive: false });
document.addEventListener('pointercancel', handleGlobalPointerCancel, { capture: true, passive: false });
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
  bindPointerDropTargets(ui.desktopTabStrip);
  bindPointerDropTargets(ui.mobileTabList);
  bindMobileSidebarGestures();
  await ensureDir(TABS_DIR);
  tabs = await loadTabs();

  if (tabs.length === 0) {
    await createTab({ activate: true, index: 0 });
    updateStatus('Ready');
    return;
  }

  activeTabId = pickInitialActiveTab();
  render();
  mountEditorForActiveTab();
  updateStatus('All changes saved');
}

async function loadTabs() {
  const [state = {}, fileEntries = []] = await Promise.all([
    readState(),
    listTabFiles()
  ]);
  const order = Array.isArray(state.order) ? state.order : [];
  const tabState = state.tabs && typeof state.tabs === 'object' ? state.tabs : {};
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
        content: await fs.promises.readFile(tabPath(id), { encoding: 'utf8' }),
        language: normalizeLanguageId(tabState[id]?.language),
        persisted: true
      });
    } catch {
    }
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
  updateStatus('Ready');
}

async function createTab({ activate = true, index = tabs.length } = {}) {
  const tab = {
    id: crypto.randomUUID(),
    content: '',
    language: DEFAULT_CARBON_LANGUAGE,
    persisted: false
  };
  tabs.splice(index, 0, tab);
  activeTabId = activate ? tab.id : activeTabId || tab.id;
  render();
  mountEditorForActiveTab();
  return tab;
}

async function selectTab(id) {
  if (id === activeTabId || !tabs.some((tab) => tab.id === id)) {
    return;
  }

  await flushPendingSave({ silent: true });
  activeTabId = id;
  render();
  mountEditorForActiveTab();
  setSidebarOpen(false);
  updateStatus(getIdleStatusForActiveTab());
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

  if (tab.persisted) {
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
  }

  if (tabs.length === 0) {
    await writeState();
    await createTab({ activate: true, index: 0 });
    updateStatus('Ready');
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
  updateStatusBar();
}

function renderTabCollection(container, axis) {
  const scrollOffset = axis === 'horizontal' ? container.scrollLeft : container.scrollTop;
  container.replaceChildren(...tabs.map((tab) => createTabNode(tab, axis)));
  if (axis === 'horizontal') {
    container.scrollLeft = scrollOffset;
    return;
  }

  container.scrollTop = scrollOffset;
}

function createTabNode(tab, axis) {
  const item = document.createElement('div');
  item.className = axis === 'horizontal' ? 'tab-card' : 'tab-list-item';
  item.dataset.id = tab.id;
  item.draggable = axis === 'horizontal';
  if (tab.id === activeTabId) {
    item.classList.add('active');
  }

  item.addEventListener('dragstart', (event) => {
    dragState = { id: tab.id, targetId: null, after: false };
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

  if (axis === 'vertical') {
    bindMobileLongPress(item, tab.id);
  }

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
  dragState.targetId = item.dataset.id;
  dragState.after = axis === 'horizontal'
    ? event.clientX >= midpoint
    : event.clientY >= midpoint;
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

function bindPointerDropTargets(container) {
  container.addEventListener('dragover', (event) => {
    if (!dragState || event.target !== container) {
      return;
    }

    event.preventDefault();
    const targetId = tabs.at(-1)?.id;
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

function bindMobileSidebarGestures() {
  document.addEventListener('pointerdown', handleSidebarPointerDown, { capture: true, passive: true });
}

function handleSidebarPointerDown(event) {
  if (!isMobileViewport() || event.pointerType === 'mouse' || mobileDragState) {
    return;
  }

  if (!isSidebarOpen) {
    sidebarSwipeState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      mode: 'open',
      locked: false,
      handled: false
    };
    return;
  }

  const withinSidebar = ui.mobileSidebar.contains(event.target);
  const withinBackdrop = ui.sidebarBackdrop.contains(event.target);
  if (!withinSidebar && !withinBackdrop) {
    return;
  }

  sidebarSwipeState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    mode: 'close',
    locked: false,
    handled: false
  };
}

function handleGlobalPointerMove(event) {
  handleSidebarPointerMove(event);
  handleMobileDragMove(event);
}

function handleGlobalPointerUp(event) {
  handleSidebarPointerUp(event);
  handleMobileLongPressEnd(event);
}

function handleGlobalPointerCancel(event) {
  cancelSidebarSwipe(event.pointerId);
  cancelMobileLongPress(event.pointerId);
  cancelMobileDrag(event.pointerId);
}

function handleSidebarPointerMove(event) {
  if (!sidebarSwipeState || sidebarSwipeState.pointerId !== event.pointerId) {
    return;
  }

  const deltaX = event.clientX - sidebarSwipeState.startX;
  const deltaY = event.clientY - sidebarSwipeState.startY;
  if (!sidebarSwipeState.locked) {
    if (Math.abs(deltaY) > MOBILE_SWIPE_MAX_VERTICAL_DRIFT_PX) {
      cancelSidebarSwipe(event.pointerId);
      return;
    }

    if (Math.abs(deltaX) < MOBILE_SWIPE_LOCK_PX) {
      return;
    }

    if (sidebarSwipeState.mode === 'open' && deltaX <= 0) {
      cancelSidebarSwipe(event.pointerId);
      return;
    }

    if (sidebarSwipeState.mode === 'close' && deltaX >= 0) {
      cancelSidebarSwipe(event.pointerId);
      return;
    }

    sidebarSwipeState.locked = true;
  }

  const threshold = sidebarSwipeState.mode === 'open'
    ? MOBILE_OPEN_SWIPE_DISTANCE_PX
    : MOBILE_CLOSE_SWIPE_DISTANCE_PX;
  const distance = sidebarSwipeState.mode === 'open' ? deltaX : -deltaX;
  if (distance >= threshold) {
    event.preventDefault();
    sidebarSwipeState.handled = true;
    setSidebarOpen(sidebarSwipeState.mode === 'open');
    cancelSidebarSwipe(event.pointerId);
  }
}

function handleSidebarPointerUp(event) {
  cancelSidebarSwipe(event.pointerId);
}

function cancelSidebarSwipe(pointerId) {
  if (sidebarSwipeState?.pointerId !== pointerId) {
    return;
  }

  sidebarSwipeState = null;
}

function bindMobileLongPress(item, tabId) {
  item.addEventListener('pointerdown', (event) => {
    if (!isMobileViewport() || event.pointerType === 'mouse' || mobileDragState || dragState) {
      return;
    }

    if (event.button !== undefined && event.button !== 0) {
      return;
    }

    const interactiveControl = event.target.closest('button');
    if (interactiveControl?.classList.contains('tab-close')) {
      return;
    }

    const rect = item.getBoundingClientRect();
    mobileLongPress = {
      pointerId: event.pointerId,
      tabId,
      item,
      startX: event.clientX,
      startY: event.clientY,
      timer: window.setTimeout(() => {
        startMobileDrag(item, tabId, event.pointerId, rect);
      }, MOBILE_LONG_PRESS_MS)
    };
  }, { passive: true });
}

function handleMobileLongPressEnd(event) {
  cancelMobileLongPress(event.pointerId);
  finalizeMobileDrag(event.pointerId);
}

function cancelMobileLongPress(pointerId) {
  if (mobileLongPress?.pointerId !== pointerId) {
    return;
  }

  clearTimeout(mobileLongPress.timer);
  mobileLongPress.item.classList.remove('long-press-armed');
  mobileLongPress = null;
}

function startMobileDrag(item, tabId, pointerId, rect) {
  if (!mobileLongPress || mobileLongPress.pointerId !== pointerId || mobileLongPress.tabId !== tabId) {
    return;
  }

  mobileLongPress.item.classList.add('long-press-armed');
  dragState = { id: tabId, targetId: tabId, after: false };
  mobileDragState = {
    pointerId,
    item,
    tabId,
    axis: 'vertical',
    lastClientX: mobileLongPress.startX,
    lastClientY: mobileLongPress.startY,
    active: false
  };
}

function handleMobileDragMove(event) {
  if (mobileLongPress?.pointerId === event.pointerId) {
    const driftX = Math.abs(event.clientX - mobileLongPress.startX);
    const driftY = Math.abs(event.clientY - mobileLongPress.startY);
    if (driftX > MOBILE_DRAG_START_DISTANCE_PX || driftY > MOBILE_DRAG_START_DISTANCE_PX) {
      cancelMobileLongPress(event.pointerId);
    }
  }

  if (!mobileDragState || mobileDragState.pointerId !== event.pointerId) {
    return;
  }

  event.preventDefault();
  mobileDragState.lastClientX = event.clientX;
  mobileDragState.lastClientY = event.clientY;
  if (!mobileDragState.active) {
    mobileDragState.active = true;
    mobileDragState.item.classList.remove('long-press-armed');
    mobileDragState.item.classList.add('dragging');
  }

  const dropTarget = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-id]');
  if (dropTarget && dropTarget.dataset.id && dropTarget.dataset.id !== mobileDragState.tabId) {
    const rect = dropTarget.getBoundingClientRect();
    dragState.targetId = dropTarget.dataset.id;
    dragState.after = event.clientY >= rect.top + (rect.height / 2);
    refreshDropIndicators();
    return;
  }

  if (!ui.mobileTabList.contains(event.target)) {
    return;
  }

  const targetId = tabs.at(-1)?.id;
  if (targetId) {
    dragState.targetId = targetId;
    dragState.after = true;
    refreshDropIndicators();
  }
}

function finalizeMobileDrag(pointerId) {
  if (!mobileDragState || mobileDragState.pointerId !== pointerId) {
    return;
  }

  const targetId = dragState?.targetId;
  const insertAfter = dragState?.after ?? false;
  const movingId = mobileDragState.tabId;
  const shouldDrop = mobileDragState.active && targetId && targetId !== movingId;
  clearDropState();
  mobileDragState = null;
  if (shouldDrop) {
    void reorderTabs(movingId, targetId, insertAfter);
  }
}

function cancelMobileDrag(pointerId) {
  if (!mobileDragState || mobileDragState.pointerId !== pointerId) {
    return;
  }

  clearDropState();
  mobileDragState = null;
}

function isMobileViewport() {
  return window.matchMedia('(max-width: ' + MOBILE_BREAKPOINT_PX + 'px)').matches;
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
  const tab = getActiveTab();
  if (!tab) {
    ui.editorHost.replaceChildren();
    updateSyntaxControl();
    return;
  }

  if (editorSession) {
    editorSession.destroy();
  }

  ui.editorHost.replaceChildren();
  editorSession = createCarbonEditor({
    parent: ui.editorHost,
    doc: tab.content,
    language: tab.language,
    onChange(nextContent) {
      tab.content = nextContent;
      render();
      scheduleAutosave(tab.id);
    }
  });
  if (!isMobileViewport()) {
    editorSession.focus();
  }
  updateSyntaxControl();
}

function scheduleAutosave(tabId) {
  const tab = tabs.find((candidate) => candidate.id === tabId);
  if (!tab) {
    return;
  }

  if (!tab.persisted && tab.content === '') {
    if (pendingSave?.id === tabId) {
      clearTimeout(pendingSave.timer);
      pendingSave = null;
    }
    updateStatus('Ready');
    return;
  }

  if (pendingSave?.timer) {
    clearTimeout(pendingSave.timer);
  }

  saveState = 'Autosaving...';
  updateStatusBar();
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

  if (!tab.persisted && tab.content === '') {
    if (!silent) {
      updateStatus('Ready');
    }
    return;
  }

  const wasPersisted = tab.persisted;

  try {
    await fs.promises.writeFile(tabPath(tab.id), tab.content);
    tab.persisted = true;
    await writeState();
    if (!wasPersisted) {
      render();
    }
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

async function updateActiveTabLanguage(languageId) {
  const tab = getActiveTab();
  if (!tab) {
    return;
  }

  const nextLanguage = normalizeLanguageId(languageId);
  if (tab.language === nextLanguage) {
    updateSyntaxControl();
    return;
  }

  tab.language = nextLanguage;
  editorSession?.setLanguage(nextLanguage);
  updateSyntaxControl();

  if (tab.persisted) {
    try {
      await writeState();
    } catch (error) {
      updateStatus('Could not save syntax setting: ' + error.message);
      return;
    }
  }

  updateStatus(getIdleStatusForActiveTab());
}

async function writeState() {
  const persistedTabs = tabs.filter((tab) => tab.persisted);
  if (persistedTabs.length === 0) {
    try {
      await fs.promises.unlink(STATE_PATH);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
    return;
  }

  const payload = {
    version: STATE_VERSION,
    order: persistedTabs.map((tab) => tab.id),
    tabs: Object.fromEntries(
      persistedTabs.map((tab) => [tab.id, { language: tab.language }])
    )
  };

  await fs.promises.writeFile(STATE_PATH, JSON.stringify(payload));
}

async function readState() {
  try {
    const raw = await fs.promises.readFile(STATE_PATH, { encoding: 'utf8' });
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
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

function handleDocumentKeydown(event) {
  if (event.key === 'Escape' && isSidebarOpen) {
    event.preventDefault();
    setSidebarOpen(false);
    return;
  }

  const primaryModifier = event.ctrlKey || event.metaKey;
  if (!primaryModifier || event.altKey) {
    return;
  }

  if (event.key === 'Tab') {
    event.preventDefault();
    void cycleTabs(event.shiftKey ? -1 : 1);
    return;
  }

  const key = event.key.toLowerCase();
  if (key === 't') {
    event.preventDefault();
    void createTabAtCurrentPosition();
    return;
  }

  if (key === 'w') {
    const tab = getActiveTab();
    if (!tab) {
      return;
    }
    event.preventDefault();
    void closeTab(tab.id);
  }
}

async function cycleTabs(step) {
  if (tabs.length < 2) {
    return;
  }

  const currentIndex = tabs.findIndex((tab) => tab.id === activeTabId);
  const startIndex = currentIndex === -1 ? 0 : currentIndex;
  const nextIndex = (startIndex + step + tabs.length) % tabs.length;
  await selectTab(tabs[nextIndex].id);
}

function getActiveTab() {
  return tabs.find((tab) => tab.id === activeTabId) || tabs[0] || null;
}

function tabPath(id) {
  return TABS_DIR + '/' + id + FILE_EXTENSION;
}

function tabTitle(content) {
  const safeContent = typeof content === 'string' ? content : '';
  const firstLine = safeContent.split(/\r?\n/, 1)[0]?.trim();
  return firstLine || EMPTY_TITLE;
}

function normalizeLanguageId(languageId) {
  return LANGUAGE_IDS.has(languageId) ? languageId : DEFAULT_CARBON_LANGUAGE;
}

function getIdleStatusForActiveTab() {
  return getActiveTab()?.persisted ? 'All changes saved' : 'Ready';
}

function updateStatus(nextStatus) {
  saveState = nextStatus;
  updateStatusBar();
}

function updateStatusBar() {
  ui.statusText.textContent = saveState;
  updateSyntaxControl();
}

function updateSyntaxControl() {
  const tab = getActiveTab();
  ui.syntaxSelect.value = tab ? normalizeLanguageId(tab.language) : DEFAULT_CARBON_LANGUAGE;
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