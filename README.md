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

## Compatibility

This adapter supports both SvelteKit 2 and SvelteKit 3 from a single package; it detects which one you are on at build time and uses the matching adapter API.

|                                | SvelteKit 2                                 | SvelteKit 3                                                      |
| ------------------------------ | ------------------------------------------- | ---------------------------------------------------------------- |
| Configuration                  | `svelte.config.js`                          | `vite.config.ts` (`svelte.config.js` is rejected by SvelteKit 3) |
| Dev server WebSockets          | needs `patchSveltekit()`                    | works out of the box, `patchSveltekit()` is a no-op              |
| Server instrumentation         | needs `experimental.instrumentation.server` | works out of the box, plus a `$app/env/private` initializer      |
| Minimum bun for the dev server | `>= 1.1.8`                                  | `>= 1.2.6`                                                       |

### SvelteKit 3 setup

SvelteKit 3 no longer reads `svelte.config.js`, so the adapter is passed to the `sveltekit` vite plugin instead:

```typescript
// vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@eslym/sveltekit-adapter-bun';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [sveltekit({ adapter: adapter() })]
});
```

### SvelteKit 2 setup

```javascript
// svelte.config.js
import adapter from '@eslym/sveltekit-adapter-bun';

export default {
    kit: {
        adapter: adapter()
    }
};
```

## Setup dev server

> [!NOTE]  
> You do not need to do this if you are not using websocket in dev mode.

1. Create an entrypoint file for dev server, e.g. `./dev.ts`
2. Add the following code to the entrypoint file

    ```typescript
    import { patchSveltekit, startDevServer } from '@eslym/sveltekit-adapter-bun/dev';

    await patchSveltekit();
    await startDevServer();
    ```

3. run `bun dev.ts`

The `startDevServer` function starts the dev server with websocket support.

On **SvelteKit 2**, `patchSveltekit` patches sveltekit using `bun patch` so that it can get the original `Request` object from bun and pass it to the dev server, making `Bun.Server#upgrade` possible. It does not impact anything in the production build, since the production build does not involve `@sveltejs/kit/node` unless you are using it in your code.

On **SvelteKit 3**, `patchSveltekit` is a no-op that returns immediately: SvelteKit 3 exposes the supported `Adapter.vite` hooks (`getRequest` / `setResponse`), which the adapter uses instead, so nothing has to be patched. You can keep the call in your entrypoint — it is safe on both versions.

> [!IMPORTANT]
> On SvelteKit 2 this dev server uses bun's internal stuff, so it might break in a future bun
> version, but the production build will not be affected.

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
    const upgraded = platform!.upgrade({
        message(ws, message) {
            ws.send(message);
        },
        // optional headers which returned as part of the upgrade response
        {
            'X-Request-Id': crypto.randomUUID()
        }
    });
    if (upgraded) {
        // return a dummy response for sveltekit when the upgrade is successful
        return new Response();
    }
    return new Response('Websocket Requried', {
        status: 400
    });
}
```

## Instrumentation

SvelteKit can run an `src/instrumentation.server.ts` module _before_ anything else in the server bundle, which is what OpenTelemetry and similar tools need in order to patch modules as they load. This adapter implements the `instrumentation` capability on both majors.

On **SvelteKit 3** it works with no extra configuration. On **SvelteKit 2** it additionally requires the experimental flag — without it SvelteKit does not instrument the build at all:

```javascript
// svelte.config.js (SvelteKit 2 only)
export default {
    kit: {
        adapter: adapter(),
        experimental: {
            instrumentation: { server: true }
        }
    }
};
```

```typescript
// src/instrumentation.server.ts
import { NodeSDK } from '@opentelemetry/sdk-node';

const sdk = new NodeSDK({
    // ...
});

