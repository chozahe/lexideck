import "./theme.js";
import { DEFAULT_SETTINGS } from "./settings.js";

const $ = (id) => document.getElementById(id);
const form = $("settings-form");
const fields = {
  sourceLanguage: $("source-language"),
  targetLanguage: $("target-language"),
  apiUrl: $("api-url"),
  model: $("model"),
  apiKey: $("api-key")
};
const limitInput = $("new-card-limit");
let savedSnapshot = null;
let allowNavigation = false;

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
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = $("settings-status");
  status.textContent = "";
  const limit = Number(limitInput.value);
  if (!Number.isSafeInteger(limit) || limit < 0) {
    status.textContent = "Укажите целое неотрицательное число новых карточек.";
    limitInput.focus();
    return;
  }
  try {
    const settings = Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value.trim()]));
    await chrome.storage.local.set({ settings, newCardLimit: limit });
    savedSnapshot = currentSnapshot();
    updateDirtyState();
    status.textContent = "Настройки сохранены на этом устройстве.";
  } catch (error) {
    status.textContent = `Не удалось сохранить настройки: ${error.message}`;
  }
});

void loadSettings().catch((error) => {
  $("settings-status").textContent = `Не удалось загрузить настройки: ${error.message}`;
});
