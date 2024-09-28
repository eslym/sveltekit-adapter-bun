import cac from 'cac';
import { patchSveltekit, startDevServer } from './dev';

const cli = cac('sveltekit-bun');

const env = Bun.env;

cli.command('', 'Start a development server')
    .alias('dev')
    .alias('start')
    .alias('serve')
    .option('--port, -p <port>', 'Port to listen on', { default: env.HTTP_PORT })
    .option('--host [host]', 'Host to listen on', { default: env.HTTP_HOST })
    .option('--config <config>', 'Vite config is')
    .action(async (options: { port?: number; host?: string | true; config?: string }) => {
        await patchSveltekit();
        await startDevServer({
            port: options.port,
            host: options.host === true ? '0.0.0.0' : options.host,
            config: options.config
        });
    });

cli.help();

cli.parse();
