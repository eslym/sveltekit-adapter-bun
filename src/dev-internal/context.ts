import type { WebSocketHandler } from '../types';
import type { Plugin } from 'vite';

export const devContextHeader = 'X-Adapter-Dev-Context' as const;

export const devContext = new Map<
    string,
    {
        request: Request;
        server: Bun.Server<WebSocketHandler>;
    }
>();

export const patchPlatform = {
    name: 'sveltekit-adapter-bun/patch-platform',
    transform(code, id, options) {
        if (!options?.ssr) return;
        if (!id.endsWith('/@sveltejs/kit/src/runtime/server/respond.js')) return;

        return code.replaceAll(
            'state.emulator.platform({',
            'state.emulator.platform({ request: event.request, '
        );
    }
} satisfies Plugin;
