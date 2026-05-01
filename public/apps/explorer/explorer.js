import { registerPwa } from '/public/libs/flare/pwa.js';
import { fs } from '/public/libs/flare/fs.js';

registerPwa('explorer');

const EXPLORER_CONFIG_DIR = '/home/.explorer';
const EXPLORER_CONFIG_PATH = EXPLORER_CONFIG_DIR + '/config.json';
const STORAGE_STATUS_LOADING = 'Checking storage...';
const STORAGE_STATUS_UNAVAILABLE = 'Storage info unavailable';
const SIDEBAR_PLACES = [
  { label: 'Root', path: '/', icon: 'fa-hard-drive' },
  { label: 'Home', path: '/home', icon: 'fa-house' },
  { label: 'Apps', path: '/public/apps', icon: 'fa-table-cells-large' },
  { label: 'Public', path: '/public', icon: 'fa-folder-tree' },
  { label: 'Libraries', path: '/public/libs', icon: 'fa-book' }
];

const state = {
  currentFolder: '/',
  currentFolderEntry: null,
  currentView: loadStoredView(),
  currentEntries: [],
  lastTouchTreeTapPath: '',
  lastTouchTreeTapAt: 0,
  favorites: [],
  pathTypes: new Map(),
  clipboardMode: '',
  clipboardPaths: [],
  draggedFolderPath: '',
  draggedPaths: [],
  selectionPath: null,
  selectedPaths: new Set(),
  expandedFolders: new Set(['/']),
  sidebarOpen: false,
  createKind: 'file',
  createTargetFolder: '/',
  renamePath: '',
  editorPath: '',
  editorDirty: false,
  pendingTouchClick: false,
  suppressedClickPath: null,
  contentRenderToken: 0,
  sidebarRenderToken: 0,
  storageStatus: STORAGE_STATUS_LOADING,
  lastStatusMessage: '',
  storageEstimateToken: 0
};

const MOBILE_LONG_PRESS_MS = 420;
const MOBILE_DOUBLE_TAP_MS = 360;
let longPressState = null;
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
});

const FILE_ICON_NAMES = {
  default: 'fa-file',
  text: 'fa-file-lines',
  code: 'fa-file-code',
  image: 'fa-file-image',
  audio: 'fa-file-audio',
  video: 'fa-file-video',
  pdf: 'fa-file-pdf',
  archive: 'fa-file-zipper',
  spreadsheet: 'fa-file-csv',
  document: 'fa-file-word',
  presentation: 'fa-file-powerpoint',
  font: 'fa-font'
};

const FILE_ICON_FAMILIES = {
  txt: 'text',
  md: 'text',
  log: 'text',
  rst: 'text',
  json: 'code',
  yaml: 'code',
  yml: 'code',
  toml: 'code',
  xml: 'code',
  html: 'code',
  htm: 'code',
  css: 'code',
  scss: 'code',
  js: 'code',
  mjs: 'code',
  cjs: 'code',
  ts: 'code',
  jsx: 'code',
  tsx: 'code',
  py: 'code',
  rb: 'code',
  php: 'code',
  java: 'code',
  c: 'code',
  h: 'code',
  cpp: 'code',
  hpp: 'code',
  cs: 'code',
  go: 'code',
  rs: 'code',
  sh: 'code',
  ps1: 'code',
  sql: 'code',
  svg: 'image',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  bmp: 'image',
  ico: 'image',
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  flac: 'audio',
  m4a: 'audio',
  aac: 'audio',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  mkv: 'video',
  avi: 'video',
  pdf: 'pdf',
  zip: 'archive',
  gz: 'archive',
  tgz: 'archive',
  tar: 'archive',
  rar: 'archive',
  '7z': 'archive',
  csv: 'spreadsheet',
  tsv: 'spreadsheet',
  doc: 'document',
  docx: 'document',
  odt: 'document',
  ppt: 'presentation',
  pptx: 'presentation',
  odp: 'presentation',
  woff: 'font',
  woff2: 'font',
  ttf: 'font',
  otf: 'font'
};

const FILE_TYPE_LABELS = {
  txt: 'Text file',
  md: 'Markdown file',
  log: 'Log file',
  json: 'JSON file',
  yaml: 'YAML file',
  yml: 'YAML file',
  toml: 'TOML file',
  xml: 'XML file',
  html: 'HTML file',
  htm: 'HTML file',
  css: 'Stylesheet',
  scss: 'Stylesheet',
  js: 'JavaScript file',
  mjs: 'JavaScript module',
  cjs: 'CommonJS module',
  ts: 'TypeScript file',
  jsx: 'React component',
  tsx: 'React component',
  py: 'Python file',
  svg: 'Vector image',
  png: 'PNG image',
  jpg: 'JPEG image',
  jpeg: 'JPEG image',
  gif: 'GIF image',
  webp: 'WebP image',
  avif: 'AVIF image',
  bmp: 'Bitmap image',
  ico: 'Icon file',
  mp3: 'Audio file',
  wav: 'Audio file',
  ogg: 'Audio file',
  flac: 'Audio file',
  m4a: 'Audio file',
  aac: 'Audio file',
  mp4: 'Video file',
  webm: 'Video file',
  mov: 'Video file',
  mkv: 'Video file',
  avi: 'Video file',
  pdf: 'PDF document',
  zip: 'Archive',
  gz: 'Archive',
  tgz: 'Archive',
  tar: 'Archive',
  rar: 'Archive',
  '7z': 'Archive',
  csv: 'CSV file',
  tsv: 'Delimited file',
  doc: 'Document',
  docx: 'Document',
  odt: 'Document',
  ppt: 'Presentation',
  pptx: 'Presentation',
  odp: 'Presentation',
  woff: 'Font file',
  woff2: 'Font file',
  ttf: 'Font file',
  otf: 'Font file'
};

const elements = {
  addressForm: document.getElementById('address-form'),
  addressInput: document.getElementById('address-input'),
  contentShell: document.querySelector('.content-shell'),
  contentView: document.getElementById('content-view'),
  selectionSummary: document.getElementById('selection-summary'),
  statusMessage: document.getElementById('status-message'),
  contentActionsDivider: document.getElementById('content-actions-divider'),
  contentActionsSecondary: document.getElementById('content-actions-secondary'),
  cutSelectionButton: document.getElementById('cut-selection-button'),
  copySelectionButton: document.getElementById('copy-selection-button'),
  pasteClipboardButton: document.getElementById('paste-clipboard-button'),
  clearSelectionButton: document.getElementById('clear-selection-button'),
  renameSelectionButton: document.getElementById('rename-selection-button'),
  pinSelectionButton: document.getElementById('pin-selection-button'),
  unpinSelectionButton: document.getElementById('unpin-selection-button'),
  deleteSelectionButton: document.getElementById('delete-selection-button'),
  operationsMenuButton: document.getElementById('operations-menu-button'),
  sidebar: document.getElementById('sidebar'),
  sidebarBackdrop: document.getElementById('sidebar-backdrop'),
  sidebarPlaces: document.getElementById('sidebar-places'),
  favoritesPanel: document.querySelector('.favorites-panel'),
  sidebarFavorites: document.getElementById('sidebar-favorites'),
  favoritesDropzone: document.getElementById('favorites-dropzone'),
  sidebarToggle: document.getElementById('sidebar-toggle'),
  collapseSidebarButton: document.getElementById('collapse-sidebar-button'),
  upButton: document.getElementById('up-button'),
  newFileButton: document.getElementById('new-file-button'),
  newFolderButton: document.getElementById('new-folder-button'),
  viewButtons: Array.from(document.querySelectorAll('.view-button')),
  editorDialog: document.getElementById('editor-dialog'),
  editorTitle: document.getElementById('editor-title'),
  editorTextarea: document.getElementById('editor-textarea'),
  editorStatus: document.getElementById('editor-status'),
  editorSaveButton: document.getElementById('editor-save-button'),
  editorCloseButton: document.getElementById('editor-close-button'),
  createDialog: document.getElementById('create-dialog'),
  createForm: document.getElementById('create-form'),
  createLabel: document.getElementById('create-label'),
  createTitle: document.getElementById('create-title'),
  createNameInput: document.getElementById('create-name-input'),
  createTarget: document.getElementById('create-target'),
  createError: document.getElementById('create-error'),
  createCancelButton: document.getElementById('create-cancel-button'),
  createSubmitButton: document.getElementById('create-submit-button'),
  alertDialog: document.getElementById('alert-dialog'),
  alertTitle: document.getElementById('alert-title'),
  alertMessage: document.getElementById('alert-message'),
  alertCloseButton: document.getElementById('alert-close-button'),
  alertConfirmButton: document.getElementById('alert-confirm-button'),
  actionMenu: document.getElementById('action-menu'),
  dropTooltip: document.getElementById('drop-tooltip')
};

