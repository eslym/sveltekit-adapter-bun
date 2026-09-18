export type { WebSocketHandler, CreateFetchOptions } from './types';
import type {
    AdapterOptions,
    AdapterPlatform,
    PreCompressOptions,
    WebSocketHandler
} from './types';
import type { Adapter, Builder } from '@sveltejs/kit';
import { name as adapterName } from '../package.json';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import {
    createReadStream,
    createWriteStream,
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
    writeFileSync
} from 'fs';
import { pipeline } from 'stream/promises';
import { uneval } from 'devalue';
import { symServer, symUpgraded, symUpgrades } from './symbols';
import { build_assets_js } from './build-assets';
import { import_peer } from './utils';
import path from 'path/posix';
import { devBridge, devContext } from './dev-internal/context';

const files = fileURLToPath(new URL('./files', import.meta.url));

/**
 * Sveltekit 3 flattened the config, sveltekit 2 keeps everything under `kit`.
 *
 * Sveltekit 3 still answers `config.kit`, but only through a deprecated getter
 * that logs a warning, so this looks at the property descriptor rather than
 * reading the value: sveltekit 3 installs an accessor, sveltekit 2 has a plain
 * data property. Probing for a flattened key such as `paths` would instead
 * misfire on a sveltekit 2 config that happens to carry an unknown top-level
 * key of that name.
 */
function kit_config(builder: Builder): any {
    const config = builder.config as any;
    const descriptor = Object.getOwnPropertyDescriptor(config, 'kit');
    if (!descriptor || descriptor.get) {
        return config;
    }
    return descriptor.value ?? config;
}

/**
 * Write the module which exports the sveltekit server instance.
 *
 * On sveltekit 3 this is `builder.generateServerInstance`. On sveltekit 2 we
 * assemble the same module from `builder.generateManifest`, so that the runtime
 * entry is identical for both.
 */
