// Runs the mock IPTV provider in its own process (memory test: keeps its memory out of the
// measured server process). Prints the base url on stdout.
import { startMockIptv } from './mock-iptv.ts';

const opts = JSON.parse(process.argv[2] ?? '{}');
const mock = await startMockIptv(opts);
process.stdout.write(mock.url + '\n');
process.on('SIGTERM', () => void mock.close().then(() => process.exit(0)));
