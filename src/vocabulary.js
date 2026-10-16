import "./theme.js";
import { createBackup, parseBackup, restoreBackup } from "./backup.js";
import { DEFAULT_SETTINGS } from "./settings.js";
import { updateCards } from "./cards.js";
import { requestExamples } from "./examples.js";

const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 50;
const normalize = (value) => String(value ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
let snapshot = [];
let index = [];
let query = "";
let page = 1;
let expandedIds = new Set();
const nodes = new Map();
let editing;
let lastUrl = location.href;

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
  lastUrl = location.href;
}

function leaveEditor() {
  if (!editing) return true;
  if (editing.dirty && !window.confirm("Отменить несохранённые изменения карточки?")) {
    nodes.get(editing.cardId)?.content.querySelector('input[name="meaning"]')?.focus();
    return false;
  }
  const cardId = editing.cardId;
  editing = undefined;
  window.onbeforeunload = null;
  const current = nodes.get(cardId);
  const card = snapshot.find((item) => item.id === cardId);
  if (current && card) renderDetails(current.content, card);
  return true;
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
  card.meanings.forEach((meaning, meaningIndex) => {
    const section = document.createElement("section");
    section.className = "vocabulary-meaning";
    const heading = document.createElement("h3");
    heading.textContent = meaning.text;
    section.append(heading);
    if (meaning.contexts.length) {
      const contextHeading = document.createElement("h4");
      contextHeading.textContent = "Контексты употребления";
      const contextList = document.createElement("ul");
      meaning.contexts.forEach((context, contextIndex) => {
        const item = document.createElement("li");
        item.append(document.createTextNode(`${context.form}: ${context.text} `));
        const editContext = document.createElement("button");
        editContext.type = "button";
        editContext.textContent = `Изменить контекст ${contextIndex + 1}`;
        editContext.addEventListener("click", () => openEditor(card, meaningIndex, contextIndex));
        item.append(editContext);
        contextList.append(item);
      });
      section.append(contextHeading, contextList);
      const editMeaning = document.createElement("button");
      editMeaning.type = "button";
      editMeaning.textContent = "Изменить значение и контекст";
      editMeaning.addEventListener("click", () => openEditor(card, meaningIndex));
      section.append(editMeaning);
    } else {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "Изменить значение и добавить контекст";
      edit.addEventListener("click", () => openEditor(card, meaningIndex, -1));
      section.append(edit);
    }
    appendList(section, "Примеры модели", meaning.examples);
    if (!meaning.examples?.length) {
      const addExamples = document.createElement("button");
      addExamples.type = "button";
      addExamples.textContent = "Добавить примеры модели";
      addExamples.addEventListener("click", () => void generateExamples(card, meaning, addExamples));
      section.append(addExamples);
    }
    fragment.append(section);
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Удалить карточку";
  remove.addEventListener("click", () => void deleteCard(card.id));
  fragment.append(remove);
  container.replaceChildren(fragment);
}

async function generateExamples(card, meaning, button) {
  button.disabled = true;
  button.textContent = "Получаем примеры…";
  try {
    const { settings = {} } = await chrome.storage.local.get("settings");
    const config = { ...DEFAULT_SETTINGS, ...settings };
    if (!config.apiUrl || !config.apiKey || !config.model) throw new Error("Настройте URL API, ключ и модель в разделе «Настройки».");
    const examples = await requestExamples(card.headword, meaning.text, meaning.contexts?.[0]?.text || card.headword, config);
    await updateCards((cards) => {
      const currentCard = cards.find((item) => item.id === card.id);
      const currentMeaning = currentCard?.meanings.find((item) => item.text === meaning.text);
      if (!currentMeaning) return;
      const existing = new Set((currentMeaning.examples || []).map((item) => item.trim().toLocaleLowerCase()));
      currentMeaning.examples ||= [];
      const additions = examples.filter((example) => !existing.has(example.trim().toLocaleLowerCase()));
      if (additions.length < 2) throw new Error("Модель вернула меньше двух новых уникальных примеров.");
      currentMeaning.examples.push(...additions);
    });
  } catch (error) {
    $("vocabulary-status").textContent = "Не удалось добавить примеры: " + error.message;
    button.disabled = false;
    button.textContent = "Повторить добавление примеров";
  }
}

function setDirty(dirty) {
  if (!editing) return;
  editing.dirty = dirty;
  window.onbeforeunload = dirty ? (event) => { event.preventDefault(); event.returnValue = ""; } : null;
}

function openEditor(card, meaningIndex, selectedContextIndex = undefined) {
  if (!leaveEditor()) return;
  const record = nodes.get(card.id);
  const meaning = card.meanings[meaningIndex];
  if (!record || !meaning) return;
  editing = { cardId: card.id, meaningIndex, dirty: false };
  const originalText = meaning.text;
  const contextIndex = selectedContextIndex ?? (meaning.contexts.length ? meaning.contexts.length - 1 : -1);
  const originalContext = meaning.contexts[contextIndex] || { form: card.headword, text: "" };
  const form = document.createElement("form");
  form.className = "vocabulary-editor";
  const meaningLabel = document.createElement("label");
  meaningLabel.textContent = "Значение";
  const meaningInput = document.createElement("input");
  meaningInput.name = "meaning";
  meaningInput.required = true;
  meaningInput.value = originalText;
  meaningLabel.append(meaningInput);
  const formLabel = document.createElement("label");
  formLabel.textContent = "Словоформа в контексте";
  const contextForm = document.createElement("input");
  contextForm.name = "context-form";
  contextForm.required = true;
  contextForm.value = originalContext.form || card.headword;
  formLabel.append(contextForm);
  const contextLabel = document.createElement("label");
  contextLabel.textContent = "Контекст употребления";
  const contextText = document.createElement("textarea");
  contextText.name = "context";
  contextText.required = true;
  contextText.value = originalContext.text;
  contextLabel.append(contextText);
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "Сохранить изменения";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Отмена";
  cancel.addEventListener("click", () => {
    editing = undefined;
    window.onbeforeunload = null;
    renderDetails(record.content, snapshot.find((item) => item.id === card.id) || card);
    record.details.querySelector("summary").focus();
  });
  const updateDirty = () => setDirty(
    meaningInput.value !== originalText ||
    contextForm.value !== (originalContext.form || "") ||
    contextText.value !== (originalContext.text || "")
  );
  for (const input of [meaningInput, contextForm, contextText]) input.addEventListener("input", updateDirty);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nextMeaning = meaningInput.value.trim();
    const nextForm = contextForm.value.trim();
    const nextContext = contextText.value.trim();
    if (!nextMeaning || !nextForm || !nextContext) {
      status.textContent = "Заполните значение, основную форму и контекст.";
      return;
    }
    save.disabled = true;
    try {
      await updateCards((cards) => {
        const target = cards.find((item) => item.id === card.id);
        const targetMeaning = target?.meanings[meaningIndex];
        if (!targetMeaning) throw new Error("Карточка или значение удалены в другом окне.");
        targetMeaning.text = nextMeaning;
        if (contextIndex < 0) targetMeaning.contexts.push({ form: nextForm, text: nextContext });
        else {
          const { start, end, position, ...preserved } = targetMeaning.contexts[contextIndex];
          targetMeaning.contexts[contextIndex] = { ...preserved, form: nextForm, text: nextContext };
        }
      });
      editing = undefined;
      window.onbeforeunload = null;
      const updated = snapshot.find((item) => item.id === card.id) || card;
      renderDetails(record.content, updated);
      $("vocabulary-status").textContent = "Изменения сохранены.";
      record.details.querySelector("summary").focus();
    } catch (error) {
      status.textContent = `Не удалось сохранить изменения: ${error.message}`;
      save.disabled = false;
    }
  });
  form.append(meaningLabel, formLabel, contextLabel, save, cancel, status);
  editing.form = form;
  record.content.replaceChildren(form);
  meaningInput.focus();
}

