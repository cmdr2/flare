import { fs as sharedFs, LightningFS } from '/libs/flare/fs.js';

const SYNC_ORIGIN = window.location.origin;
const SYNC_SOURCE = 'flare-sync';
const SYNC_URL = '/apps/sync/index.html';
const IFRAME_TIMEOUT_MS = 5000;
const DIRTY_EXCLUDED_PATHS = new Set([
    '/home/.aws/credentials',
    '/home/.sync/.local',
    '/home/.sync/.remote'
]);

let syncFrame = null;
let syncReady = false;
let syncButton = null;
let statusNode = null;
let setupLink = null;
let syncRequestCounter = 0;
let iframeTimeout = null;
let isSyncing = false;
let reloadAfterCheck = false;
let localDirty = false;

mountSyncBar();
patchLightningFs();
ensureSyncFrame();
window.addEventListener('message', handleMessage);

function mountSyncBar() {
    const style = document.createElement('style');
    style.textContent = `
    .flare-sync-bar {
      position: fixed;
      inset: 0 0 auto 0;
      z-index: 1000;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 18px;
      background: rgba(22, 24, 29, 0.92);
      color: #f5efe6;
      font: 14px/1.2 Georgia, 'Times New Roman', serif;
      box-shadow: 0 12px 24px rgba(0, 0, 0, 0.14);
      backdrop-filter: blur(12px);
    }

    .flare-sync-button {
      border: 0;
      border-radius: 999px;
      padding: 9px 16px;
      background: #dcb06a;
      color: #1a1712;
      font: inherit;
      cursor: pointer;
    }

    .flare-sync-button:disabled {
      opacity: 0.45;
      cursor: default;
    }

    .flare-sync-status {
      min-width: 88px;
    }

    .flare-sync-link {
      color: #f3c992;
    }
  `;
    document.head.appendChild(style);

    const bar = document.createElement('div');
    bar.className = 'flare-sync-bar';

    syncButton = document.createElement('button');
    syncButton.className = 'flare-sync-button';
    syncButton.type = 'button';
    syncButton.textContent = 'Sync';
    syncButton.disabled = true;
    syncButton.addEventListener('click', handleSyncClick);

    statusNode = document.createElement('span');
    statusNode.className = 'flare-sync-status';
    statusNode.textContent = 'Connecting..';

    setupLink = document.createElement('a');
    setupLink.className = 'flare-sync-link';
    setupLink.href = '/apps/sync/';
    setupLink.textContent = 'Open setup';
    setupLink.hidden = true;

    bar.append(syncButton, statusNode, setupLink);
    document.body.prepend(bar);

    document.body.style.paddingTop = '64px';
}

function ensureSyncFrame() {
    if (syncFrame) {
        return;
    }

    setStatus('Connecting..');
    syncFrame = document.createElement('iframe');
    syncFrame.hidden = true;
    syncFrame.src = SYNC_URL;
    syncFrame.addEventListener('load', startIframeTimeout, { once: true });
    document.body.appendChild(syncFrame);
    startIframeTimeout();
}

function startIframeTimeout() {
    clearTimeout(iframeTimeout);
    iframeTimeout = window.setTimeout(() => {
        if (!syncReady) {
            setStatus('Offline');
            setSyncEnabled(false);
        }
    }, IFRAME_TIMEOUT_MS);
}

function handleMessage(event) {
    if (event.origin !== SYNC_ORIGIN) {
        return;
    }

    if (event.data?.source !== SYNC_SOURCE) {
        return;
    }

    if (event.data.type === 'sync-ready') {
        syncReady = true;
        clearTimeout(iframeTimeout);
        setStatus('Checking..');
        sendSyncMessage('check');
        return;
    }

    if (event.data.type === 'sync-status') {
        handleSyncStatus(event.data.payload?.status || 'offline');
        return;
    }

    if (event.data.type === 'sync-progress') {
        setStatus(event.data.payload?.message || 'Syncing..');
        return;
    }

    if (event.data.type === 'sync-complete') {
        isSyncing = false;
        localDirty = false;
        reloadAfterCheck = true;
        setStatus('Checking..');
        sendSyncMessage('check');
        return;
    }

    if (event.data.type === 'sync-error') {
        isSyncing = false;
        reloadAfterCheck = false;
        setStatus('Failed to sync');
        showSetupLink(event.data.payload?.code === 'setup-needed');
        setSyncEnabled(true);
    }
}

