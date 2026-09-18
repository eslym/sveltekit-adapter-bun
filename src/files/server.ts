import { server } from 'SERVER';
import { join } from 'node:path';
import { assets } from 'ASSETS';

let server_promise: Promise<typeof server> | null = null;
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