async function deleteCard(id) {
  const card = snapshot.find((item) => item.id === id);
  if (!card || !window.confirm(`Удалить карточку «${card.headword}» и её историю повторений?`)) return;
  await updateCards((cards) => {
    const index = cards.findIndex((item) => item.id === id);
    if (index >= 0) cards.splice(index, 1);
  });
  $("vocabulary-status").textContent = `Карточка «${card.headword}» удалена.`;
  $("vocabulary-search").focus();
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
  summary.addEventListener("click", (event) => {
    if (details.open && editing?.cardId === card.id && !leaveEditor()) {
      event.preventDefault();
      editing?.form?.querySelector('input[name="meaning"]')?.focus();
      return;
    }
    setTimeout(() => {
      if (details.open) expandedIds.add(card.id);
      else expandedIds.delete(card.id);
      writeUrlState("push");
    }, 0);
  });
  const record = { details, headword, status, content, signature: "" };
  updateNode(card, record);
  nodes.set(card.id, record);
  return record;
}

function updateNode(card, record) {
  const signature = JSON.stringify(card);
  if (record.signature === signature) {
    record.details.open = expandedIds.has(card.id);
    return;
  }
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
  if (record.details.open && editing?.cardId !== card.id) renderDetails(record.content, card);
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
  $("vocabulary-count").textContent = `Найдено карточек: ${results.length}.`;
  $("vocabulary-live-status").textContent = `Найдено карточек: ${results.length}. Страница ${page} из ${pageCount}.`;
  $("vocabulary-clear-search").hidden = !query;
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
  if (!leaveEditor()) {
    $("vocabulary-search").value = query;
    return;
  }
  query = normalize($("vocabulary-search").value);
  page = 1;
  writeUrlState("replace");
  renderVocabulary();
});
$("vocabulary-clear-search").addEventListener("click", () => {
  if (!leaveEditor()) return;
  $("vocabulary-search").value = "";
  query = "";
  page = 1;
  writeUrlState("replace");
  renderVocabulary();
  $("vocabulary-search").focus();
});
$("vocabulary-previous").addEventListener("click", () => { if (!leaveEditor()) return; page -= 1; writeUrlState(); renderVocabulary(); });
$("vocabulary-next").addEventListener("click", () => { if (!leaveEditor()) return; page += 1; writeUrlState(); renderVocabulary(); });
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
  if (editing && !snapshot.some((card) => card.id === editing.cardId)) {
    editing = undefined;
    window.onbeforeunload = null;
  }
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
  const nextUrl = location.href;
  if (!leaveEditor()) {
    history.pushState({}, "", lastUrl);
    return;
  }
  lastUrl = nextUrl;
  readUrlState();
  renderVocabulary();
});
void loadSnapshot().catch((error) => { $("vocabulary-status").textContent = `Не удалось загрузить словарь: ${error.message}`; });