sdk.start();
```

The adapter emits `build/index.js` as a small facade that loads your instrumentation module first, and only then imports the actual server:

<!-- prettier-ignore -->
```javascript
#!/usr/bin/env bun
// @bun
import "./server/environment.js";
import "./server/instrumentation.server.js";
await import("./start.js");
```

The `environment.js` line is SvelteKit 3 only — it is the initializer that populates `$app/env/private` before your instrumentation runs. On SvelteKit 2 there is no such module and the facade is one line shorter.

Your instrumentation module is bundled together with the SvelteKit runtime, so the two share a single instance of `@opentelemetry/api` and the spans SvelteKit emits reach the provider you register.

> [!IMPORTANT]
> With the default `bundler: 'rollup'`, Vite's SSR build leaves bare imports of packages that live
> in `node_modules` external, so `@opentelemetry/api` — and any other OpenTelemetry package your
> instrumentation imports — has to be a real `dependency`, not a `devDependency`. The adapter strips
> `devDependencies` from the emitted `build/package.json`, so a dev-only OpenTelemetry would not be
> installed on the deployment target and the server would fail to start. With `bundler: 'bun'` only
> the app's `dependencies` are externalised and everything else is bundled into the output, so there
> a dev-only OpenTelemetry works too.

Note that OpenTelemetry's automatic instrumentations patch modules as they are loaded, so they cannot see code that ended up inside the bundle. Packages you want auto-instrumented have to stay external, which again means listing them in `dependencies`.

> [!IMPORTANT]
> To read environment variables from your instrumentation module, declare them in `src/env.ts` and
> import from `$app/env/private`. SvelteKit 3 only populates `$env/dynamic/private` for variables
> that are explicitly declared, so an undeclared variable reads as `undefined` there — this is
> SvelteKit behaviour, not an adapter limitation.
>
> ```typescript
> // src/env.ts
> import { defineEnvVars } from '@sveltejs/kit/env';
>
> export const variables = defineEnvVars({
>     OTEL_EXPORTER_OTLP_ENDPOINT: { schema: (value) => value }
> });
> ```

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
     * @requires @sveltejs/kit >= 2.50.1 (any 3.x)
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
```

## Runtime Environments

| Name                   | Description                                                                                               | Default    |
| ---------------------- | --------------------------------------------------------------------------------------------------------- | ---------- |
| `HTTP_HOST`            | The host for the server                                                                                   | `0.0.0.0`  |
| `HTTP_PORT`            | The port for the server                                                                                   | `3000`     |
| `HTTP_SOCKET`          | The path of the unix socket which the server will listen to (this will disable http)                      | -          |
| `HTTP_PROTOCOL_HEADER` | The header name to get the protocol from the request                                                      | -          |
| `HTTP_HOST_HEADER`     | The header name to get the host from the request                                                          | -          |
| `HTTP_IP_HEADER`       | The header name to get the client ip from the request (usually `X-Forwarded-For`)                         | -          |
| `HTTP_XFF_DEPTH`       | The depth of the `X-Forwarded-For` header to get the client ip                                            | `1`        |
| `HTTP_TRUSTED_PROXIES` | A comma separated list of trusted proxies IP or CIDR, used to determine the client IP and override origin | -          |
| `HTTP_OVERRIDE_ORIGIN` | Force the request origin when it is unable to retrieve from the request                                   | -          |
| `HTTP_IDLE_TIMEOUT`    | The request timeout for the server(in seconds)                                                            | `30`       |
| `HTTP_MAX_BODY`        | The maximum body size for the request                                                                     | `128mib`   |
| `HTTP_2`               | Enable HTTP/2 (requires Bun version >= 1.14.1 and TLS enabled)                                            | `false`    |
| `TLS_CERT_FILE`        | Path to the TLS certificate file (PEM). Enables HTTPS when set alongside `TLS_KEY_FILE`                   | -          |
| `TLS_KEY_FILE`         | Path to the TLS private key file (PEM). Required with `TLS_CERT_FILE` to enable HTTPS                     | -          |
| `TLS_CA_FILE`          | Optional path to a CA bundle file (PEM)                                                                   | -          |
| `TLS_PASSPHRASE`       | Optional passphrase for an encrypted `TLS_KEY_FILE`                                                       | -          |
| `WS_IDLE_TIMEOUT`      | The websocket idle timeout (in seconds)                                                                   | `120`      |
| `WS_MAX_PAYLOAD`       | The maximum payload size for the websocket                                                                | `16mib`    |
| `WS_NO_PING`           | Disable automatic ping response                                                                           | `false`    |
| `CACHE_ASSET_AGE`      | The max-age for the cache-control header for the assets                                                   | `14400`    |
| `CACHE_IMMUTABLE_AGE`  | The max-age for the cache-control header for the immutable assets                                         | `31536000` |

## Experimental Features

### Custom Launch

This feature allows you to enable custom launch behavior for the server, giving you more control over the final build.

To enable this feature, set the `customLaunch` option to `true` in the adapter configuration and export `launch` function from `hooks.server.js`.

```js
// hooks.server.js
import type { LaunchParam } from '@eslym/sveltekit-adapter-bun';

export function launch({ serve }: LaunchParam) {
    if (Bun.argv.includes('--serve')) {
        const server = serve();

        return;
    }
    // ...you may do other cli handling here
}
```

> [!IMPORTANT]
>
> 1. This feature requires `@sveltejs/kit >= 2.50.1` (or any SvelteKit 3), which allows the adapter to import `hooks.server.js` directly.
> 2. `init` in `hooks.server.js` will still run before the `launch` function because SvelteKit runs it when initializing environment variables.
