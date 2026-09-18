import { EventEmitter } from 'events';
import { IncomingMessage, ServerResponse } from 'http';
import type { Server, WebSocketHandler as BunWSHandler } from 'bun';
import type { AdapterViteConfig, DevServeOptions, WebSocketHandler } from './types';
import { symServer, symUpgraded, symUpgrades } from './symbols';
import type { Plugin, ViteDevServer } from 'vite';
import {
    bunternal,
    bunternalPlugin,
    patchBunternal,
    setupBunternal
} from './dev-internal/bunternal';
import { satisfies } from './dev-internal/version';
import {
    kReq,
    kRes,
    mockedHttpPlugin,
    mockNodeRequest,
    patchMockHttp
} from './dev-internal/mock-http';
import { import_peer, kit_major } from './utils';
import { devBridge } from './dev-internal/context';

type KitNode = typeof import('@sveltejs/kit/node');

/**
 * Sveltekit 3 lets the adapter replace `getRequest` and `setResponse` through
 * `Adapter.vite`, so bun's own `Request` and `Response` can be handed over
 * without patching `@sveltejs/kit/node` at load time.
 */
function createViteHooks(kit: KitNode): AdapterViteConfig {
    return {
        getRequest(opts) {
            const original = (opts.request as any)[kReq] as Request | undefined;
            if (original) return original;
            return kit.getRequest(opts as any);
        },
        setResponse(res, response) {
            const resolve = (res as any)[kRes] as ((response: Response) => void) | undefined;
            if (resolve) {
                resolve(response);
                return;
            }
            return kit.setResponse(res, response);
        }
    };
}

export async function patchSveltekit() {
    if ((kit_major() ?? 2) >= 3) {
        console.log(
            "patchSveltekit is a no-op on sveltekit 3 — the adapter now hands bun's Request to sveltekit through `Adapter.vite`.\nYou can remove the call from your dev entrypoint."
        );
        return;
    }
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
    exposeBunVersionToClient = false,
    exposeBunRevisionToClient = false,
    ...serveOptions
}: DevServeOptions & {
    port?: number;
    host?: string;
    config?: string;
} = {}) {
    if (!('Bun' in globalThis)) {
        throw new Error('Please run with bun');
    }

    if (exposeBunVersionToClient) {
        process.env.PUBLIC_BUN_VERSION = Bun.version;
        Bun.env.PUBLIC_BUN_VERSION = Bun.version;
    }

    if (exposeBunRevisionToClient) {
        process.env.PUBLIC_BUN_REVISION = Bun.revision;
        Bun.env.PUBLIC_BUN_REVISION = Bun.revision;
    }

    // matches vite's own candidate list; on sveltekit 3 this is the only place
    // the adapter can be configured, so failing to find it is fatal
    const candidates = [
        'vite.config.ts',
        'vite.config.js',
        'vite.config.mjs',
        'vite.config.mts',
        'vite.config.cjs',
        'vite.config.cts'
    ];
    if (!config) {
        for (const cfg of candidates) {
            if (Bun.file(cfg).size) {
                config = cfg;
                break;
            }
        }
    }
    if (!config) {
        throw new Error(
            `No vite config file found in ${process.cwd()}, looked for: ${candidates.join(', ')}.`
        );
    }

    const kit = kit_major() ?? 2;
    const bridge = devBridge();

    if (kit >= 3) {
        if (satisfies('<1.2.6')) {
            throw new Error(
                `Bun v${Bun.version} is too old for the sveltekit 3 dev server, please use bun >= 1.2.6.`
            );
        }
        // has to be registered before the vite config is evaluated, since that
        // is when the adapter builds the object sveltekit reads `vite` from
        bridge.vite = createViteHooks(await import_peer<KitNode>('@sveltejs/kit/node'));
    }

    const { createServer } = await import_peer<typeof import('vite')>('vite');

    const upgrades = new WeakMap<Response, WebSocketHandler>();

    (globalThis as any)[symUpgrades] = upgrades;

    const mockServer = new EventEmitter();

    // on sveltekit 3 the adapter's `vite` hooks replace all of this
    const plugins: Plugin[] =
        kit >= 3 ? [] : [satisfies('<1.2.5') ? bunternalPlugin : mockedHttpPlugin];

    const vite = await createServer({
        configFile: config,
        server: {
            hmr: satisfies('<1.2.6')
                ? {
                      server: mockServer as any
                  }
                : {
                      port: hmrPort ?? 0
                  },
            middlewareMode: true
        },
        appType: 'custom',
        plugins
    });

    const getResponse = satisfies('<1.2.6') ? legacyReqRes : mockedReqRes;

    const server = Bun.serve({
        ...serveOptions,
        hostname: host,
        port,
        idleTimeout,
        async fetch(request: Request, server: Server<WebSocketHandler>) {
            // `Adapter.emulate().platform()` is called by sveltekit without any
            // reference to the request, so carry it through the async context
            const response = await bridge.storage.run({ request, server }, () =>
                getResponse(vite, request, server, mockServer)
            );

            if (!response) return;

            if ((request as any)[symUpgraded]) return;

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
