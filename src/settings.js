export const DEFAULT_SETTINGS = {
  sourceLanguage: "English",
  targetLanguage: "Русский",
  apiUrl: "",
  model: "",
  apiKey: ""
};

export function completionEndpoint(baseUrl) {
  const url = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) throw new Error("Укажите корректный URL API, начинающийся с https:// или http://.");
  return url.endsWith("/chat/completions") ? url : `${url}/chat/completions`;
}

export function isValidApiUrl(baseUrl) {
  try {
    const input = String(baseUrl).trim();
    const endpoint = new URL(completionEndpoint(input));
    const authority = input.match(/^https?:\/\/([^/?#]*)/i)?.[1];
    const hostname = decodeURIComponent(endpoint.hostname);
    return Boolean(authority) &&
      !/[\s\u0000-\u001f\u007f]/.test(authority) &&
      !/[\s\u0000-\u001f\u007f]/.test(hostname) &&
      (endpoint.protocol === "http:" || endpoint.protocol === "https:");
  } catch {
    return false;
  }
}
