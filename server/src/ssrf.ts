// SSRF protection for the proxy: only public unicast addresses may be contacted.
// Hostnames are resolved through `safeLookup`, which is passed to http(s).request so
// the validated address is the one actually connected to (no DNS-rebinding window).
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
const V4: [string, number][] = [
	['0.0.0.0', 8], // "this" network
	['10.0.0.0', 8], // private
	['100.64.0.0', 10], // carrier-grade NAT
	['127.0.0.0', 8], // loopback
	['169.254.0.0', 16], // link-local (cloud metadata!)
	['172.16.0.0', 12], // private
	['192.0.0.0', 24], // IETF protocol assignments
	['192.0.2.0', 24], // TEST-NET-1
	['192.88.99.0', 24], // 6to4 relay anycast
	['192.168.0.0', 16], // private
	['198.18.0.0', 15], // benchmarking
	['198.51.100.0', 24], // TEST-NET-2
	['203.0.113.0', 24], // TEST-NET-3
	['224.0.0.0', 4], // multicast
	['240.0.0.0', 4] // reserved + broadcast
];
const V6: [string, number][] = [
	['::', 128], // unspecified
	['::1', 128], // loopback
	['64:ff9b::', 96], // NAT64 (embeds IPv4)
	['64:ff9b:1::', 48], // local-use NAT64
	['100::', 64], // discard
	['2001::', 23], // IETF protocol assignments (Teredo, ORCHID, ...)
	['2001:db8::', 32], // documentation
	['2002::', 16], // 6to4 (embeds IPv4)
	['fc00::', 7], // unique local
	['fe80::', 10], // link-local
	['fec0::', 10], // site-local (deprecated)
	['ff00::', 8] // multicast
];
for (const [net, prefix] of V4) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of V6) blocked.addSubnet(net, prefix, 'ipv6');

/** Extracts the IPv4 address from an IPv4-mapped IPv6 address (::ffff:a.b.c.d in any notation). */
function mappedV4(addr: string): string | null {
	let canon: string;
	try {
		canon = new URL(`http://[${addr}]/`).hostname.slice(1, -1);
	} catch {
		return null;
	}
	const m = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canon);
	if (!m) return null;
	const hi = parseInt(m[1], 16);
	const lo = parseInt(m[2], 16);
	return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** True only for globally routable unicast addresses. Unknown input counts as not public. */
export function isPublicAddress(address: string): boolean {
	const addr = address.replace(/^\[|\]$/g, '').replace(/%.*$/, '');
	const family = isIP(addr);
	if (family === 4) return !blocked.check(addr, 'ipv4');
	if (family === 6) {
		const v4 = mappedV4(addr);
		if (v4) return !blocked.check(v4, 'ipv4');
		return !blocked.check(addr, 'ipv6');
	}
	return false;
}

export class BlockedAddressError extends Error {
	code = 'EBLOCKED';
	constructor(host: string) {
		super(`Address not allowed: ${host}`);
	}
}

type LookupCb = (
	err: NodeJS.ErrnoException | null,
	address: string | LookupAddress[],
	family?: number
) => void;

/**
 * Drop-in replacement for dns.lookup that rejects when ANY resolved address is non-public.
 * Handles both the single-address and the `{ all: true }` calling convention.
 */
export function createSafeLookup(allowPrivate = false) {
	return function safeLookup(hostname: string, options: unknown, callback?: LookupCb) {
		const cb = (typeof options === 'function' ? options : callback) as LookupCb;
		const opts = (typeof options === 'object' && options ? options : {}) as {
			all?: boolean;
			family?: number;
		};
		dnsLookup(hostname, { all: true, family: opts.family ?? 0 }, (err, addresses) => {
			if (err) return cb(err, '');
			const list = addresses as LookupAddress[];
			if (list.length === 0) return cb(new BlockedAddressError(hostname), '');
			if (!allowPrivate && list.some((a) => !isPublicAddress(a.address)))
				return cb(new BlockedAddressError(hostname), '');
			if (opts.all) return cb(null, list);
			cb(null, list[0].address, list[0].family);
		});
	};
}

/** Validates a literal-IP host before connecting (lookup is skipped for IP literals). */
export function hostAllowed(hostname: string, allowPrivate = false): boolean {
	const h = hostname.replace(/^\[|\]$/g, '');
	if (h === '') return false;
	if (isIP(h)) return allowPrivate || isPublicAddress(h);
	return true;
}
