import './server';
import { set_basepath } from './utils';
import type { WebSocketHandler } from '../types';
import { create_fetch } from './handle';
import type { WebSocketHandler as BunWSHandler } from 'bun';
import { get_env } from './env';

set_basepath(import.meta.dir);

async function serve() {
    const optionFile = get_env('SERVE_OPTIONS', './serve.json');
    const opts = await Bun.file(optionFile)
        .json()
        .catch(() => ({}));

    const socket = get_env('SOCKET');
    const serverOptions = socket
        ? {
              unix: socket
          }
        : {
              hostname: get_env('HOST', '0.0.0.0'),
              port: get_env('PORT', '3000')
          };

    const xffDepth = get_env('XFF_DEPTH');
    const server = Bun.serve({
        ...opts,
        ...serverOptions,
        fetch: create_fetch({
            overrideOrigin: get_env('OVERRIDE_ORIGIN'),
            hostHeader: get_env('HOST_HEADER'),
            protocolHeader: get_env('PROTOCOL_HEADER'),
            ipHeader: get_env('IP_HEADER'),
            xffDepth: xffDepth ? parseInt(xffDepth) : undefined
        }),
        websocket: {
            ...(opts.websocket ?? {}),
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
