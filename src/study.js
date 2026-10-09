function localDay(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayOffset(day, offset) {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return localDay(date);
}

export function currentStreak(days, today = localDay(new Date())) {
  const latest = days.includes(today) ? today : dayOffset(today, -1);
  if (!days.includes(latest)) return 0;
  const activeDays = new Set(days);
  let streak = 0;
  for (let day = latest; activeDays.has(day); day = dayOffset(day, -1)) streak++;
  return streak;
}

function longestStreak(days) {
  const activeDays = [...new Set(days)].sort();
  let longest = 0;
  let streak = 0;
  let previous;
  for (const day of activeDays) {
    streak = previous && dayOffset(previous, 1) === day ? streak + 1 : 1;
    longest = Math.max(longest, streak);
    previous = day;
  }
  return longest;
}

export async function recordStudyReview() {
  return navigator.locks.request("lexideck-study", async () => {
    const { studyStats = { days: [], reviewCount: 0 } } = await chrome.storage.local.get("studyStats");
    const today = localDay(new Date());
    const days = [...new Set([...studyStats.days, today])].sort();
    const next = { days, reviewCount: studyStats.reviewCount + 1 };
    await chrome.storage.local.set({ studyStats: next });
    return next;
  });
}

export async function renderStudyStats() {
  const { studyStats = { days: [], reviewCount: 0 } } = await chrome.storage.local.get("studyStats");
  const streak = currentStreak(studyStats.days);
  document.getElementById("study-streak").textContent = `Серия занятий: ${streak} ${streak === 1 ? "день" : streak >= 2 && streak <= 4 ? "дня" : "дней"}`;
  const achievements = [
    { title: "Первый ответ", earned: studyStats.reviewCount >= 1 },
    { title: "10 оценок карточек", earned: studyStats.reviewCount >= 10 },
    { title: "Серия из 3 дней", earned: longestStreak(studyStats.days) >= 3 }
  ];
  document.getElementById("study-achievements").replaceChildren(...achievements.map(({ title, earned }) => {
    const item = document.createElement("li");
    item.textContent = `${earned ? "Получено" : "Пока не получено"}: ${title}`;
    return item;
  }));
}
