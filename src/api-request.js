export async function requestApi(url, options, consume = (response) => response.json(), timeoutMs = 60_000) {
  const controller = new AbortController();
  const externalSignal = options.signal;
  const abortFromCaller = () => controller.abort(externalSignal.reason);
  if (externalSignal?.aborted) abortFromCaller();
  else externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    const { signal: _signal, ...fetchOptions } = options;
    const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
    return await consume(response);
  } catch (error) {
    if (externalSignal?.aborted) throw externalSignal.reason || new DOMException("Отменено", "AbortError");
    if (controller.signal.aborted) {
      const timeoutError = new Error("Запрос занял больше 60 секунд. Проверьте доступность API и повторите попытку.");
      timeoutError.kind = "timeout";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}
