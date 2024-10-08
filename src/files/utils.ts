const urls = new WeakMap<Request, URL>();

const basePath = Symbol.for('app.basepath');

export function get_url(request: Request) {
    if (!urls.has(request)) {
        urls.set(request, new URL(request.url));
    }
    return urls.get(request)!;
}

export function set_url(request: Request, url: URL) {
    urls.set(request, url);
    return url;
}

export function get_basepath(): string {
    return (globalThis as any)[basePath] || '';
}

export function set_basepath(path: string) {
    (globalThis as any)[basePath] = path;
}
