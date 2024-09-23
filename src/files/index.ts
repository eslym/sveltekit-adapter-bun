import './server';
import cac from 'cac';
import { set_basepath } from './utils';
import type { ServeOptions, WebSocketHandler } from '../types';
import { create_fetch } from './handle';
import type { WebSocketHandler as BunWSHandler } from 'bun';

import { get_hooks } from 'SERVER';

set_basepath(import.meta.dir);

const hooks = await get_hooks();

export const cli = cac(CLI_NAME);

const env = Bun.env;

cli.command('', 'Serve the app')
    .alias('serve')
    .option('--port, -p <port>', 'Port to listen on', { default: env.HTTP_PORT || 3000 })
    .option('--host, -h <host>', 'Host to listen on', { default: env.HTTP_HOST || '0.0.0.0' })
    .option('--unix-socket, -u <unix-socket>', 'Serve on a unix socket instead.', {
        default: env.HTTP_SOCKET
    })
    .option('--protocol-header, -P <protocol-header>', 'Protocol header to use', {
        default: env.HTTP_PROTOCOL_HEADER
    })
    .option('--override-origin, -O <override-origin>', 'Override the origin', {
        default: env.HTTP_OVERRIDE_ORIGIN
    })
    .option('--host-header, -H <host-header>', 'Host header to use', {
        default: env.HTTP_HOST_HEADER
    })
    .option('--ip-header, -i <ip-header>', 'IP header to use', { default: env.HTTP_IP_HEADER })
    .option('--xff-depth, -x <xff-depth>', 'X-Forwarded-For depth', { default: env.HTTP_XFF_DEPTH })
    .action(async (options: ServeOptions) => {
        await hooks.beforeServe?.(options);
        const serverOptions = options.unixSocket
            ? {
                  unix: options.unixSocket
              }
            : {
                  hostname: options.host,
                  port: options.port
              };
        const server = Bun.serve({
            ...serverOptions,
            fetch: create_fetch(options),
            websocket: {
                ...WEBSOCKET_OPTIONS,
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
        await hooks.afterServe?.(server, options);
        console.log(`Serving on ${server.url}`);
    });

cli.help();

await hooks.setupCLI?.(cli);

if (Bun.main === Bun.fileURLToPath(import.meta.url)) {
    cli.parse();
}
