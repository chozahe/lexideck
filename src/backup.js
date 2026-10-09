import { updateCards } from "./cards.js";

const FORMAT = "lexideck-backup";
const VERSION = 1;

export function createBackup(cards, exportedAt = new Date()) {
  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: exportedAt.toISOString(),
    cards: structuredClone(cards)
  };
}

function isText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function validateCard(card, index) {
  const prefix = `Карточка ${index + 1}`;
  if (!card || typeof card !== "object" || !isText(card.id) || !["word", "expression"].includes(card.kind) || !isText(card.headword)) {
    throw new Error(`${prefix}: некорректная запись карточки.`);
  }
  if (!Array.isArray(card.meanings) || !card.meanings.length) throw new Error(`${prefix}: нет значений.`);
  for (const [meaningIndex, meaning] of card.meanings.entries()) {
    if (!meaning || typeof meaning !== "object" || !isText(meaning.text) || !Array.isArray(meaning.contexts) || !Array.isArray(meaning.examples)) {
      throw new Error(`${prefix}, значение ${meaningIndex + 1}: некорректные данные.`);
    }
    for (const context of meaning.contexts) {
      if (!context || !isText(context.form) || !isText(context.text)) throw new Error(`${prefix}: некорректный контекст употребления.`);
      if ((context.start !== undefined && (!Number.isSafeInteger(context.start) || context.start < 0)) ||
          (context.end !== undefined && (!Number.isSafeInteger(context.end) || context.end < 0))) {
        throw new Error(`${prefix}: некорректные позиции контекста.`);
      }
    }
    if (meaning.examples.some((example) => !isText(example))) throw new Error(`${prefix}: некорректный пример модели.`);
  }
  if (card.schedule) {
    const schedule = card.schedule;
    if (!schedule || typeof schedule !== "object" || !isDate(schedule.due) ||
        !["stability", "difficulty", "elapsed_days", "scheduled_days", "reps", "lapses", "state"].every((key) => Number.isFinite(schedule[key]))) {
      throw new Error(`${prefix}: некорректное расписание повторения.`);
    }
    if (schedule.last_review !== undefined && schedule.last_review !== null && !isDate(schedule.last_review)) {
      throw new Error(`${prefix}: некорректная дата последнего повторения.`);
    }
  }
  if (card.firstReviewedAt !== undefined && !isDate(card.firstReviewedAt)) throw new Error(`${prefix}: некорректная дата первого повторения.`);
  if (card.nextMeaning !== undefined && (!Number.isSafeInteger(card.nextMeaning) || card.nextMeaning < 0 || card.nextMeaning >= card.meanings.length)) {
    throw new Error(`${prefix}: некорректный порядок значений.`);
  }
}

export function parseBackup(contents) {
  let backup;
  try {
    backup = JSON.parse(contents);
  } catch {
    throw new Error("Файл не является корректным JSON.");
  }
  if (!backup || backup.format !== FORMAT || backup.version !== VERSION || !isDate(backup.exportedAt) || !Array.isArray(backup.cards)) {
    throw new Error("Формат резервной копии не поддерживается.");
  }
  const ids = new Set();
  backup.cards.forEach((card, index) => {
    validateCard(card, index);
    if (ids.has(card.id)) throw new Error("В резервной копии повторяется идентификатор карточки.");
    ids.add(card.id);
  });
  return backup.cards;
}

export async function restoreBackup(cardsToRestore, confirmReplace) {
  return updateCards((cards) => {
    if (cards.length && !confirmReplace()) throw new Error("Импорт отменён. Текущий словарь сохранён.");
    cards.splice(0, cards.length, ...structuredClone(cardsToRestore));
  });
}
