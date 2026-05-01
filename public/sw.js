const CACHE_VERSION = 'v0.6.0';
const CACHE_NAME = 'flare-shell-' + CACHE_VERSION;
const APP_SHELLS = {
    '/public/apps/explorer/': '/public/apps/explorer/index.html',
    '/public/apps/explorer/index.html': '/public/apps/explorer/index.html',
    '/public/apps/app2/': '/public/apps/app2/index.html',
    '/public/apps/app2/index.html': '/public/apps/app2/index.html',
    '/public/apps/urnal/': '/public/apps/urnal/index.html',
    '/public/apps/urnal/index.html': '/public/apps/urnal/index.html',
    '/public/apps/carbon/': '/public/apps/carbon/index.html',
    '/public/apps/carbon/index.html': '/public/apps/carbon/index.html',
    '/public/apps/sync/': '/public/apps/sync/index.html',
    '/public/apps/sync/index.html': '/public/apps/sync/index.html'
};
const PRECACHE_URLS = [
    '/public/apps/explorer/',
    '/public/apps/explorer/index.html',
    '/public/apps/explorer/manifest.webmanifest',
    '/public/apps/explorer/icon.svg',
    '/public/apps/explorer/explorer.css',
    '/public/apps/explorer/explorer.js',
    '/public/apps/app2/',
    '/public/apps/app2/index.html',
    '/public/apps/app2/manifest.webmanifest',
    '/public/apps/app2/icon.svg',
    '/public/apps/urnal/',
    '/public/apps/urnal/index.html',
    '/public/apps/urnal/manifest.webmanifest',
    '/public/apps/urnal/icon.svg',
    '/public/apps/carbon/',
    '/public/apps/carbon/index.html',
    '/public/apps/carbon/manifest.webmanifest',
    '/public/apps/carbon/icon.svg',
    '/public/apps/carbon/carbon.js',
    '/public/apps/carbon/codemirror-carbon.js',
    '/public/libs/codemirror.js',
    '/public/apps/sync/',
    '/public/apps/sync/index.html',
    '/public/apps/sync/manifest.webmanifest',
    '/public/apps/sync/icon.svg',
    '/public/apps/sync/sync.js',
    '/public/apps/sync/syncbar.js',
    '/public/libs/fontawesome/css/fontawesome.min.css',
    '/public/libs/fontawesome/css/solid.min.css',
    '/public/libs/fontawesome/webfonts/fa-solid-900.woff2',
    '/public/libs/fontawesome/webfonts/fa-solid-900.ttf',
    '/public/libs/flare/fs.js',
    '/public/libs/flare/pwa.js',
    '/public/libs/lightning-fs.bundle.mjs',
    '/public/libs/buffer.mjs',
    '/public/libs/aws-sdk.min.js',
    '/public/libs/spark-md5.min.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(PRECACHE_URLS);
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((cacheName) => {
            if (cacheName === CACHE_NAME || !cacheName.startsWith('flare-shell-')) {
                return Promise.resolve();
            }

            return caches.delete(cacheName);
        }));
    })());
});

self.addEventListener('message', (event) => {
    if (event.data?.type === 'skip-waiting') {
        void self.skipWaiting();
    }
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') {
        return;
    }

    const url = new URL(request.url);
    if (url.origin !== self.location.origin || !url.pathname.startsWith('/public/')) {
        return;
    }

    if (request.mode === 'navigate') {
        event.respondWith(handleNavigation(request, url));
        return;
    }

    event.respondWith(staleWhileRevalidate(request));
});

async function handleNavigation(request, url) {
    const fallbackPath = APP_SHELLS[url.pathname];
    const cache = await caches.open(CACHE_NAME);

    try {
        const response = await fetch(request);
        if (response.ok) {
            await cache.put(request, response.clone());
            if (fallbackPath) {
                await cache.put(fallbackPath, response.clone());
            }
        }
        return response;
    } catch {
        const cached = await cache.match(request);
        if (cached) {
            return cached;
        }

        if (fallbackPath) {
            const fallback = await cache.match(fallbackPath);
            if (fallback) {
                return fallback;
            }
        }

        throw new Error('offline');
    }
}

async function staleWhileRevalidate(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    const networkPromise = fetch(request)
        .then(async (response) => {
            if (response.ok) {
                await cache.put(request, response.clone());
            }
            return response;
        })
        .catch(() => null);

    if (cached) {
        void networkPromise;
        return cached;
    }

    const response = await networkPromise;
    if (response) {
        return response;
    }

    throw new Error('offline');
}
