declare module 'SERVER' {
    import { CAC } from 'cac';
    import { Server as BunServer } from 'bun';
    export { Server, MaybePromise } from '@sveltejs/kit';
}

declare module 'MANIFEST' {
    import { SSRManifest, type MaybePromise } from '@sveltejs/kit';
    export const manifest: SSRManifest;
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
