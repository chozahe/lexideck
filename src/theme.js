const KEY = "themePreference";
const OPTIONS = new Set(["system", "latte", "macchiato"]);
const media = window.matchMedia("(prefers-color-scheme: dark)");
const selector = document.getElementById("theme-preference");
const status = document.getElementById("theme-status");
let preference = "system";

function resolvedTheme(value = preference) {
  if (value === "system") return media.matches ? "macchiato" : "latte";
  return value;
}

function applyTheme() {
  const resolved = resolvedTheme();
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.style.colorScheme = resolved === "latte" ? "light" : "dark";
}

function setPreference(value) {
  preference = OPTIONS.has(value) ? value : "system";
  if (selector) selector.value = preference;
  applyTheme();
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[KEY]) {
    setPreference(changes[KEY].newValue || "system");
  }
});

const onSystemThemeChange = () => {
  if (preference === "system") applyTheme();
};
if (media.addEventListener) media.addEventListener("change", onSystemThemeChange);
else media.addListener(onSystemThemeChange);

void chrome.storage.local.get(KEY).then(({ [KEY]: saved }) => {
  setPreference(saved || "system");
}).catch((error) => {
  setPreference("system");
  if (status) status.textContent = `Не удалось загрузить тему: ${error.message}`;
});

if (selector) {
  selector.addEventListener("change", async () => {
    const next = OPTIONS.has(selector.value) ? selector.value : "system";
    status.textContent = "";
    try {
      await chrome.storage.local.set({ [KEY]: next });
      setPreference(next);
      status.textContent = "Тема сохранена для панели и страниц.";
    } catch (error) {
      selector.value = preference;
      status.textContent = `Не удалось сохранить тему: ${error.message}`;
    }
  });
}
