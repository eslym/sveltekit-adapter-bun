import './server';
import { set_basepath } from './utils';
import type { WebSocketHandler } from '../types';
import { create_fetch } from './handle';
import type { WebSocketHandler as BunWSHandler } from 'bun';
import { bool_env, bytes_env, duration_env, http_env, int_env, ws_env } from './env';

set_basepath(import.meta.dir);

async function serve() {
    const socket = http_env('SOCKET');
    const serverOptions = socket
        ? {
              unix: socket
          }
        : {
              hostname: http_env('HOST', '0.0.0.0'),
              port: http_env('PORT', '3000')
          };

    const server = Bun.serve({
        ...serverOptions,
        idleTimeout: duration_env(http_env, 'IDLE_TIMEOUT', 30),
        maxRequestBodySize: bytes_env(http_env, 'MAX_BODY', 128 * 1024 * 1024),
        fetch: create_fetch({
            overrideOrigin: http_env('OVERRIDE_ORIGIN'),
            hostHeader: http_env('HOST_HEADER'),
            protocolHeader: http_env('PROTOCOL_HEADER'),
            ipHeader: http_env('IP_HEADER'),
            xffDepth: int_env(http_env, 'XFF_DEPTH', 1)
        }),
        websocket: {
            idleTimeout: duration_env(ws_env, 'IDLE_TIMEOUT', 120),
            maxPayloadLength: bytes_env(ws_env, 'MAX_PAYLOAD', 16 * 1024 * 1024),
            sendPings: !bool_env(ws_env, 'NO_PING'),
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
