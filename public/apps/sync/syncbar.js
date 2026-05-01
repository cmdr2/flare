import { fs as sharedFs, LightningFS } from '/public/libs/flare/fs.js';

const SYNC_ORIGIN = window.location.origin;
const SYNC_SOURCE = 'flare-sync';
const SYNC_URL = '/public/apps/sync/index.html';
const IFRAME_TIMEOUT_MS = 5000;
const FONT_AWESOME_STYLES = [
    '/public/libs/fontawesome/css/fontawesome.min.css',
    '/public/libs/fontawesome/css/solid.min.css'
];
const DIRTY_EXCLUDED_PATHS = new Set([
    '/home/.aws/credentials',
    '/home/.sync/.local',
    '/home/.sync/.remote'
]);

const STATUS_META = {
    connecting: { label: 'Connecting..', icon: 'fa-link', tone: 'pending' },
    checking: { label: 'Checking..', icon: 'fa-arrows-rotate', tone: 'pending', spin: true },
    syncing: { label: 'Syncing..', icon: 'fa-arrows-rotate', tone: 'pending', spin: true },
    upload: { label: 'Uploading', icon: 'fa-cloud-arrow-up', tone: 'pending' },
    download: { label: 'Downloading', icon: 'fa-cloud-arrow-down', tone: 'pending' },
    removing: { label: 'Removing', icon: 'fa-trash', tone: 'warning' },
    'needs-sync': { label: 'Needs sync', icon: 'fa-rotate', tone: 'warning' },
    'up-to-date': { label: 'Up-to-date', icon: 'fa-circle-check', tone: 'success' },
    offline: { label: 'Offline', icon: 'fa-cloud-slash', tone: 'muted' },
    error: { label: 'Error', icon: 'fa-circle-exclamation', tone: 'danger' },
    failed: { label: 'Failed to sync', icon: 'fa-triangle-exclamation', tone: 'danger' },
    'setup-needed': { label: 'Setup needed', icon: 'fa-screwdriver-wrench', tone: 'warning' }
};

let syncFrame = null;
let syncReady = false;
let syncButton = null;
let statusNode = null;
let statusIconNode = null;
let statusTextNode = null;
let progressNode = null;
let progressCountNode = null;
let setupLink = null;
let syncRequestCounter = 0;
let iframeTimeout = null;
let isSyncing = false;
let reloadAfterCheck = false;
let localDirty = false;

ensureFontAwesomeStyles();
mountSyncBar();
patchLightningFs();
ensureSyncFrame();
window.addEventListener('message', handleMessage);

