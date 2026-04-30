import { fs } from '/public/libs/flare/fs.js';

export const SYNC_SOURCE = 'flare-sync';
export const CREDENTIALS_PATH = '/home/.aws/credentials';
export const LOCAL_INDEX_PATH = '/home/.sync/.local';
export const REMOTE_INDEX_PATH = '/home/.sync/.remote';
const MD5_HEX_LENGTH = 32;

const AWS_SDK_URL = 'https://cdn.jsdelivr.net/npm/aws-sdk@2.1693.0/dist/aws-sdk.min.js';
const SPARK_MD5_URL = 'https://cdn.jsdelivr.net/npm/spark-md5@3.0.2/spark-md5.min.js';

let awsSdkPromise = null;
let sparkMd5Promise = null;

export async function initializeSyncRuntime() {
    await ensureDir('/home/.aws');
    await ensureDir('/home/.sync');
}

export async function readSavedCredentials() {
    if (!(await exists(CREDENTIALS_PATH))) {
        return null;
    }

    return parseCredentials(await readText(CREDENTIALS_PATH));
}

export async function saveCredentials(credentials) {
    await writeText(CREDENTIALS_PATH, serializeCredentials(credentials));
    await flushFs();
}

export function parseCredentials(text) {
    const credentials = {
        accessKey: '',
        secretKey: '',
        region: 'us-east-1',
        bucket: '',
        prefix: ''
    };

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('[') || line.startsWith('#')) {
            continue;
        }

        const separator = line.indexOf('=');
        if (separator === -1) {
            continue;
        }

        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        if (key === 'aws_access_key_id') {
            credentials.accessKey = value;
        } else if (key === 'aws_secret_access_key') {
            credentials.secretKey = value;
        } else if (key === 'region') {
            credentials.region = value;
        } else if (key === 'bucket') {
            credentials.bucket = value;
        } else if (key === 'prefix') {
            credentials.prefix = value;
        }
    }

    return credentials;
}

export function serializeCredentials(credentials) {
    return [
        '[default]',
        'aws_access_key_id=' + credentials.accessKey,
        'aws_secret_access_key=' + credentials.secretKey,
        'region=' + (credentials.region || 'us-east-1'),
        'bucket=' + credentials.bucket,
        'prefix=' + (credentials.prefix || '')
    ].join('\n');
}

export function hasValidCredentials(credentials) {
    return Boolean(credentials?.accessKey && credentials?.secretKey && credentials?.region && credentials?.bucket);
}

export async function inspectSyncState(credentials, { requestId, onProgress } = {}) {
    const remoteStorage = await createRemoteStorage(credentials);
    const local = await getLocalFiles();
    const remote = await getRemoteFiles(remoteStorage);
    const localOld = await getOldIndex(LOCAL_INDEX_PATH);
    const remoteOld = await getOldIndex(REMOTE_INDEX_PATH);

    logSyncEntries('check', getTrackedPaths(local, remote), local, remote, requestId, onProgress);

    if (Object.keys(remote).length === 0) {
        return {
            status: 'needs-sync',
            summary: 'Remote store is empty.'
        };
    }

    const tasks = getSyncTasks(local, remote, localOld, remoteOld);
    return {
        status: hasPendingTasks(tasks) ? 'needs-sync' : 'up-to-date',
        summary: summarizeTasks(tasks)
    };
}

export async function performSync({ requestId, onProgress }) {
    const releaseLock = acquireSyncLock();
    if (!releaseLock) {
        const error = new Error('Sync already running');
        error.code = 'busy';
        throw error;
    }

    try {
        const credentials = await readSavedCredentials();
        if (!hasValidCredentials(credentials)) {
            const error = new Error('Missing credentials');
            error.code = 'setup-needed';
            throw error;
        }

        if (!navigator.onLine) {
            const error = new Error('Offline');
            error.code = 'offline';
            throw error;
        }

        onProgress?.({ phase: 'start', message: 'Syncing..', requestId });

        const remoteStorage = await createRemoteStorage(credentials);
        let local = await getLocalFiles();
        const remote = await getRemoteFiles(remoteStorage);
        const localOld = await getOldIndex(LOCAL_INDEX_PATH);
        const remoteOld = await getOldIndex(REMOTE_INDEX_PATH);
        const tasks = getSyncTasks(local, remote, localOld, remoteOld);

        await runSyncTasks(tasks, remoteStorage, local, remote, requestId, onProgress);

        local = await getLocalFiles();
        await setOldIndex(LOCAL_INDEX_PATH, local);
        await setOldIndex(REMOTE_INDEX_PATH, local);
        await flushFs();

        return {
            summary: summarizeTasks(tasks)
        };
    } finally {
        releaseLock();
    }
}

