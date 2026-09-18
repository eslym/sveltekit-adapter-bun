declare module 'SERVER' {
    import type { Server } from '@sveltejs/kit';

    /**
     * The already constructed sveltekit server. On sveltekit 3 this module is
     * written by `builder.generateServerInstance`, on sveltekit 2 the adapter
     * writes an equivalent module itself.
     */
    export const server: Server;
}

declare module 'ASSETS' {
    import type { BunFile } from 'bun';

    export type ResolvedStatic = {
        file: BunFile;
        immutable: boolean;
        headers: [modified: string, etag: string, size: number];
        compression: [gzip?: BunFile, brotli?: BunFile];
    };

    export const assets = new Map<string, ResolvedStatic>();
}
