import { name as adapterName } from '../package.json';

export const symServer: unique symbol = Symbol.for(`${adapterName}/server`);
export const symUpgrades: unique symbol = Symbol.for(`${adapterName}/upgrades`);

export const symUpgraded: unique symbol = Symbol.for(`${adapterName}/upgraded`);

/**
 * The dev server and the adapter are loaded through different module graphs
 * (the adapter is imported by vite while resolving the config, the dev server
 * is run by bun directly), so anything they share has to live on `globalThis`
 * behind a registered symbol rather than in a module-level binding.
 */
export const symDevBridge: unique symbol = Symbol.for(`${adapterName}/dev-bridge`);
