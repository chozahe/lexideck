import "./theme.js";
import { completionEndpoint, DEFAULT_SETTINGS, isValidApiUrl } from "./settings.js";
import { requestApi } from "./api-request.js";

const $ = (id) => document.getElementById(id);
const form = $("settings-form");
const fields = {
  sourceLanguage: $("source-language"),
  targetLanguage: $("target-language"),
  apiUrl: $("api-url"),
  model: $("model"),
  apiKey: $("api-key")
};
const apiFields = [fields.apiUrl, fields.model, fields.apiKey];
const limitInput = $("new-card-limit");
let savedSnapshot = null;
let allowNavigation = false;
let apiTestSnapshot = null;
let apiTestRequest = 0;

function currentSnapshot() {
  return JSON.stringify({
    settings: Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value.trim()])),
    newCardLimit: limitInput.value
  });
}

function isDirty() {
  return savedSnapshot !== null && currentSnapshot() !== savedSnapshot;
}

function updateDirtyState() {
  form.dataset.dirty = String(isDirty());
}

for (const input of [...Object.values(fields), limitInput]) {
  input.addEventListener("input", updateDirtyState);
  input.addEventListener("change", updateDirtyState);
}

function apiSnapshot() {
  return JSON.stringify(apiFields.map((input) => input.value.trim()));
}

function updateApiReadiness() {
  const url = fields.apiUrl.value.trim();
  const model = fields.model.value.trim();
  const key = fields.apiKey.value.trim();
  let urlIsValid = !url;
  const urlError = $("api-url-error");
  if (url) {
    if (isValidApiUrl(url)) {
      urlIsValid = true;
      fields.apiUrl.removeAttribute("aria-invalid");
      urlError.textContent = "";
    } else {
      urlError.textContent = "Укажите полный http:// или https:// адрес сервиса либо endpoint /chat/completions.";
      fields.apiUrl.setAttribute("aria-invalid", "true");
    }
  }
  const missing = [];
  if (!url || !urlIsValid) missing.push("корректный URL API");
  if (!model) missing.push("модель");
  if (!key) missing.push("ключ");
  const ready = $("api-readiness");
  const nextStep = $("api-next-step");
  if (missing.length) {
    ready.textContent = `Перевод ещё не настроен. Не заполнено: ${missing.join(", ")}.`;
    nextStep.textContent = "Заполните указанные поля подключения. Повторение и локальные настройки доступны без API.";
  } else {
    const saved = savedSnapshot !== null && currentSnapshot() === savedSnapshot;
    ready.textContent = saved
      ? "Параметры подключения заполнены и сохранены. Проверьте подключение перед первым переводом."
      : "Поля подключения заполнены, но ещё не сохранены. Проверка использует черновые значения формы.";
    nextStep.textContent = saved
      ? "Проверка отправит короткий текстовый запрос. Для анализа комиксов выбранная модель должна поддерживать изображения."
      : "Проверьте подключение, затем сохраните настройки. Повторение и локальные настройки доступны без API.";
  }
  if (apiTestSnapshot !== null && apiTestSnapshot !== apiSnapshot()) {
    apiTestSnapshot = null;
    $("api-test-status").textContent = "Параметры подключения изменились. Проверьте подключение ещё раз.";
    $("api-test-status").dataset.state = "";
  }
}

for (const input of apiFields) input.addEventListener("input", () => {
  const wasPending = $("api-test-status").dataset.state === "pending";
  apiTestRequest++;
  if (wasPending) {
    $("api-test-status").textContent = "Параметры подключения изменились. Проверьте подключение ещё раз.";
    $("api-test-status").dataset.state = "";
    $("test-api").disabled = false;
  }
  const errorId = { "api-url": "api-url-error", model: "model-error", "api-key": "api-key-error" }[input.id];
  $(errorId).textContent = "";
  input.removeAttribute("aria-invalid");
  updateApiReadiness();
});