syncViewportHeight();
bindEvents();
renderStatusMessage();
await refreshExplorer();

function bindEvents() {
  elements.addressForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void handleAddressSubmit();
  });

  elements.upButton.addEventListener('click', () => {
    if (state.currentFolder !== '/') {
      void navigateTo(parentDir(state.currentFolder));
    }
  });

  elements.sidebarToggle.addEventListener('click', () => {
    setSidebarOpen(!state.sidebarOpen);
  });

  elements.collapseSidebarButton.addEventListener('click', () => setSidebarOpen(false));
  elements.sidebarBackdrop.addEventListener('click', () => setSidebarOpen(false));

  elements.newFileButton.addEventListener('click', () => openCreateDialog('file'));
  elements.newFolderButton.addEventListener('click', () => openCreateDialog('folder'));
  elements.cutSelectionButton.addEventListener('click', () => copySelectionToClipboard('cut'));
  elements.copySelectionButton.addEventListener('click', () => copySelectionToClipboard('copy'));
  elements.pasteClipboardButton.addEventListener('click', () => {
    void pasteClipboardInto(state.currentFolder);
  });
  elements.renameSelectionButton.addEventListener('click', () => openRenameDialog());
  elements.pinSelectionButton.addEventListener('click', () => {
    void pinSelectedFolder();
  });
  elements.unpinSelectionButton.addEventListener('click', () => {
    void unpinSelectedFolder();
  });
  elements.deleteSelectionButton.addEventListener('click', () => {
    void deleteSelectedItems();
  });
  elements.clearSelectionButton.addEventListener('click', () => clearSelection());
  elements.operationsMenuButton.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleToolbarActionsMenu(elements.operationsMenuButton);
  });

  for (const button of elements.viewButtons) {
    button.addEventListener('click', () => {
      setView(button.dataset.view || 'grid');
    });
  }

  elements.contentShell.addEventListener('click', handleBackgroundClick);
  elements.contentView.addEventListener('contextmenu', handleContentContextMenu);
  bindFavoritesDropzone();

  window.addEventListener('pointerdown', handleGlobalPointerDown, true);
  window.addEventListener('keydown', handleGlobalKeyDown);
  window.addEventListener('resize', () => {
    syncViewportHeight();
    closeActionMenu();
  });
  window.addEventListener('blur', () => {
    closeActionMenu();
    hideDropTooltip();
  });
  window.addEventListener('dragend', hideDropTooltip);
  window.addEventListener('drop', hideDropTooltip);
  window.visualViewport?.addEventListener('resize', syncViewportHeight);
  window.visualViewport?.addEventListener('scroll', syncViewportHeight);

  elements.editorSaveButton.addEventListener('click', () => {
    void saveEditor();
  });
  elements.editorCloseButton.addEventListener('click', () => {
    void attemptCloseEditor();
  });
  elements.editorTextarea.addEventListener('input', () => {
    state.editorDirty = true;
    elements.editorStatus.textContent = 'Unsaved changes';
  });
  elements.editorDialog.addEventListener('cancel', (event) => {
    if (state.editorDirty && !window.confirm('Discard unsaved changes?')) {
      event.preventDefault();
    }
  });

  elements.createForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void createItem();
  });
  elements.createCancelButton.addEventListener('click', () => closeDialog(elements.createDialog));
  elements.createDialog.addEventListener('close', () => {
    elements.createError.textContent = '';
  });
  elements.alertCloseButton.addEventListener('click', () => closeDialog(elements.alertDialog));
  elements.alertConfirmButton.addEventListener('click', () => closeDialog(elements.alertDialog));
}

async function handleAddressSubmit() {
  const path = normalizePath(elements.addressInput.value.trim() || '/');
  try {
    const entry = await describePath(path);
    if (entry.type === 'directory') {
      await navigateTo(path);
      return;
    }

    await navigateTo(parentDir(path), { selectionPath: path, silent: true });
    await openEditor(path);
  } catch (error) {
    showAlert('Invalid address', 'Could not open ' + path + ': ' + error.message);
  }
}

async function refreshExplorer(message = '') {
  try {
    closeActionMenu();
    const current = await ensureDirectory(state.currentFolder);
    const currentEntry = await describePath(current);
    state.currentFolder = current;
    state.currentFolderEntry = currentEntry;
    expandAncestors(current);
    state.currentEntries = await readDirectory(current);
    state.pathTypes = new Map([[current, 'directory']]);
    for (const entry of state.currentEntries) {
      updateKnownPathType(entry.path, entry.type);
    }
    await loadFavorites();
    const visiblePaths = new Set(state.currentEntries.map((entry) => entry.path));
    state.selectedPaths = new Set(Array.from(state.selectedPaths).filter((path) => visiblePaths.has(path)));
    if (state.selectionPath && !state.selectedPaths.has(state.selectionPath)) {
      state.selectionPath = Array.from(state.selectedPaths).at(-1) || null;
    }

    elements.addressInput.value = current;
    elements.upButton.disabled = current === '/';
    renderViewButtons();
    await renderSidebarTree();
    await renderContent();
    renderSelectionAction();
    updateSelectionSummary();
    setStatus(message || describeFolderState());
  } catch (error) {
    setStatus('Failed to load explorer: ' + error.message);
  }
}

async function renderContent() {
  const renderToken = ++state.contentRenderToken;
  elements.contentView.dataset.view = state.currentView;
  elements.contentView.replaceChildren();

  if (state.currentView === 'tree') {
    const treeRoot = document.createElement('div');
    treeRoot.className = 'tree-group';
    const branch = await buildTreeBranch(state.currentFolder, {
      includeFiles: true,
      rootLabel: state.currentFolder === '/' ? 'Root' : baseName(state.currentFolder),
      behavior: 'content-tree'
    });
    if (renderToken !== state.contentRenderToken) {
      return;
    }
    treeRoot.append(branch);
    elements.contentView.replaceChildren(treeRoot);
    return;
  }

  if (state.currentEntries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<div><strong>This folder is empty.</strong><br>Create a file or folder to get started.</div>';
    elements.contentView.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const entry of state.currentEntries) {
    fragment.append(createEntryButton(entry));
  }
  elements.contentView.append(fragment);
}

function createEntryButton(entry) {
  updateKnownPathType(entry.path, entry.type);
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.path = entry.path;
  button.className = 'content-item' + (state.selectedPaths.has(entry.path) ? ' is-selected' : '');
  button.setAttribute('aria-pressed', String(state.selectedPaths.has(entry.path)));
  bindEntryInteractions(button, entry);

  const icon = createEntryIcon(entry);
  const meta = document.createElement('div');
  meta.className = 'content-item-meta';

  const name = document.createElement('span');
  name.className = 'content-item-name';
  name.textContent = entry.name;

  meta.append(name);

  if (entry.path !== '/') {
    makeEntryDragSource(button, entry);
  }
  if (entry.type === 'directory') {
    bindFolderDropTarget(button, () => entry.path);
  }

  button.append(icon, meta);
  return button;
}

async function renderSidebarTree() {
  const renderToken = ++state.sidebarRenderToken;
  const visiblePlaces = [];

  for (const place of SIDEBAR_PLACES) {
    if (await pathExists(place.path)) {
      visiblePlaces.push(place);
    }
  }

  if (renderToken !== state.sidebarRenderToken) {
    return;
  }

  elements.sidebarPlaces.replaceChildren(...visiblePlaces.map((place) => createSidebarPlaceButton(place)));
  renderFavorites();
}

