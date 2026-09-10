import type { WebSocketHandler } from 'bun';
import type { ResolvedStatic, PureWebSocketOptions } from './types';

declare global {
    declare const SERVE_STATIC: boolean;
    declare const CUSTOM_LAUNCH: boolean;
    declare const EXPOSE_BUN_VERSION: boolean;
    declare const EXPOSE_BUN_REVISION: boolean;
}

export {};
