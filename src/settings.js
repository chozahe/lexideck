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
