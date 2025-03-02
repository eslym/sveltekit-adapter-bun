#!/usr/bin/env bun
import './server';
import type { WebSocketHandler } from '../types';
import { create_fetch } from './handle';
import type { WebSocketHandler as BunWSHandler } from 'bun';
import { bool_env, bytes_env, duration_env, get_env, int_env } from './env';
import { resolve } from 'path';

Bun.plugin({
    name: 'asset-module',
    target: 'bun',
    setup(build) {
        build.module('sveltekit-adapter-bun:assets', async () => ({
            loader: 'object',
            exports: await import(resolve(import.meta.dir, './assets'))
        }));
    }
});

async function serve() {
    const socket = get_env('HTTP_SOCKET');
    const serverOptions = socket
        ? {
              unix: socket
          }
        : {
              hostname: get_env('HTTP_HOST', '0.0.0.0'),
              port: get_env('HTTP_PORT', '3000')
          };

    const server = Bun.serve({
        ...serverOptions,
        idleTimeout: duration_env('HTTP_IDLE_TIMEOUT', 30),
        maxRequestBodySize: bytes_env('HTTP_MAX_BODY', 128 * 1024 * 1024),
        fetch: await create_fetch({
            overrideOrigin: get_env('HTTP_OVERRIDE_ORIGIN'),
            hostHeader: get_env('HTTP_HOST_HEADER'),
            protocolHeader: get_env('HTTP_PROTOCOL_HEADER'),
            ipHeader: get_env('HTTP_IP_HEADER'),
            xffDepth: int_env('HTTP_XFF_DEPTH', 1)
        }),
        websocket: {
            idleTimeout: duration_env('WS_IDLE_TIMEOUT', 120),
            maxPayloadLength: bytes_env('WS_MAX_PAYLOAD', 16 * 1024 * 1024),
            sendPings: !bool_env('WS_NO_PING'),
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
        } as BunWSHandler<WebSocketHandler>
    });
    console.log(`Serving on ${server.url}`);
}

if (Bun.main === Bun.fileURLToPath(import.meta.url)) {
    serve();
}

export { create_fetch as createBunFetch };
