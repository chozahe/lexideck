import { createEmptyCard, fsrs } from "./vendor/ts-fsrs.js";
import { updateCards } from "./cards.js";
import { recordStudyReview, renderStudyStats } from "./study.js";

const scheduler = fsrs();
const $ = (id) => document.getElementById(id);
let currentCard;
let saving = false;
let sessionQueue = [];
let sessionCompleted = 0;
let sessionStarted = false;

function localDay(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

async function dailyLimit() {
  const { newCardLimit = 10 } = await chrome.storage.local.get("newCardLimit");
  return newCardLimit;
}

function introducedOn(cards, now) {
  return cards.filter((card) => card.firstReviewedAt && localDay(new Date(card.firstReviewedAt)) === localDay(now)).length;
}

function renderProgress() {
  const progress = $("review-progress");
  const bar = $("review-progress-bar");
  if (!sessionStarted) {
    progress.textContent = "Занятие ещё не начато.";
    bar.hidden = true;
    bar.value = 0;
    return;
  }
  const total = sessionQueue.length;
  const remaining = Math.max(0, total - sessionCompleted);
  progress.textContent = `Пройдено ${sessionCompleted} из ${total}. Осталось ${remaining}.`;
  bar.hidden = total === 0;
  bar.max = Math.max(total, 1);
  bar.value = sessionCompleted;
}

async function startSession() {
  const { cards = [] } = await chrome.storage.local.get("cards");
  const now = new Date();
  const limit = await dailyLimit();
  const introducedToday = introducedOn(cards, now);
  const dueCards = cards.filter((card) => card.schedule && new Date(card.schedule.due) <= now);
  const newCards = introducedToday < limit
    ? cards.filter((card) => !card.schedule).slice(0, limit - introducedToday)
    : [];
  sessionQueue = [...dueCards, ...newCards].map((card) => card.id);
  sessionCompleted = 0;
  sessionStarted = true;
  renderProgress();
  await nextCard();
}

async function nextCard() {
  if (!sessionStarted) {
    currentCard = undefined;
    $("review-card").hidden = true;
    renderProgress();
    return;
  }
  const { cards = [] } = await chrome.storage.local.get("cards");
  currentCard = cards.find((card) => card.id === sessionQueue[sessionCompleted]);
  $("review-card").hidden = !currentCard;
  $("review-answer").hidden = true;
  $("show-answer").hidden = false;
  if (currentCard) {
    $("review-status").textContent = "Вспомните значение, затем откройте ответ.";
  } else if (!sessionQueue.length) {
    $("review-status").textContent = "На сегодня всё. Карточек для занятия пока нет.";
  } else if (sessionCompleted >= sessionQueue.length) {
    $("review-status").textContent = "Занятие завершено: все карточки пройдены.";
  } else {
    $("review-status").textContent = "Очередь изменилась в другой вкладке. Начните занятие снова.";
  }
  renderProgress();
  if (currentCard) $("review-headword").textContent = currentCard.headword;
}

function showAnswer() {
  if (!currentCard || saving) return;
  const meaning = currentCard.meanings[(currentCard.nextMeaning || 0) % currentCard.meanings.length];
  $("review-meaning").textContent = meaning.text;
  for (const [id, texts] of [
    ["review-contexts", meaning.contexts.map((context) => `${context.form}: ${context.text}`)],
    ["review-examples", meaning.examples]
  ]) {
    $(id).replaceChildren(...texts.map((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }));
  }
  $("review-answer").hidden = false;
  $("show-answer").hidden = true;
}

export function setupReview(onReview = async () => {}) {
  if (!$("review")) return;
  void renderStudyStats();
  void dailyLimit().then((limit) => { $("new-card-limit").value = limit; }).catch((error) => {
    $("review-settings-status").textContent = `Не удалось загрузить лимит: ${error.message}`;
  });
  $("review-settings").addEventListener("submit", async (event) => {
    event.preventDefault();
    const limit = Number($("new-card-limit").value);
    if (!Number.isSafeInteger(limit) || limit < 0) {
      $("review-settings-status").textContent = "Укажите целое неотрицательное число.";
      return;
    }
    try {
      await chrome.storage.local.set({ newCardLimit: limit });
      $("review-settings-status").textContent = "Лимит сохранён.";
      if (!saving) await nextCard();
    } catch (error) {
      $("review-settings-status").textContent = `Не удалось сохранить лимит: ${error.message}`;
    }
  });
  $("start-review").addEventListener("click", () => {
    $("start-review").disabled = true;
    void startSession().catch((error) => { $("review-status").textContent = error.message; }).finally(() => {
      $("start-review").disabled = saving;
    });
  });
  $("show-answer").addEventListener("click", showAnswer);
  for (const button of $("review-ratings").querySelectorAll("button")) {
    button.addEventListener("click", async () => {
      if (!currentCard || saving || $("review-answer").hidden) return;
      const reviewedCard = currentCard;
      saving = true;
      $("start-review").disabled = true;
      try {
        await updateCards(async (cards) => {
          const card = cards.find((item) => item.id === reviewedCard.id);
          if (!card || card.schedule?.reps !== reviewedCard.schedule?.reps) {
            throw new Error("Карточка уже изменилась в другой панели. Начните занятие снова.");
          }
          const now = new Date();
          if (!card.schedule && introducedOn(cards, now) >= await dailyLimit()) {
            throw new Error("Дневной лимит новых карточек исчерпан. Начните занятие снова.");
          }
          const result = scheduler.next(card.schedule || createEmptyCard(now), now, Number(button.dataset.rating));
          if (!card.schedule) card.firstReviewedAt = now.toISOString();
          card.schedule = JSON.parse(JSON.stringify(result.card));
          const meaningIndex = (reviewedCard.nextMeaning || 0) % reviewedCard.meanings.length;
          card.nextMeaning = (meaningIndex + 1) % card.meanings.length;
          card.reviewHistory = [...(card.reviewHistory || []), { ...JSON.parse(JSON.stringify(result.log)), meaningIndex }];
        });
        await recordStudyReview();
        sessionCompleted += 1;
        currentCard = undefined;
        $("review-card").hidden = true;
        await renderStudyStats();
        await onReview();
        await nextCard();
      } catch (error) {
        $("review-status").textContent = `Не удалось сохранить ответ: ${error.message}`;
      } finally {
        saving = false;
        $("start-review").disabled = false;
      }
    });
  }
}
