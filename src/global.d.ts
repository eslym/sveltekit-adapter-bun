import type { WebSocketHandler } from 'bun';
import type { ResolvedStatic, WebSocketOptions } from './types';

declare global {
    declare const PRE_RESOLVE_STATIC: [string, ResolvedStatic][];
}
