import LightningFS from '/public/vendor/lightning-fs.bundle.mjs';

export const FS_NAME = '/sda1';
export const fs = new LightningFS(FS_NAME);

export { LightningFS };
export default fs;