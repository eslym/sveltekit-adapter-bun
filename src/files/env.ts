import parse_duration from 'parse-duration';

const env = Bun.env;

type HTTP_ENVS =
    | 'PORT'
    | 'HOST'
    | 'SOCKET'
    | 'PROTOCOL_HEADER'
    | 'OVERRIDE_ORIGIN'
    | 'HOST_HEADER'
    | 'IP_HEADER'
    | 'XFF_DEPTH'
    | 'IDLE_TIMEOUT'
    | 'MAX_BODY';

export function http_env(name: HTTP_ENVS): string | undefined;
export function http_env(name: HTTP_ENVS, fallback: string): string;
export function http_env(name: HTTP_ENVS, fallback?: string) {
    return env[`HTTP_${name}`] ?? fallback;
}

type WS_ENVS = 'IDLE_TIMEOUT' | 'MAX_PAYLOAD' | 'NO_PING';

export function ws_env(name: WS_ENVS): string | undefined;
export function ws_env(name: WS_ENVS, fallback: string): string;
export function ws_env(name: WS_ENVS, fallback?: string) {
    return env[`WS_${name}`] ?? fallback;
}

export function int_env<N extends string, FN extends (name: N) => string | undefined>(
    fn: FN,
    name: N,
    fallback: number
): number {
    const value = fn(name);
    if (!value) return fallback;
    const val = parseInt(value);
    return isNaN(val) ? fallback : val;
}

export function duration_env<N extends string, FN extends (name: N) => string | undefined>(
    fn: FN,
    name: N,
    fallback: number
): number {
    const value = fn(name);
    if (!value) return fallback;
    return parse_duration(value, 's') ?? fallback;
}

const bytes = {
    b: 1,
    kb: 1000,
    mb: 1000000,
    gb: 1000000000,
    tb: 1000000000000,

    kib: 1024,
    mib: 1048576,
    gib: 1073741824,
    tib: 1099511627776
} as Record<string, number>;

function byte(str: string) {
    str = str.toLowerCase();
    return str.endsWith('b') ? str : str + 'b';
}

export function bytes_env<N extends string, FN extends (name: N) => string | undefined>(
    fn: FN,
    name: N,
    fallback: number
): number {
    const value = fn(name);
    if (!value) return fallback;
    const size_pattern = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*((?:[kmgt]i?)?b?)/gi;
    let match = size_pattern.exec(value);
    if (!match) return fallback;
    let val = 0;
    while (match) {
        const [_, num, unit] = match;
        val += parseFloat(num) * bytes[byte(unit)];
        match = size_pattern.exec(value);
    }
    return val;
}

export function bool_env<N extends string, FN extends (name: N) => string | undefined>(
    fn: FN,
    name: N,
    fallback: boolean = false
): boolean {
    const value = fn(name);
    if (!value) return fallback;
    return value === 'true';
}
