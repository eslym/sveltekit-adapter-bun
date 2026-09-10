export type { WebSocketHandler, CreateFetchOptions } from './types';
import type {
    AdapterOptions,
    AdapterPlatform,
    PreCompressOptions,
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
import { uneval } from 'devalue';
import { symServer, symUpgrades } from './symbols';
import { build_assets_js } from './build-assets';
import { import_peer } from './utils';
import path from 'path/posix';

const files = fileURLToPath(new URL('./files', import.meta.url));

export default function adapter(userOpts: AdapterOptions = {}): Adapter {
    const opts: Required<AdapterOptions> = {
        out: './build',
        precompress: false,
        exportPrerender: false,
        serveStatic: true,
        staticIgnores: ['**/.*'],
        bundler: 'rollup',
        sourceMap: true,
        rollupMinify: false,
        bunBuildMinify: false,
        exposeBunVersionToClient: false,
        exposeBunRevisionToClient: false,
        customLaunch: false,
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

            const { build } = await import_peer<typeof import('vite')>('vite');

            const tmp = builder.getBuildDirectory(adapterName);

            builder.rimraf(tmp);
            builder.mkdirp(tmp);

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

            builder.log.minor('Building server');
            builder.writeServer(tmp);

            writeFileSync(
                `${tmp}/manifest.js`,
                `export const manifest = ${builder.generateManifest({ relativePath: './' })};\n\n` +
                    `export const prerendered = new Set(${JSON.stringify(builder.prerendered.paths)});\n`
            );

            const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

            builder.log.minor('Bundling...');

            builder.copy(files, `${tmp}/adapter`, {
                replace: {
                    SERVER: '../index.js',
                    CUSTOM_LAUNCH: opts.customLaunch ? 'true' : 'false',
                    MANIFEST: '../manifest.js',
                    ASSETS: '../assets.js',
                    SERVE_STATIC: opts.serveStatic ? 'true' : 'false',
                    EXPOSE_BUN_VERSION: opts.exposeBunVersionToClient ? 'true' : 'false',
                    EXPOSE_BUN_REVISION: opts.exposeBunRevisionToClient ? 'true' : 'false'
                }
            });

            if (opts.bundler !== 'bun') {
                // we bundle the Vite output so that deployments only need
                // their production dependencies. Anything in devDependencies
                // will get included in the bundled code
                await build({
                    configFile: false,
                    plugins: [
                        {
                            name: 'ignore-assets-js',
                            resolveId(source, importer) {
                                builder.log.info(`Resolving import: ${source} from ${importer}`);
                                // Match the exact relative path you want Vite to ignore
                                if (
                                    source === `../assets.js` &&
                                    importer === `${tmp}/adapter/index.js`
                                ) {
                                    return { id: source, external: true };
                                }
                                return null; // Let Vite handle everything else normally
                            }
                        }
                    ],
                    build: {
                        outDir: `${out}/server`,
                        ssr: true,
                        sourcemap: opts.sourceMap,
                        minify: opts.rollupMinify,
                        rollupOptions: {
                            input: {
                                index: `${tmp}/adapter/index.js`,
                                manifest: `${tmp}/manifest.js`
                            },
                            external: [
                                // dependencies could have deep exports, so we need a regex
                                ...Object.keys(pkg.dependencies || {}).map(
                                    (d) => new RegExp(`^${d}(\\/.*)?$`)
                                )
                            ],
                            onLog(level, log) {
                                builder.log[level === 'debug' ? 'minor' : level](log.message);
                            }
                        }
                    }
                });
            } else {
                const res = await Bun.build({
                    target: 'bun',
                    entrypoints: [`${tmp}/adapter/index.js`, `${tmp}/manifest.js`],
                    outdir: `${out}/server`,
                    sourcemap:
                        opts.sourceMap === true ? 'linked' : opts.sourceMap ? 'inline' : 'none',
                    naming: {
                        entry: '[name].[ext]',
                        chunk: 'chunks/[name]-[hash].[ext]'
                    },
                    external: [
                        path.resolve(`${tmp}/assets.js`),
                        ...Object.keys(pkg.dependencies || {})
                    ],
                    splitting: true,
                    format: 'esm',
                    minify: opts.bunBuildMinify
                });

                for (const msg of res.logs) {
                    switch (msg.level) {
                        case 'info':
                            builder.log.info(Bun.inspect(msg, { colors: true }));
                            break;
                        case 'warning':
                            builder.log.warn(Bun.inspect(msg, { colors: true }));
                            break;
                        case 'error':
                            builder.log.error(Bun.inspect(msg, { colors: true }));
                            break;
                    }
                }

                if (!res.success) {
                    process.exit(1);
                }
            }

            const immutable = `${builder.config.kit.appDir}/immutable/`.replace(/^\/?/, '/');

            const staticIgnores = opts.staticIgnores.map((p) => new Bun.Glob(p));
            const clientFiles = new Bun.Glob('**/*');
            const clientPath = `${out}/client`;

            const assets_js = opts.serveStatic
                ? await build_assets_js(
                      out,
                      clientFiles.scan({
                          cwd: clientPath,
                          dot: true,
                          absolute: false,
                          onlyFiles: true
                      }),
                      builder.prerendered.pages,
                      immutable,
                      staticIgnores
                  )
                : '// @bun\nexport const assets = new Map();';

            await Bun.write(`${out}/assets.js`, assets_js);
            await Bun.write(
                `${out}/index.js`,
                "#!/usr/bin/env bun\n// @bun\nimport {main} from './server/index.js';\nmain();"
            );

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
                writeFileSync(`${out}/prerendered.js`, js);
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
                                throw Error('Dev Bun http server not found');
                            }
                            return (globalThis as any)[symServer];
                        },
                        markForUpgrade(res, ws) {
                            if (!(symUpgrades in globalThis)) {
                                throw Error('Dev Bun http server not found');
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
        },
        supports: {
            read: () => true
        }
    };
}

const default_minimum_size = 1024;

async function compress(directory: string, options: true | PreCompressOptions | number) {
    if (!existsSync(directory)) {
        return;
    }

    const files_ext =
        options === true || typeof options === 'number' || !options.files
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

    let doBr: false | number = false,
        doGz: false | number = false;

    if (options === true) {
        doBr = doGz = default_minimum_size;
    } else if (typeof options == 'number') {
        doBr = doGz = options;
    } else if (typeof options == 'object') {
        doBr =
            typeof options.brotli === 'number'
                ? options.brotli
                : options.brotli
                  ? default_minimum_size
                  : false;
        doGz =
            typeof options.gzip === 'number'
                ? options.gzip
                : options.gzip
                  ? default_minimum_size
                  : false;
    }

    await Promise.all(
        files.map((file) => {
            const size = Bun.file(file).size;
            return Promise.all([
                doGz !== false && size >= doGz && compress_file(file, 'gz'),
                doBr !== false && size >= doBr && compress_file(file, 'br')
            ]);
        })
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

export { type AdapterOptions, type AdapterPlatform };
export type { LaunchParam } from './types';