$("test-api").addEventListener("click", async () => {
  const status = $("api-test-status");
  const errors = {
    apiUrl: $("api-url-error"),
    model: $("model-error"),
    apiKey: $("api-key-error")
  };
  for (const error of Object.values(errors)) error.textContent = "";
  for (const input of apiFields) input.removeAttribute("aria-invalid");
  const url = fields.apiUrl.value.trim();
  const model = fields.model.value.trim();
  const key = fields.apiKey.value.trim();
  let endpoint;
  try {
    if (!url) throw new Error("Введите URL сервиса.");
    if (!isValidApiUrl(url)) throw new Error("Укажите полный http:// или https:// адрес сервиса либо endpoint /chat/completions.");
    endpoint = completionEndpoint(url);
  } catch (error) {
    endpoint = undefined;
    errors.apiUrl.textContent = `${error.message} Допустимы адреса http:// и https://.`;
    fields.apiUrl.setAttribute("aria-invalid", "true");
  }
  if (!model) {
    errors.model.textContent = "Введите идентификатор модели, который выдал API-сервис.";
    fields.model.setAttribute("aria-invalid", "true");
  }
  if (!key) {
    errors.apiKey.textContent = "Введите ключ API из настроек вашего сервиса.";
    fields.apiKey.setAttribute("aria-invalid", "true");
  }
  if (!endpoint || !model || !key) {
    status.textContent = "Не удалось проверить подключение. Исправьте поля, отмеченные рядом с ними.";
    status.dataset.state = "error";
    return;
  }

  const button = $("test-api");
  const testedSnapshot = apiSnapshot();
  const request = ++apiTestRequest;
  button.disabled = true;
  status.textContent = "Проверяем текстовый запрос к API…";
  status.dataset.state = "pending";
  $("api-test-details").hidden = true;
  $("api-test-detail").textContent = "";
  try {
    const payload = await requestApi(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [{ role: "user", content: "Ответь одним словом: OK" }]
      })
    }, async (response) => {
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300).replaceAll(key, "[ключ скрыт]");
        const error = new Error(`Сервис вернул ошибку ${response.status}.`);
        error.detail = `HTTP ${response.status}${detail ? `: ${detail}` : ""}`;
        throw error;
      }
      return response.json();
    });
    if (typeof payload.choices?.[0]?.message?.content !== "string") {
      throw new Error("Ответ сервиса не содержит текст завершения.");
    }
    if (request !== apiTestRequest || testedSnapshot !== apiSnapshot()) return;
    apiTestSnapshot = testedSnapshot;
    status.textContent = "Текстовый запрос выполнен успешно. Поддержка изображений этой проверкой не подтверждена.";
    status.dataset.state = "success";
  } catch (error) {
    if (request !== apiTestRequest || testedSnapshot !== apiSnapshot()) return;
    apiTestSnapshot = null;
    const errorMessage = error instanceof SyntaxError
      ? "Сервис вернул некорректный JSON-ответ."
      : String(error.message || "Неизвестная ошибка.").replaceAll(key, "[ключ скрыт]");
    const technicalDetail = String(error.detail || error.message || "Неизвестная ошибка.").replaceAll(key, "[ключ скрыт]");
    status.textContent = `Проверка не пройдена: ${errorMessage} Проверьте URL, модель и права ключа; технический ответ доступен отдельно.`;
    status.dataset.state = "error";
    $("api-test-detail").textContent = technicalDetail;
    $("api-test-details").hidden = false;
  } finally {
    if (request === apiTestRequest) button.disabled = false;
  }
});

window.addEventListener("beforeunload", (event) => {
  if (allowNavigation || !isDirty()) return;
  event.preventDefault();
  event.returnValue = "";
});

document.querySelectorAll('nav a[href]').forEach((link) => {
  link.addEventListener("click", (event) => {
    if (!isDirty()) return;
    if (!window.confirm("Есть несохранённые настройки. Остаться на странице? Нажмите «Отмена», чтобы остаться, или «ОК», чтобы отбросить изменения и перейти.")) {
      event.preventDefault();
      return;
    }
    allowNavigation = true;
  });
});

async function loadSettings() {
  const { settings = {}, newCardLimit = 10 } = await chrome.storage.local.get(["settings", "newCardLimit"]);
  const saved = { ...DEFAULT_SETTINGS, ...settings };
  for (const [key, input] of Object.entries(fields)) input.value = saved[key];
  limitInput.value = newCardLimit;
  savedSnapshot = currentSnapshot();
  updateDirtyState();
  updateApiReadiness();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = $("settings-status");
  status.textContent = "";
  status.dataset.state = "";
  const limit = Number(limitInput.value);
  if (!Number.isSafeInteger(limit) || limit < 0) {
    status.textContent = "Укажите целое неотрицательное число новых карточек.";
    status.dataset.state = "error";
    limitInput.focus();
    return;
  }
  try {
    const settings = Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value.trim()]));
    const submittedSnapshot = JSON.stringify({ settings, newCardLimit: String(limit) });
    await chrome.storage.local.set({ settings, newCardLimit: limit });
    savedSnapshot = submittedSnapshot;
    updateDirtyState();
    updateApiReadiness();
    status.textContent = "Настройки сохранены на этом устройстве.";
    status.dataset.state = "success";
  } catch (error) {
    status.textContent = `Не удалось сохранить настройки: ${error.message}`;
    status.dataset.state = "error";
  }
});

void loadSettings().catch((error) => {
  const status = $("settings-status");
  status.textContent = `Не удалось загрузить настройки: ${error.message}`;
  status.dataset.state = "error";
});