async function buildTreeBranch(path, { includeFiles, rootLabel, behavior = 'sidebar' } = {}) {
  const entry = path === '/'
    ? { name: rootLabel || 'Root', path, type: 'directory' }
    : await describePath(path);

  const group = document.createElement('div');
  group.className = 'tree-group';

  const row = document.createElement('div');
  row.className = 'tree-row';

  if (entry.type === 'directory') {
    const expanded = state.expandedFolders.has(path);
    const hasChildren = await directoryHasVisibleChildren(path, includeFiles);

    if (hasChildren) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'tree-toggle';
      toggle.append(createFaIcon(expanded ? 'fa-angle-down' : 'fa-angle-right'));
      toggle.setAttribute('aria-label', (expanded ? 'Collapse ' : 'Expand ') + entry.name);
      toggle.addEventListener('click', () => {
        if (expanded) {
          state.expandedFolders.delete(path);
        } else {
          state.expandedFolders.add(path);
        }
        void rerenderTreeViews();
      });
      row.append(toggle);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'tree-spacer';
      row.append(spacer);
    }
  } else {
    const spacer = document.createElement('span');
    spacer.className = 'tree-spacer';
    row.append(spacer);
  }

  const node = document.createElement('button');
  node.type = 'button';
  node.dataset.path = path;
  node.className = 'tree-node' + (state.selectedPaths.has(path) ? ' is-active' : '');
  node.setAttribute('aria-pressed', String(state.selectedPaths.has(path)));
  updateKnownPathType(path, entry.type);
  bindEntryInteractions(node, entry, {
    mobileTreeTapMode: behavior === 'content-tree' && entry.type === 'directory' ? 'toggle' : 'open'
  });

  const icon = createEntryIcon(entry, {
    open: entry.type === 'directory' && (state.expandedFolders.has(path) || state.currentFolder === path)
  });
  const textWrap = document.createElement('span');
  textWrap.className = 'content-item-meta';

  const label = document.createElement('span');
  label.className = 'tree-label';
  label.textContent = path === '/' ? (rootLabel || 'Root') : entry.name;

  textWrap.append(label);
  node.append(icon, textWrap);
  if (path !== '/') {
    makeEntryDragSource(node, entry);
  }
  if (entry.type === 'directory') {
    bindFolderDropTarget(node, () => path);
  }
  row.append(node);
  group.append(row);

  if (entry.type === 'directory' && state.expandedFolders.has(path)) {
    const children = await readDirectory(path, includeFiles);
    if (children.length > 0) {
      const childrenWrap = document.createElement('div');
      childrenWrap.className = 'tree-children';
      childrenWrap.style.paddingLeft = '18px';
      for (const child of children) {
        if (!includeFiles && child.type !== 'directory') {
          continue;
        }
        childrenWrap.append(await buildTreeBranch(child.path, { includeFiles, behavior }));
      }
      group.append(childrenWrap);
    }
  }

  return group;
}

async function rerenderTreeViews() {
  await renderSidebarTree();
  if (state.currentView === 'tree') {
    await renderContent();
  }
}

function toggleExpandedFolder(path) {
  if (state.expandedFolders.has(path)) {
    state.expandedFolders.delete(path);
    return;
  }

  state.expandedFolders.add(path);
}

function selectPath(path, entry = null) {
  state.selectionPath = path;
  state.selectedPaths = new Set([path]);
  updateSelectionSummary();
  renderSelectionAction();
  syncSelectedStyles();
}

function syncSelectedStyles() {
  for (const node of document.querySelectorAll('.content-item')) {
    const selected = state.selectedPaths.has(node.dataset.path);
    node.classList.toggle('is-selected', selected);
    node.setAttribute('aria-pressed', String(selected));
  }
  for (const node of document.querySelectorAll('.tree-node')) {
    const active = state.selectedPaths.has(node.dataset.path);
    node.classList.toggle('is-active', active);
    node.setAttribute('aria-pressed', String(state.selectedPaths.has(node.dataset.path)));
  }
}

async function openEntry(entry) {
  const target = entry || state.currentEntries.find((item) => item.path === state.selectionPath) || null;
  if (!target) {
    return;
  }
  if (target.type === 'directory') {
    await navigateTo(target.path);
    return;
  }

  await openEditor(target.path);
}

async function navigateTo(path, { selectionPath, silent = false } = {}) {
  const folder = await ensureDirectory(path);
  state.currentFolder = folder;
  state.selectionPath = selectionPath || null;
  state.selectedPaths = selectionPath ? new Set([selectionPath]) : new Set();
  setSidebarOpen(false);
  await refreshExplorer(silent ? '' : 'Opened ' + folder);
}

function setView(view) {
  state.currentView = ['grid', 'list', 'tree'].includes(view) ? view : 'grid';
  window.localStorage.setItem('flare-explorer-view', state.currentView);
  renderViewButtons();
  void renderContent();
}

function renderViewButtons() {
  for (const button of elements.viewButtons) {
    const selected = button.dataset.view === state.currentView;
    button.setAttribute('aria-selected', String(selected));
  }
}

function updateSelectionSummary() {
  const selectedCount = state.selectedPaths.size;
  if (selectedCount === 0) {
    elements.selectionSummary.textContent = formatFolderMetadata(state.currentFolderEntry);
    return;
  }

  if (selectedCount > 1) {
    elements.selectionSummary.textContent = selectedCount + ' items selected';
    return;
  }

  const selectedPath = getSingleSelectedPath();
  if (!selectedPath) {
    elements.selectionSummary.textContent = '1 item selected';
    return;
  }

  const selected = state.currentEntries.find((entry) => entry.path === selectedPath);
  if (selected) {
    elements.selectionSummary.textContent = formatEntryMetadata(selected);
    return;
  }

  if (isDirectoryPath(selectedPath)) {
    elements.selectionSummary.textContent = 'Folder selected';
    return;
  }

  elements.selectionSummary.textContent = '1 item selected';
}

function setStatus(message) {
  state.lastStatusMessage = message || '';
  renderStatusMessage();
  void refreshStorageEstimate();
}

function renderStatusMessage() {
  elements.statusMessage.textContent = state.storageStatus;
  elements.statusMessage.title = state.lastStatusMessage || state.storageStatus;
}

async function refreshStorageEstimate() {
  const token = ++state.storageEstimateToken;

  try {
    if (!navigator.storage?.estimate) {
      throw new Error('StorageManager estimate unavailable');
    }

    const estimate = await navigator.storage.estimate();
    const nextStatus = formatStorageEstimate(estimate);
    if (token !== state.storageEstimateToken) {
      return;
    }

    state.storageStatus = nextStatus;
  } catch {
    if (token !== state.storageEstimateToken) {
      return;
    }

    state.storageStatus = STORAGE_STATUS_UNAVAILABLE;
  }

  renderStatusMessage();
}

function formatStorageEstimate(estimate) {
  const quota = Number(estimate?.quota);
  const indexedDbUsage = getIndexedDbUsage(estimate);
  if (!Number.isFinite(quota) || quota <= 0 || !Number.isFinite(indexedDbUsage) || indexedDbUsage < 0) {
    return STORAGE_STATUS_UNAVAILABLE;
  }

  return formatBytes(indexedDbUsage) + ' used of ' + formatBytes(quota);
}

function getIndexedDbUsage(estimate) {
  const usageDetails = estimate?.usageDetails;
  if (usageDetails && typeof usageDetails === 'object') {
    const indexedDbUsage = usageDetails.indexedDB ?? usageDetails.indexedDb;
    if (Number.isFinite(indexedDbUsage)) {
      return Number(indexedDbUsage);
    }
  }

  return Number(estimate?.usage || 0);
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let unitIndex = 0;
  let value = bytes;

  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }

  const maximumFractionDigits = value >= 100 ? 0 : 1;
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits
  }).format(value) + ' ' + units[unitIndex];
}

function describeFolderState() {
  return state.currentEntries.length === 0 ? 'Empty folder' : '';
}

async function openEditor(path) {
  const filePath = normalizePath(path);
  const content = await fs.promises.readFile(filePath, { encoding: 'utf8' });
  state.editorPath = filePath;
  state.editorDirty = false;
  elements.editorTitle.textContent = filePath;
  elements.editorTextarea.value = content;
  elements.editorStatus.textContent = 'Ready';
  openDialog(elements.editorDialog);
  elements.editorTextarea.focus();
  elements.editorTextarea.setSelectionRange(0, 0);
}

async function attemptCloseEditor() {
  if (state.editorDirty && !window.confirm('Discard unsaved changes?')) {
    return;
  }

  closeDialog(elements.editorDialog);
}

async function saveEditor() {
  if (!state.editorPath) {
    return;
  }

  await fs.promises.writeFile(state.editorPath, elements.editorTextarea.value);
  state.editorDirty = false;
  elements.editorStatus.textContent = 'Saved';
  state.selectionPath = state.editorPath;
  state.selectedPaths = new Set([state.editorPath]);
  await refreshExplorer('Saved ' + state.editorPath);
}

function openCreateDialog(kind, targetFolder = state.currentFolder) {
  state.renamePath = '';
  state.createKind = kind;
  state.createTargetFolder = normalizePath(targetFolder || state.currentFolder);
  elements.createLabel.textContent = kind === 'folder' ? 'Create folder' : 'Create file';
  elements.createTitle.textContent = kind === 'folder' ? 'New folder' : 'New file';
  elements.createSubmitButton.textContent = kind === 'folder' ? 'Create folder' : 'Create file';
  elements.createNameInput.value = '';
  elements.createError.textContent = '';
  elements.createTarget.textContent = 'Create in ' + state.createTargetFolder;
  openDialog(elements.createDialog);
  elements.createNameInput.focus();
}

function openRenameDialog(selectedPath = getSingleSelectedPath()) {
  if (!selectedPath || selectedPath === '/') {
    return;
  }

  state.createKind = 'rename';
  state.renamePath = selectedPath;
  elements.createLabel.textContent = 'Rename item';
  elements.createTitle.textContent = 'Rename ' + baseName(selectedPath);
  elements.createSubmitButton.textContent = 'Rename';
  elements.createNameInput.value = baseName(selectedPath);
  elements.createError.textContent = '';
  elements.createTarget.textContent = 'Rename in ' + parentDir(selectedPath);
  openDialog(elements.createDialog);
  elements.createNameInput.focus();
  elements.createNameInput.setSelectionRange(0, elements.createNameInput.value.length);
}

