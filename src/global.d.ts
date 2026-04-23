import type { WebSocketHandler } from 'bun';
import type { ResolvedStatic, WebSocketOptions } from './types';

declare global {
    declare const SERVE_STATIC: boolean;
    declare const EXPOSE_BUN_VERSION: boolean;
    declare const EXPOSE_BUN_REVISION: boolean;
}

export {};
