# @eslym/sveltekit-adapter-bun

Another sveltekit adapter for bun, an alternative to [svelte-adapter-bun](https://github.com/gornostay25/svelte-adapter-bun). This package support websocket in dev mode with few steps of setup.

## Installation

```shell
bun add -d @eslym/sveltekit-adapter-bun
```

## Setup dev server
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

The `patchSvelteKit` function will patch the sveltekit to let it get the original `Request` object from bun and pass it to the dev server, making `Bun.Server#upgrade` possible. The `startDevServer` function will start the dev server with websocket support.

## Use the websocket
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
