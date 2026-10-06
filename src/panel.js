const DEFAULT_SETTINGS = {
  sourceLanguage: "English",
  targetLanguage: "Русский",
  apiUrl: "",
  model: "",
  apiKey: ""
};

const $ = (id) => document.getElementById(id);
const form = {
  sourceLanguage: $("source-language"),
  targetLanguage: $("target-language"),
  apiUrl: $("api-url"),
  model: $("model"),
  apiKey: $("api-key")
};

function showError(message) {
  $("error").textContent = message;
}

async function loadSettings() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  const saved = { ...DEFAULT_SETTINGS, ...settings };
  Object.entries(form).forEach(([key, input]) => { input.value = saved[key]; });
}

async function saveSettings() {
  const settings = Object.fromEntries(Object.entries(form).map(([key, input]) => [key, input.value.trim()]));
  await chrome.storage.local.set({ settings });
  $("settings-status").textContent = "Настройки сохранены на этом устройстве.";
}

function parseCompletion(content, sourceText) {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const result = JSON.parse(cleaned);
  if (typeof result.sentence_translation !== "string" || !Array.isArray(result.words)) {
    throw new Error("Ответ API не содержит перевод предложения и список слов.");
  }
  const source = Array.from(sourceText, (character) => character.toLowerCase());
  for (const word of result.words) {
    if (typeof word.text !== "string" || typeof word.meaning !== "string") {
      throw new Error("Ответ API содержит слово без текста или значения.");
    }
    if (!Number.isInteger(word.start) || !Number.isInteger(word.end) || word.start < 0 || word.end <= word.start) {
      throw new Error("Ответ API не содержит корректные позиции слов в исходном тексте.");
    }
    if (source.slice(word.start, word.end).join("") !== word.text.toLowerCase()) {
      throw new Error("Позиция слова в ответе API не совпадает с исходным текстом.");
    }
  }
  result.words = result.words
    .sort((left, right) => left.start - right.start);
  return result;
}

function completionUrl(baseUrl) {
  const url = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) throw new Error("Укажите корректный URL API, начинающийся с https:// или http://.");
  return url.endsWith("/chat/completions") ? url : `${url}/chat/completions`;
}

async function translate(text) {
  const { settings = {} } = await chrome.storage.local.get("settings");
  const config = { ...DEFAULT_SETTINGS, ...settings };
  if (!config.apiUrl || !config.apiKey || !config.model) {
    throw new Error("Заполните URL API, ключ и модель в настройках.");
  }
  let response;
  try {
    response = await fetch(completionUrl(config.apiUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `Переведи текст с ${config.sourceLanguage} на ${config.targetLanguage}. Верни только JSON-объект: {"sentence_translation":"перевод всего текста","words":[{"text":"точный фрагмент исходного текста","meaning":"значение в данном контексте","start":0,"end":4}]}. Добавь разбор всех содержательных слов в порядке текста. start и end — нулевая позиция и исключительная конечная позиция фрагмента в символах Unicode исходного текста; указывай точные границы каждого вхождения, включая повторяющиеся слова.` },
          { role: "user", content: text }
        ]
      })
    });
  } catch (error) {
    throw new Error(`Не удалось связаться с API: ${error.message}`);
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    throw new Error(`API вернул ошибку ${response.status}${detail ? `: ${detail}` : "."}`);
  }
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Ответ API не содержит текста перевода.");
  return parseCompletion(content, text);
}

function renderResult(result) {
  $("sentence-translation").textContent = result.sentence_translation;
  const list = $("word-meanings");
  list.replaceChildren(...result.words.map(({ text, meaning }) => {
    const item = document.createElement("li");
    item.textContent = `${text} — ${meaning}`;
    return item;
  }));
  $("result").hidden = false;
}

async function runTranslation() {
  const text = $("source-text").value.trim();
  if (!text) return showError("Введите текст или выберите его на странице.");
  showError("");
  $("translate").disabled = true;
  $("translate").textContent = "Переводим…";
  try {
    renderResult(await translate(text));
  } catch (error) {
    showError(error.message || "Не удалось выполнить перевод.");
  } finally {
    $("translate").disabled = false;
    $("translate").textContent = "Перевести";
  }
}

$("settings-toggle").addEventListener("click", () => {
  const settings = $("settings");
  settings.hidden = !settings.hidden;
  $("settings-toggle").setAttribute("aria-expanded", String(!settings.hidden));
});
  $("save-settings").addEventListener("click", async () => {
    $("settings-status").textContent = "";
    $("settings-status").style.color = "";
  try {
    await saveSettings();
  } catch (error) {
    $("settings-status").textContent = `Не удалось сохранить настройки: ${error.message}`;
    $("settings-status").style.color = "#c33";
  }
});
$("translate").addEventListener("click", () => void runTranslation());
$("source-text").addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void runTranslation();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.pendingSelection?.newValue) {
    $("source-text").value = changes.pendingSelection.newValue;
    void chrome.storage.local.remove("pendingSelection");
  }
});

void loadSettings().then(async () => {
  const { pendingSelection } = await chrome.storage.local.get("pendingSelection");
  if (pendingSelection) {
    $("source-text").value = pendingSelection;
    await chrome.storage.local.remove("pendingSelection");
  }
}).catch((error) => showError(`Не удалось загрузить настройки: ${error.message}`));
