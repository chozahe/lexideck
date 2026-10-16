import { completionEndpoint } from "./settings.js";
import { requestApi } from "./api-request.js";

export async function requestExamples(headword, meaning, context, config, { signal } = {}) {
  const content = await requestApi(completionEndpoint(config.apiUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `Сгенерируй два дополнительных примера на ${config.sourceLanguage} для выражения «${headword}» со значением «${meaning}». Не копируй исходный контекст. Верни только JSON: {"examples":["пример 1","пример 2"]}.` },
        { role: "user", content: context }
      ]
    }),
    signal
  }, async (response) => {
    if (!response.ok) {
      const messages = { 401: "Ключ API отклонён. Проверьте ключ в настройках.", 429: "Превышен лимит запросов. Подождите и повторите попытку." };
      throw new Error(messages[response.status] || `API вернул ошибку ${response.status}.`);
    }
    return response.json();
  });
  const examples = JSON.parse(content.choices?.[0]?.message?.content || "{}").examples;
  if (!Array.isArray(examples) || examples.length < 2 || examples.length > 3 || examples.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error("Модель вернула некорректный список примеров.");
  }
  const unique = [...new Set(examples.map((item) => item.trim()).filter(Boolean))];
  if (unique.length < 2) throw new Error("Модель вернула меньше двух уникальных примеров.");
  return unique;
}
