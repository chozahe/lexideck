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

function isDue(card, now) {
  return card.schedule && new Date(card.schedule.due) <= now;
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
  sessionQueue = [];
  sessionCompleted = 0;
  sessionStarted = true;
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
  const now = new Date();
  const remainingNew = Math.max(0, await dailyLimit() - introducedOn(cards, now));
  const available = [
    ...cards.filter((card) => isDue(card, now)),
    ...cards.filter((card) => !card.schedule).slice(0, remainingNew)
  ];
  // Пересчитываем остаток по FSRS: срок уже оценённой карточки мог наступить снова.
  sessionQueue.splice(sessionCompleted, sessionQueue.length - sessionCompleted, ...available.map((card) => card.id));
  currentCard = available[0];
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
  $("review-status").textContent = "Ответ открыт. Оцените, насколько хорошо вы вспомнили значение.";
  $("review-answer").focus();
}

export function setupReview(onReview = async () => {}) {
  if (!$("review")) return;
  void renderStudyStats();
  $("start-review").addEventListener("click", () => {
    $("start-review").disabled = true;
    void startSession().then(() => {
      if (currentCard) $("show-answer").focus();
      else $("review-status").focus();
    }).catch((error) => { $("review-status").textContent = error.message; $("review-status").focus(); }).finally(() => {
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
      let queueChanged = false;
      try {
        await updateCards(async (cards) => {
          const card = cards.find((item) => item.id === reviewedCard.id);
          const now = new Date();
          if (!card || card.schedule?.reps !== reviewedCard.schedule?.reps || (card.schedule && !isDue(card, now))) {
            queueChanged = true;
            throw new Error("Карточка уже изменилась в другой вкладке и пропущена.");
          }
          if (!card.schedule && introducedOn(cards, now) >= await dailyLimit()) {
            queueChanged = true;
            throw new Error("Дневной лимит новых карточек исчерпан.");
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
        if (currentCard) $("show-answer").focus();
        else $("review-status").focus();
      } catch (error) {
        if (queueChanged) {
          sessionQueue.splice(sessionCompleted, 1);
          currentCard = undefined;
          await nextCard();
          $("review-status").textContent = `${error.message} ${$("review-status").textContent}`;
        } else $("review-status").textContent = `Не удалось сохранить ответ: ${error.message}`;
        if (!queueChanged) button.focus();
      } finally {
        saving = false;
        $("start-review").disabled = false;
      }
    });
  }
}
