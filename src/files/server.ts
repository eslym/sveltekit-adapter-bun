import { Server } from 'SERVER';
import { manifest } from 'MANIFEST';

export const server = new Server(manifest);

await server.init({
    env: Bun.env as any,
    read(file) {
        return Bun.file(file).stream();
    }
});
