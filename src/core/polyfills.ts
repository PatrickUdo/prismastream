// Minimal polyfills for a bare JavaScriptCore context (Apple TV). JSC only guarantees the
// ECMAScript built-ins (incl. Intl and String#normalize); there is no window, console,
// structuredClone, URL or TextDecoder. The core code paths avoid URL/TextDecoder/crypto
// entirely; this file only fills the few globals that third-party code might touch.
// Every check is a `typeof` guard, so loading never throws.

type Global = Record<string, unknown>;

const g: Global =
	typeof globalThis !== 'undefined'
		? (globalThis as unknown as Global)
		: // Very old engines: the global object via a sloppy-mode function.
			(Function('return this')() as Global);

if (typeof g.globalThis === 'undefined') g.globalThis = g;

if (typeof g.console === 'undefined') {
	const noop = () => {};
	g.console = { log: noop, info: noop, warn: noop, error: noop, debug: noop, trace: noop };
}

if (typeof g.structuredClone === 'undefined') {
	// Good enough for the plain JSON data the core handles (no Map/Set/Date/cycles).
	g.structuredClone = <T>(value: T): T =>
		value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

export {};
