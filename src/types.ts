import type { WebSocketHandler as BunWSHandler, ServerWebSocket } from 'bun';
import type { Server } from 'bun';

export type CreateFetchOptions = {
    overrideOrigin?: string;
    hostHeader?: string;
    protocolHeader?: string;
    ipHeader?: string;
    xffDepth?: number;
};

export type ServeOptions = {
    port: number;
    host: string;
    unixSocket?: string;
} & CreateFetchOptions;

export type WebSocketOptions = Omit<
    BunWSHandler,
    'message' | 'open' | 'close' | 'ping' | 'pong' | 'drain'
>;

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
    markForUpgrade(response: Response, ws: WebSocketHandler): Response;
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
