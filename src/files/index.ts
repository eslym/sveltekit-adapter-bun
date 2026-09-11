import type { WebSocketHandler } from '../types';
import { create_fetch } from './handle';
import type { WebSocketHandler as BunWSHandler } from 'bun';
import { bool_env, bytes_env, duration_env, get_env, int_env } from './env';
import { create_blocklist } from './trustedproxy';
import { init_server } from './server';

const websocketHandler = {
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

function serveOptions() {
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
        http2: bool_env('HTTP_2', false),
        idleTimeout: duration_env('HTTP_IDLE_TIMEOUT', 30),
        maxRequestBodySize: bytes_env('HTTP_MAX_BODY', 128 * 1024 * 1024)
    };
}

function websocketOptions() {
    return {
        idleTimeout: duration_env('WS_IDLE_TIMEOUT', 120),
        maxPayloadLength: bytes_env('WS_MAX_PAYLOAD', 16 * 1024 * 1024),
        sendPings: !bool_env('WS_NO_PING')
    };
}

function tlsOptions() {
    const cert = get_env('TLS_CERT_FILE');
    const key = get_env('TLS_KEY_FILE');
    if (!cert || !key) {
        if (cert || key) {
            console.warn(
                '[adapter-bun] TLS_CERT_FILE and TLS_KEY_FILE must both be set. TLS disabled.'
            );
        }
        return {};
    }
    const ca = get_env('TLS_CA_FILE');
    const passphrase = get_env('TLS_PASSPHRASE');
    return {
        tls: {
            cert: Bun.file(cert),
            key: Bun.file(key),
            ...(ca ? { ca: Bun.file(ca) } : {}),
            ...(passphrase ? { passphrase } : {})
        }
    };
}

function createBunOptions() {
    return {
        ...serveOptions(),
        ...tlsOptions(),
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
    } as any;
}

function serve() {
    const server = Bun.serve(createBunOptions());
    console.log(`Serving on ${server.url}`);
    return server;
}

export const main = CUSTOM_LAUNCH
    ? async () => {
          await init_server(import.meta.dirname);
          //@ts-expect-error
          const { launch } = await import('../entries/hooks.server.js');
          await launch({ serve, createBunOptions, createBunFetch: create_fetch, websocketHandler });
      }
    : async () => {
          await init_server(import.meta.dirname);
          serve();
      };

if (EXPOSE_BUN_VERSION) {
    process.env.PUBLIC_BUN_VERSION = Bun.version;
    Bun.env.PUBLIC_BUN_VERSION = Bun.version;
}
if (EXPOSE_BUN_REVISION) {
    process.env.PUBLIC_BUN_REVISION = Bun.revision;
    Bun.env.PUBLIC_BUN_REVISION = Bun.revision;
}
