// Entry point: `node src/main.ts` (Node >= 23.6 strips TypeScript types natively).
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const ctx = createApp(config);

const server = serve({ fetch: ctx.app.fetch, port: config.port, hostname: config.host }, (info) => {
	console.log(`PrismaStream sync-server luistert op http://${info.address}:${info.port}`);
	if (config.proxyAllowPrivate) console.warn('WAARSCHUWING: PROXY_ALLOW_PRIVATE staat aan.');
});

let stopping = false;
function shutdown(signal: string) {
	if (stopping) return;
	stopping = true;
	console.log(`${signal} ontvangen, server stopt…`);
	ctx.events.closeAll();
	server.close(() => {
		ctx.dispose();
		process.exit(0);
	});
	setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
