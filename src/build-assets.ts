import type { Glob } from 'bun';
import { join } from 'path/posix';

namespace T {
    export function stringify(obj: any) {
        return JSON.stringify(obj, null, 2).replace(
            /[\u007F-\uFFFF]/g,
            (c) => '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4)
        );
    }

    export function* concat(...args: Iterable<string>[]) {
        for (const arg of args) {
            yield* arg;
        }
    }

    export function fn(name: string, wraps: Iterable<string>) {
        return concat(name, '(', wraps, ')');
    }

    export function prop(name: Iterable<string>, value: Iterable<string>) {
        return concat(name, ': ', value);
    }

    export function obj(pairs: [Iterable<string>, Iterable<string>][]) {
        return concat(
            '{\n  ',
            indent(
                join(
                    pairs.map(([k, v]) => prop(k, v)),
                    ',\n'
                )
            ),
            '\n}'
        );
    }

    export function* join(args: Iterable<Iterable<string>>, seperator: string) {
        let last: Iterable<string> | null = null;
        for (const arg of args) {
            if (last) {
                yield* last;
                yield* seperator;
            }
            last = arg;
        }
        if (last) yield* last;
    }

    export function* indent(src: Iterable<string>) {
        for (const str of src) {
            for (const char of str) {
                yield char;
                if (char === '\n') yield '  ';
            }
        }
    }

    export function collect(...src: Iterable<string>[]) {
        return Array.from(concat(...src)).join('');
    }
}

function to_base36(n: number) {
    return n.toString(36);
}

function get_imports_n(
    imports: Iterable<string>[],
    declared: Map<string, string>,
    import_path: string
) {
    let n = declared.get(import_path);
    if (n === undefined) {
        n = to_base36(imports.length);
        imports.push(
            T.concat(`import f_${n} from `, T.stringify(import_path), ' with { type: "file" };')
        );
        declared.set(import_path, n);
    }
    return n;
}

function normalize_path(path: string) {
    return path.replace(/\\/g, '/');
}

export async function build_assets_js(
    base_path: string,
    client_files: AsyncIterableIterator<string>,
    prerendered_pages: Map<string, { file: string }>,
    immutable_prefix: string,
    ignores: Glob[]
): Promise<string> {
    const imports: Iterable<string>[] = [];
    const records: Iterable<string>[] = [];
    const declared = new Map<string, string>();

    for await (const path of client_files) {
        if (ignores.some((ignore) => ignore.match(path))) continue;
        const normalized = normalize_path(path);
        records.push(
            await build_asset_record(
                declared,
                imports,
                normalized.replace(/^(?:\.?\/)?/, '/'),
                join(base_path, 'client', normalized),
                './' + join('client', normalized),
                immutable_prefix
            )
        );
    }

    for await (const [pathname, target] of prerendered_pages) {
        records.push(
            await build_asset_record(
                declared,
                imports,
                pathname,
                join(base_path, 'prerendered', target.file),
                './' + join('prerendered', target.file),
                immutable_prefix
            )
        );
    }

    return T.collect(
        '// @bun\n',
        "import { file } from 'bun';\n",
        T.join(imports, '\n'),
        '\n',
        'export const assets = new Map([\n  ',
        T.indent(T.join(records, ',\n')),
        '\n]);',
        '\n'
    );
}

async function build_asset_record(
    declared: Map<string, string>,
    imports: Iterable<string>[],
    pathname: string,
    filepath: string,
    import_path: string,
    immutable_prefix: string
) {
    const file_n = get_imports_n(imports, declared, import_path);
    let br_n, gz_n;
    if (Bun.file(filepath + '.br').size) {
        br_n = get_imports_n(imports, declared, import_path + '.br');
    }
    if (Bun.file(filepath + '.gz').size) {
        gz_n = get_imports_n(imports, declared, import_path + '.gz');
    }
    const file = Bun.file(filepath);
    const sha = Bun.SHA1.hash(await file.arrayBuffer(), 'hex');
    return T.concat(
        '[\n  ',
        T.indent(
            T.join(
                [
                    T.stringify(pathname),
                    T.obj([
                        ['file', T.fn('file', `f_${file_n}`)],
                        ['immutable', pathname.startsWith(immutable_prefix) ? 'true' : 'false'],
                        [
                            'headers',
                            T.stringify([new Date(file.lastModified).toUTCString(), sha, file.size])
                        ],
                        [
                            'compression',
                            T.concat(
                                '[',
                                br_n ? T.fn('file', `f_${br_n}`) : 'undefined',
                                ', ',
                                gz_n ? T.fn('file', `f_${gz_n}`) : 'undefined',
                                ']'
                            )
                        ]
                    ])
                ],
                ',\n'
            )
        ),
        '\n]'
    );
}