async function createItem() {
  const name = elements.createNameInput.value.trim();
  const validationError = validateItemName(name);
  if (validationError) {
    elements.createError.textContent = validationError;
    return;
  }

  if (state.createKind === 'rename') {
    await renameItem(name);
    return;
  }

  const targetFolder = normalizePath(state.createTargetFolder || state.currentFolder);
  const revealTarget = targetFolder === state.currentFolder;
  const targetPath = joinPath(targetFolder, name);
  try {
    if (await pathExists(targetPath)) {
      throw new Error('An item with that name already exists');
    }

    if (state.createKind === 'folder') {
      await fs.promises.mkdir(targetPath);
      closeDialog(elements.createDialog);
      if (revealTarget) {
        state.selectionPath = targetPath;
        state.selectedPaths = new Set([targetPath]);
        state.expandedFolders.add(state.currentFolder);
      } else {
        state.selectionPath = null;
        state.selectedPaths.clear();
      }
      await refreshExplorer('Created folder ' + targetPath);
      return;
    }

    closeDialog(elements.createDialog);
    await fs.promises.writeFile(targetPath, '');
    if (revealTarget) {
      state.selectionPath = targetPath;
      state.selectedPaths = new Set([targetPath]);
    } else {
      state.selectionPath = null;
      state.selectedPaths.clear();
    }
    await refreshExplorer('Created file ' + targetPath);
    if (revealTarget) {
      await openEditor(targetPath);
    }
  } catch (error) {
    elements.createError.textContent = 'Could not create ' + name + ': ' + error.message;
  }
}

async function renameItem(name) {
  const sourcePath = normalizePath(state.renamePath);
  const targetFolder = parentDir(sourcePath);
  const targetPath = joinPath(targetFolder, name);

  try {
    if (targetPath === sourcePath) {
      closeDialog(elements.createDialog);
      return;
    }

    if (await pathExists(targetPath)) {
      throw new Error('An item with that name already exists');
    }

    closeDialog(elements.createDialog);
    await fs.promises.rename(sourcePath, targetPath);
  await persistFavoriteChanges(remapFavorites(sourcePath, targetPath));
    state.renamePath = '';
    state.selectionPath = targetPath;
    state.selectedPaths = new Set([targetPath]);
    if (state.editorPath === sourcePath) {
      state.editorPath = targetPath;
      elements.editorTitle.textContent = targetPath;
    }
    await refreshExplorer('Renamed to ' + targetPath);
  } catch (error) {
    elements.createError.textContent = 'Could not rename ' + baseName(sourcePath) + ': ' + error.message;
  }
}

function setSidebarOpen(open) {
  state.sidebarOpen = open;
  elements.sidebar.classList.toggle('is-open', open);
  elements.sidebarBackdrop.hidden = !open;
  elements.sidebarBackdrop.classList.toggle('is-open', open);
  elements.sidebarToggle.setAttribute('aria-expanded', String(open));
}

function openDialog(dialog) {
  if (!dialog.open) {
    dialog.showModal();
  }
}

function closeDialog(dialog) {
  if (dialog.open) {
    dialog.close();
  }
}

function showAlert(title, message) {
  elements.alertTitle.textContent = title;
  elements.alertMessage.textContent = message;
  openDialog(elements.alertDialog);
}

async function ensureDirectory(path) {
  const entry = await describePath(path || '/');
  if (entry.type !== 'directory') {
    throw new Error('Not a folder');
  }
  return normalizePath(path || '/');
}

async function describePath(path) {
  const normalized = normalizePath(path || '/');
  const stat = await fs.promises.stat(normalized);
  if (stat.isDirectory()) {
    return {
      name: normalized === '/' ? 'Root' : baseName(normalized),
      path: normalized,
      type: 'directory',
      size: 0,
      mtimeMs: stat.mtimeMs
    };
  }

  return {
    name: baseName(normalized),
    path: normalized,
    type: 'file',
    size: stat.size,
    mtimeMs: stat.mtimeMs
  };
}

async function readDirectory(path, includeFiles = true) {
  const names = await fs.promises.readdir(path);
  const described = [];

  for (const name of names) {
    const childPath = joinPath(path, name);
    const stat = await fs.promises.stat(childPath);
    if (stat.isDirectory()) {
      described.push({
        name,
        path: childPath,
        type: 'directory',
        size: 0,
        mtimeMs: stat.mtimeMs
      });
      continue;
    }

    if (includeFiles) {
      described.push({
        name,
        path: childPath,
        type: 'file',
        size: stat.size,
        mtimeMs: stat.mtimeMs
      });
    }
  }

  described.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'directory' ? -1 : 1;
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });

  return described;
}

async function directoryHasVisibleChildren(path, includeFiles) {
  const children = await readDirectory(path, includeFiles);
  return children.length > 0;
}

function createEntryIcon(entry, { open = false } = {}) {
  const descriptor = getEntryIconDescriptor(entry, { open });
  const icon = document.createElement('span');
  icon.className = 'entry-icon entry-icon--' + descriptor.tone;
  icon.title = descriptor.label;
  icon.append(createFaIcon(descriptor.icon));
  return icon;
}

function createFaIcon(iconName) {
  const icon = document.createElement('i');
  icon.className = 'fa-solid ' + iconName;
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

function getEntryIconDescriptor(entry, { open = false } = {}) {
  if (entry.type === 'directory') {
    return {
      icon: open ? 'fa-folder-open' : 'fa-folder',
      tone: open ? 'folder-open' : 'folder',
      label: (open ? 'Open folder' : 'Folder') + ': ' + entry.name
    };
  }

  const extension = extensionOf(entry.name);
  const family = FILE_ICON_FAMILIES[extension] || 'default';
  return {
    icon: FILE_ICON_NAMES[family] || FILE_ICON_NAMES.default,
    tone: family,
    label: (FILE_TYPE_LABELS[extension] || 'File') + ': ' + entry.name
  };
}

function extensionOf(name) {
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(index + 1).toLowerCase() : '';
}

function normalizePath(path) {
  if (!path) {
    return '/';
  }

  const segments = [];
  const source = path.startsWith('/') ? path : '/' + path;
  for (const segment of source.split('/')) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return '/' + segments.join('/');
}

function joinPath(base, name) {
  return normalizePath((base === '/' ? '' : base) + '/' + name);
}

function parentDir(path) {
  const normalized = normalizePath(path);
  if (normalized === '/') {
    return '/';
  }
  const parts = normalized.split('/').filter(Boolean);
  parts.pop();
  return '/' + parts.join('/');
}

function baseName(path) {
  const normalized = normalizePath(path);
  if (normalized === '/') {
    return '/';
  }
  return normalized.split('/').filter(Boolean).pop() || '/';
}

function formatSize(bytes) {
  if (!bytes) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return (value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)) + ' ' + units[unitIndex];
}

function formatDateTime(value) {
  return Number.isFinite(value) ? dateTimeFormatter.format(new Date(value)) : 'Date unavailable';
}

function formatEntryMetadata(entry) {
  if (!entry) {
    return 'No selection';
  }
  if (entry.type === 'directory') {
    return 'Updated ' + formatDateTime(entry.mtimeMs);
  }
  return formatSize(entry.size) + ' • ' + formatDateTime(entry.mtimeMs);
}

function formatFolderMetadata(entry) {
  return entry ? 'Updated ' + formatDateTime(entry.mtimeMs) : 'No selection';
}

function validateItemName(name) {
  if (!name) {
    return 'Enter a name.';
  }
  if (name === '.' || name === '..') {
    return 'Choose a different name.';
  }
  if (/[/\\]/.test(name)) {
    return 'Use a single file or folder name.';
  }
  return '';
}

function expandAncestors(path) {
  let current = normalizePath(path);
  while (current !== '/') {
    state.expandedFolders.add(current);
    current = parentDir(current);
  }
  state.expandedFolders.add('/');
}

function isSelectablePath(path, entries) {
  return entries.some((entry) => entry.path === path);
}

async function pathExists(path) {
  try {
    await fs.promises.stat(path);
    return true;
  } catch {
    return false;
  }
}

function updateKnownPathType(path, type) {
  state.pathTypes.set(normalizePath(path), type);
}

function isDirectoryPath(path) {
  const normalized = normalizePath(path);
  return normalized === '/' || state.pathTypes.get(normalized) === 'directory';
}

function loadStoredView() {
  const view = window.localStorage.getItem('flare-explorer-view');
  return ['grid', 'list', 'tree'].includes(view) ? view : 'grid';
}

