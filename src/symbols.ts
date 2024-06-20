import { name as adapterName } from '../package.json';

export const symServer: unique symbol = Symbol.for(`${adapterName}/server`);
export const symUpgrades: unique symbol = Symbol.for(`${adapterName}/upgrades`);
