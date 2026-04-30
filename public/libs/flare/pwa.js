const SHARED_SW_URL = '/public/sw.js';
const SHARED_SW_SCOPE = '/public/';

export function registerPwa(appName) {
    if (!('serviceWorker' in navigator)) {
        return;
    }

    const startRegistration = () => {
        void registerSharedWorker(appName);
    };

    if (document.readyState === 'complete') {
        startRegistration();
        return;
    }

    window.addEventListener('load', startRegistration, { once: true });
}

async function registerSharedWorker(appName) {
    try {
        const registration = await navigator.serviceWorker.register(SHARED_SW_URL, {
            scope: SHARED_SW_SCOPE
        });

        let waitingWorker = registration.waiting;
        const promoteWaitingWorker = () => {
            waitingWorker?.postMessage({ type: 'skip-waiting' });
        };

        registration.addEventListener('updatefound', () => {
            const candidate = registration.installing;
            if (!candidate) {
                return;
            }

            candidate.addEventListener('statechange', () => {
                if (candidate.state === 'installed' && navigator.serviceWorker.controller) {
                    waitingWorker = registration.waiting || candidate;
                }
            });
        });

        window.addEventListener('pagehide', promoteWaitingWorker, { once: true });
        window.addEventListener('beforeunload', promoteWaitingWorker, { once: true });

        void registration.update();
    } catch (error) {
        console.warn('[pwa]', 'registration failed for ' + appName, error);
    }
}