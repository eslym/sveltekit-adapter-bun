export const mapping = {
    path: 0,
    immutable: 1,
    headers: 2,
    compression: 3,
    c: {
        gzip: 0,
        brotli: 1
    } as const,
    h: {
        modified: 0,
        etag: 1,
        size: 2
    } as const
} as const;
