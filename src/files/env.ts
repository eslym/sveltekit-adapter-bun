const env = Bun.env;

type ENVS =
    | 'PORT'
    | 'HOST'
    | 'SOCKET'
    | 'PROTOCOL_HEADER'
    | 'OVERRIDE_ORIGIN'
    | 'HOST_HEADER'
    | 'IP_HEADER'
    | 'XFF_DEPTH'
    | 'SERVE_OPTIONS';

export function get_env(name: ENVS, fallback: string): string;
export function get_env(name: ENVS): string | undefined;
export function get_env(name: ENVS, fallback?: string) {
    return env[`HTTP_${name}`] ?? fallback;
}
