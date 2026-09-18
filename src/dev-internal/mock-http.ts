import { IncomingMessage, ServerResponse, type OutgoingHttpHeaders } from 'http';
import type { Socket } from 'net';
import { Duplex, PassThrough, Readable } from 'stream';
import type { Plugin } from 'vite';
import type { WebSocketHandler } from '../types';

export const kReq = Symbol.for('::adapter-bun::request::');
export const kRes = Symbol.for('::adapter-bun::response::');

function defineGetter<T, K extends keyof T>(object: T, property: K, getter: () => T[K]) {
    Object.defineProperty(object, property, { get: getter });
}

export function mockNodeRequest(
    request: Request,
    server: Bun.Server<WebSocketHandler>
): {
    req: IncomingMessage;
    res: ServerResponse;
    promise: Promise<Response>;
    reject: (err: any) => void;
} {
    const remote = server.requestIP(request)!;

    const cloned = request.clone();

    const readable = cloned.body
        ? Readable.fromWeb(cloned.body as any)
        : new Readable({
              read() {
                  this.push(null);
              }
          });
    const writable = new PassThrough();
    
    writable.on('error', (err) => {
        if (Error.isError(err) && (err as any).code === 'ABORT_ERR') return;
        console.error('Writable stream error:', err);
    });

    const mockSocket = Duplex.from({ readable, writable } as any) as any as Socket;
    mockSocket.on('error', (err) => {
        if (Error.isError(err) && (err as any).code === 'ABORT_ERR') return;
        console.error('Mock socket error:', err);
    });

    defineGetter(mockSocket, 'remoteAddress', () => remote.address);
    defineGetter(mockSocket, 'remotePort', () => remote.port);
    defineGetter(mockSocket, 'remoteFamily', () => remote.family);
    defineGetter(mockSocket, 'address', () => () => remote);
    defineGetter(mockSocket, 'localAddress', () => server.hostname);
    defineGetter(mockSocket, 'localPort', () => server.port);
    defineGetter(mockSocket, 'setKeepAlive', () => () => mockSocket);
    defineGetter(mockSocket, 'setTimeout', () => () => mockSocket);
    defineGetter(mockSocket, 'setNoDelay', () => () => mockSocket);
    defineGetter(mockSocket, 'ref', () => () => mockSocket);
    defineGetter(mockSocket, 'unref', () => () => mockSocket);
    defineGetter(mockSocket, 'encrypted' as any, () => server.url.protocol === 'https:');

    const req = new IncomingMessage(mockSocket);
    req.socket = mockSocket;

    const url = new URL(request.url);

    req.method = request.method;
    req.url = url.pathname + url.search;
    req.headers = {};

    request.headers.forEach((value, name) => {
        req.headers[name] = value;
    });

    (req as any)[kReq] = request;

    const { promise, resolve, reject } = Promise.withResolvers<Response>();

    const headers = new Headers();
    let headerSent = false;

    (writable as any).setHeader = (name: string, value: string | number | string[]) => {
        headers.delete(name);
        if (Array.isArray(value)) {
            for (const v of value) {
                headers.append(name, v);
            }
        } else {
            headers.set(name, `${value}`);
        }
    };

    (writable as any).appendHeader = (name: string, value: string | number | string[]) => {
        if (Array.isArray(value)) {
            for (const v of value) {
                headers.append(name, v);
            }
        } else {
            headers.append(name, `${value}`);
        }
    };

    (writable as any).getHeader = (name: string) => {
        return headers.get(name) ?? undefined;
    };

    (writable as any).getHeaders = () => Object.fromEntries(headers.entries());

    (writable as any).getHeaderNames = () => [...headers.keys()];

    (writable as any).hasHeader = (name: string) => headers.has(name);

    (writable as any).removeHeader = (name: string) => {
        headers.delete(name);
    };

    Object.defineProperty(writable, 'headersSent', { get: () => headerSent });

    (writable as any).req = req;

    // node's signature is `writeHead(status, statusMessage?, headers?)`, and
    // sveltekit's dev middleware uses the headers form for the service worker
    // and the error page. Dropping the argument served both without their
    // content-type.
    (writable as any).writeHead = (
        statusCode: number,
        statusMessage?: string | OutgoingHttpHeaders,
        headersArg?: OutgoingHttpHeaders
    ) => {
        const extra = typeof statusMessage === 'string' ? headersArg : statusMessage;
        if (extra) {
            for (const [name, value] of Object.entries(extra)) {
                if (value === undefined) continue;
                (writable as any).setHeader(name, value as string | number | string[]);
            }
        }
        const body = Readable.toWeb(writable);
        const response = new Response(body as any, {
            status: statusCode,
            headers: headers
        });
        headerSent = true;
        resolve(response);
        return writable;
    };

    (writable as any)[kRes] = resolve;

    const old_write = writable._write.bind(writable);

    writable._write = (...args: any[]) => {
        if (!headerSent) {
            (writable as any).statusCode ??= 200;
            (writable as any).writeHead((writable as any).statusCode);
            writable._write = old_write;
            writable.end = old_end;
        }
        (old_write as any)(...args);
    };

    const old_end = writable.end.bind(writable);
    (writable as any).end = (...args: any[]) => {
        if (!headerSent) {
            (writable as any).statusCode ??= 200;
            (writable as any).writeHead((writable as any).statusCode);
            writable._write = old_write;
            writable.end = old_end;
        }
        (old_end as any)(...args);
        return writable;
    };

    return {
        req,
        res: writable as any,
        promise,
        reject
    };
}

/**
 * Find the end of the signature line of an exported function, so a statement
 * can be injected at the top of its body. `getRequest` and `setResponse` are
 * `async` on sveltekit 2 and synchronous on sveltekit 3, so match both.
 */
export function body_start(src: string, name: string) {
    const match = new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b`).exec(src);
    if (!match) {
        throw new Error(
            `[adapter-bun] could not find \`${name}\` in @sveltejs/kit/node, this version of sveltekit is not supported by the dev server.`
        );
    }
    return src.indexOf('\n', match.index);
}

export function patchMockHttp(src: string) {
    const getRequestPatch = `
    if(Symbol.for('::adapter-bun::request::') in request) {
        return request[Symbol.for('::adapter-bun::request::')];
    }
`;

    const setResponsePatch = `
    if(Symbol.for('::adapter-bun::response::') in res) {
        res[Symbol.for('::adapter-bun::response::')](response);
        return;
    }
`;
    const getReqStart = body_start(src, 'getRequest');
    const setResStart = body_start(src, 'setResponse');

    return src
        .slice(0, getReqStart)
        .concat(getRequestPatch)
        .concat(src.slice(getReqStart, setResStart))
        .concat(setResponsePatch)
        .concat(src.slice(setResStart));
}

export const mockedHttpPlugin: Plugin = {
    name: 'sveltekit-adapter-bun/mocked-http',
    transform(src, id, options) {
        if (!options?.ssr) return;
        if (!id.endsWith('/node_modules/@sveltejs/kit/src/exports/node/index.js')) return;

        return {
            code: patchMockHttp(src)
        };
    }
};
