import { Server } from 'SERVER';
import { manifest } from 'MANIFEST';
import { join } from 'node:path';
import { assets } from 'ASSETS';
import { name } from '../../package.json';

export const server = new Server(manifest);

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
