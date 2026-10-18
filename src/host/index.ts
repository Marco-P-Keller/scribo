import { createElectronHost } from './electron';
import { createWebHost } from './web';
import type { Host } from './types';

export type AppHost = Host & { launchPaths?: () => Promise<string[]> };

export function createHost(): AppHost {
  return window.scribo ? createElectronHost(window.scribo) : createWebHost();
}
