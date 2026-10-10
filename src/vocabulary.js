import "./theme.js";
import { createBackup, parseBackup, restoreBackup } from "./backup.js";

const $ = (id) => document.getElementById(id);
const normalize = (value) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ");

function cardMatches(card, query) {
  const text = [card.headword, ...card.meanings.map((meaning) => meaning.text)];
  return text.some((value) => normalize(value).includes(query));
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

function renderCard(card, expanded) {
  const details = document.createElement("details");
  details.className = "vocabulary-card";
  details.dataset.cardId = card.id;
  details.open = expanded;

  const summary = document.createElement("summary");
  const headword = document.createElement("strong");
  headword.textContent = card.headword;
  const status = document.createElement("span");
  if (card.schedule?.due) {
    const due = document.createElement("time");
    due.dateTime = card.schedule.due;
    due.textContent = new Date(card.schedule.due).toLocaleString("ru-RU");
    status.append("Следующее повторение: ", due);
  } else {
    status.textContent = "Новая карточка";
  }
  summary.append(headword, document.createTextNode(" — "), status);
  details.append(summary);

  for (const meaning of card.meanings) {
    const section = document.createElement("section");
    section.className = "vocabulary-meaning";
    const heading = document.createElement("h3");
    heading.textContent = meaning.text;
    section.append(heading);
    appendList(section, "Контексты употребления", meaning.contexts, (context) => `${context.form}: ${context.text}`);
    appendList(section, "Примеры модели", meaning.examples);
    details.append(section);
  }
  return details;
}

async function renderVocabulary() {
  const { cards = [] } = await chrome.storage.local.get("cards");
  const query = normalize($("vocabulary-search").value);
  const expanded = new Set([...$("vocabulary-cards").querySelectorAll("details[open]")].map((item) => item.dataset.cardId));
  const matches = cards.filter((card) => cardMatches(card, query));
  $("vocabulary-cards").replaceChildren(...matches.map((card) => renderCard(card, expanded.has(card.id))));
  $("vocabulary-empty").hidden = cards.length > 0;
  $("vocabulary-no-results").hidden = cards.length === 0 || matches.length > 0;
  $("vocabulary-status").textContent = "";
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
  await renderVocabulary();
  $("backup-status").textContent = `Восстановлено карточек: ${cards.length}.`;
}

$("vocabulary-search").addEventListener("input", () => {
  void renderVocabulary().catch((error) => { $("vocabulary-status").textContent = `Не удалось показать словарь: ${error.message}`; });
});
$("export-backup").addEventListener("click", () => {
  void exportBackup().catch((error) => { $("backup-status").textContent = `Не удалось экспортировать словарь: ${error.message}`; });
});
$("import-backup").addEventListener("change", async (event) => {
  const input = event.currentTarget;
  const [file] = input.files;
  if (!file) return;
  $("backup-status").textContent = "Проверяем резервную копию…";
  try {
    await importBackup(file);
  } catch (error) {
    $("backup-status").textContent = error.message.startsWith("Импорт отменён")
      ? error.message
      : `Не удалось импортировать словарь: ${error.message}`;
  } finally {
    input.value = "";
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.cards) {
    void renderVocabulary().catch((error) => { $("vocabulary-status").textContent = `Не удалось обновить словарь: ${error.message}`; });
  }
});

void renderVocabulary().catch((error) => { $("vocabulary-status").textContent = `Не удалось загрузить словарь: ${error.message}`; });
