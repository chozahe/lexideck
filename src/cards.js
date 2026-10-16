// Панели разных окон изменяют общий словарь последовательно.
export async function updateCards(update, { beforeCommit } = {}) {
  return navigator.locks.request("lexideck-cards", async () => {
    const { cards = [] } = await chrome.storage.local.get("cards");
    if (beforeCommit && !beforeCommit()) return false;
    await update(cards);
    await chrome.storage.local.set({ cards });
    return true;
  });
}
