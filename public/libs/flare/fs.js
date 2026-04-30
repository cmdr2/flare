import LightningFS from 'https://esm.sh/@isomorphic-git/lightning-fs@4.6.2?bundle';

export const FS_NAME = '/sda1';
export const fs = new LightningFS(FS_NAME);

export { LightningFS };
export default fs;