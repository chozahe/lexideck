import "./theme.js";
import { createBackup, parseBackup, restoreBackup } from "./backup.js";
import { DEFAULT_SETTINGS } from "./settings.js";
import { updateCards } from "./cards.js";

const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 50;
const normalize = (value) => String(value ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
let snapshot = [];
let index = [];
let query = "";
let page = 1;
let expandedIds = new Set();
const nodes = new Map();

function readUrlState() {
  const params = new URL(location.href).searchParams;
  query = normalize(params.get("q") || "");
  $("vocabulary-search").value = params.get("q") || "";
  const rawPage = Number(params.get("page") || 1);
  page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  expandedIds = new Set(params.getAll("open").filter((id) => id.length <= 200));
}

function writeUrlState(mode = "push") {
  const url = new URL(location.href);
  url.search = "";
  if (query) url.searchParams.set("q", $("vocabulary-search").value.trim());
  if (page > 1) url.searchParams.set("page", String(page));
  for (const id of expandedIds) url.searchParams.append("open", id);
  history[mode === "replace" ? "replaceState" : "pushState"]({}, "", url);
}

function cardText(card) {
  return normalize([card.headword, ...card.meanings.map((meaning) => meaning.text)].join(" "));
}

function appendList(parent, title, values, format = (value) => value) {
  if (!values.length) return;
  const heading = document.createElement("h4");
  heading.textContent = title;
  const list = document.createElement("ul");
  for (const value of values) {
    const item = document.createElement("li");
    item.textContent = format(value);
    list.append(item);
  }
  parent.append(heading, list);
}

function renderDetails(container, card) {
  const fragment = document.createDocumentFragment();
  for (const meaning of card.meanings) {
    const section = document.createElement("section");
    section.className = "vocabulary-meaning";
    const heading = document.createElement("h3");
    heading.textContent = meaning.text;
    section.append(heading);
    appendList(section, "Контексты употребления", meaning.contexts, (context) => `${context.form}: ${context.text}`);
    appendList(section, "Примеры модели", meaning.examples);
    if (!meaning.examples?.length) {
      const addExamples = document.createElement("button");
      addExamples.type = "button";
      addExamples.textContent = "Добавить примеры модели";
      addExamples.addEventListener("click", () => void generateExamples(card, meaning, addExamples));
      section.append(addExamples);
    }
    fragment.append(section);
  }
  container.replaceChildren(fragment);
}

async function generateExamples(card, meaning, button) {
  button.disabled = true;
  button.textContent = "Получаем примеры…";
  try {
    const { settings = {} } = await chrome.storage.local.get("settings");
    const config = { ...DEFAULT_SETTINGS, ...settings };
    if (!config.apiUrl || !config.apiKey || !config.model) throw new Error("Настройте URL API, ключ и модель в разделе «Настройки».");
    const base = config.apiUrl.trim().replace(/\/+$/, "");
    const url = /^https?:\/\//i.test(base) ? (base.endsWith("/chat/completions") ? base : base + "/chat/completions") : "";
    if (!url) throw new Error("Укажите корректный URL API в настройках.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + config.apiKey },
        body: JSON.stringify({ model: config.model, temperature: 0.2, response_format: { type: "json_object" }, messages: [
          { role: "system", content: "Сгенерируй два дополнительных примера на " + config.sourceLanguage + " для выражения «" + card.headword + "» со значением «" + meaning.text + "». Не копируй исходный контекст. Верни только JSON: {\"examples\":[\"пример 1\",\"пример 2\"]}." },
          { role: "user", content: meaning.contexts?.[0]?.text || card.headword }
        ] }),
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) throw new Error("Запрос занял больше 60 секунд. Повторите попытку.");
      throw new Error("Не удалось связаться с API. Проверьте соединение и настройки.");
    } finally { clearTimeout(timeout); }
    if (!response.ok) {
      const hints = { 401: "Проверьте ключ API.", 429: "Подождите и повторите запрос." };
      throw new Error(hints[response.status] || "API вернул ошибку " + response.status + ".");
    }
    const payload = await response.json();
    const examples = JSON.parse(payload.choices?.[0]?.message?.content || "{}").examples;
    if (!Array.isArray(examples) || examples.length < 2 || examples.length > 3 || examples.some((item) => typeof item !== "string" || !item.trim())) {
      throw new Error("Модель вернула некорректный список примеров.");
    }
    await updateCards((cards) => {
      const currentCard = cards.find((item) => item.id === card.id);
      const currentMeaning = currentCard?.meanings.find((item) => item.text === meaning.text);
      if (!currentMeaning) return;
      const existing = new Set((currentMeaning.examples || []).map((item) => item.trim().toLocaleLowerCase()));
      currentMeaning.examples ||= [];
      for (const example of examples) {
        const clean = example.trim();
        if (!existing.has(clean.toLocaleLowerCase())) currentMeaning.examples.push(clean);
      }
    });
  } catch (error) {
    $("vocabulary-status").textContent = "Не удалось добавить примеры: " + error.message;
    button.disabled = false;
    button.textContent = "Повторить добавление примеров";
  }
}

