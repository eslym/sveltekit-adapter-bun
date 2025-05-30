if (!Bun.env.GITHUB_REF?.startsWith('refs/tags/')) {
    throw new Error('This script should only be run in a GitHub Actions environment with a tag.');
}

const semver = Bun.env.GITHUB_REF.replace('refs/tags/', '');

const tag = semver.includes('-') ? 'next' : 'latest';

console.log('tag:', tag);
if (Bun.env.GITHUB_OUTPUT) {
    Bun.write(Bun.env.GITHUB_OUTPUT, `tag=${tag}`);
} else {
    console.log(`::set-output name=tag::${tag}`);
}
