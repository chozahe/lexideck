import "./theme.js";

const DEFAULT_SETTINGS = {
  sourceLanguage: "English",
  targetLanguage: "Русский",
  apiUrl: "",
  model: "",
  apiKey: ""
};

const $ = (id) => document.getElementById(id);
const form = $("settings-form");
const fields = {
  sourceLanguage: $("source-language"),
  targetLanguage: $("target-language"),
  apiUrl: $("api-url"),
  model: $("model"),
  apiKey: $("api-key")
};

async function loadSettings() {
  const { settings = {}, newCardLimit = 10 } = await chrome.storage.local.get(["settings", "newCardLimit"]);
  const saved = { ...DEFAULT_SETTINGS, ...settings };
  for (const [key, input] of Object.entries(fields)) input.value = saved[key];
  $("new-card-limit").value = newCardLimit;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = $("settings-status");
  status.textContent = "";
  const limit = Number($("new-card-limit").value);
  if (!Number.isSafeInteger(limit) || limit < 0) {
    status.textContent = "Укажите целое неотрицательное число новых карточек.";
    $("new-card-limit").focus();
    return;
  }
  try {
    const settings = Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value.trim()]));
    await chrome.storage.local.set({ settings, newCardLimit: limit });
    status.textContent = "Настройки сохранены на этом устройстве.";
  } catch (error) {
    status.textContent = `Не удалось сохранить настройки: ${error.message}`;
  }
});

void loadSettings().catch((error) => {
  $("settings-status").textContent = `Не удалось загрузить настройки: ${error.message}`;
});
