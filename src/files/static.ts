import { get_url } from './utils';
import { normalize } from 'path/posix';
import { assets, type ResolvedStatic } from 'sveltekit-adapter-bun:assets';

const headersMap = ['last-modified', 'etag', 'content-length'];

const methods = new Set(['HEAD', 'GET']);

function lookup(pathname: string): [false, ResolvedStatic] | [string] | undefined {
    pathname = normalize(pathname);
    let res = assets.get(pathname);
    if (res) return [false, res] as const;
    let tryFiles: string[];
    if (pathname === '/') {
        tryFiles = ['/index.html', '/index.htm'];
    } else {
        const stripped = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
        tryFiles = [
            `${stripped}.html`,
            `${stripped}.htm`,
            `${stripped}/index.html`,
            `${stripped}/index.htm`
        ];
    }
    for (let i = 0; i < tryFiles.length; i++) {
        res = assets.get(tryFiles[i]);
        if (res) return [false, res] as const;
    }
    pathname = pathname.at(-1) === '/' ? pathname.slice(0, -1) : pathname + '/';
    if (assets.has(pathname)) return [pathname];
}

function parse_range(header: Headers): [false] | [true, number, number | null] | false {
    if (!header.has('range')) return false;
    const range = header.get('range')!;
    const match = /^bytes=(?:(\d+)\-(\d+)?|(\-\d+))/.exec(range);
    if (!match) return [false];
    if (match[3]) return [true, +match[3], null];
    return [true, +match[1], match[2] ? +match[2] + 1 : null];
}

function serve(request: Request, basePath: string) {
    if (!methods.has(request.method)) return;
    const url = get_url(request);
    const pathname = decodeURIComponent(url.pathname);
    const res = lookup(pathname);
    if (!res) return;
    if (res[0] !== false) {
        return new Response(null, {
            status: 302,
            headers: {
                location: res[0] + url.search
            }
        });
    }
    const [_, data] = res;
    const headers = new Headers(
        data.headers.map((h, i) => [headersMap[i], h as string] as [string, string])
    );
    const range = parse_range(request.headers);
    const file = data.file;
    headers.set('content-type', file.type);
    if (range) {
        const size = data.headers[2];
        if (!range[0]) {
            headers.set('content-range', `bytes */${size}`);
            headers.set('content-length', '0');
            return new Response(null, {
                status: 416,
                headers
            });
        }
        const [_, rangeStart, rangeEnd] = range;
        let startBytes = 0;
        let endBytes = size;
        if (rangeStart < 0) {
            startBytes = size + rangeStart;
        } else {
            startBytes = rangeStart;
            if (rangeEnd) endBytes = rangeEnd + 1;
        }
        if (endBytes <= startBytes || startBytes < 0 || endBytes > size) {
            headers.set('content-range', `bytes */${size}`);
            headers.set('content-length', '0');
            return new Response(null, {
                status: 416,
                headers
            });
        }
        headers.set('content-range', `bytes ${startBytes}-${endBytes - 1}/${size}`);
        headers.set('content-length', `${endBytes - startBytes}`);
        headers.set('accept-range', 'bytes');
        return new Response(file.slice(startBytes, endBytes), {
            status: 206,
            headers
        });
    }
    headers.set(
        'cache-control',
        data.immutable ? 'public,max-age=604800,immutable' : 'public,max-age=14400'
    );
    if (
        request.headers.has('if-none-match') &&
        request.headers.get('if-none-match') === data.headers[1]
    ) {
        return new Response(null, {
            status: 304,
            headers
        });
    }
    if (
        request.headers.has('if-modified-since') &&
        request.headers.get('if-modified-since') === data.headers[0]
    ) {
        return new Response(null, {
            status: 304,
            headers
        });
    }
    if (!request.headers.has('accept-encoding')) {
        return new Response(file, {
            headers
        });
    }
    const ae = request.headers.get('accept-encoding')!;
    if (ae.includes('br') && data.compression[0]) {
        headers.set('content-encoding', 'br');
        headers.set('content-length', data.compression[0].size as any as string);
        return new Response(data.compression[0], {
            headers
        });
    }
    if (ae.includes('gzip') && data.compression[1]) {
        headers.set('content-encoding', 'gzip');
        headers.set('content-length', data.compression[1].size as any as string);
        return new Response(data.compression[1], {
            headers
        });
    }
    return new Response(file, {
        headers
    });
}

export const serve_static = SERVE_STATIC ? serve : () => undefined;
