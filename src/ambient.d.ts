declare module 'SERVER' {
    import { CAC } from 'cac';
    import { Server as BunServer } from 'bun';
    export { Server, MaybePromise } from '@sveltejs/kit';
    export function get_hooks(): Promise<{
        setupCLI?: (cac: CAC) => MaybePromise<void>;
        beforeServe?: (options: any) => MaybePromise<void>;
        afterServe?: (server: BunServer, options: any) => MaybePromise<void>;
    }>;
}

declare module 'MANIFEST' {
    import { SSRManifest, type MaybePromise } from '@sveltejs/kit';
    export const manifest: SSRManifest;
}
