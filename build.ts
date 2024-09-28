import { join } from 'path';

await Bun.$`rm -rf ${join(import.meta.dir, 'dist')}`;

import { dependencies } from './package.json';

const buildIndex = await Bun.build({
    entrypoints: [join(import.meta.dir, 'src/index.ts')],
    outdir: join(import.meta.dir, 'dist'),
    external: [...Object.keys(dependencies), 'vite'],
    target: 'bun'
});

for (const log of buildIndex.logs) {
    console.log(log);
}

if (!buildIndex.success) {
    process.exit(1);
}

for (const output of buildIndex.outputs) {
    console.log(output.path);
}

const buildBin = await Bun.build({
    entrypoints: [join(import.meta.dir, 'src/bin.ts')],
    outdir: join(import.meta.dir, 'dist'),
    external: [...Object.keys(dependencies), 'vite'],
    target: 'bun'
});

for (const log of buildBin.logs) {
    console.log(log);
}

if (!buildBin.success) {
    process.exit(1);
}

for (const output of buildBin.outputs) {
    console.log(output.path);
}

const buildFiles = await Bun.build({
    entrypoints: [join(import.meta.dir, 'src/files/index.ts')],
    outdir: join(import.meta.dir, 'dist/files'),
    external: ['SERVER', 'MANIFEST'],
    target: 'bun'
});

for (const log of buildFiles.logs) {
    console.log(log);
}

if (!buildFiles.success) {
    process.exit(1);
}

for (const output of buildFiles.outputs) {
    console.log(output.path);
}

await Bun.$`${process.execPath} x tsc -p tsconfig-dts.json`;

if (Bun.env.GITHUB_REF_TYPE === 'tag') {
    const pkg = await Bun.file('package.json').json();
    pkg.version = Bun.env.GITHUB_REF_NAME;
    await Bun.write('package.json', JSON.stringify(pkg, null, 2));
}

console.log('done');
