import { Server } from 'SERVER';
import { manifest } from 'MANIFEST';
import { join } from 'node:path';
import { assets } from 'ASSETS';

const server = new Server(manifest);

let server_promise: Promise<Server> | null = null;
let initialized = false;

export async function init_server(clientDir: string) {
    if (initialized) {
        return;
    }
    initialized = true;
    await server.init({
        env: Bun.env as any,
        read(file) {
            if (assets.has(file)) {
                return assets.get(file)!.file.stream();
            }
            return Bun.file(join(clientDir, 'clients', file)).stream();
        }
    });
}

export function get_server() {
    return (server_promise ??= initialized
        ? Promise.resolve(server)
        : init_server('').then(() => server));
}
