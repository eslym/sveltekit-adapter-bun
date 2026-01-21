import type { Server } from 'bun';
import type { EventEmitter } from 'events';
import type { ServerResponse } from 'http';
import type { Plugin } from 'vite';
import { satisfies } from './version';
import type { WebSocketHandler } from '../types';

export const bunternal = Symbol.for('::bunternal::');

function setupBunternalOld(
    socket: any,
    bunServer: Server<WebSocketHandler>,
    httpServer: EventEmitter,
    httpRes: ServerResponse,
    bunReq: Request
) {
    socket[bunternal] = [bunServer, httpServer, httpRes, bunReq];
}

function setupBunternalNew(
    socket: any,
    _: Server<WebSocketHandler>,
    httpServer: EventEmitter,
    httpRes: ServerResponse,
    bunReq: Request
) {
    socket[bunternal] = [httpServer, httpRes, bunReq];
}

export const setupBunternal = satisfies('<1.1.25') ? setupBunternalOld : setupBunternalNew;

export function patchBunternal(src: string) {
    const bunReqIndex = satisfies('<1.1.25') ? 2 : 3;

    const getRequestPatch = `
	if(Symbol.for('::bunternal::') in request.socket) {
		return request.socket[Symbol.for('::bunternal::')][${bunReqIndex}];
	}
`;

    const setResponsePatch = `
	if('Bun' in globalThis && '_reply' in res) {
		res._reply(response);
		return;
	}
`;
    const getReq = src.indexOf('export async function getRequest');
    const getReqStart = src.indexOf('\n', getReq);

    const setRes = src.indexOf('export async function setResponse');
    const setResStart = src.indexOf('\n', setRes);

    return src
        .slice(0, getReqStart)
        .concat(getRequestPatch)
        .concat(src.slice(getReqStart, setResStart))
        .concat(setResponsePatch)
        .concat(src.slice(setResStart));
}

export const bunternalPlugin: Plugin = {
    name: 'sveltekit-adapter-bun/bunternal',
    transform(src, id, options) {
        if (!options?.ssr) return;
        if (!id.endsWith('/node_modules/@sveltejs/kit/src/exports/node/index.js')) return;

        return {
            code: patchBunternal(src)
        };
    }
};