function makeNode(card) {
  const details = document.createElement("details");
  details.className = "vocabulary-card";
  details.dataset.cardId = card.id;
  const summary = document.createElement("summary");
  const headword = document.createElement("strong");
  const status = document.createElement("span");
  summary.append(headword, document.createTextNode(" — "), status);
  const content = document.createElement("div");
  content.className = "vocabulary-card-details";
  details.append(summary, content);
  details.addEventListener("toggle", () => {
    if (details.open) {
      expandedIds.add(details.dataset.cardId);
      const latest = snapshot.find((item) => item.id === details.dataset.cardId);
      if (latest) renderDetails(content, latest);
    } else expandedIds.delete(details.dataset.cardId);
  });
  summary.addEventListener("click", () => {
    if (details.open) expandedIds.delete(card.id);
    else expandedIds.add(card.id);
    writeUrlState("push");
  });
  const record = { details, headword, status, content, signature: "" };
  updateNode(card, record);
  nodes.set(card.id, record);
  return record;
}

function updateNode(card, record) {
  const signature = JSON.stringify(card);
  if (record.signature === signature) return;
  record.signature = signature;
  record.details.dataset.cardId = card.id;
  record.headword.textContent = card.headword;
  if (card.schedule?.due) {
    const due = document.createElement("time");
    due.dateTime = card.schedule.due;
    due.textContent = new Date(card.schedule.due).toLocaleString("ru-RU");
    record.status.replaceChildren("Следующее повторение: ", due);
  } else record.status.textContent = "Новая карточка";
  record.details.open = expandedIds.has(card.id);
  if (record.details.open) renderDetails(record.content, card);
}

function renderVocabulary() {
  const results = index.filter((entry) => !query || entry.text.includes(query));
  const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  page = Math.min(Math.max(page, 1), pageCount);
  const pageCards = results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((entry) => entry.card);
  const container = $("vocabulary-cards");
  const activeCard = document.activeElement?.closest?.(".vocabulary-card")?.dataset.cardId;
  const pageIds = new Set(pageCards.map((card) => card.id));
  for (const id of [...expandedIds]) if (!snapshot.some((card) => card.id === id)) expandedIds.delete(id);

  for (const child of [...container.children]) {
    if (!pageIds.has(child.dataset.cardId)) child.remove();
  }
  pageCards.forEach((card, position) => {
    let record = nodes.get(card.id);
    if (!record) record = makeNode(card);
    else updateNode(card, record);
    const current = container.children[position];
    if (current !== record.details) container.insertBefore(record.details, current || null);
  });

  for (const id of [...nodes.keys()]) {
    if (!snapshot.some((card) => card.id === id)) {
      nodes.get(id).details.remove();
      nodes.delete(id);
      expandedIds.delete(id);
    }
  }

  $("vocabulary-empty").hidden = snapshot.length > 0;
  $("vocabulary-no-results").hidden = snapshot.length === 0 || results.length > 0;
  $("vocabulary-pagination").hidden = results.length <= PAGE_SIZE;
  $("vocabulary-page-status").textContent = `${page} / ${pageCount} · карточек: ${results.length}`;
  $("vocabulary-previous").disabled = page <= 1;
  $("vocabulary-next").disabled = page >= pageCount;
  writeUrlState("replace");
  if (activeCard && !pageIds.has(activeCard)) {
    const replacement = pageCards[Math.min((results.findIndex((entry) => entry.card.id === activeCard) % PAGE_SIZE + PAGE_SIZE) % PAGE_SIZE, pageCards.length - 1)];
    (replacement && nodes.get(replacement.id)?.details.querySelector("summary") || $("vocabulary-search")).focus();
  }
}

