import type {
    WebSocketHandler as WSHandler,
    ServeOptions as BunServeOptions,
    ServerWebSocket
} from 'bun';
import type { Server } from 'bun';
import type { BlockList } from 'node:net';

export type CreateFetchOptions = {
    overrideOrigin?: string;
    hostHeader?: string;
    protocolHeader?: string;
    ipHeader?: string;
    xffDepth?: number;
    trustedProxies?: BlockList;
};

export type ServeOptions = {
    port: number;
    host: string;
    unixSocket?: string;
} & CreateFetchOptions;

type StripNever<T> = {
    [K in keyof T as T[K] extends never ? never : K]: T[K];
};

export type PureWebSocketOptions = Partial<
    StripNever<
        Omit<
            {
                [K in keyof WSHandler<any>]-?: Exclude<WSHandler<any>[K], undefined> extends (
                    ...args: any[]
                ) => any
                    ? never
                    : WSHandler<any>[K];
            },
            'data'
        >
    >
>;

export type DevServeOptions = Omit<BunServeOptions, 'fetch'> & {
    websocket?: PureWebSocketOptions;
    hmrPort?: number;
    exposeBunVersionToClient?: boolean;
    exposeBunRevisionToClient?: boolean;
};

export interface WebSocketHandler {
    /**
     * Called when the server receives an incoming message.
     *
     * If the message is not a `string`, its type is based on the value of `binaryType`.
     * - if `nodebuffer`, then the message is a `Buffer`.
     * - if `arraybuffer`, then the message is an `ArrayBuffer`.
     * - if `uint8array`, then the message is a `Uint8Array`.
     *
     * @param ws The websocket that sent the message
     * @param message The message received
     */
    message(ws: ServerWebSocket<this>, message: string | Buffer): void | Promise<void>;

    /**
     * Called when a connection is opened.
     *
     * @param ws The websocket that was opened
     */
    open?(ws: ServerWebSocket<this>): void | Promise<void>;

    /**
     * Called when a connection was previously under backpressure,
     * meaning it had too many queued messages, but is now ready to receive more data.
     *
     * @param ws The websocket that is ready for more data
     */
    drain?(ws: ServerWebSocket<this>): void | Promise<void>;

    /**
     * Called when a connection is closed.
     *
     * @param ws The websocket that was closed
     * @param code The close code
     * @param message The close message
     */
    close?(ws: ServerWebSocket<this>, code: number, reason: string): void | Promise<void>;

    /**
     * Called when a ping is sent.
     *
     * @param ws The websocket that received the ping
     * @param data The data sent with the ping
     */
    ping?(ws: ServerWebSocket<this>, data: Buffer): void | Promise<void>;

    /**
     * Called when a pong is received.
     *
     * @param ws The websocket that received the ping
     * @param data The data sent with the ping
     */
    pong?(ws: ServerWebSocket<this>, data: Buffer): void | Promise<void>;
}

export interface AdapterPlatform {
    /**
     * The original request received from Bun.serve
     */
    readonly originalRequest: Request;

    /**
     * The Bun server
     */
    readonly bunServer: Server<WebSocketHandler>;

    /**
     * Mark a response for upgrade and return the response itself.
     *
     * When a response is marked for upgrade, the server will try to upgrade the request,
     * if the upgrade fails, the response will be returned to the client.
     *
     * @param response The response to mark
     * @param ws The websocket handler
     */
    markForUpgrade(response: Response, ws: WebSocketHandler): Response;
}

export type AdapterOptions = {
    /**
     * Output path
     * @default './build'
     */
    out?: string;

    /**
     * The bundler for the final step build.
     * Now use `import('vite').build` instead of using rollup directly.
     * @default 'rollup'
     */
    bundler?: 'rollup' | 'bun';

    /**
     * Enable pre-compress, use number to specify a minimum file size which will be compressed.
     * When it is true, the minimum size is 1KiB.
     *
     * @default false
     */
    precompress?: boolean | PreCompressOptions | number;

    /**
     * Serve static assets, set if to false if you want to handle static assets yourself
     * like using nginx or caddy. When it is true, an index of assets will build with
     * bun's `import with { type: 'file' }` syntax, which make it ready to bundle into
     * single executable file.
     *
     * @default true
     */
    serveStatic?: boolean;

    /**
     * File patterns to be ignored in the static assets, ex: `*.{br,gz}`
     * @default ["**​/.*"]
     */
    staticIgnores?: string[];

    /**
     * Export prerendered entries as json
     * @default false
     */
    exportPrerender?: boolean;

    /**
     * Include source maps
     *
     * @default true
     */
    sourceMap?: boolean | 'inline';

    /**
     * Minify the output when using rollup build
     * @default false
     */
    rollupMinify?: Exclude<import('vite').UserConfig['build'], undefined>['minify'];

    /**
     * Minify the output when using bun build
     *
     * @default false
     */
    bunBuildMinify?: Bun.BuildConfig['minify'];

    /**
     * Expose the Bun version to the client via public env (`PUBLIC_BUN_VERSION`).
     * @default false
     */
    exposeBunVersionToClient?: boolean;

    /**
     * Expose the Bun revision to the client via public env (`PUBLIC_BUN_REVISION`).
     * @default false
     */
    exposeBunRevisionToClient?: boolean;

    /**
     * Call the launch function exported from `hooks.server.js` instead of serve the application directly.
     * @requires @sveltejs/kit >= 2.50.1
     * @default false
     */
    customLaunch?: boolean;
};

export type PreCompressOptions = {
    /**
     * Enable specific compression, number means the minimum size to compress.
     * 1KiB will be used when the value is `true`, set to `0` for always compress.
     *
     * @default true;
     */
    [k in 'gzip' | 'brotli']?: boolean | number;
} & {
    /**
     * Extensions to pre-compress
     * @default ['html','js','json','css','svg','xml','wasm']
     */
    files?: string[];
};

type Prettify<T> = {
    [K in keyof T]: T[K];
} & {};

export interface LaunchParam {
    serve: () => Promise<Bun.Server<WebSocketHandler>>;
    createBunFetch: () => (
        request: Request,
        server: Bun.Server<WebSocketHandler>
    ) => Promise<Response | undefined>;
    createBunServer: () => Bun.Server<WebSocketHandler>;
    websocketHandler: Prettify<
        Required<Omit<WSHandler<WebSocketHandler>, keyof PureWebSocketOptions | 'data'>>
    >;
}
