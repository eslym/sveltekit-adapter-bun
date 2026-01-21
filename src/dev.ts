import { EventEmitter } from 'events';
import { IncomingMessage, ServerResponse } from 'http';
import type { Server, WebSocketHandler as BunWSHandler } from 'bun';
import type { DevServeOptions, WebSocketHandler } from './types';
import { symServer, symUpgrades } from './symbols';
import type { ViteDevServer } from 'vite';
import {
    bunternal,
    bunternalPlugin,
    patchBunternal,
    setupBunternal
} from './dev-internal/bunternal';
import { satisfies } from './dev-internal/version';
import { mockedHttpPlugin, mockNodeRequest, patchMockHttp } from './dev-internal/mock-http';

export async function patchSveltekit() {
    console.log(
        'Now patchSveltekit function uses Bun plugin instead of bun patch,\nyou can now safely remove all patches to @sveltejs/kit in package.json'
    );
    Bun.plugin({
        name: 'bun-patch-sveltekit',
        setup(build) {
            build.onLoad(
                { filter: /\/@sveltejs\/kit\/src\/exports\/node\/index\.js$/ },
                async (args) => {
                    const src = await Bun.file(args.path).text();
                    return {
                        contents: satisfies('<1.2.5') ? patchBunternal(src) : patchMockHttp(src)
                    };
                }
            );
        }
    });
}

export async function startDevServer({
    port = 5173,
    host = 'localhost',
    idleTimeout = 30,
    config,
    websocket = {} as any,
    hmrPort = undefined,
    ...serveOptions
}: DevServeOptions & {
    port?: number;
    host?: string;
    config?: string;
} = {}) {
    if (!('Bun' in globalThis)) {
        throw new Error('Please run with bun');
    }
    if (satisfies('>=1.2.6') && !hmrPort) {
        throw new Error('hmrPort must be specified when using Bun >= 1.2.6.');
    }

    if (!config) {
        for (const cfg of [
            'vite.config.ts',
            'vite.config.js',
            'vite.config.cjs',
            'vite.config.mjs'
        ]) {
            if (Bun.file(cfg).size) {
                config = cfg;
                break;
            }
        }
    }
    if (!config) {
        throw new Error('No config file found.');
    }
    const { createServer } = await import('vite');

    const upgrades = new WeakMap<Response, WebSocketHandler>();

    (globalThis as any)[symUpgrades] = upgrades;

    const mockServer = new EventEmitter();

    const vite = await createServer({
        configFile: config,
        server: {
            hmr: satisfies('<1.2.6')
                ? {
                      server: mockServer as any
                  }
                : {
                      port: hmrPort
                  },
            middlewareMode: true,
        },
        appType: 'custom',
        plugins: [satisfies('<1.2.5') ? bunternalPlugin : mockedHttpPlugin]
    });

    const hooks = await vite
        .ssrLoadModule('./src/hooks.server.ts')
        .catch(() => ({}) as Record<string, any>);

    await hooks.beforeServe?.();

    const getResponse = satisfies('<1.2.6') ? legacyReqRes : mockedReqRes;

    const server = Bun.serve({
        ...serveOptions,
        hostname: host,
        port,
        idleTimeout,
        async fetch(request: Request, server: Server<WebSocketHandler>) {
            const response = await getResponse(vite, request, server, mockServer);

            if (!response) return;

            if (upgrades.has(response)) {
                const ws = upgrades.get(response)!;
                if (server.upgrade(request, { data: ws, headers: response.headers })) {
                    return;
                }
            }

            return response;
        },
        websocket: {
            ...websocket,
            open(ws) {
                return ws.data.open?.(ws);
            },
            message(ws, message) {
                return ws.data.message(ws, message);
            },
            drain(ws) {
                return ws.data.drain?.(ws);
            },
            close(ws, code, reason) {
                return ws.data.close?.(ws, code, reason);
            },
            ping(ws, buffer) {
                return ws.data.ping?.(ws, buffer);
            },
            pong(ws, buffer) {
                return ws.data.pong?.(ws, buffer);
            }
        } as BunWSHandler<WebSocketHandler>
    } as any);

    (mockServer as any)[bunternal] = server;

    (globalThis as any)[symServer] = server;

    await hooks.afterServe?.(server);

    console.log(`Serving on ${server.url}`);
}

function legacyReqRes(
    vite: ViteDevServer,
    request: Request,
    server: Server<WebSocketHandler>,
    mockServer: EventEmitter
) {
    let pendingResponse: Response | undefined;
    let pendingError: Error | undefined;

    const { promise, resolve, reject } = Promise.withResolvers<Response>();

    function raise(err: any) {
        if (pendingError) return;
        reject((pendingError = err));
    }

    function respond(res: Response) {
        if (pendingResponse) return;
        resolve((pendingResponse = res));
    }

    const req = new IncomingMessage(request as any);
    const res = new (ServerResponse as any)(req, respond) as ServerResponse;

    const socket = req.socket as any;
    setupBunternal(socket, server, mockServer, res, request);

    req.once('error', raise);
    res.once('error', raise);

    if (request.headers.get('upgrade')) {
        if (request.headers.get('sec-websocket-protocol') === 'vite-hmr') {
            mockServer.emit('upgrade', req, socket, Buffer.alloc(0));
            return;
        }
    }

    vite.middlewares(req, res, (err: any) => {
        if (err) {
            vite.ssrFixStacktrace(err);
            raise(err);
        }
    });

    return promise;
}

function mockedReqRes(vite: ViteDevServer, request: Request, server: Server<WebSocketHandler>) {
    const { req, res, promise, reject } = mockNodeRequest(request, server);

    vite.middlewares(req, res, (err: any) => {
        if (err) {
            vite.ssrFixStacktrace(err);
            reject(err);
        }
    });

    return promise;
}