function getTopLevelPaths(paths) {
  return Array.from(new Set(paths.map((path) => normalizePath(path))))
    .sort((left, right) => left.length - right.length)
    .filter((path, index, all) => !all.slice(0, index).some((parent) => isSamePathOrAncestor(parent, path)));
}

function getDeletionTargets() {
  return getTopLevelPaths(Array.from(state.selectedPaths)).filter((path) => path !== '/');
}

function getSingleSelectedPath() {
  return state.selectedPaths.size === 1 ? normalizePath(Array.from(state.selectedPaths)[0]) : null;
}

function hasClipboardData() {
  return state.clipboardPaths.length > 0;
}

function formatPathSummary(paths) {
  return paths.length === 1 ? baseName(paths[0]) : paths.length + ' items';
}

function clearClipboard() {
  state.clipboardMode = '';
  state.clipboardPaths = [];
  renderSelectionAction();
}

function copySelectionToClipboard(mode, paths = Array.from(state.selectedPaths)) {
  const targets = getTopLevelPaths(paths).filter((path) => path !== '/');
  if (targets.length === 0) {
    return;
  }

  state.clipboardMode = mode;
  state.clipboardPaths = targets;
  renderSelectionAction();
  setStatus((mode === 'cut' ? 'Cut ' : 'Copied ') + formatPathSummary(targets));
}

async function pasteClipboardInto(destinationPath) {
  if (!hasClipboardData()) {
    return;
  }

  await transferPaths(state.clipboardPaths, destinationPath, state.clipboardMode || 'copy', { fromClipboard: true });
}

async function transferPaths(paths, destinationPath, mode, { fromClipboard = false } = {}) {
  const destinationFolder = await ensureDirectory(destinationPath);
  const sources = getTopLevelPaths(paths).filter((path) => path !== '/');
  if (sources.length === 0) {
    return;
  }

  const operations = [];
  for (const sourcePath of sources) {
    if (isDirectoryPath(sourcePath) && isSamePathOrAncestor(sourcePath, destinationFolder)) {
      throw new Error('Cannot place a folder into itself.');
    }

    const targetPath = mode === 'copy' && parentDir(sourcePath) === destinationFolder
      ? await getAvailableCopyPath(sourcePath, destinationFolder)
      : joinPath(destinationFolder, baseName(sourcePath));
    if (mode === 'move' && parentDir(sourcePath) === destinationFolder) {
      continue;
    }

    if (await pathExists(targetPath)) {
      throw new Error(baseName(targetPath) + ' already exists in ' + destinationFolder + '.');
    }

    operations.push({ sourcePath, targetPath });
  }

  if (operations.length === 0) {
    setStatus('Nothing to ' + mode + '.');
    return;
  }

  try {
    let favoritesChanged = false;
    for (const operation of operations) {
      if (mode === 'copy') {
        await copyPath(operation.sourcePath, operation.targetPath);
      } else {
        await fs.promises.rename(operation.sourcePath, operation.targetPath);
        favoritesChanged = remapFavorites(operation.sourcePath, operation.targetPath) || favoritesChanged;
      }
    }

    if (favoritesChanged) {
      await persistFavoriteChanges(true);
    }

    if (mode === 'move') {
      remapSelectionPaths(operations);
      remapEditorPath(operations);
      if (fromClipboard) {
        clearClipboard();
      }
    }

    const createdPaths = operations.map((operation) => operation.targetPath);
    if (destinationFolder === state.currentFolder) {
      state.selectedPaths = new Set(createdPaths);
      state.selectionPath = createdPaths.at(-1) || null;
    } else if (mode !== 'move') {
      state.selectedPaths.clear();
      state.selectionPath = null;
    }

    state.currentFolder = await resolveExistingFolder(state.currentFolder);
    await refreshExplorer((mode === 'copy' ? 'Copied ' : 'Moved ') + formatPathSummary(sources));
  } catch (error) {
    showAlert(mode === 'copy' ? 'Copy failed' : 'Move failed', 'Could not ' + mode + ' ' + formatPathSummary(sources) + ': ' + error.message);
  }
}

async function copyPath(sourcePath, targetPath) {
  const source = normalizePath(sourcePath);
  const target = normalizePath(targetPath);
  const stat = await fs.promises.stat(source);
  if (!stat.isDirectory()) {
    const content = await fs.promises.readFile(source);
    await fs.promises.writeFile(target, content);
    return;
  }

  await fs.promises.mkdir(target);
  const children = await fs.promises.readdir(source);
  for (const child of children) {
    await copyPath(joinPath(source, child), joinPath(target, child));
  }
}

async function getAvailableCopyPath(sourcePath, destinationFolder) {
  const sourceName = baseName(sourcePath);
  let attempt = 0;
  while (true) {
    const candidateName = attempt === 0
      ? 'Copy of ' + sourceName
      : 'Copy ' + (attempt + 1) + ' of ' + sourceName;
    const candidatePath = joinPath(destinationFolder, candidateName);
    if (!(await pathExists(candidatePath))) {
      return candidatePath;
    }
    attempt += 1;
  }
}

function remapSelectionPaths(operations) {
  const nextSelection = new Set();
  let nextSelectionPath = state.selectionPath;

  for (const path of state.selectedPaths) {
    const matchingOperation = operations.find((operation) => isSamePathOrAncestor(operation.sourcePath, path));
    if (!matchingOperation) {
      nextSelection.add(path);
      continue;
    }

    const remapped = remapPath(path, matchingOperation.sourcePath, matchingOperation.targetPath);
    nextSelection.add(remapped);
    if (path === state.selectionPath) {
      nextSelectionPath = remapped;
    }
  }

  state.selectedPaths = nextSelection;
  state.selectionPath = nextSelectionPath;
}

function remapEditorPath(operations) {
  if (!state.editorPath) {
    return;
  }

  const matchingOperation = operations.find((operation) => isSamePathOrAncestor(operation.sourcePath, state.editorPath));
  if (!matchingOperation) {
    return;
  }

  state.editorPath = remapPath(state.editorPath, matchingOperation.sourcePath, matchingOperation.targetPath);
  elements.editorTitle.textContent = state.editorPath;
}

async function deleteSelectedItems(paths = Array.from(state.selectedPaths)) {
  const targets = getTopLevelPaths(paths).filter((path) => path !== '/');
  if (targets.length === 0) {
    if (paths.length > 0) {
      showAlert('Delete unavailable', 'The root folder cannot be deleted.');
    }
    return;
  }

  const summary = targets.length === 1 ? baseName(targets[0]) : targets.length + ' items';
  if (!window.confirm('Delete ' + summary + '? This cannot be undone.')) {
    return;
  }

  try {
    for (const path of targets) {
      await removePath(path);
    }

    await persistFavoriteChanges(pruneFavorites(targets));

    resetEditorForDeletedPaths(targets);
    state.selectedPaths = new Set(Array.from(state.selectedPaths).filter((path) => !targets.some((target) => isSamePathOrAncestor(target, path))));
    if (state.selectionPath && !state.selectedPaths.has(state.selectionPath)) {
      state.selectionPath = Array.from(state.selectedPaths).at(-1) || null;
    }
    state.currentFolder = await resolveExistingFolder(state.currentFolder);
    await refreshExplorer('Deleted ' + summary);
  } catch (error) {
    showAlert('Delete failed', 'Could not delete ' + summary + ': ' + error.message);
  }
}

async function removePath(path) {
  const target = normalizePath(path);
  const stat = await fs.promises.stat(target);
  if (!stat.isDirectory()) {
    await fs.promises.unlink(target);
    return;
  }

  const children = await fs.promises.readdir(target);
  for (const child of children) {
    await removePath(joinPath(target, child));
  }
  await fs.promises.rmdir(target);
}

async function resolveExistingFolder(path) {
  let candidate = normalizePath(path || '/');
  while (candidate !== '/' && !(await pathExists(candidate))) {
    candidate = parentDir(candidate);
  }
  return candidate;
}

function resetEditorForDeletedPaths(paths) {
  if (!state.editorPath || !paths.some((path) => isSamePathOrAncestor(path, state.editorPath))) {
    return;
  }

  state.editorPath = '';
  state.editorDirty = false;
  elements.editorTextarea.value = '';
  elements.editorStatus.textContent = 'File deleted';
  closeDialog(elements.editorDialog);
}

function isSamePathOrAncestor(parentPath, childPath) {
  const parent = normalizePath(parentPath);
  const child = normalizePath(childPath);
  return child === parent || child.startsWith(parent === '/' ? '/' : parent + '/');
}

