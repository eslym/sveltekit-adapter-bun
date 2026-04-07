import { BlockList, isIPv4, isIPv6 } from 'node:net';

function isCidr4(str: string) {
    const match = str.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/);
    if (!match) return false;
    const [_, ip, prefix] = match;
    if (!isIPv4(ip)) return false;
    const prefixNum = parseInt(prefix, 10);
    return prefixNum >= 0 && prefixNum <= 32;
}

function isCidr6(str: string) {
    const match = str.match(/^([a-fA-F0-9:]+)\/(\d{1,3})$/);
    if (!match) return false;
    const [_, ip, prefix] = match;
    if (!isIPv6(ip)) return false;
    const prefixNum = parseInt(prefix, 10);
    return prefixNum >= 0 && prefixNum <= 128;
}

function isRange4(str: string) {
    const match = str.match(
        /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})-(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/
    );
    if (!match) return false;
    const [_, start, end] = match;
    return isIPv4(start) && isIPv4(end);
}

function isRange6(str: string) {
    const match = str.match(/^([a-fA-F0-9:]+)-([a-fA-F0-9:]+)$/);
    if (!match) return false;
    const [_, start, end] = match;
    return isIPv6(start) && isIPv6(end);
}

export function create_blocklist(entries: string[]) {
    const blocklist = new BlockList();
    for (const entry of entries) {
        if (isCidr4(entry)) {
            const [ip, prefix] = entry.split('/');
            blocklist.addSubnet(ip, parseInt(prefix, 10));
        } else if (isCidr6(entry)) {
            const [ip, prefix] = entry.split('/');
            blocklist.addSubnet(ip, parseInt(prefix, 10));
        } else if (isRange4(entry)) {
            const [start, end] = entry.split('-');
            blocklist.addRange(start, end);
        } else if (isRange6(entry)) {
            const [start, end] = entry.split('-');
            blocklist.addRange(start, end);
        } else if (isIPv4(entry) || isIPv6(entry)) {
            blocklist.addAddress(entry);
        } else {
            throw new Error(`Invalid blocklist entry: ${entry}`);
        }
    }
    return blocklist;
}
