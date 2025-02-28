import type { WebSocketHandler } from 'bun';
import type { ResolvedStatic, WebSocketOptions } from './types';

declare global {
    declare const SERVE_STATIC: boolean;
}

export {};
