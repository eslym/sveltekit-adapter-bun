import { dirname, join } from 'path';
import { EventEmitter } from 'events';
import { IncomingMessage, ServerResponse } from 'http';
import type { Server, WebSocketHandler as BunWSHandler } from 'bun';
import type { WebSocketHandler } from './types';
import { symServer, symUpgrades } from './symbols';

const getRequestPatch = `
	if(Symbol.for('::bunternal::') in request.socket) {
		return request.socket[Symbol.for('::bunternal::')][2];
	}
`;

const setResponsePatch = `
	if('Bun' in globalThis && '_reply' in res) {
		res._reply(response);
		return;
	}
`;

const bunternal = Symbol.for('::bunternal::');

const setupBunternal: (
    socket: any,
    bunServer: any,
    httpServer: any,
    httpReq: any,
    bunReq: any
) => void = Bun.semver.satisfies(Bun.version, '<1.1.25')
    ? (socket, bunServer, _, httpReq, bunReq) => {
          socket[bunternal] = [bunServer, httpReq, bunReq];
      }
    : (socket, _, httpServer, httpReq, bunReq) => {
          socket[bunternal] = [httpServer, httpReq, bunReq];
      };

export async function patchSveltekit() {
    if (!('Bun' in globalThis)) {
        throw new Error('Please run with bun');
    }
    if (Bun.semver.satisfies(Bun.version, '<1.1.15')) {
        throw new Error('bun patch requires Bun >= 1.1.15');
    }
    const bun = process.execPath;
    const sveltekit = dirname(Bun.resolveSync('@sveltejs/kit/package.json', process.cwd()));
    const { version } = await Bun.file(join(sveltekit, 'package.json')).json();
    const exportNode = join(sveltekit, 'src/exports/node/index.js');

    const src = await Bun.file(exportNode).text();

    if (src.includes('::bunternal::')) {
        console.log('No patched required.');
        return;
    }

    await Bun.$`${bun} patch @sveltejs/kit@${version}`;
    const getReq = src.indexOf('export async function getRequest');
    const getReqStart = src.indexOf('\n', getReq);

    const setRes = src.indexOf('export async function setResponse');
    const setResStart = src.indexOf('\n', setRes);

    const patched = src
        .slice(0, getReqStart)
        .concat(getRequestPatch)
        .concat(src.slice(getReqStart, setResStart))
        .concat(setResponsePatch)
        .concat(src.slice(setResStart));

    await Bun.write(exportNode, patched);
    console.log('Patched @sveltejs/kit/node');

    await Bun.$`${bun} patch --commit 'node_modules/@sveltejs/kit'`;
}

export async function startDevServer({
    port = 5173,
    host = 'localhost',
    config
}: { port?: number; host?: string; config?: string } = {}) {
    if (!('Bun' in globalThis)) {
        throw new Error('Please run with bun');
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

    const fakeServer = new EventEmitter();

    const vite = await createServer({
        configFile: config,
        server: {
            hmr: {
                server: fakeServer as any
            },
            middlewareMode: true
        },
        appType: 'custom'
    });

    const hooks = await vite
        .ssrLoadModule('./src/hooks.server.ts')
        .catch(() => ({}) as Record<string, any>);

    await hooks.beforeServe?.();

    const server = Bun.serve({
        hostname: host,
        port,
        async fetch(request: Request, server: Server) {
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
            const res = new (ServerResponse as any)(req, respond);

            const socket = req.socket as any;
            setupBunternal(socket, server, fakeServer, req, request);

            req.once('error', raise);
            res.once('error', raise);

            if (request.headers.get('upgrade')) {
                if (request.headers.get('sec-websocket-protocol') === 'vite-hmr') {
                    fakeServer.emit('upgrade', req, socket, Buffer.alloc(0));
                    return;
                }
            }

            vite.middlewares(req, res, (err: any) => {
                if (err) {
                    vite.ssrFixStacktrace(err);
                    raise(err);
                }
            });

            const response = await promise;

            if (upgrades.has(response)) {
                const ws = upgrades.get(response)!;
                if (server.upgrade(request, { data: ws, headers: response.headers })) {
                    return undefined;
                }
            }

            return response;
        },
        websocket: {
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
    });

    (fakeServer as any)[bunternal] = server;

    (globalThis as any)[symServer] = server;

    await hooks.afterServe?.(server);

    console.log(`Serving on ${server.url}`);
}
