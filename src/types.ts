import type { WebSocketHandler as BunWSHandler } from 'bun';
import type { Server } from 'bun';

export type ServeOptions = {
    port: number;
    host: string;
    unixSocket?: string;
    overrideOrigin?: string;
    hostHeader?: string;
    protocolHeader?: string;
    ipHeader?: string;
    xffDepth?: number;
};

export type WebSocketOptions = Omit<
    BunWSHandler,
    'message' | 'open' | 'close' | 'ping' | 'pong' | 'drain'
>;

export type WebSocketHandler<T extends WebSocketHandler<any>> = Pick<
    BunWSHandler<T>,
    'message' | 'open' | 'drain' | 'ping' | 'pong' | 'close'
>;

export interface AdapterPlatform {
    /**
     * The original request received from Bun.serve
     */
    readonly originalRequest: Request;

    /**
     * The Bun server
     */
    readonly bunServer: Server;

    /**
     * Mark a response for upgrade and return the response itself.
     *
     * When a response is marked for upgrade, the server will try to upgrade the request,
     * if the upgrade fails, the response will be returned to the client.
     *
     * @param response The response to mark
     * @param ws The websocket handler
     */
    markForUpgrade(response: Response, ws: WebSocketHandler<any>): Response;
}

export type PreCompressOptions = {
    /**
     * @default false;
     */
    [k in 'gzip' | 'brotli']?: boolean;
} & {
    /**
     * Extensions to pre-compress
     * @default ['html','js','json','css','svg','xml','wasm']
     */
    files?: string[];
};

export type AdapterOptions = {
    /**
     * Output path
     * @default './build'
     */
    out?: string;

    /**
     * Transpile server code with bun transpiler after build. (will add `// @bun` tag to first line)
     * @default false
     */
    transpileBun?: boolean;

    /**
     * Enable pre-compress
     * @default false
     */
    precompress?: boolean | PreCompressOptions;

    /**
     * File patterns to ignore for static files
     * @default ["**​/.*"]
     */
    staticIgnores?: string[];

    /**
     * Websocket serve options
     */
    websocketOptions?: WebSocketOptions;

    /**
     * The name of the CLI
     */
    cliName?: string;

    /**
     * Export prerendered entries as json
     * @default false
     */
    exportPrerender?: boolean;
};

export type ResolvedStatic = [
    path: string,
    immutable: boolean,
    headers: [modified: string, etag: string, size: number],
    compression: [gzip: false | number, brotli: false | number]
];