export function shouldSyncPath(path) {
    return path !== CREDENTIALS_PATH
        && path !== LOCAL_INDEX_PATH
        && path !== REMOTE_INDEX_PATH;
}

async function getLocalFiles() {
    const files = await listAll('/');
    const entries = {};

    for (const filePath of files) {
        if (!shouldSyncPath(filePath)) {
            continue;
        }

        entries[filePath] = await getHash(filePath);
    }

    return entries;
}

async function getRemoteFiles(remoteStorage) {
    const entries = await remoteStorage.list();
    const filtered = {};

    for (const [filePath, hash] of Object.entries(entries)) {
        if (!shouldSyncPath(filePath)) {
            continue;
        }

        filtered[filePath] = hash;
    }

    return filtered;
}

function getSyncTasks(localNew, remoteNew, localOld, remoteOld) {
    const tasks = { upload: {}, download: {}, localDelete: {}, remoteDelete: {}, error: false };

    if (!localNew || !remoteNew || !localOld || !remoteOld) {
        return tasks;
    }

    for (const filePath in localNew) {
        if (localNew[filePath] !== localOld[filePath] && remoteNew[filePath] === undefined && remoteOld[filePath] === undefined) {
            tasks.upload[filePath] = 1;
        }

        if (remoteNew[filePath] === undefined && remoteOld[filePath] === undefined) {
            tasks.upload[filePath] = 1;
        } else if (localNew[filePath] !== remoteNew[filePath] && remoteNew[filePath] === remoteOld[filePath] && remoteNew[filePath] !== undefined) {
            tasks.upload[filePath] = 1;
        }
    }

    for (const filePath in localOld) {
        if (localNew[filePath] === undefined && remoteNew[filePath] === remoteOld[filePath] && remoteNew[filePath] !== undefined) {
            tasks.remoteDelete[filePath] = 1;
        }
    }

    for (const filePath in remoteOld) {
        if (remoteNew[filePath] === undefined) {
            tasks.localDelete[filePath] = 1;
        }
    }

    for (const filePath in remoteNew) {
        if (localNew[filePath] === undefined && localOld[filePath] === undefined) {
            tasks.download[filePath] = 1;
        } else if (remoteOld[filePath] !== remoteNew[filePath] && localNew[filePath] !== remoteNew[filePath]) {
            tasks.download[filePath] = 1;
        }
    }

    for (const filePath in tasks.upload) {
        if (tasks.download[filePath] !== undefined) {
            tasks.error = true;
            delete tasks.download[filePath];
        }
    }

    return tasks;
}

async function runSyncTasks(tasks, remoteStorage, local, remote, requestId, onProgress) {
    const uploadFiles = Object.keys(tasks.upload);
    const downloadFiles = Object.keys(tasks.download);
    const localDeleteFiles = Object.keys(tasks.localDelete);
    const remoteDeleteFiles = Object.keys(tasks.remoteDelete);

    if (uploadFiles.length > 0) {
        onProgress?.({ phase: 'upload', message: 'Uploading ' + uploadFiles.length + ' file(s)..', requestId });
        logSyncEntries('upload', uploadFiles, local, remote, requestId, onProgress);
        await remoteStorage.upload(uploadFiles);
    }

    if (downloadFiles.length > 0) {
        onProgress?.({ phase: 'download', message: 'Downloading ' + downloadFiles.length + ' file(s)..', requestId });
        logSyncEntries('download', downloadFiles, local, remote, requestId, onProgress);
        await remoteStorage.download(downloadFiles);
    }

    if (localDeleteFiles.length > 0) {
        onProgress?.({ phase: 'local-delete', message: 'Removing ' + localDeleteFiles.length + ' local file(s)..', requestId });
        logSyncEntries('local-delete', localDeleteFiles, local, remote, requestId, onProgress);
        await removeMany(localDeleteFiles);
    }

    if (remoteDeleteFiles.length > 0) {
        onProgress?.({ phase: 'remote-delete', message: 'Removing ' + remoteDeleteFiles.length + ' remote file(s)..', requestId });
        logSyncEntries('remote-delete', remoteDeleteFiles, local, remote, requestId, onProgress);
        await remoteStorage.moveToTrash(remoteDeleteFiles);
    }
}

function logSyncEntries(phase, paths, local, remote, requestId, onProgress) {
    for (const path of paths) {
        const localHash = local[path] || '(missing)';
        const remoteHash = remote[path] || '(missing)';
        const message = [
            phase + ' ' + path,
            '  local: ' + localHash,
            '  remote: ' + remoteHash
        ].join('\n');

        console.log('[sync]', message);
        onProgress?.({ phase, message, requestId, append: true, path, localHash, remoteHash });
    }
}

