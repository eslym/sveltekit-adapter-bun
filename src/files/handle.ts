import type { AdapterPlatform, CreateFetchOptions, ServeOptions, WebSocketHandler } from '../types';
import { get_url, set_url } from './utils';
import { serve_static } from './static';
import { get_server } from './server';
import type { BlockList } from 'node:net';

type MaybePromise<T> = T | Promise<T>;

type Resolvers = ((args: {
    request: Request;
    ip: string | undefined;
}) => MaybePromise<Response | undefined | void>)[];

type GetIP = (request: Request, fallback: string | undefined) => string | undefined | null;

function clone_req(url: URL, request: Request) {
    return new Request(url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        referrer: request.referrer,
        referrerPolicy: request.referrerPolicy,
        mode: request.mode,
        credentials: request.credentials,
        cache: request.cache,
        redirect: request.redirect,
        integrity: request.integrity
    });
}

async function first_resolve(request: Request, ip: string | undefined, resolvers: Resolvers) {
    const args = { request, ip };
    for (let i = 0; i < resolvers.length; i++) {
        const _r = resolvers[i](args);
        const response = _r instanceof Promise ? await _r : _r;
        if (response) return response;
    }
}

function override_origin(origin: URL, args: { request: Request }) {
    const url = get_url(args.request);
    const newUrl = new URL(url.pathname + url.search, origin);
    args.request = clone_req(newUrl, args.request);
    set_url(args.request, newUrl);
}

function override_origin_with_header(
    hostHeader: string | undefined,
    protocolHeader: string | undefined,
    args: { request: Request }
) {
    const url = get_url(args.request);
    let newUrl = new URL(url);
    if (hostHeader && args.request.headers.has(hostHeader)) {
        newUrl.host = args.request.headers.get(hostHeader)!;
    }
    if (protocolHeader && args.request.headers.has(protocolHeader)) {
        newUrl.protocol = args.request.headers.get(protocolHeader)! + ':';
    }
    if (newUrl.href !== url.href) {
        args.request = clone_req(newUrl, args.request);
        set_url(args.request, newUrl);
    }
}

function resolve_xff_ip(request: Request, depth: number) {
    if (!request.headers.has('x-forwarded-for')) return;
    const ips = request.headers.get('x-forwarded-for')!.split(',');
    return ips.at(-depth) || undefined;
}

function resolve_trusted_proxy_ip(
    trustedProxies: BlockList,
    request: Request,
    fallback: string | undefined
) {
    return fallback && trustedProxies.check(fallback)
        ? (resolve_xff_ip(request, 1) ?? fallback)
        : fallback;
}

function override_origin_with_trusted_proxies(
    trustedProxies: BlockList,
    args: { request: Request; ip: string | undefined }
) {
    if (!args.ip || !trustedProxies.check(args.ip)) return;
    override_origin_with_header('x-forwarded-host', 'x-forwarded-proto', args);
}

export function create_fetch({
    overrideOrigin,
    hostHeader,
    protocolHeader,
    ipHeader,
    xffDepth,
    trustedProxies
}: CreateFetchOptions) {
    let getIp: GetIP | undefined = undefined;
    if (ipHeader === 'x-forwarded-for') {
        getIp = (req, fallback) => resolve_xff_ip(req, xffDepth!) ?? fallback;
    } else if (ipHeader) {
        getIp = (req, fallback) => req.headers.get(ipHeader) ?? fallback;
    }
    const resolvers: Resolvers = [];
    const upgrades = new WeakMap<Response, WebSocketHandler>();
    function markUpgrade(response: Response, ws: WebSocketHandler) {
        upgrades.set(response, ws);
        return response;
    }
    if (overrideOrigin) {
        resolvers.push(override_origin.bind(null, new URL(overrideOrigin)));
    } else if (hostHeader || protocolHeader) {
        resolvers.push(override_origin_with_header.bind(null, hostHeader, protocolHeader));
    } else if (trustedProxies) {
        getIp = resolve_trusted_proxy_ip.bind(null, trustedProxies);
        resolvers.push(override_origin_with_trusted_proxies.bind(null, trustedProxies));
    }
    if (SERVE_STATIC) {
        resolvers.push(serve_static);
    }
    return (request: Request, srv: Bun.Server<unknown>) => {
        const request_ip = srv.requestIP(request)?.address;
        const try_get_ip = getIp ? () => getIp(request, request_ip) : () => request_ip;
        return first_resolve(request, request_ip, [
            ...resolvers,
            async (args) => {
                const server = await get_server();
                const res = await server.respond(args.request, {
                    getClientAddress() {
                        const ip = try_get_ip();
                        if (ip) return ip;
                        throw new Error('Unable to determine client IP address');
                    },
                    platform: {
                        get originalRequest() {
                            return request;
                        },
                        get bunServer() {
                            return srv;
                        },
                        get markForUpgrade() {
                            return markUpgrade;
                        }
                    } as AdapterPlatform
                });
                if (
                    upgrades.has(res) &&
                    srv.upgrade(request, { headers: res.headers, data: upgrades.get(res) })
                ) {
                    return undefined;
                }
                return res;
            }
        ]);
    };
}