function bindEntryInteractions(node, entry, { mobileTreeTapMode = 'open' } = {}) {
  node.addEventListener('click', (event) => {
    if (isTouchClick(event)) {
      handleMobileEntryClick(event, entry, { treeTapMode: mobileTreeTapMode });
      return;
    }

    if (consumeSuppressedClick(entry.path)) {
      event.preventDefault();
      return;
    }

    handleDesktopEntryClick(event, entry);
  });

  node.addEventListener('dblclick', (event) => {
    if (isTouchClick(event)) {
      return;
    }

    event.preventDefault();
    if (!state.selectedPaths.has(entry.path)) {
      selectPath(entry.path);
    }
    void openEntry(entry);
  });

  node.addEventListener('pointerdown', (event) => {
    state.pendingTouchClick = event.pointerType === 'touch';
    if (event.pointerType !== 'touch') {
      return;
    }

    startLongPress(event, entry);
  });

  node.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'touch') {
      return;
    }

    updateLongPress(event);
  });

  node.addEventListener('pointerup', stopLongPress);
  node.addEventListener('pointercancel', stopLongPress);
  node.addEventListener('pointerleave', stopLongPress);
  node.addEventListener('contextmenu', (event) => {
    if (isTouchClick(event)) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    if (!state.selectedPaths.has(entry.path)) {
      selectPath(entry.path);
    }
    openActionMenuAtPoint(event.clientX, event.clientY, buildContextMenuItems({
      selectedPaths: state.selectedPaths.has(entry.path) ? Array.from(state.selectedPaths) : [entry.path],
      targetPath: entry.type === 'directory' ? entry.path : state.currentFolder,
      allowPinPath: entry.type === 'directory' ? entry.path : '',
      includeNewItems: true,
      includeClearSelection: false
    }));
  });
}

function handleDesktopEntryClick(event, entry) {
  clearLastTouchTreeTap();
  if (event.ctrlKey || event.metaKey) {
    toggleSelection(entry.path);
    return;
  }

  selectPath(entry.path);
}

function handleMobileEntryClick(event, entry, { treeTapMode = 'open' } = {}) {
  if (consumeSuppressedClick(entry.path)) {
    event.preventDefault();
    return;
  }

  if (treeTapMode === 'toggle' && entry.type === 'directory') {
    if (state.selectedPaths.size > 0) {
      clearLastTouchTreeTap();
      toggleSelection(entry.path);
      return;
    }

    const now = Date.now();
    const isDoubleTap = state.lastTouchTreeTapPath === entry.path && now - state.lastTouchTreeTapAt <= MOBILE_DOUBLE_TAP_MS;
    if (isDoubleTap) {
      clearLastTouchTreeTap();
      void openEntry(entry);
      return;
    }

    state.lastTouchTreeTapPath = entry.path;
    state.lastTouchTreeTapAt = now;
    clearSelection();
    toggleExpandedFolder(entry.path);
    void rerenderTreeViews();
    return;
  }

  clearLastTouchTreeTap();

  if (state.selectedPaths.size > 0) {
    toggleSelection(entry.path);
    return;
  }

  void openEntry(entry);
}

function clearLastTouchTreeTap() {
  state.lastTouchTreeTapPath = '';
  state.lastTouchTreeTapAt = 0;
}

function toggleSelection(path) {
  if (state.selectedPaths.has(path)) {
    state.selectedPaths.delete(path);
  } else {
    state.selectedPaths.add(path);
  }

  state.selectionPath = state.selectedPaths.has(path)
    ? path
    : Array.from(state.selectedPaths).at(-1) || null;
  updateSelectionSummary();
  renderSelectionAction();
  syncSelectedStyles();
}

function clearSelection() {
  if (state.selectedPaths.size === 0) {
    return;
  }

  state.selectedPaths.clear();
  state.selectionPath = null;
  updateSelectionSummary();
  renderSelectionAction();
  syncSelectedStyles();
}

function renderSelectionAction() {
  const selectedCount = state.selectedPaths.size;
  const selectedTargets = getTopLevelPaths(Array.from(state.selectedPaths)).filter((path) => path !== '/');
  const selectedPath = selectedTargets.length === 1 ? selectedTargets[0] : null;
  const hasClipboard = hasClipboardData();
  const canCutCopy = selectedTargets.length > 0;
  const canRename = Boolean(selectedPath && selectedPath !== '/');
  const canPin = Boolean(selectedPath && isSelectedDirectory(selectedPath));
  const isPinnedFolder = Boolean(selectedPath && state.favorites.includes(selectedPath));
  const label = selectedCount > 1 ? 'Clear ' + selectedCount + ' selected items' : 'Clear selection';
  const deleteLabel = selectedCount > 1 ? 'Delete ' + selectedCount + ' selected items' : 'Delete selected item';
  const renameLabel = canRename ? 'Rename ' + baseName(selectedPath) : 'Rename selected item';
  const pinLabel = canPin ? (isPinnedFolder ? 'Pinned: ' + baseName(selectedPath) : 'Pin ' + baseName(selectedPath)) : 'Pin selected folder';
  const unpinLabel = canPin ? 'Unpin ' + baseName(selectedPath) : 'Unpin selected folder';
  const pasteLabel = hasClipboard ? 'Paste into ' + state.currentFolder : 'Paste into current folder';
  const showClearSelection = selectedCount > 0;
  const showSecondarySurface = canCutCopy || hasClipboard || canRename || canPin || selectedCount > 0;
  setActionVisibility(elements.cutSelectionButton, canCutCopy);
  setActionVisibility(elements.copySelectionButton, canCutCopy);
  setActionVisibility(elements.pasteClipboardButton, canCutCopy || hasClipboard);
  setActionVisibility(elements.renameSelectionButton, canRename);
  setActionVisibility(elements.pinSelectionButton, canPin);
  setActionVisibility(elements.unpinSelectionButton, canPin && isPinnedFolder);
  setActionVisibility(elements.deleteSelectionButton, selectedCount > 0);
  setActionVisibility(elements.clearSelectionButton, showClearSelection);
  elements.pasteClipboardButton.disabled = !hasClipboard;
  elements.pasteClipboardButton.setAttribute('aria-label', pasteLabel);
  elements.pasteClipboardButton.title = pasteLabel;
  elements.pasteClipboardButton.classList.toggle('is-active', hasClipboard);
  elements.renameSelectionButton.setAttribute('aria-label', renameLabel);
  elements.renameSelectionButton.title = renameLabel;
  elements.pinSelectionButton.setAttribute('aria-label', pinLabel);
  elements.pinSelectionButton.title = pinLabel;
  elements.pinSelectionButton.setAttribute('aria-pressed', String(isPinnedFolder));
  elements.pinSelectionButton.classList.toggle('is-active', isPinnedFolder);
  elements.unpinSelectionButton.setAttribute('aria-label', unpinLabel);
  elements.unpinSelectionButton.title = unpinLabel;
  elements.clearSelectionButton.setAttribute('aria-label', label);
  elements.clearSelectionButton.title = label;
  elements.deleteSelectionButton.setAttribute('aria-label', deleteLabel);
  elements.deleteSelectionButton.title = deleteLabel;
  elements.contentActionsDivider.hidden = !(showClearSelection || showSecondarySurface);
  elements.contentActionsSecondary.hidden = !showSecondarySurface;
  elements.operationsMenuButton.hidden = !showSecondarySurface;
}

function setActionVisibility(element, visible) {
  element.hidden = !visible;
  element.style.display = visible ? '' : 'none';
}

function handleBackgroundClick(event) {
  if (event.target.closest('.content-header')) {
    return;
  }

  if (event.target.closest('.content-item, .tree-node, .tree-toggle')) {
    return;
  }

  clearLastTouchTreeTap();
  clearSelection();
}

function createSidebarPlaceButton(place) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sidebar-link' + (state.currentFolder === place.path ? ' is-active' : '');
  button.dataset.path = place.path;
  updateKnownPathType(place.path, 'directory');
  button.append(createSidebarIcon(place.icon), createSidebarLabel(place.label));
  button.addEventListener('click', () => {
    void navigateTo(place.path);
  });
  bindFolderDropTarget(button, () => place.path);
  button.addEventListener('contextmenu', (event) => {
    if (isTouchClick(event)) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    openActionMenuAtPoint(event.clientX, event.clientY, buildContextMenuItems({
      targetPath: place.path,
      allowPinPath: place.path,
      includeNewItems: true,
      includeClearSelection: false,
      includeSelectionActions: false
    }));
  });
  return button;
}

function renderFavorites() {
  if (state.favorites.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'favorite-empty';
    empty.textContent = 'Pin favorites here';
    elements.sidebarFavorites.replaceChildren(empty);
    return;
  }

  elements.sidebarFavorites.replaceChildren(...state.favorites.map((path) => createFavoriteRow(path)));
}

