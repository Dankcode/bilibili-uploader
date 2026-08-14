import { register } from 'node:module';

register('./extension_loader.mjs', import.meta.url);
