export type { WebSocketHandler, CreateFetchOptions } from './types';
import type {
    AdapterOptions,
    AdapterPlatform,
    PreCompressOptions,
    ResolvedStatic,
    WebSocketHandler
} from './types';
import type { Adapter } from '@sveltejs/kit';
import { name as adapterName } from '../package.json';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import {
    createReadStream,
    createWriteStream,
    existsSync,
    readFileSync,
    statSync,
    writeFileSync
} from 'fs';
import { pipeline } from 'stream/promises';
import { rollup } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import { join } from 'node:path/posix';
import { uneval } from 'devalue';
import { symServer, symUpgrades } from './symbols';
export * from './dev';

const files = fileURLToPath(new URL('./files', import.meta.url));

export default function adapter(userOpts: AdapterOptions = {}): Adapter {
    const opts: Required<Omit<AdapterOptions, 'cliName'>> & { cliName?: string } = {
        out: './build',
        transpileBun: false,
        precompress: false,
        exportPrerender: false,
        websocketOptions: {},
        staticIgnores: ['**/.*'],
        ...userOpts
    };
    return {
        name: adapterName,
        async adapt(builder) {
            if (!('Bun' in globalThis)) {
                throw new Error('Please run with bun');
            }
            if (Bun.semver.order(Bun.version, '1.1.8') < 0) {
                if (opts.precompress === true) {
                    builder.log.warn(
                        `Bun v${Bun.version} does not support brotli, please use newer version of bun or nodejs to build, otherwise brotli will be ignore.`
                    );
                    opts.precompress = {
                        gzip: true,
                        brotli: false
                    };
                } else if (typeof opts.precompress === 'object' && opts.precompress) {
                    throw new Error(
                        `Bun v${Bun.version} does not support brotli, please use newer version of bun or nodejs to build.`
                    );
                }
            }

            const tmp = builder.getBuildDirectory(adapterName);

            const { out, precompress } = opts;

            builder.rimraf(out);
            builder.mkdirp(out);

            builder.log.minor('Copying assets');

            builder.writeClient(`${out}/client${builder.config.kit.paths.base}`);
            builder.writePrerendered(`${out}/prerendered${builder.config.kit.paths.base}`);

            if (precompress) {
                builder.log.minor('Compressing assets');
                await Promise.all([
                    compress(`${out}/client`, precompress),
                    compress(`${out}/prerendered`, precompress)
                ]);
            }

            const mappings = new Map<string, ResolvedStatic>();

            const staticIgnores = opts.staticIgnores.map((p) => new Bun.Glob(p));
            const clientFiles = new Bun.Glob('**/*');

            const clientPath = `${out}/client`;
            const immutable = `${builder.config.kit.appDir}/immutable/`.replace(/^\/?/, '/');
            for await (const path of clientFiles.scan({
                cwd: clientPath,
                dot: true,
                onlyFiles: true,
                absolute: false
            })) {
                if (staticIgnores.some((g) => g.match(path))) continue;
                const pathname = path.replace(/\\/g, '/').replace(/^\/?/, '/');
                const file = Bun.file(clientPath + pathname);
                mappings.set(pathname, [
                    join('/client', pathname),
                    pathname.includes(immutable),
                    [
                        new Date(file.lastModified).toUTCString(),
                        `"${Bun.SHA1.hash(await file.arrayBuffer(), 'hex')}"`,
                        file.size
                    ],
                    [
                        Bun.file(`${clientPath}${pathname}.gz`).size,
                        Bun.file(`${clientPath}${pathname}.br`).size
                    ]
                ]);
            }

            const prerenderPath = `${out}/prerendered`;
            for (const [pathname, target] of builder.prerendered.pages) {
                const path = join(prerenderPath, target.file);
                const file = Bun.file(path);
                mappings.set(pathname, [
                    join('/prerendered', target.file.replace(/\\/g, '/')),
                    false,
                    [
                        new Date(file.lastModified).toUTCString(),
                        `"${Bun.SHA1.hash(await file.arrayBuffer(), 'hex')}"`,
                        file.size
                    ],
                    [Bun.file(`${path}.gz`).size, Bun.file(`${path}.br`).size]
                ]);
            }

            builder.log.minor('Building server');
            builder.writeServer(tmp);

            exportSetupCLI(tmp);

            writeFileSync(
                `${tmp}/manifest.js`,
                `export const manifest = ${builder.generateManifest({ relativePath: './' })};\n\n` +
                    `export const prerendered = new Set(${JSON.stringify(builder.prerendered.paths)});\n`
            );

            const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

            builder.log.minor('Bundling...');

            // we bundle the Vite output so that deployments only need
            // their production dependencies. Anything in devDependencies
            // will get included in the bundled code
            const bundle = await rollup({
                input: {
                    index: `${tmp}/index.js`,
                    manifest: `${tmp}/manifest.js`
                },
                external: [
                    // dependencies could have deep exports, so we need a regex
                    ...Object.keys(pkg.dependencies || {}).map((d) => new RegExp(`^${d}(\\/.*)?$`))
                ],
                plugins: [
                    nodeResolve({
                        preferBuiltins: true,
                        exportConditions: ['node']
                    }),
                    // @ts-ignore https://github.com/rollup/plugins/issues/1329
                    commonjs({ strictRequires: true }),
                    // @ts-ignore https://github.com/rollup/plugins/issues/1329
                    json()
                ],
                onLog(level, log) {
                    builder.log[level === 'debug' ? 'minor' : level](log.message);
                }
            });

            await bundle.write({
                dir: `${out}/server`,
                format: 'esm',
                sourcemap: true,
                chunkFileNames: 'chunks/[name]-[hash].js'
            });

            builder.copy(files, out, {
                replace: {
                    SERVER: './server/index.js',
                    MANIFEST: './server/manifest.js',
                    CLI_NAME: opts.cliName ? JSON.stringify(opts.cliName) : 'undefined',
                    PRE_RESOLVE_STATIC: JSON.stringify([...mappings.entries()]),
                    WEBSOCKET_OPTIONS: JSON.stringify(opts.websocketOptions)
                }
            });

            const transpiler = new Bun.Transpiler({ loader: 'js' });

            if (opts.transpileBun) {
                const glob = new Bun.Glob('./server/**/*.js');
                const files = [...glob.scanSync({ cwd: out, absolute: true })];
                for (const file of files) {
                    const src = await Bun.file(file).text();
                    if (src.startsWith('// @bun')) continue;
                    await Bun.write(file, '// @bun\n' + transpiler.transformSync(src));
                }
            }

            if ('patchedDependencies' in pkg) {
                const deps = Object.keys(pkg.devDependencies || {});
                for (const [patchedDep, patch] of Object.entries(pkg.patchedDependencies)) {
                    let keep = true;
                    for (const dep of deps) {
                        if (!patchedDep.startsWith(`${dep}@`)) continue;
                        keep = false;
                        delete pkg.patchedDependencies[patchedDep];
                        break;
                    }
                    if (keep) builder.copy(patch as string, `${out}/${patch}`);
                }
            }

            delete pkg.devDependencies;

            writeFileSync(`${out}/package.json`, JSON.stringify(pkg, null, 2) + '\n');

            if (opts.exportPrerender) {
                const js =
                    `export const paths = ${uneval(builder.prerendered.paths)};\n` +
                    `export const prerendered = ${uneval(builder.prerendered.pages)};\n` +
                    `export const assets = ${uneval(builder.prerendered.assets)};\n` +
                    `export const redirects = ${uneval(builder.prerendered.redirects)};\n` +
                    `export default { paths, prerendered, assets, redirects };\n`;
                writeFileSync(`${out}/prerendered.js`, '//@bun\n' + transpiler.transformSync(js));
            }

            builder.log.success(`Build done.`);
        },
        emulate() {
            return {
                platform(): AdapterPlatform {
                    return {
                        get originalRequest(): Request {
                            throw Error('Not supported in dev mode');
                        },
                        get bunServer() {
                            if (!(symServer in globalThis)) {
                                throw Error('Not supported in dev mode');
                            }
                            return (globalThis as any)[symServer];
                        },
                        markForUpgrade(res, ws) {
                            if (!(symUpgrades in globalThis)) {
                                throw Error('Not supported in dev mode');
                            }
                            const upgrades = (globalThis as any)[symUpgrades] as WeakMap<
                                Response,
                                WebSocketHandler
                            >;
                            upgrades.set(res, ws);
                            return res;
                        }
                    };
                }
            };
        }
    };
}