function createFavoriteRow(path) {
  const row = document.createElement('div');
  row.className = 'favorite-row';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'favorite-link' + (state.currentFolder === path ? ' is-active' : '');
  button.dataset.path = path;
  updateKnownPathType(path, 'directory');
  button.append(createSidebarIcon('fa-thumbtack'), createSidebarLabel(baseName(path)));
  button.addEventListener('click', () => {
    void navigateTo(path);
  });
  bindFolderDropTarget(button, () => path);
  button.addEventListener('contextmenu', (event) => {
    if (isTouchClick(event)) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    openActionMenuAtPoint(event.clientX, event.clientY, buildContextMenuItems({
      targetPath: path,
      allowPinPath: path,
      includeNewItems: true,
      includeClearSelection: false,
      includeSelectionActions: false
    }));
  });

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'favorite-remove';
  remove.setAttribute('aria-label', 'Unpin ' + baseName(path));
  remove.title = 'Unpin ' + baseName(path);
  remove.append(createFaIcon('fa-xmark'));
  remove.addEventListener('click', (event) => {
    event.stopPropagation();
    void unpinFolder(path);
  });

  row.append(button, remove);
  return row;
}

function createSidebarIcon(iconName) {
  const icon = document.createElement('span');
  icon.className = 'entry-icon entry-icon--folder';
  icon.append(createFaIcon(iconName));
  return icon;
}

function createSidebarLabel(labelText) {
  const meta = document.createElement('span');
  meta.className = 'sidebar-link-meta';

  const label = document.createElement('span');
  label.className = 'tree-label';
  label.textContent = labelText;

  meta.append(label);
  return meta;
}

function bindFavoritesDropzone() {
  const panel = elements.favoritesPanel;
  if (!panel) {
    return;
  }

  panel.addEventListener('dragenter', (event) => {
    if (!getDraggedFolderPath(event)) {
      return;
    }
    if (event.target.closest('.favorite-link')) {
      return;
    }
    event.preventDefault();
    panel.classList.add('is-dragover', 'is-drop-target');
    showDropTooltip('Pin to Favorites', event.clientX, event.clientY);
  });
  panel.addEventListener('dragover', (event) => {
    if (!getDraggedFolderPath(event)) {
      return;
    }
    if (event.target.closest('.favorite-link')) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    panel.classList.add('is-dragover', 'is-drop-target');
    showDropTooltip('Pin to Favorites', event.clientX, event.clientY);
  });
  panel.addEventListener('dragleave', (event) => {
    if (event.relatedTarget && panel.contains(event.relatedTarget)) {
      return;
    }
    panel.classList.remove('is-dragover', 'is-drop-target');
    hideDropTooltip();
  });
  panel.addEventListener('drop', (event) => {
    const path = getDraggedFolderPath(event);
    panel.classList.remove('is-dragover', 'is-drop-target');
    if (!path || event.target.closest('.favorite-link')) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    clearDraggedState();
    void pinFolder(path);
  });
}

function makeEntryDragSource(node, entry) {
  node.draggable = true;
  node.addEventListener('dragstart', (event) => {
    const draggedPaths = state.selectedPaths.has(entry.path)
      ? getTopLevelPaths(Array.from(state.selectedPaths)).filter((path) => path !== '/')
      : [entry.path].filter((path) => path !== '/');

    if (draggedPaths.length === 0) {
      event.preventDefault();
      return;
    }

    state.draggedPaths = draggedPaths;
    state.draggedFolderPath = entry.type === 'directory' && draggedPaths.length === 1 ? entry.path : '';
    state.suppressedClickPath = entry.path;
    if (!event.dataTransfer) {
      return;
    }
    event.dataTransfer.effectAllowed = 'copyMove';
    event.dataTransfer.setData('text/plain', entry.path);
    event.dataTransfer.setData('application/x-flare-paths', JSON.stringify(draggedPaths));
    if (entry.type === 'directory' && draggedPaths.length === 1) {
      event.dataTransfer.setData('application/x-flare-folder', entry.path);
    }
  });
  node.addEventListener('dragend', () => {
    clearDraggedState();
  });
}

function getDraggedPaths(event) {
  const raw = event.dataTransfer?.getData('application/x-flare-paths');
  if (raw) {
    try {
      return JSON.parse(raw).map((path) => normalizePath(path));
    } catch {
    }
  }
  return state.draggedPaths.map((path) => normalizePath(path));
}

function getDraggedFolderPath(event) {
  const folderPath = event.dataTransfer?.getData('application/x-flare-folder');
  if (folderPath) {
    return normalizePath(folderPath);
  }

  const draggedPaths = getDraggedPaths(event);
  return draggedPaths.length === 1 && isDirectoryPath(draggedPaths[0]) ? draggedPaths[0] : state.draggedFolderPath;
}

function bindFolderDropTarget(node, getTargetPath) {
  node.addEventListener('dragenter', (event) => {
    if (!getDraggedPaths(event).length) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    node.classList.add('is-drop-target');
    showDropTooltip(getDropActionLabel(getTargetPath(), event.ctrlKey ? 'copy' : 'move'), event.clientX, event.clientY);
  });

  node.addEventListener('dragover', (event) => {
    const draggedPaths = getDraggedPaths(event);
    if (!draggedPaths.length) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = event.ctrlKey ? 'copy' : 'move';
    node.classList.add('is-drop-target');
    showDropTooltip(getDropActionLabel(getTargetPath(), event.ctrlKey ? 'copy' : 'move'), event.clientX, event.clientY);
  });

  node.addEventListener('dragleave', (event) => {
    if (event.relatedTarget && node.contains(event.relatedTarget)) {
      return;
    }
    node.classList.remove('is-drop-target');
    hideDropTooltip();
  });

  node.addEventListener('drop', (event) => {
    const draggedPaths = getDraggedPaths(event);
    node.classList.remove('is-drop-target');
    if (!draggedPaths.length) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    clearDraggedState();
    void transferPaths(draggedPaths, getTargetPath(), event.ctrlKey ? 'copy' : 'move');
  });
}

function clearDraggedState() {
  state.draggedFolderPath = '';
  state.draggedPaths = [];
  hideDropTooltip();
}

function getDropActionLabel(targetPath, mode) {
  return (mode === 'copy' ? 'Copy to ' : 'Move to ') + (targetPath === '/' ? 'Root' : targetPath);
}

function showDropTooltip(label, clientX, clientY) {
  if (!label) {
    hideDropTooltip();
    return;
  }

  elements.dropTooltip.hidden = false;
  elements.dropTooltip.textContent = label;
  elements.dropTooltip.style.left = clientX + 'px';
  elements.dropTooltip.style.top = clientY + 'px';
}

function hideDropTooltip() {
  elements.dropTooltip.hidden = true;
}

function isSelectedDirectory(path) {
  return isDirectoryPath(path);
}

async function pinSelectedFolder(selectedPath = getSingleSelectedPath()) {
  if (!selectedPath || !isSelectedDirectory(selectedPath)) {
    return;
  }
  await pinFolder(selectedPath);
}

async function unpinSelectedFolder(selectedPath = getSingleSelectedPath()) {
  if (!selectedPath) {
    return;
  }
  await unpinFolder(selectedPath);
}

async function pinFolder(path) {
  const normalized = normalizePath(path);
  const entry = await describePath(normalized);
  if (entry.type !== 'directory') {
    return;
  }
  if (state.favorites.includes(normalized)) {
    renderSelectionAction();
    return;
  }
  state.favorites = [...state.favorites, normalized].sort(comparePathsByName);
  await persistFavorites();
  await renderSidebarTree();
  renderSelectionAction();
}

function syncViewportHeight() {
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty('--viewport-height', viewportHeight + 'px');
}

async function unpinFolder(path) {
  const normalized = normalizePath(path);
  if (!state.favorites.includes(normalized)) {
    return;
  }
  state.favorites = state.favorites.filter((favorite) => favorite !== normalized);
  await persistFavorites();
  await renderSidebarTree();
  renderSelectionAction();
}

async function loadFavorites() {
  const config = await readExplorerConfig();
  const favorites = [];

  for (const rawPath of config.favorites || []) {
    const normalized = normalizePath(rawPath);
    if (favorites.includes(normalized)) {
      continue;
    }
    try {
      const entry = await describePath(normalized);
      if (entry.type === 'directory') {
        favorites.push(normalized);
      }
    } catch {
    }
  }

  state.favorites = favorites.sort(comparePathsByName);
}

async function readExplorerConfig() {
  try {
    const raw = await fs.promises.readFile(EXPLORER_CONFIG_PATH, { encoding: 'utf8' });
    const parsed = JSON.parse(raw);
    return {
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : []
    };
  } catch {
    return { favorites: [] };
  }
}

async function persistFavorites() {
  await ensureDir(EXPLORER_CONFIG_DIR);
  await fs.promises.writeFile(EXPLORER_CONFIG_PATH, JSON.stringify({ favorites: state.favorites }, null, 2));
}

async function persistFavoriteChanges(changed) {
  if (!changed) {
    return;
  }
  await persistFavorites();
}

