import LightningFS from '/public/libs/lightning-fs.bundle.mjs';

export const FS_NAME = '/sda1';
export const fs = new LightningFS(FS_NAME);

export async function requestPersistentStorage() {
    if (!globalThis.isSecureContext || !globalThis.navigator?.storage?.persist) {
        return false;
    }

    try {
        return await globalThis.navigator.storage.persist();
    } catch (error) {
        console.warn('[fs]', 'persistent storage request failed', error);
        return false;
    }
}

void requestPersistentStorage();

export { LightningFS };
export default fs;