async function loadSnapshot() {
  const { cards = [] } = await chrome.storage.local.get("cards");
  snapshot = Array.isArray(cards) ? cards : [];
  index = snapshot.map((card) => ({ card, text: cardText(card) }));
  for (const id of [...expandedIds]) if (!snapshot.some((card) => card.id === id)) expandedIds.delete(id);
  renderVocabulary();
}

async function exportBackup() {
  const { cards = [] } = await chrome.storage.local.get("cards");
  const file = new Blob([JSON.stringify(createBackup(cards), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = `lexideck-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  $("backup-status").textContent = `Экспортировано карточек: ${cards.length}. Ключ API не включён.`;
}

async function importBackup(file) {
  const cards = parseBackup(await file.text());
  await restoreBackup(cards, () => window.confirm(`В резервной копии ${cards.length} карточек. Заменить текущий словарь?`));
  await loadSnapshot();
  $("backup-status").textContent = `Восстановлено карточек: ${cards.length}.`;
}

$("vocabulary-search").addEventListener("input", () => {
  query = normalize($("vocabulary-search").value);
  page = 1;
  writeUrlState("replace");
  renderVocabulary();
});
$("vocabulary-previous").addEventListener("click", () => { page -= 1; writeUrlState(); renderVocabulary(); });
$("vocabulary-next").addEventListener("click", () => { page += 1; writeUrlState(); renderVocabulary(); });
$("export-backup").addEventListener("click", () => {
  void exportBackup().catch((error) => { $("backup-status").textContent = `Не удалось экспортировать словарь: ${error.message}`; });
});
$("import-backup").addEventListener("change", async (event) => {
  const input = event.currentTarget;
  const [file] = input.files;
  if (!file) return;
  $("backup-status").textContent = "Проверяем резервную копию…";
  try { await importBackup(file); }
  catch (error) {
    $("backup-status").textContent = error.message.startsWith("Импорт отменён") ? error.message : `Не удалось импортировать словарь: ${error.message}`;
  } finally { input.value = ""; }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.cards) return;
  const activeId = document.activeElement?.closest?.(".vocabulary-card")?.dataset.cardId;
  const oldCards = new Map(snapshot.map((card) => [card.id, card]));
  snapshot = Array.isArray(changes.cards.newValue) ? changes.cards.newValue : [];
  index = snapshot.map((card) => ({ card, text: cardText(card) }));
  if (activeId && !snapshot.some((card) => card.id === activeId)) {
    $("vocabulary-status").textContent = "Карточка изменилась в другом окне.";
  }
  // Поддерживаем ссылки на неизменившиеся записи; updateNode сравнит только карточки текущей страницы.
  for (const card of snapshot) if (oldCards.get(card.id) === card) nodes.get(card.id)?.details.setAttribute("data-current", "true");
  renderVocabulary();
  $("vocabulary-status").textContent = "Словарь обновлён в другом окне.";
});

readUrlState();
window.addEventListener("popstate", () => {
  readUrlState();
  renderVocabulary();
});
void loadSnapshot().catch((error) => { $("vocabulary-status").textContent = `Не удалось загрузить словарь: ${error.message}`; });