function getTrackedPaths(local, remote) {
    return Object.keys({ ...local, ...remote }).sort();
}

async function getOldIndex(indexPath) {
    if (!(await exists(indexPath))) {
        return {};
    }

    const text = await readText(indexPath);
    const entries = {};

    for (const line of text.split(/\r?\n/)) {
        if (!line) {
            continue;
        }

        const separator = line.indexOf(':');
        if (separator === -1) {
            continue;
        }

        const filePath = line.slice(0, separator);
        const hash = line.slice(separator + 1);
        entries[filePath] = hash;
    }

    return entries;
}

async function setOldIndex(indexPath, entries) {
    const lines = [];
    for (const [filePath, hash] of Object.entries(entries)) {
        lines.push(filePath + ':' + hash);
    }
    await writeText(indexPath, lines.join('\n'));
}

async function createRemoteStorage(credentials) {
    const AWS = await loadAwsSdk();
    const client = new AWS.S3({
        accessKeyId: credentials.accessKey,
        secretAccessKey: credentials.secretKey,
        region: credentials.region,
        signatureVersion: 'v4'
    });

    const basePrefix = normalizePrefix(credentials.prefix);
    const filesPrefix = basePrefix ? basePrefix + '/' : '';

    return {
        async list() {
            const entries = {};
            let continuationToken = undefined;

            do {
                const response = await runS3Request(() => client.listObjectsV2({
                    Bucket: credentials.bucket,
                    Prefix: filesPrefix,
                    ContinuationToken: continuationToken
                }).promise());

                for (const item of response.Contents || []) {
                    if (!item.Key || item.Key.endsWith('/')) {
                        continue;
                    }

                    const path = '/' + item.Key.slice(filesPrefix.length);
                    entries[path] = normalizeStoredHash(item.ETag);
                }

                continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
            } while (continuationToken);

            return entries;
        },

        async upload(paths) {
            for (const path of paths) {
                const body = await readBytes(path);
                const hash = await getHash(path);
                await runS3Request(() => client.putObject({
                    Bucket: credentials.bucket,
                    Key: toRemoteKey(filesPrefix, path),
                    Body: body,
                    Metadata: { syncchecksum: hash }
                }).promise());
            }
        },

        async download(paths) {
            for (const path of paths) {
                const response = await runS3Request(() => client.getObject({
                    Bucket: credentials.bucket,
                    Key: toRemoteKey(filesPrefix, path)
                }).promise());
                const body = await readResponseBody(response.Body);
                await writeBytes(path, body);
            }
        },

        async moveToTrash(paths) {
            for (const path of paths) {
                await runS3Request(() => client.deleteObject({
                    Bucket: credentials.bucket,
                    Key: toRemoteKey(filesPrefix, path)
                }).promise());
            }
        }
    };
}

function loadAwsSdk() {
    if (window.AWS) {
        return Promise.resolve(window.AWS);
    }

    if (!awsSdkPromise) {
        awsSdkPromise = new Promise((resolve, reject) => {
            const existing = document.querySelector('script[data-flare-aws-sdk]');
            if (existing) {
                existing.addEventListener('load', () => resolve(window.AWS), { once: true });
                existing.addEventListener('error', () => reject(new Error('Failed to load AWS SDK')), { once: true });
                return;
            }

            const script = document.createElement('script');
            script.src = AWS_SDK_URL;
            script.async = true;
            script.dataset.flareAwsSdk = 'true';
            script.addEventListener('load', () => resolve(window.AWS), { once: true });
            script.addEventListener('error', () => reject(new Error('Failed to load AWS SDK')), { once: true });
            document.head.appendChild(script);
        });
    }

    return awsSdkPromise;
}

async function runS3Request(makeRequest) {
    try {
        return await makeRequest();
    } catch (error) {
        throw normalizeS3Error(error);
    }
}

function normalizeS3Error(error) {
    if (error?.code === 'NetworkingError' && /Network Failure/i.test(error.message || '')) {
        const wrapped = new Error('S3 request failed in the browser. Check the bucket CORS policy for this origin.');
        wrapped.code = 'cors';
        wrapped.cause = error;
        return wrapped;
    }

    return error;
}

async function listAll(root) {
    const paths = [];
    let entries;

    try {
        entries = await fs.promises.readdir(root);
    } catch {
        return paths;
    }

    for (const name of entries) {
        const childPath = joinPath(root, name);

        try {
            const nested = await fs.promises.readdir(childPath);
            if (Array.isArray(nested)) {
                paths.push(...await listAll(childPath));
                continue;
            }
        } catch {
            paths.push(childPath);
        }
    }

    return paths;
}

async function readText(path) {
    return fs.promises.readFile(path, { encoding: 'utf8' });
}

