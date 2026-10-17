import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithTimeout } from '../lib/fetch-with-timeout';

test('hung requests time out and caller cancellation is preserved', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
    const signal = init!.signal!;
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  try {
    await assert.rejects(fetchWithTimeout('https://test.invalid', undefined, 10), { name: 'TimeoutError' });
    const controller = new AbortController();
    const request = fetchWithTimeout('https://test.invalid', { signal: controller.signal }, 1000);
    controller.abort();
    await assert.rejects(request, { name: 'AbortError' });
    await assert.rejects(fetchWithTimeout('https://test.invalid', { signal: controller.signal }), { name: 'AbortError' });
  } finally { globalThis.fetch = original; }
});
