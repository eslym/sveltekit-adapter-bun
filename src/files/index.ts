#!/usr/bin/env bun
import './server';
import type { WebSocketHandler } from '../types';
import { create_fetch } from './handle';
import type { WebSocketHandler as BunWSHandler } from 'bun';
import { bool_env, bytes_env, duration_env, get_env, int_env } from './env';
import { name } from '../../package.json';
import { create_blocklist } from './trustedproxy';

export const websocketHandler = {
    message(ws, message) {
        return ws.data.message(ws, message);
    },
    open(ws) {
        return ws.data.open?.(ws);
    },
    close(ws, code, reason) {
        return ws.data.close?.(ws, code, reason);
    },
    ping(ws, data) {
        return ws.data.ping?.(ws, data);
    },
    pong(ws, data) {
        return ws.data.pong?.(ws, data);
    },
    drain(ws) {
        return ws.data.drain?.(ws);
    }
} as BunWSHandler<WebSocketHandler>;

export function serveOptions() {
    const socket = get_env('HTTP_SOCKET');
    const serverOptions = socket
        ? {
              unix: socket
          }
        : {
              hostname: get_env('HTTP_HOST', '0.0.0.0'),
              port: get_env('HTTP_PORT', '3000')
          };

    return {
        ...serverOptions,
        idleTimeout: duration_env('HTTP_IDLE_TIMEOUT', 30),
        maxRequestBodySize: bytes_env('HTTP_MAX_BODY', 128 * 1024 * 1024)
    };
}

export function websocketOptions() {
    return {
        idleTimeout: duration_env('WS_IDLE_TIMEOUT', 120),
        maxPayloadLength: bytes_env('WS_MAX_PAYLOAD', 16 * 1024 * 1024),
        sendPings: !bool_env('WS_NO_PING')
    };
}

export function serve() {
    const server = Bun.serve({
        ...serveOptions(),
        fetch: create_fetch({
            overrideOrigin: get_env('HTTP_OVERRIDE_ORIGIN'),
            hostHeader: get_env('HTTP_HOST_HEADER'),
            protocolHeader: get_env('HTTP_PROTOCOL_HEADER'),
            ipHeader: get_env('HTTP_IP_HEADER'),
            xffDepth: int_env('HTTP_XFF_DEPTH', 1),
            trustedProxies: get_env('HTTP_TRUSTED_PROXIES')?.trim()
                ? create_blocklist(
                      get_env('HTTP_TRUSTED_PROXIES')!
                          .split(',')
                          .map((s) => s.trim())
                  )
                : undefined
        }),
        websocket: {
            ...websocketOptions(),
            ...websocketHandler
        }
    } as any);
    console.log(`Serving on ${server.url}`);
}

(globalThis as any)[Symbol.for(`${name}::root`)] = import.meta.dirname;

if (Bun.main === Bun.fileURLToPath(import.meta.url)) {
    serve();
}

export { create_fetch as createBunFetch };
