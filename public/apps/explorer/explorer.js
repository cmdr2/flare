import { registerPwa } from '/public/libs/flare/pwa.js';
import { fs } from '/public/libs/flare/fs.js';

registerPwa('explorer');

const state = {
  currentFolder: '/',
  currentView: loadStoredView(),
  currentEntries: [],
  selectionPath: '/',
  expandedFolders: new Set(['/']),
  sidebarOpen: false,
  createKind: 'file',
  editorPath: '',
  editorDirty: false,
  selectedEntry: null
};

const formatDate = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
});

const elements = {
  addressForm: document.getElementById('address-form'),
  addressInput: document.getElementById('address-input'),
  contentView: document.getElementById('content-view'),
  folderTitle: document.getElementById('folder-title'),
  selectionSummary: document.getElementById('selection-summary'),
  statusMessage: document.getElementById('status-message'),
  sidebar: document.getElementById('sidebar'),
  sidebarBackdrop: document.getElementById('sidebar-backdrop'),
  sidebarTree: document.getElementById('sidebar-tree'),
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
  createSubmitButton: document.getElementById('create-submit-button')
};

bindEvents();
await refreshExplorer('Explorer ready');

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

  for (const button of elements.viewButtons) {
    button.addEventListener('click', () => {
      setView(button.dataset.view || 'grid');
    });
  }

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
    setStatus('Could not open ' + path + ': ' + error.message);
  }
}

async function refreshExplorer(message = '') {
  try {
    const current = await ensureDirectory(state.currentFolder);
    state.currentFolder = current;
    expandAncestors(current);
    state.currentEntries = await readDirectory(current);
    if (!isSelectablePath(state.selectionPath, state.currentEntries) && state.selectionPath !== current) {
      state.selectionPath = current;
    }

    state.selectedEntry = state.selectionPath === current
      ? await describePath(current)
      : state.currentEntries.find((entry) => entry.path === state.selectionPath) || null;

    elements.addressInput.value = current;
    elements.folderTitle.textContent = current;
    elements.upButton.disabled = current === '/';
    renderViewButtons();
    await renderSidebarTree();
    await renderContent();
    updateSelectionSummary();
    setStatus(message || describeFolderState());
  } catch (error) {
    setStatus('Failed to load explorer: ' + error.message);
  }
}

