// Панели разных окон изменяют общий словарь последовательно.
export async function updateCards(update) {
  return navigator.locks.request("lexideck-cards", async () => {
    const { cards = [] } = await chrome.storage.local.get("cards");
    await update(cards);
    await chrome.storage.local.set({ cards });
  });
}
