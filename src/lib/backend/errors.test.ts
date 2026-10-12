import { describe, expect, it } from 'vitest';
import { BackendError, BackendOfflineError } from './client.ts';
import { sourceErrorFromException, sourceErrorMessage } from './errors.ts';

describe('source error messages', () => {
	it('maps provider codes to plain-language keys', () => {
		expect(sourceErrorMessage('auth').key).toBe('cloud.source.error.auth');
		expect(sourceErrorMessage('unreachable').key).toBe('cloud.source.error.unreachable');
		expect(sourceErrorMessage('timeout').key).toBe('cloud.source.error.timeout');
		expect(sourceErrorMessage('http_404').key).toBe('cloud.source.error.notFound');
		expect(sourceErrorMessage('http', { status: 500 })).toEqual({
			key: 'cloud.source.error.http',
			params: { status: 500 }
		});
	});

	it('shows the expiry date when known', () => {
		const m = sourceErrorMessage('expired', { expiresAt: Date.UTC(2026, 0, 31), locale: 'nl' });
		expect(m.key).toBe('cloud.source.error.expiredOn');
		expect(String(m.params?.date)).toContain('2026');
	});

	it('handles exceptions', () => {
		expect(sourceErrorFromException(new BackendOfflineError()).key).toBe('cloud.error.offline');
		expect(
			sourceErrorFromException(new BackendError(400, 'auth', 'Bad', { error: 'auth' })).key
		).toBe('cloud.source.error.auth');
		expect(sourceErrorFromException(new BackendError(400, 'weird', 'Odd thing')).fallback).toBe(
			'Odd thing'
		);
	});
});