function ensureFontAwesomeStyles() {
        for (const href of FONT_AWESOME_STYLES) {
                if (document.querySelector('link[href="' + href + '"]')) {
                        continue;
                }

                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = href;
                document.head.appendChild(link);
        }
}

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
        background: rgba(18, 24, 32, 0.9);
        color: #eef5ff;
        font: 13px/1.2 'Segoe UI', system-ui, sans-serif;
        box-shadow: 0 12px 24px rgba(0, 0, 0, 0.18);
        backdrop-filter: blur(12px);
    }

    .flare-sync-button {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 999px;
        padding: 7px 12px;
        background: linear-gradient(180deg, #f5cd83 0%, #e0a84b 100%);
        color: #24180c;
        font: inherit;
        cursor: pointer;
    }

    .flare-sync-button:disabled {
        opacity: 0.45;
        cursor: default;
    }

    .flare-sync-status {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        padding: 6px 10px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.08);
        color: #eef5ff;
    }

    .flare-sync-status[data-tone="success"] {
        color: #c4f0d4;
    }

    .flare-sync-status[data-tone="warning"] {
        color: #ffe2a9;
    }

    .flare-sync-status[data-tone="danger"] {
        color: #ffb7ae;
    }

    .flare-sync-status[data-tone="muted"] {
        color: #c8d3de;
    }

    .flare-sync-status-icon {
        width: 16px;
        display: inline-grid;
        place-items: center;
        flex: none;
    }

    .flare-sync-progress {
        --progress-ratio: 0;
        position: relative;
        display: inline-grid;
        place-items: center;
        width: 34px;
        height: 34px;
        border-radius: 50%;
        background: conic-gradient(#f2c16e calc(var(--progress-ratio) * 1turn), rgba(255, 255, 255, 0.18) 0);
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
        background: rgba(18, 24, 32, 0.96);
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
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: #f3c992;
        text-decoration: none;
    }

    .flare-sync-link:hover {
        color: #ffe0a8;
    }

    @media (max-width: 640px) {
        .flare-sync-bar {
            gap: 8px;
            padding: 7px 10px;
        }

        .flare-sync-status {
            padding-inline: 8px;
        }

        .flare-sync-button-text,
        .flare-sync-link-text {
            display: none;
        }
    }
  `;
    document.head.appendChild(style);

    const bar = document.createElement('div');
    bar.className = 'flare-sync-bar';

    syncButton = document.createElement('button');
    syncButton.className = 'flare-sync-button';
    syncButton.type = 'button';
    syncButton.append(createSyncIcon('fa-arrows-rotate'), createSyncLabel('Sync', 'flare-sync-button-text'));
    syncButton.disabled = true;
    syncButton.addEventListener('click', handleSyncClick);

    statusNode = document.createElement('span');
    statusNode.className = 'flare-sync-status';
    statusIconNode = document.createElement('span');
    statusIconNode.className = 'flare-sync-status-icon';
    statusTextNode = document.createElement('span');
    statusTextNode.className = 'flare-sync-status-text';
    statusNode.append(statusIconNode, statusTextNode);
    setStatus('connecting');

    progressNode = document.createElement('span');
    progressNode.className = 'flare-sync-progress';
    progressNode.hidden = true;

    progressCountNode = document.createElement('span');
    progressCountNode.className = 'flare-sync-progress-count';
    progressNode.append(progressCountNode);

    setupLink = document.createElement('a');
    setupLink.className = 'flare-sync-link';
    setupLink.href = '/public/apps/sync/';
    setupLink.append(createSyncIcon('fa-screwdriver-wrench'), createSyncLabel('Open setup', 'flare-sync-link-text'));
    setupLink.hidden = true;

    bar.append(syncButton, statusNode, progressNode, setupLink);
    document.body.prepend(bar);
}

function ensureSyncFrame() {
    if (syncFrame) {
        return;
    }

    setStatus('Connecting..');
    setStatus('connecting');
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
            setStatus('offline');
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
        setStatus('checking');
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
        setStatus('checking');
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
        setStatus('failed');
        showSetupLink(event.data.payload?.code === 'setup-needed');
        setSyncEnabled(true);
    }
}

function handleSyncProgress(payload) {
    const phase = payload.phase;

    if (phase === 'upload' || phase === 'download') {
        setStatus(phase);
        if (Number.isFinite(payload.total) && payload.total > 0) {
            setProgress(payload.completed ?? 0, payload.total);
        }
        return;
    }

    clearProgress();

    if (phase === 'local-delete' || phase === 'remote-delete') {
        setStatus('removing');
        return;
    }

    if (phase === 'noop') {
        setStatus('up-to-date');
        return;
    }

    setStatus('syncing', payload.message || STATUS_META.syncing.label);
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
        setStatus('needs-sync');
        setSyncEnabled(syncReady && !isSyncing);
        showSetupLink(status === 'setup-needed' || status === 'error');
        return;
    }

    if (status === 'needs-sync') {
        console.log('[syncbar]', 'status branch', { status });
        setStatus('needs-sync');
        setSyncEnabled(true);
        showSetupLink(false);
        return;
    }

    if (status === 'up-to-date') {
        console.log('[syncbar]', 'status branch', { status });
        setStatus('up-to-date');
        setSyncEnabled(false);
        showSetupLink(false);
        return;
    }

    if (status === 'setup-needed') {
        console.log('[syncbar]', 'status branch', { status });
        setStatus('setup-needed');
        setSyncEnabled(false);
        showSetupLink(true);
        return;
    }

    if (status === 'error') {
        console.warn('[syncbar]', 'status branch', { status });
        setStatus('error');
        setSyncEnabled(false);
        showSetupLink(true);
        return;
    }

    console.warn('[syncbar]', 'status fell through to offline', { status });
    setStatus('offline');
    setSyncEnabled(false);
    showSetupLink(false);
}

function markDirty() {
    localDirty = true;
    reloadAfterCheck = false;
    clearProgress();
    setStatus('needs-sync');
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
    setStatus('syncing');
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

function setStatus(statusKey, labelOverride) {
    if (!statusNode || !statusIconNode || !statusTextNode) {
        return;
    }

    const meta = STATUS_META[statusKey] || { label: labelOverride || statusKey, icon: 'fa-circle-info', tone: 'muted' };
    const label = labelOverride || meta.label;
    statusNode.dataset.tone = meta.tone;
    statusNode.title = label;
    statusIconNode.replaceChildren(createSyncIcon(meta.icon, meta.spin));
    statusTextNode.textContent = label;
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

function createSyncIcon(iconName, spin = false) {
    const icon = document.createElement('i');
    icon.className = 'fa-solid ' + iconName + (spin ? ' fa-spin' : '');
    icon.setAttribute('aria-hidden', 'true');
    return icon;
}

function createSyncLabel(text, className) {
    const label = document.createElement('span');
    label.className = className;
    label.textContent = text;
    return label;
}