// Bound browser database/auth requests so loading and payment polling can recover.
// Preserve the caller's cancellation signal as well as our timeout.
export async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const caller = init?.signal || (input instanceof Request ? input.signal : undefined);
  const abort = () => controller.abort(caller?.reason);
  if (caller?.aborted) abort();
  else caller?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out. Please retry.', 'TimeoutError')), timeoutMs);
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); caller?.removeEventListener('abort', abort); }
}
