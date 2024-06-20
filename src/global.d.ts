import type { WebSocketHandler } from 'bun';
import type { ResolvedStatic, WebSocketOptions } from './types';

declare global {
    declare const CLI_NAME: string | undefined;
    declare const PRE_RESOLVE_STATIC: [string, ResolvedStatic][];

    declare const WEBSOCKET_OPTIONS: WebSocketOptions;
}