function write_server_instance(builder: Builder, dest: string, serverDirectory: string) {
    const generate = (builder as any).generateServerInstance as
        ((dest: string, opts?: { serverDirectory?: string }) => void) | undefined;

    if (typeof generate === 'function') {
        generate.call(builder, dest, { serverDirectory });
        return;
    }

    const relative = path.relative(path.dirname(dest), serverDirectory) || '.';
    writeFileSync(
        dest,
        `import { Server } from '${relative.startsWith('.') ? relative : `./${relative}`}/index.js';\n` +
            `const manifest = ${builder.generateManifest!({ relativePath: relative })};\n` +
            `export const server = new Server(manifest);\n`
    );
}

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
    // Sveltekit 3 resolves the function form while validating the config, so the
    // dev server only has to register its hooks before `createServer` rather
    // than before this module is evaluated. Returns an empty object under
    // `vite dev`/`vite preview`, where sveltekit keeps its own request plumbing.
    // Sveltekit 2 ignores the key at runtime, but its `Adapter` type has no
    // `vite` property, so this is spread in rather than written inline to keep
    // the source compiling against both majors.
    const viteHooks: Record<string, unknown> = {
        vite: () => devBridge().vite ?? {}
    };
    return {
        name: adapterName,
        ...viteHooks,
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

            const config = kit_config(builder);

            const tmp = builder.getBuildDirectory(adapterName);

            rmSync(tmp, { force: true, recursive: true });
            mkdirSync(tmp, { recursive: true });

            const { out, precompress } = opts;

            rmSync(out, { force: true, recursive: true });
            mkdirSync(out, { recursive: true });

            builder.log.minor('Copying assets');

            builder.writeClient(`${out}/client${config.paths.base}`);
            builder.writePrerendered(`${out}/prerendered${config.paths.base}`);

            if (precompress) {
                builder.log.minor('Compressing assets');
                await Promise.all([
                    compress(`${out}/client`, precompress),
                    compress(`${out}/prerendered`, precompress)
                ]);
            }

            builder.log.minor('Building server');
            builder.writeServer(tmp);

            write_server_instance(builder, `${tmp}/server.js`, tmp);

            const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

            builder.log.minor('Bundling...');

            const entries = `${tmp}/adapter`;

            builder.copy(files, entries, {
                replace: {
                    SERVER: '../server.js',
                    CUSTOM_LAUNCH: opts.customLaunch ? 'true' : 'false',
                    ASSETS: '../assets.js',
                    SERVE_STATIC: opts.serveStatic ? 'true' : 'false',
                    EXPOSE_BUN_VERSION: opts.exposeBunVersionToClient ? 'true' : 'false',
                    EXPOSE_BUN_REVISION: opts.exposeBunRevisionToClient ? 'true' : 'false'
                }
            });

            const instrumented = builder.hasServerInstrumentationFile?.() ?? false;

            /** extra bundle inputs, keyed by their output name */
            const extraInputs: Record<string, string> = {};

            if (instrumented) {
                // the initializer populates `$env/dynamic/private` before the
                // instrumentation file runs; sveltekit 2 has no such module
                const createInitializer = (builder as any).createInstrumentationInitializer as
                    | ((opts: {
                          outputDirectory: string;
                          environment?: string;
                          serverDirectory?: string;
                      }) => string)
                    | undefined;

                if (typeof createInitializer === 'function') {
                    const initializer = createInitializer.call(builder, {
                        outputDirectory: entries,
                        serverDirectory: tmp
                    });
                    // both bundlers name the output after the entry's basename,
                    // so give it the name we want to reference later
                    const renamed = `${entries}/environment.js`;
                    renameSync(initializer, renamed);
                    extraInputs.environment = renamed;
                }

                extraInputs['instrumentation.server'] = `${tmp}/instrumentation.server.js`;
            }

            // the runtime's `import('../entries/hooks.server.js')` sits in a
            // branch which `CUSTOM_LAUNCH: 'false'` already made dead, but
            // bundlers resolve imports before they eliminate dead code, and the
            // file only exists when the app has a `hooks.server` file.
            const hooks = '../entries/hooks.server.js';
            const hooksFile = `${tmp}/entries/hooks.server.js`;
            // Only stub it out when it genuinely is not there. Sveltekit's own
            // server imports the same file to load the app's hooks, and on the
            // bun path `external` is matched by resolved path with no way to
            // tell the two importers apart, so externalising it unconditionally
            // would strip the app's real hooks out of the bundle.
            const bundleHooks = opts.customLaunch || existsSync(hooksFile);

            if (opts.bundler !== 'bun') {
                // we bundle the Vite output so that deployments only need
                // their production dependencies. Anything in devDependencies
                // will get included in the bundled code
                await build({
                    configFile: false,
                    plugins: [
                        {
                            name: 'adapter-bun-externals',
                            resolveId(source, importer) {
                                // match the whole copied runtime directory, not
                                // just its entry: `build.ts` bundles it with
                                // `splitting: true`, so these imports can move
                                // into a chunk at any time
                                if (!importer?.startsWith(`${entries}/`)) {
                                    return null; // Let Vite handle everything else normally
                                }
                                // `assets.js` is generated next to the bundle,
                                // after this build has already run
                                if (source === '../assets.js') {
                                    return { id: source, external: true };
                                }
                                if (source === hooks && !bundleHooks) {
                                    return { id: source, external: true };
                                }
                                return null;
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
                                index: `${entries}/index.js`,
                                ...extraInputs
                            },
                            output: {
                                // vite picks `.mjs` for SSR output unless the
                                // app's package.json says `type: module`, but
                                // the entry shim and `builder.instrument` both
                                // reference these by name. sveltekit pins the
                                // same thing for its own build.
                                entryFileNames: '[name].js',
                                // flat, i.e. every chunk sits beside the entry.
                                // the runtime imports `../assets.js`, which is
                                // external, and rollup writes an external id
                                // into each importing chunk verbatim rather
                                // than recomputing it per chunk - so a chunk
                                // one directory deeper would resolve it to
                                // `server/assets.js` and fail at startup.
                                // Which chunk ends up holding that import
                                // depends on the app, so depth has to be
                                // uniform rather than merely happen to match.
                                chunkFileNames: '[name]-[hash].js'
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
                    entrypoints: [`${entries}/index.js`, ...Object.values(extraInputs)],
                    outdir: `${out}/server`,
                    sourcemap:
                        opts.sourceMap === true ? 'linked' : opts.sourceMap ? 'inline' : 'none',
                    naming: {
                        entry: '[name].[ext]',
                        chunk: 'chunks/[name]-[hash].[ext]'
                    },
                    external: [
                        path.resolve(`${tmp}/assets.js`),
                        ...(bundleHooks ? [] : [path.resolve(hooksFile)]),
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

            const immutable = `${config.appDir}/immutable/`.replace(/^\/?/, '/');

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

            if (instrumented) {
                builder.log.minor('Instrumenting server');
                builder.instrument({
                    entrypoint: `${out}/index.js`,
                    instrumentation: `${out}/server/instrumentation.server.js`,
                    ...(extraInputs.environment
                        ? { initializer: `${out}/server/environment.js` }
                        : ({} as any)),
                    module: {
                        generateText: ({
                            instrumentation,
                            start,
                            initializer
                        }: {
                            instrumentation: string;
                            start: string;
                            initializer?: string;
                        }) =>
                            '#!/usr/bin/env bun\n// @bun\n' +
                            (initializer ? `import ${import_specifier(initializer)};\n` : '') +
                            `import ${import_specifier(instrumentation)};\n` +
                            `await import(${import_specifier(start)});\n`
                    }
                } as any);
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
                writeFileSync(`${out}/prerendered.js`, js);
            }

            builder.log.success(`Build done.`);
        },
        emulate() {
            return {
                platform(): AdapterPlatform {
                    // set by the dev server for the request being handled; absent
                    // during build and prerender
                    const context = devContext();
                    const bunServer = context ? context.server : (globalThis as any)[symServer];
                    return {
                        get originalRequest(): Request {
                            if (context) {
                                return context.request;
                            }
                            throw Error('Failed to emulate platform.originalRequest');
                        },
                        get bunServer() {
                            if (bunServer) {
                                return bunServer;
                            }
                            throw Error('Failed to emulate platform.bunServer');
                        },
                        upgrade(ws, headers = undefined) {
                            if (context) {
                                const upgraded = context.server.upgrade(context.request, {
                                    data: ws,
                                    headers
                                });
                                (context.request as any)[symUpgraded] = upgraded;
                                return upgraded;
                            }
                            throw Error('Failed to emulate platform.upgrade');
                        },
                        markForUpgrade(res, ws) {
                            if (!bunServer) {
                                throw Error('Failed to emulate platform.markForUpgrade');
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
            read: () => true,
            instrumentation: () => true
        }
    };
}

function import_specifier(file: string) {
    return JSON.stringify(file.startsWith('.') ? file : `./${file}`);
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
