import { AsyncLocalStorage } from 'node:async_hooks';
import type { AdapterViteConfig, WebSocketHandler } from '../types';
import { symDevBridge } from '../symbols';

export interface DevContext {
    request: Request;
    server: Bun.Server<WebSocketHandler>;
}

export interface DevBridge {
    /**
     * Carries the bun `Request` and `Server` of the request currently being
     * handled from the dev server into `Adapter.emulate().platform()`, which
     * sveltekit calls without any reference to the request.
     */
    storage: AsyncLocalStorage<DevContext>;

    /**
     * Populated by the dev server on sveltekit 3+, where the adapter can hand
     * bun's own `Request`/`Response` to sveltekit instead of patching
     * `@sveltejs/kit/node` at load time.
     */
    vite?: AdapterViteConfig;
}

/**
 * Get the shared bridge, creating it if this is the first access.
 */
export function devBridge(): DevBridge {
    const global = globalThis as any;
    return (global[symDevBridge] ??= {
        storage: new AsyncLocalStorage<DevContext>()
    } satisfies DevBridge);
}

/**
 * The context of the request being handled, or `undefined` outside of the dev
 * server (during build and prerender, or when running under `vite dev`).
 */
export function devContext(): DevContext | undefined {
    return ((globalThis as any)[symDevBridge] as DevBridge | undefined)?.storage.getStore();
}
