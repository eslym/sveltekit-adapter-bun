import { Server } from 'SERVER';
import { manifest } from 'MANIFEST';
import { join } from 'node:path';
import { assets } from 'ASSETS';
import { name } from '../../package.json';

const server = new Server(manifest);

let init_promise: Promise<Server> | null = null;

async function init_server() {
    if (EXPOSE_BUN_VERSION) {
        process.env.PUBLIC_BUN_VERSION = Bun.version;
        Bun.env.PUBLIC_BUN_VERSION = Bun.version;
    }
    if (EXPOSE_BUN_REVISION) {
        process.env.PUBLIC_BUN_REVISION = Bun.revision;
        Bun.env.PUBLIC_BUN_REVISION = Bun.revision;
    }
    await server.init({
        env: Bun.env as any,
        read(file) {
            if (assets.has(file)) {
                return assets.get(file)!.file.stream();
            }
            return Bun.file(
                join((globalThis as any)[Symbol.for(`${name}::root`)] as string, 'clients', file)
            ).stream();
        }
    });
}

export async function get_server() {
    return (init_promise ??= init_server().then(() => server));
}