async function readBytes(path) {
    return toUint8Array(await fs.promises.readFile(path));
}

async function writeText(path, text) {
    await ensureDir(parentDir(path));
    await fs.promises.writeFile(path, text);
}

async function writeBytes(path, bytes) {
    await ensureDir(parentDir(path));
    await fs.promises.writeFile(path, bytes);
}

async function flushFs() {
    if (typeof fs.flush !== 'function') {
        return;
    }

    await new Promise((resolve, reject) => {
        fs.flush((error) => {
            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });
}

async function removeMany(paths) {
    for (const path of paths) {
        try {
            await fs.promises.unlink(path);
        } catch {
        }
    }
}

async function exists(path) {
    try {
        await fs.promises.stat(path);
        return true;
    } catch {
        return false;
    }
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

async function getHash(path) {
    const bytes = await readBytes(path);
    return getHashForBytes(bytes);
}

async function getHashForBytes(bytes) {
    const SparkMD5 = await loadSparkMd5();
    const normalized = toUint8Array(bytes);
    const buffer = normalized.byteOffset === 0 && normalized.byteLength === normalized.buffer.byteLength
        ? normalized.buffer
        : normalized.buffer.slice(normalized.byteOffset, normalized.byteOffset + normalized.byteLength);
    return SparkMD5.ArrayBuffer.hash(buffer);
}

function toUint8Array(value) {
    if (value instanceof Uint8Array) {
        return value;
    }

    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }

    if (typeof value === 'string') {
        return new TextEncoder().encode(value);
    }

    if (value == null) {
        return new Uint8Array();
    }

    return new Uint8Array(value);
}

function normalizeStoredHash(hash) {
    if (typeof hash !== 'string') {
        return null;
    }

    const value = hash.trim().toLowerCase().replace(/^"|"$/g, '');
    if (!/^[0-9a-f]+$/.test(value) || value.length !== MD5_HEX_LENGTH) {
        return null;
    }

    return value;
}

function loadSparkMd5() {
    if (window.SparkMD5) {
        return Promise.resolve(window.SparkMD5);
    }

    if (!sparkMd5Promise) {
        sparkMd5Promise = new Promise((resolve, reject) => {
            const existing = document.querySelector('script[data-flare-spark-md5]');
            if (existing) {
                existing.addEventListener('load', () => resolve(window.SparkMD5), { once: true });
                existing.addEventListener('error', () => reject(new Error('Failed to load SparkMD5')), { once: true });
                return;
            }

            const script = document.createElement('script');
            script.src = SPARK_MD5_URL;
            script.async = true;
            script.dataset.flareSparkMd5 = 'true';
            script.addEventListener('load', () => resolve(window.SparkMD5), { once: true });
            script.addEventListener('error', () => reject(new Error('Failed to load SparkMD5')), { once: true });
            document.head.appendChild(script);
        });
    }

    return sparkMd5Promise;
}

function hasPendingTasks(tasks) {
    return Object.keys(tasks.upload).length > 0
        || Object.keys(tasks.download).length > 0
        || Object.keys(tasks.localDelete).length > 0
        || Object.keys(tasks.remoteDelete).length > 0;
}

function summarizeTasks(tasks) {
    return [
        'upload=' + Object.keys(tasks.upload).length,
        'download=' + Object.keys(tasks.download).length,
        'localDelete=' + Object.keys(tasks.localDelete).length,
        'remoteDelete=' + Object.keys(tasks.remoteDelete).length
    ].join(', ');
}

function normalizePrefix(prefix) {
    return (prefix || '').replace(/^\/+|\/+$/g, '');
}

function toRemoteKey(filesPrefix, path) {
    return filesPrefix + path.replace(/^\//, '');
}

function joinPath(base, name) {
    return (base === '/' ? '' : base) + '/' + name;
}

function parentDir(path) {
    const parts = path.split('/');
    parts.pop();
    const value = parts.join('/');
    return value || '/';
}

async function readResponseBody(body) {
    if (!body) {
        return new Uint8Array();
    }

    if (body instanceof Uint8Array) {
        return body;
    }

    if (body instanceof ArrayBuffer) {
        return new Uint8Array(body);
    }

    const buffer = await new Response(body).arrayBuffer();
    return new Uint8Array(buffer);
}

function acquireSyncLock() {
    const key = 'flare-sync-lock';
    const now = Date.now();
    const current = localStorage.getItem(key);

    if (current) {
        const timestamp = Number(current);
        if (Number.isFinite(timestamp) && now - timestamp < 30000) {
            return null;
        }
    }

    localStorage.setItem(key, String(now));
    return () => {
        if (localStorage.getItem(key) === String(now)) {
            localStorage.removeItem(key);
        }
    };
}