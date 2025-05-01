# @eslym/sveltekit-adapter-bun

Another sveltekit adapter for bun, an alternative to [svelte-adapter-bun](https://github.com/gornostay25/svelte-adapter-bun). This package support websocket in dev mode with few steps of setup.

The built bundle with version `2.0.0` will be ready to compile into single executable with bun.

## Installation

```shell
bun add -d @eslym/sveltekit-adapter-bun
```

> [!IMPORTANT]  
> **Breaking Changes**
>
> Since version `2.0.0`, the custom hooks (`beforeServe`, `afterServe` and `setupCLI`) and CLI functionality is complemetely removed.

## Setup dev server

> [!CAUTION]
> This dev server is no longer work since bun v1.2.6, see https://github.com/eslym/sveltekit-adapter-bun/issues/3, but the production server will still function as expected.

> [!NOTE]  
> You do not need to do this if you are not using websocket in dev mode.

1. Create an entrypoint file for dev server, e.g. `./dev.ts`
2. Add the following code to the entrypoint file

    ```typescript
    import { patchSvelteKit, startDevServer } from '@eslym/sveltekit-adapter-bun';

    await patchSvelteKit();
    await startDevServer();
    ```

3. run `bun dev.ts`

The `patchSvelteKit` function will patch the sveltekit using `bun patch` to let it get the original `Request` object from bun and pass it to the dev server, making `Bun.Server#upgrade` possible. The `startDevServer` function will start the dev server with websocket support.

The `patchSvelteKit` will not impact anything in production build, since the production build will not involve `@sveltejs/kit/node` unless you are using it in your code.

> [!IMPORTANT]
> This dev server uses bun's internal stuff, so it might break in the future bun version, but the
> production build will not be affected.

## Use the websocket

```typescript
// ./src/app.d.ts
// for the type checking

import type { AdapterPlatform } from '@eslym/sveltekit-adapter-bun';

// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare global {
    namespace App {
        // interface Error {}
        // interface Locals {}
        // interface PageData {}
        // interface PageState {}
        interface Platform extends AdapterPlatform {}
    }
}
```

```typescript
// ./src/routes/echo/+server.ts

export async function GET({ platform }) {
    // can mark any response for upgrade, if the upgrade failed, the response will be sent as is
    return platform!.markForUpgrade(
        new Response('Websocket Requried', {
            status: 400
        }),
        {
            message(ws, message) {
                ws.send(message);
            }
        }
    );
}
```

## Adapter Options

```typescript
export type AdapterOptions = {
    /**
     * Output path
     * @default './build'
     */
    out?: string;

    /**
     * The bundler for the final step build.
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
     * Minify the output when using bun build
     *
     * @default false
     */
    bunBuildMinify?:
        | boolean
        | {
              whitespace?: boolean;
              syntax?: boolean;
              identifiers?: boolean;
          };
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
```

## Runtime Environments

| Name                   | Description                                                                          | Default    |
| ---------------------- | ------------------------------------------------------------------------------------ | ---------- |
| `HTTP_HOST`            | The host for the server                                                              | `0.0.0.0`  |
| `HTTP_PORT`            | The port for the server                                                              | `3000`     |
| `HTTP_SOCKET`          | The path of the unix socket which the server will listen to (this will disable http) | -          |
| `HTTP_PROTOCOL_HEADER` | The header name to get the protocol from the request                                 | -          |
| `HTTP_HOST_HEADER`     | The header name to get the host from the request                                     | -          |
| `HTTP_IP_HEADER`       | The header name to get the client ip from the request (usually `X-Forwarded-For`)    | -          |
| `HTTP_XFF_DEPTH`       | The depth of the `X-Forwarded-For` header to get the client ip                       | `1`        |
| `HTTP_OVERRIDE_ORIGIN` | Force the request origin when it is unable to retrieve from the request              | -          |
| `HTTP_IDLE_TIMEOUT`    | The request timeout for the server(in seconds)                                       | `30`       |
| `HTTP_MAX_BODY`        | The maximum body size for the request                                                | `128mib`   |
| `WS_IDLE_TIMEOUT`      | The websocket idle timeout (in seconds)                                              | `120`      |
| `WS_MAX_PAYLOAD`       | The maximum payload size for the websocket                                           | `16mib`    |
| `WS_NO_PING`           | Disable automatic ping response                                                      | `false`    |
| `CACHE_ASSET_AGE`      | The max-age for the cache-control header for the assets                              | `14400`    |
| `CACHE_IMMUTABLE_AGE`  | The max-age for the cache-control header for the immutable assets                    | `31536000` |
