# Проверка темы и адаптивной вёрстки

Скриншоты сняты в Chromium через тестовый сервер со словарём из одной карточки и
контролируемым API для экрана панели. Для широкого вида использован viewport
1280 × 900, для узкого — 390 × 844. Каждый экран проверен в Catppuccin Latte и
Macchiato.

| Экран | Latte, широкий | Latte, узкий | Macchiato, широкий | Macchiato, узкий |
| --- | --- | --- | --- | --- |
| Панель | [PNG](theme/latte-wide-panel.png) | [PNG](theme/latte-narrow-panel.png) | [PNG](theme/macchiato-wide-panel.png) | [PNG](theme/macchiato-narrow-panel.png) |
| Повторение | [PNG](theme/latte-wide-review.png) | [PNG](theme/latte-narrow-review.png) | [PNG](theme/macchiato-wide-review.png) | [PNG](theme/macchiato-narrow-review.png) |
| Словарь | [PNG](theme/latte-wide-vocabulary.png) | [PNG](theme/latte-narrow-vocabulary.png) | [PNG](theme/macchiato-wide-vocabulary.png) | [PNG](theme/macchiato-narrow-vocabulary.png) |
| Настройки | [PNG](theme/latte-wide-settings.png) | [PNG](theme/latte-narrow-settings.png) | [PNG](theme/macchiato-wide-settings.png) | [PNG](theme/macchiato-narrow-settings.png) |

Клавиатурный сценарий Playwright проверяет переход по ссылкам навигации и ввод
текста в панели, запуск занятия и открытие ответа, раскрытие карточки словаря,
а также изменение темы клавишами в настройках. Видимый фокус задан через
`:focus-visible` для ссылок, кнопок, карточек и полей ввода.

Тесты проверяют системный режим при смене светлой и тёмной схемы, сохранение
ручного выбора после перезагрузки и синхронизацию между открытыми страницами.