function handleSyncStatus(status) {
    isSyncing = false;

    if (reloadAfterCheck) {
        reloadAfterCheck = false;
        if (status === 'up-to-date') {
            window.location.reload();
            return;
        }
    }

    if (localDirty) {
        setStatus('Needs sync');
        setSyncEnabled(syncReady && !isSyncing);
        showSetupLink(status === 'setup-needed' || status === 'error');
        return;
    }

    if (status === 'needs-sync') {
        setStatus('Needs sync');
        setSyncEnabled(true);
        showSetupLink(false);
        return;
    }

    if (status === 'up-to-date') {
        setStatus('Up-to-date');
        setSyncEnabled(false);
        showSetupLink(false);
        return;
    }

    if (status === 'setup-needed') {
        setStatus('Setup needed');
        setSyncEnabled(false);
        showSetupLink(true);
        return;
    }

    if (status === 'error') {
        setStatus('Error');
        setSyncEnabled(false);
        showSetupLink(true);
        return;
    }

    setStatus('Offline');
    setSyncEnabled(false);
    showSetupLink(false);
}

function markDirty() {
    localDirty = true;
    reloadAfterCheck = false;
    setStatus('Needs sync');
    setSyncEnabled(syncReady && !isSyncing);
    showSetupLink(false);
}

function patchLightningFs() {
    patchFsInstance(sharedFs);
    wrapMutation(LightningFS.prototype, 'writeFile');
    wrapMutation(LightningFS.prototype, 'unlink');
    wrapMutation(Object.getPrototypeOf(sharedFs.promises), 'writeFile');
    wrapMutation(Object.getPrototypeOf(sharedFs.promises), 'unlink');
}

function patchFsInstance(fs) {
    wrapMutation(fs, 'writeFile');
    wrapMutation(fs, 'unlink');
    wrapMutation(fs?.promises, 'writeFile');
    wrapMutation(fs?.promises, 'unlink');
}

function wrapMutation(target, methodName) {
    const original = target?.[methodName];
    if (typeof original !== 'function' || original.__flareSyncWrapped) {
        return;
    }

    const wrapped = function (...args) {
        const path = args[0];
        const lastArg = args[args.length - 1];

        if (typeof lastArg === 'function') {
            args[args.length - 1] = function (error, ...callbackArgs) {
                if (!error && shouldTrackDirtyPath(path)) {
                    markDirty();
                }
                return lastArg.call(this, error, ...callbackArgs);
            };
            return original.apply(this, args);
        }

        const result = original.apply(this, args);
        if (result && typeof result.then === 'function') {
            return result.then((value) => {
                if (shouldTrackDirtyPath(path)) {
                    markDirty();
                }
                return value;
            });
        }

        if (shouldTrackDirtyPath(path)) {
            markDirty();
        }

        return result;
    };

    wrapped.__flareSyncWrapped = true;
    target[methodName] = wrapped;
}

function shouldTrackDirtyPath(path) {
    return !isSyncing && typeof path === 'string' && !DIRTY_EXCLUDED_PATHS.has(path);
}

function handleSyncClick() {
    if (!syncReady || isSyncing) {
        return;
    }

    isSyncing = true;
    setStatus('Syncing..');
    setSyncEnabled(false);
    showSetupLink(false);
    sendSyncMessage('sync');
}

function sendSyncMessage(type, payload = {}) {
    if (!syncFrame?.contentWindow) {
        return;
    }

    syncFrame.contentWindow.postMessage({
        source: SYNC_SOURCE,
        type,
        requestId: String(++syncRequestCounter),
        payload
    }, SYNC_ORIGIN);
}

function setStatus(value) {
    if (statusNode) {
        statusNode.textContent = value;
    }
}

function setSyncEnabled(enabled) {
    if (syncButton) {
        syncButton.disabled = !enabled;
    }
}

function showSetupLink(visible) {
    if (setupLink) {
        setupLink.hidden = !visible;
    }
}