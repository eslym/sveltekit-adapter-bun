import parse_duration from 'parse-duration';

const env = Bun.env;

type ENV_NAMES =
    | 'HTTP_PORT'
    | 'HTTP_HOST'
    | 'HTTP_SOCKET'
    | 'HTTP_PROTOCOL_HEADER'
    | 'HTTP_OVERRIDE_ORIGIN'
    | 'HTTP_HOST_HEADER'
    | 'HTTP_IP_HEADER'
    | 'HTTP_XFF_DEPTH'
    | 'HTTP_IDLE_TIMEOUT'
    | 'HTTP_MAX_BODY'
    | 'WS_IDLE_TIMEOUT'
    | 'WS_MAX_PAYLOAD'
    | 'WS_NO_PING'
    | 'CACHE_ASSET_AGE'
    | 'CACHE_IMMUTABLE_AGE';

export function get_env(name: ENV_NAMES): string | undefined;
export function get_env(name: ENV_NAMES, fallback: string): string;
export function get_env(name: ENV_NAMES, fallback?: string) {
    return env[name] ?? fallback;
}

export function int_env(name: ENV_NAMES, fallback: number): number {
    const value = get_env(name);
    if (!value) return fallback;
    const val = parseInt(value);
    return isNaN(val) || !isFinite(val) ? fallback : val;
}

export function duration_env(name: ENV_NAMES, fallback: number): number {
    const value = get_env(name);
    if (!value) return fallback;
    const s = parse_duration(value, 's') ?? fallback;
    return s < 0 ? fallback : s;
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

export function bytes_env(name: ENV_NAMES, fallback: number): number {
    const value = get_env(name);
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

export function bool_env(name: ENV_NAMES, fallback: boolean = false): boolean {
    const value = get_env(name);
    if (!value) return fallback;
    return value === 'true';
}