function remapFavorites(sourcePath, targetPath) {
  let changed = false;
  const remapped = [];

  for (const favorite of state.favorites) {
    const nextFavorite = isSamePathOrAncestor(sourcePath, favorite)
      ? remapPath(favorite, sourcePath, targetPath)
      : favorite;
    if (nextFavorite !== favorite) {
      changed = true;
    }
    if (!remapped.includes(nextFavorite)) {
      remapped.push(nextFavorite);
    }
  }

  state.favorites = remapped.sort(comparePathsByName);
  return changed;
}

function pruneFavorites(paths) {
  const nextFavorites = state.favorites.filter((favorite) => !paths.some((path) => isSamePathOrAncestor(path, favorite)));
  const changed = nextFavorites.length !== state.favorites.length;
  state.favorites = nextFavorites;
  return changed;
}

function remapPath(path, sourcePath, targetPath) {
  if (path === sourcePath) {
    return targetPath;
  }
  const suffix = path.slice(sourcePath.length);
  return normalizePath((targetPath === '/' ? '' : targetPath) + suffix);
}

function comparePathsByName(left, right) {
  return baseName(left).localeCompare(baseName(right), undefined, { sensitivity: 'base' })
    || left.localeCompare(right, undefined, { sensitivity: 'base' });
}

function buildActionMenuItems({
  selectedPaths = [],
  targetPath = state.currentFolder,
  allowPinPath = '',
  includeNewItems = false,
  includeClearSelection = false,
  includeSelectionActions = true
} = {}) {
  const items = [];
  const selectionTargets = getTopLevelPaths(selectedPaths).filter((path) => path !== '/');
  const singleSelectionPath = selectionTargets.length === 1 ? selectionTargets[0] : '';
  const pinPath = allowPinPath || (singleSelectionPath && isDirectoryPath(singleSelectionPath) ? singleSelectionPath : '');
  const hasClipboard = hasClipboardData();

  if (includeSelectionActions && selectionTargets.length > 0) {
    items.push({ label: 'Cut', icon: 'fa-scissors', action: () => copySelectionToClipboard('cut', selectionTargets) });
    items.push({ label: 'Copy', icon: 'fa-copy', action: () => copySelectionToClipboard('copy', selectionTargets) });
  }

  items.push({
    label: 'Paste',
    icon: 'fa-paste',
    disabled: !hasClipboard,
    action: () => pasteClipboardInto(targetPath)
  });

  if (includeSelectionActions && singleSelectionPath && singleSelectionPath !== '/') {
    items.push({ label: 'Rename', icon: 'fa-i-cursor', action: () => openRenameDialog(singleSelectionPath) });
  }

  if (pinPath && pinPath !== '/') {
    const pinned = state.favorites.includes(pinPath);
    items.push({
      label: pinned ? 'Unpin' : 'Pin',
      icon: pinned ? 'fa-xmark' : 'fa-thumbtack',
      action: () => (pinned ? unpinSelectedFolder(pinPath) : pinSelectedFolder(pinPath))
    });
  }

  if (includeSelectionActions && selectionTargets.length > 0) {
    items.push({ label: 'Delete', icon: 'fa-trash', danger: true, action: () => deleteSelectedItems(selectionTargets) });
  }

  if (includeClearSelection && state.selectedPaths.size > 0) {
    items.push({ label: 'Clear selection', icon: 'fa-border-none', action: () => clearSelection() });
  }

  if (includeNewItems) {
    items.push({ type: 'divider' });
    items.push({ label: 'New file', icon: 'fa-file-circle-plus', action: () => openCreateDialog('file', targetPath) });
    items.push({ label: 'New folder', icon: 'fa-folder-plus', action: () => openCreateDialog('folder', targetPath) });
  }

  while (items[0]?.type === 'divider') {
    items.shift();
  }
  while (items.at(-1)?.type === 'divider') {
    items.pop();
  }

  return items;
}

function buildContextMenuItems(options) {
  return buildActionMenuItems(options).filter((item, index, all) => item.type !== 'divider' || (index > 0 && index < all.length - 1));
}

function toggleToolbarActionsMenu(button) {
  if (!elements.actionMenu.hidden && elements.actionMenu.dataset.mode === 'toolbar') {
    closeActionMenu();
    return;
  }

  openActionMenuNearElement(button, buildActionMenuItems({
    selectedPaths: Array.from(state.selectedPaths),
    targetPath: state.currentFolder,
    includeClearSelection: true,
    includeSelectionActions: true
  }), 'toolbar');
}

function renderActionMenu(items) {
  if (items.length === 0) {
    closeActionMenu();
    return false;
  }

  elements.actionMenu.replaceChildren(...items.map((item) => {
    if (item.type === 'divider') {
      const divider = document.createElement('div');
      divider.className = 'action-menu-divider';
      return divider;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action-menu-button' + (item.danger ? ' action-menu-button--danger' : '');
    button.disabled = Boolean(item.disabled);
    button.append(createFaIcon(item.icon), document.createTextNode(item.label));
    button.addEventListener('click', () => {
      closeActionMenu();
      if (!item.disabled) {
        void item.action();
      }
    });
    return button;
  }));
  elements.actionMenu.hidden = false;
  return true;
}

function positionActionMenu(left, top) {
  const margin = 8;
  const menuWidth = elements.actionMenu.offsetWidth;
  const menuHeight = elements.actionMenu.offsetHeight;
  const clampedLeft = Math.max(margin, Math.min(left, window.innerWidth - menuWidth - margin));
  const clampedTop = Math.max(margin, Math.min(top, window.innerHeight - menuHeight - margin));
  elements.actionMenu.style.left = clampedLeft + 'px';
  elements.actionMenu.style.top = clampedTop + 'px';
}

function openActionMenuAtPoint(x, y, items, mode = 'context') {
  if (!renderActionMenu(items)) {
    return;
  }
  elements.actionMenu.dataset.mode = mode;
  positionActionMenu(x, y);
}

function openActionMenuNearElement(element, items, mode = 'toolbar') {
  if (!renderActionMenu(items)) {
    return;
  }
  const rect = element.getBoundingClientRect();
  elements.actionMenu.dataset.mode = mode;
  positionActionMenu(rect.right - elements.actionMenu.offsetWidth, rect.bottom + 6);
}

function closeActionMenu() {
  if (elements.actionMenu.hidden) {
    return;
  }
  elements.actionMenu.hidden = true;
  elements.actionMenu.replaceChildren();
  delete elements.actionMenu.dataset.mode;
}

function handleGlobalPointerDown(event) {
  if (elements.actionMenu.hidden) {
    return;
  }
  if (event.target.closest('#action-menu, #operations-menu-button')) {
    return;
  }
  closeActionMenu();
}

function handleGlobalKeyDown(event) {
  if (event.key === 'Escape') {
    closeActionMenu();
  }
}

function handleContentContextMenu(event) {
  if (isTouchClick(event)) {
    event.preventDefault();
    return;
  }
  if (event.target.closest('.content-item, .tree-node, .tree-toggle')) {
    return;
  }

  event.preventDefault();
  openActionMenuAtPoint(event.clientX, event.clientY, buildContextMenuItems({
    targetPath: state.currentFolder,
    includeNewItems: true,
    includeClearSelection: false,
    includeSelectionActions: false
  }));
}

async function ensureDir(path) {
  if (!path || path === '/') {
    return;
  }

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

function isTouchClick(event) {
  return Boolean(event.sourceCapabilities?.firesTouchEvents) || state.pendingTouchClick;
}

function startLongPress(event, entry) {
  stopLongPress();
  longPressState = {
    path: entry.path,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    timer: window.setTimeout(() => {
      if (!longPressState || longPressState.path !== entry.path || longPressState.pointerId !== event.pointerId) {
        return;
      }

      state.suppressedClickPath = entry.path;
      if (!state.selectedPaths.has(entry.path)) {
        state.selectedPaths.add(entry.path);
        state.selectionPath = entry.path;
        updateSelectionSummary();
        renderSelectionAction();
        syncSelectedStyles();
      }
    }, MOBILE_LONG_PRESS_MS)
  };
}

function updateLongPress(event) {
  if (!longPressState || longPressState.pointerId !== event.pointerId) {
    return;
  }

  if (Math.abs(event.clientX - longPressState.startX) > 8 || Math.abs(event.clientY - longPressState.startY) > 8) {
    stopLongPress(event);
  }
}

function stopLongPress(event) {
  if (!longPressState) {
    return;
  }

  if (event && longPressState.pointerId !== event.pointerId) {
    return;
  }

  window.clearTimeout(longPressState.timer);
  longPressState = null;
}

function consumeSuppressedClick(path) {
  if (state.suppressedClickPath !== path) {
    return false;
  }

  state.suppressedClickPath = null;
  return true;
}
