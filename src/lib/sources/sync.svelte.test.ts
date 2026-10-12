import { describe, expect, it, vi } from 'vitest';
import type { SourceConfig } from '#lib/types.ts';
import {
	addSource,
	applySynced,
	onChange,
	removeSource,
	sources,
	updateSource
} from '#lib/sources/index.svelte.ts';
import { credentials } from '#lib/sources/credentials.ts';

// Runs in node: no IndexedDB (cache disabled) and credentials kept in memory.
describe('sources sync hooks', () => {
	it('fires onChange for user mutations but not for applySynced', async () => {
		const cb = vi.fn();
		const off = onChange(cb);
		const a = await addSource({
			type: 'xtream',
			name: 'A',
			serverUrl: 'http://panel.example:8080',
			username: 'u',
			password: 'pw-one'
		});
		expect(cb).toHaveBeenCalledTimes(1);
		await updateSource(a.id, { name: 'A2' });
		expect(cb).toHaveBeenCalledTimes(2);

		const synced: SourceConfig[] = [
			{ id: 'sample', type: 'sample', name: 'Demo', enabled: false, addedAt: 0 },
			{
				id: a.id,
				type: 'xtream',
				name: 'A renamed',
				enabled: true,
				addedAt: a.addedAt,
				serverUrl: 'http://panel.example:8080',
				username: 'u'
			},
			{
				id: 'src_remote',
				type: 'm3u',
				name: 'Remote',
				enabled: true,
				addedAt: 1,
				playlistUrl: 'http://pl.example/get.php?username=***&password=***'
			}
		];
		await applySynced(synced, {
			[a.id]: { password: 'pw-two' },
			src_remote: { playlistUrl: 'http://pl.example/get.php?username=x&password=y' }
		});
		expect(cb).toHaveBeenCalledTimes(2); // no echo

		expect(sources.get(a.id)?.name).toBe('A renamed');
		expect(sources.get('sample')?.enabled).toBe(false);
		expect(sources.get('src_remote')).toMatchObject({ type: 'm3u', name: 'Remote' });
		expect((await credentials.load(a.id)).password).toBe('pw-two');
		expect((await credentials.load('src_remote')).playlistUrl).toContain('password=y');
		// Never a secret in the persisted entries
		expect(JSON.stringify($state.snapshot(sources.list))).not.toContain('pw-two');

		// Missing from the synced list → removed locally (sample stays)
		await applySynced([{ id: 'sample', type: 'sample', name: 'Demo', enabled: true, addedAt: 0 }]);
		expect(sources.get(a.id)).toBeUndefined();
		expect(sources.get('src_remote')).toBeUndefined();
		expect(sources.get('sample')?.enabled).toBe(true);
		expect(await credentials.load(a.id)).toEqual({});
		expect(cb).toHaveBeenCalledTimes(2);

		const b = await addSource({ type: 'm3u', playlistUrl: 'http://pl.example/list.m3u' });
		await removeSource(b.id);
		expect(cb).toHaveBeenCalledTimes(4);
		off();
		await sources.setProxyUrl('');
		expect(cb).toHaveBeenCalledTimes(4);
	});
});