async function compress(directory: string, options: true | PreCompressOptions) {
    if (!existsSync(directory)) {
        return;
    }

    const files_ext =
        options === true || !options.files
            ? ['html', 'js', 'json', 'css', 'svg', 'xml', 'wasm']
            : options.files;
    const glob = new Bun.Glob(`**/*.{${files_ext.join()}}`);
    const files = [
        ...glob.scanSync({
            cwd: directory,
            dot: true,
            absolute: true,
            onlyFiles: true
        })
    ];

    let doBr = false,
        doGz = false;

    if (options === true) {
        doBr = doGz = true;
    } else if (typeof options == 'object') {
        doBr = options.brotli ?? false;
        doGz = options.gzip ?? false;
    }

    await Promise.all(
        files.map((file) =>
            Promise.all([doGz && compress_file(file, 'gz'), doBr && compress_file(file, 'br')])
        )
    );
}

/**
 * @param {string} file
 * @param {'gz' | 'br'} format
 */
async function compress_file(file: string, format: 'gz' | 'br' = 'gz') {
    if (format === 'br' && typeof zlib.createBrotliCompress !== 'function') {
        throw new Error(
            'Brotli compression is not supported, this might happens if you are using Bun to build your project instead of Node JS. See https://github.com/oven-sh/bun/issues/267'
        );
    }
    const compress =
        format == 'br'
            ? zlib.createBrotliCompress({
                  params: {
                      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
                      [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
                      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: statSync(file).size
                  }
              })
            : zlib.createGzip({ level: zlib.constants.Z_BEST_COMPRESSION });

    const source = createReadStream(file);
    const destination = createWriteStream(`${file}.${format}`);

    await pipeline(source, compress, destination);
}

function exportSetupCLI(out: string) {
    let src = readFileSync(`${out}/index.js`, 'utf8');
    const result = src.replace(/^export\s*{/gm, 'export {\nget_hooks,\n');

    writeFileSync(`${out}/index.js`, result, 'utf8');
}

export { type AdapterOptions, type AdapterPlatform };