async function renderContent() {
  elements.contentView.dataset.view = state.currentView;
  elements.contentView.replaceChildren();

  if (state.currentView === 'tree') {
    const treeRoot = document.createElement('div');
    treeRoot.className = 'tree-group';
    treeRoot.append(await buildTreeBranch(state.currentFolder, { includeFiles: true, rootLabel: state.currentFolder === '/' ? 'Root' : baseName(state.currentFolder) }));
    elements.contentView.append(treeRoot);
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
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.path = entry.path;
  button.className = 'content-item' + (state.selectionPath === entry.path ? ' is-selected' : '');
  button.addEventListener('click', () => selectPath(entry.path, entry));
  button.addEventListener('dblclick', () => {
    void openEntry(entry);
  });

  const icon = createIcon(entry.type);
  const meta = document.createElement('div');
  meta.className = 'content-item-meta';

  const name = document.createElement('span');
  name.className = 'content-item-name';
  name.textContent = entry.name;

  const subtitle = document.createElement('span');
  subtitle.className = 'content-item-subtitle';
  subtitle.textContent = entry.type === 'directory'
    ? entry.childLabel
    : [formatSize(entry.size), formatTimestamp(entry.mtimeMs)].filter(Boolean).join(' • ');

  meta.append(name, subtitle);

  if (state.currentView === 'list') {
    const detail = document.createElement('span');
    detail.className = 'content-item-subtitle';
    detail.textContent = entry.type === 'directory' ? 'Folder' : formatTimestamp(entry.mtimeMs);
    button.append(icon, meta, detail);
    return button;
  }

  button.append(icon, meta);
  return button;
}

async function renderSidebarTree() {
  elements.sidebarTree.replaceChildren();
  const rootGroup = document.createElement('div');
  rootGroup.className = 'tree-group';
  rootGroup.append(await buildTreeBranch('/', { includeFiles: false, rootLabel: 'Root' }));
  elements.sidebarTree.append(rootGroup);
}

async function buildTreeBranch(path, { includeFiles, rootLabel } = {}) {
  const entry = path === '/'
    ? { name: rootLabel || 'Root', path, type: 'directory', childLabel: '' }
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
      toggle.textContent = expanded ? '▾' : '▸';
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
  node.className = 'tree-node' + (state.selectionPath === path || state.currentFolder === path ? ' is-active' : '');
  node.addEventListener('click', () => {
    selectPath(path, entry);
  });
  node.addEventListener('dblclick', () => {
    void openEntry(entry);
  });

  const icon = createIcon(entry.type);
  const textWrap = document.createElement('span');
  textWrap.className = 'content-item-meta';

  const label = document.createElement('span');
  label.className = 'tree-label';
  label.textContent = path === '/' ? (rootLabel || 'Root') : entry.name;

  const subtitle = document.createElement('span');
  subtitle.className = 'tree-subtitle';
  subtitle.textContent = entry.type === 'directory'
    ? entry.childLabel || 'Folder'
    : formatSize(entry.size);

  textWrap.append(label, subtitle);
  node.append(icon, textWrap);
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
        childrenWrap.append(await buildTreeBranch(child.path, { includeFiles }));
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

function selectPath(path, entry = null) {
  state.selectionPath = path;
  state.selectedEntry = entry;
  updateSelectionSummary();
  syncSelectedStyles();
}

function syncSelectedStyles() {
  const selectedPath = state.selectionPath;
  for (const node of document.querySelectorAll('.content-item')) {
    node.classList.toggle('is-selected', node.dataset.path === selectedPath);
  }
  for (const node of document.querySelectorAll('.tree-node')) {
    node.classList.toggle('is-active', node.dataset.path === selectedPath || node.dataset.path === state.currentFolder);
  }
}

async function openEntry(entry) {
  const target = entry || state.currentEntries.find((item) => item.path === state.selectionPath) || await describePath(state.selectionPath);
  if (target.type === 'directory') {
    await navigateTo(target.path);
    return;
  }

  await openEditor(target.path);
}

async function navigateTo(path, { selectionPath, silent = false } = {}) {
  const folder = await ensureDirectory(path);
  state.currentFolder = folder;
  state.selectionPath = selectionPath || folder;
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
  const selected = state.selectedEntry || state.currentEntries.find((entry) => entry.path === state.selectionPath);
  if (!selected && state.selectionPath === state.currentFolder) {
    elements.selectionSummary.textContent = 'Viewing ' + state.currentFolder;
    return;
  }

  if (!selected) {
    elements.selectionSummary.textContent = 'No selection';
    return;
  }

  elements.selectionSummary.textContent = selected.type === 'directory'
    ? selected.name + ' • Folder'
    : selected.name + ' • ' + formatSize(selected.size);
}

function setStatus(message) {
  elements.statusMessage.textContent = message;
}

function describeFolderState() {
  const count = state.currentEntries.length;
  return count === 0
    ? 'Empty folder'
    : count + ' item' + (count === 1 ? '' : 's') + ' in ' + state.currentFolder;
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
  await refreshExplorer('Saved ' + state.editorPath);
}

function openCreateDialog(kind) {
  state.createKind = kind;
  elements.createLabel.textContent = kind === 'folder' ? 'Create folder' : 'Create file';
  elements.createTitle.textContent = kind === 'folder' ? 'New folder' : 'New file';
  elements.createSubmitButton.textContent = kind === 'folder' ? 'Create folder' : 'Create file';
  elements.createNameInput.value = '';
  elements.createError.textContent = '';
  elements.createTarget.textContent = 'Create in ' + state.currentFolder;
  openDialog(elements.createDialog);
  elements.createNameInput.focus();
}

async function createItem() {
  const name = elements.createNameInput.value.trim();
  const validationError = validateItemName(name);
  if (validationError) {
    elements.createError.textContent = validationError;
    return;
  }

  const targetPath = joinPath(state.currentFolder, name);
  try {
    if (await pathExists(targetPath)) {
      throw new Error('An item with that name already exists');
    }

    if (state.createKind === 'folder') {
      await fs.promises.mkdir(targetPath);
      closeDialog(elements.createDialog);
      state.selectionPath = targetPath;
      state.expandedFolders.add(state.currentFolder);
      await refreshExplorer('Created folder ' + targetPath);
      return;
    }

    closeDialog(elements.createDialog);
    await fs.promises.writeFile(targetPath, '');
    state.selectionPath = targetPath;
    await refreshExplorer('Created file ' + targetPath);
    await openEditor(targetPath);
  } catch (error) {
    elements.createError.textContent = 'Could not create ' + name + ': ' + error.message;
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
    const entryCount = await countChildren(normalized);
    return {
      name: normalized === '/' ? 'Root' : baseName(normalized),
      path: normalized,
      type: 'directory',
      size: 0,
      mtimeMs: stat.mtimeMs,
      childLabel: entryCount + ' item' + (entryCount === 1 ? '' : 's')
    };
  }

  return {
    name: baseName(normalized),
    path: normalized,
    type: 'file',
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    childLabel: ''
  };
}

async function readDirectory(path, includeFiles = true) {
  const names = await fs.promises.readdir(path);
  const described = [];

  for (const name of names) {
    const childPath = joinPath(path, name);
    const stat = await fs.promises.stat(childPath);
    if (stat.isDirectory()) {
      const childCount = await countChildren(childPath);
      described.push({
        name,
        path: childPath,
        type: 'directory',
        size: 0,
        mtimeMs: stat.mtimeMs,
        childLabel: childCount + ' item' + (childCount === 1 ? '' : 's')
      });
      continue;
    }

    if (includeFiles) {
      described.push({
        name,
        path: childPath,
        type: 'file',
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        childLabel: ''
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

async function countChildren(path) {
  try {
    return (await fs.promises.readdir(path)).length;
  } catch {
    return 0;
  }
}

function createIcon(type) {
  const icon = document.createElement('span');
  icon.className = 'entry-icon ' + (type === 'directory' ? 'entry-icon--folder' : 'entry-icon--file');
  return icon;
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

function formatTimestamp(value) {
  return value ? formatDate.format(new Date(value)) : '';
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

function loadStoredView() {
  const view = window.localStorage.getItem('flare-explorer-view');
  return ['grid', 'list', 'tree'].includes(view) ? view : 'grid';
}
