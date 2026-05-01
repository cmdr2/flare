import { fs as sharedFs, LightningFS } from '/public/libs/flare/fs.js';

const SYNC_ORIGIN = window.location.origin;
const SYNC_SOURCE = 'flare-sync';
const SYNC_URL = '/public/apps/sync/index.html';
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
let progressNode = null;
let progressCountNode = null;
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
            gap: 10px;
            padding: 8px 14px;
      background: rgba(22, 24, 29, 0.92);
      color: #f5efe6;
      font: 14px/1.2 Georgia, 'Times New Roman', serif;
      box-shadow: 0 12px 24px rgba(0, 0, 0, 0.14);
      backdrop-filter: blur(12px);
    }

    .flare-sync-button {
      border: 0;
      border-radius: 999px;
            padding: 6px 12px;
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

        .flare-sync-progress {
            --progress-ratio: 0;
            position: relative;
            display: inline-grid;
            place-items: center;
            width: 34px;
            height: 34px;
            border-radius: 50%;
            background: conic-gradient(#dcb06a calc(var(--progress-ratio) * 1turn), rgba(255, 255, 255, 0.18) 0);
            flex: none;
        }

        .flare-sync-progress[hidden] {
            display: none;
        }

        .flare-sync-progress::before {
            content: '';
            position: absolute;
            inset: 4px;
            border-radius: 50%;
            background: rgba(22, 24, 29, 0.96);
            box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
        }

        .flare-sync-progress-count {
            position: relative;
            z-index: 1;
            font: 10px/1.05 'Segoe UI', system-ui, sans-serif;
            color: #f5efe6;
            text-align: center;
            white-space: pre;
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

    progressNode = document.createElement('span');
    progressNode.className = 'flare-sync-progress';
    progressNode.hidden = true;

    progressCountNode = document.createElement('span');
    progressCountNode.className = 'flare-sync-progress-count';
    progressNode.append(progressCountNode);

    setupLink = document.createElement('a');
    setupLink.className = 'flare-sync-link';
    setupLink.href = '/public/apps/sync/';
    setupLink.textContent = 'Open setup';
    setupLink.hidden = true;

    bar.append(syncButton, statusNode, progressNode, setupLink);
    document.body.prepend(bar);
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

    console.log('[syncbar]', 'message', {
        type: event.data.type,
        requestId: event.data.requestId,
        payload: event.data.payload
    });

    if (event.data.type === 'sync-ready') {
        syncReady = true;
        clearTimeout(iframeTimeout);
        clearProgress();
        setStatus('Checking..');
        sendSyncMessage('check');
        return;
    }

    if (event.data.type === 'sync-status') {
        handleSyncStatus(event.data.payload?.status || 'offline');
        return;
    }

    if (event.data.type === 'sync-progress') {
        handleSyncProgress(event.data.payload || {});
        return;
    }

    if (event.data.type === 'sync-complete') {
        isSyncing = false;
        localDirty = false;
        reloadAfterCheck = true;
        console.log('[syncbar]', 'sync-complete; requesting post-sync check', {
            requestId: event.data.requestId,
            payload: event.data.payload
        });
        clearProgress();
        setStatus('Checking..');
        sendSyncMessage('check');
        return;
    }

    if (event.data.type === 'sync-error') {
        isSyncing = false;
        reloadAfterCheck = false;
        console.error('[syncbar]', 'sync-error', {
            requestId: event.data.requestId,
            payload: event.data.payload
        });
        clearProgress();
        setStatus('Failed to sync');
        showSetupLink(event.data.payload?.code === 'setup-needed');
        setSyncEnabled(true);
    }
}

function handleSyncProgress(payload) {
    const phase = payload.phase;

    if (phase === 'upload' || phase === 'download') {
        setStatus(phase === 'upload' ? 'Uploading' : 'Downloading');
        setProgress(payload.completed ?? 0, payload.total ?? 0);
        return;
    }

    clearProgress();

    if (phase === 'local-delete' || phase === 'remote-delete') {
        setStatus('Removing');
        return;
    }

    if (phase === 'noop') {
        setStatus('Up-to-date');
        return;
    }

    setStatus(payload.message || 'Syncing..');
}

function handleSyncStatus(status) {
    isSyncing = false;
    clearProgress();

    if (reloadAfterCheck) {
        reloadAfterCheck = false;
        if (status === 'up-to-date') {
            console.log('[syncbar]', 'post-sync check is up-to-date; reloading page');
            window.location.reload();
            return;
        }

        console.warn('[syncbar]', 'post-sync check did not resolve to up-to-date', { status });
    }

    if (localDirty) {
        console.log('[syncbar]', 'status resolved to local dirty override', { status });
        setStatus('Needs sync');
        setSyncEnabled(syncReady && !isSyncing);
        showSetupLink(status === 'setup-needed' || status === 'error');
        return;
    }

    if (status === 'needs-sync') {
        console.log('[syncbar]', 'status branch', { status });
        setStatus('Needs sync');
        setSyncEnabled(true);
        showSetupLink(false);
        return;
    }

    if (status === 'up-to-date') {
        console.log('[syncbar]', 'status branch', { status });
        setStatus('Up-to-date');
        setSyncEnabled(false);
        showSetupLink(false);
        return;
    }

    if (status === 'setup-needed') {
        console.log('[syncbar]', 'status branch', { status });
        setStatus('Setup needed');
        setSyncEnabled(false);
        showSetupLink(true);
        return;
    }

    if (status === 'error') {
        console.warn('[syncbar]', 'status branch', { status });
        setStatus('Error');
        setSyncEnabled(false);
        showSetupLink(true);
        return;
    }

    console.warn('[syncbar]', 'status fell through to offline', { status });
    setStatus('Offline');
    setSyncEnabled(false);
    showSetupLink(false);
}

function markDirty() {
    localDirty = true;
    reloadAfterCheck = false;
    clearProgress();
    setStatus('Needs sync');
    setSyncEnabled(syncReady && !isSyncing);
    showSetupLink(false);
}

function patchLightningFs() {
    patchFsInstance(sharedFs);
    wrapMutation(LightningFS.prototype, 'writeFile');
    wrapMutation(LightningFS.prototype, 'unlink');
    wrapMutation(LightningFS.prototype, 'mkdir');
    wrapMutation(LightningFS.prototype, 'rmdir');
    wrapMutation(LightningFS.prototype, 'rename');
    wrapMutation(Object.getPrototypeOf(sharedFs.promises), 'writeFile');
    wrapMutation(Object.getPrototypeOf(sharedFs.promises), 'unlink');
    wrapMutation(Object.getPrototypeOf(sharedFs.promises), 'mkdir');
    wrapMutation(Object.getPrototypeOf(sharedFs.promises), 'rmdir');
    wrapMutation(Object.getPrototypeOf(sharedFs.promises), 'rename');
}

function patchFsInstance(fs) {
    wrapMutation(fs, 'writeFile');
    wrapMutation(fs, 'unlink');
    wrapMutation(fs, 'mkdir');
    wrapMutation(fs, 'rmdir');
    wrapMutation(fs, 'rename');
    wrapMutation(fs?.promises, 'writeFile');
    wrapMutation(fs?.promises, 'unlink');
    wrapMutation(fs?.promises, 'mkdir');
    wrapMutation(fs?.promises, 'rmdir');
    wrapMutation(fs?.promises, 'rename');
}

function wrapMutation(target, methodName) {
    const original = target?.[methodName];
    if (typeof original !== 'function' || original.__flareSyncWrapped) {
        return;
    }

    const wrapped = function (...args) {
        const path = args[0];
        const lastArg = args[args.length - 1];

        const trackedPaths = getMutationPaths(methodName, args);

        if (typeof lastArg === 'function') {
            args[args.length - 1] = function (error, ...callbackArgs) {
                if (!error && trackedPaths.some(shouldTrackDirtyPath)) {
                    markDirty();
                }
                return lastArg.call(this, error, ...callbackArgs);
            };
            return original.apply(this, args);
        }

        const result = original.apply(this, args);
        if (result && typeof result.then === 'function') {
            return result.then((value) => {
                if (trackedPaths.some(shouldTrackDirtyPath)) {
                    markDirty();
                }
                return value;
            });
        }

        if (trackedPaths.some(shouldTrackDirtyPath)) {
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

function getMutationPaths(methodName, args) {
    if (methodName === 'rename') {
        return [args[0], args[1]];
    }

    return [args[0]];
}

function handleSyncClick() {
    if (!syncReady || isSyncing) {
        console.warn('[syncbar]', 'sync click ignored', { syncReady, isSyncing });
        return;
    }

    isSyncing = true;
    console.log('[syncbar]', 'sync click accepted');
    clearProgress();
    setStatus('Syncing..');
    setSyncEnabled(false);
    showSetupLink(false);
    sendSyncMessage('sync');
}

function sendSyncMessage(type, payload = {}) {
    if (!syncFrame?.contentWindow) {
        console.warn('[syncbar]', 'cannot send message; iframe missing', { type, payload });
        return;
    }

    const requestId = String(++syncRequestCounter);
    console.log('[syncbar]', 'send', { type, requestId, payload });

    syncFrame.contentWindow.postMessage({
        source: SYNC_SOURCE,
        type,
        requestId,
        payload
    }, SYNC_ORIGIN);
}

function setStatus(value) {
    if (statusNode) {
        statusNode.textContent = value;
    }
}

function setProgress(completed, total) {
    if (!progressNode || !progressCountNode || !total) {
        clearProgress();
        return;
    }

    const safeCompleted = Math.min(Math.max(completed, 0), total);
    progressNode.hidden = false;
    progressNode.style.setProperty('--progress-ratio', String(safeCompleted / total));
    progressCountNode.textContent = safeCompleted + '/' + total;
}

function clearProgress() {
    if (!progressNode || !progressCountNode) {
        return;
    }

    progressNode.hidden = true;
    progressNode.style.setProperty('--progress-ratio', '0');
    progressCountNode.textContent = '';
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