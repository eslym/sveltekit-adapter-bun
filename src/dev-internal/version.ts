export function satisfies(range: string) {
    return Bun.semver.satisfies(Bun.version, range);
}
