// Hono environment shared by all route modules.
import type { DeviceRow } from './store.ts';

export type Env = {
	Bindings: { incoming?: { socket?: { remoteAddress?: string } } };
	Variables: { device: DeviceRow };
};
