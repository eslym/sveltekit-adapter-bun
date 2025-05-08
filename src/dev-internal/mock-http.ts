import { IncomingMessage, ServerResponse, type OutgoingHttpHeaders } from 'http';
import type { Socket } from 'net';
import { Duplex, PassThrough, Readable } from 'stream';
import type { Plugin } from 'vite';

const kReq = Symbol.for('::adapter-bun::request::');
const kRes = Symbol.for('::adapter-bun::response::');

function defineGetter<T, K extends keyof T>(object: T, property: K, getter: () => T[K]) {
    Object.defineProperty(object, property, { get: getter });
}

export function mockNodeRequest(
    request: Request,
    server: Bun.Server
): {
    req: IncomingMessage;
    res: ServerResponse;
    promise: Promise<Response>;
    reject: (err: any) => void;
} {
    const remote = server.requestIP(request)!;

    const readable = new Readable({ read() {} });
    const writable = new PassThrough();

    const mockSocket = Duplex.from({ readable, writable }) as any as Socket;

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

    async function* read() {
        if (!request.body) {
            readable.push(null);
            return;
        }
        const reader = request.body.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            readable.push(value);
            yield value;
        }
        readable.push(null);
    }

    (req as any)[kReq] = new Request(request.url, {
        headers: request.headers,
        method: request.method,
        body: new Response(read() as any).body,
        signal: request.signal
    });

    const { promise, resolve, reject } = Promise.withResolvers<Response>();

    const headers = new Headers(request.headers);
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

    (writable as any).getHeader = (name: string) => {
        return headers.get(name);
    };

    (writable as any).writeHead = (statusCode: number) => {
        if (!headers.has('content-type')) {
            headers.set('content-type', Bun.file(url.pathname).type);
        }
        const body = Readable.toWeb(writable);
        const response = new Response(body as any, {
            status: statusCode,
            headers: headers
        });
        headerSent = true;
        resolve(response);
    };

    (writable as any)[kRes] = resolve;

    const old_write = writable._write.bind(writable);

    writable._write = (...args: any[]) => {
        if (!headerSent) {
            (writable as any).statusCode ??= 200;
            (writable as any).writeHead((writable as any).statusCode);
        }
        (old_write as any)(...args);
    };

    const old_end = writable.end.bind(writable);
    (writable as any).end = (...args: any[]) => {
        if (!headerSent) {
            (writable as any).statusCode ??= 200;
            (writable as any).writeHead((writable as any).statusCode);
        }
        (old_end as any)(...args);
    };

    return {
        req,
        res: writable as any,
        promise,
        reject
    };
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
    const getReq = src.indexOf('export async function getRequest');
    const getReqStart = src.indexOf('\n', getReq);

    const setRes = src.indexOf('export async function setResponse');
    const setResStart = src.indexOf('\n', setRes);

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
