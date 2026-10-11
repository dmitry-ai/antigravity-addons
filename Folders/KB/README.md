# Project Folders: Иерархический менеджер проектов для Google Antigravity 2.0

Инструмент организации проектов и диалогов в Google Antigravity 2.0 непосредственно в основном левом списке **Projects** (**Способ 1 из ответа 7**).

---

## 1. Как это устроено

1. **Интеграция в левый сайдбар**:
   Проекты группируются в интерактивные сворачиваемые папки непосредственно в основном списке `Projects` левой панели Antigravity.
2. **Нативные действия и меню**:
   Строки проектов сохраняют нативные заголовки, кнопку создания нового диалога **`+`**, настройки и контекстное меню проекта (`Project settings`, `Archive`, `Delete`).
3. **Плавная виртуализация (TanStack Virtual)**:
   При сворачивании папки её проекты и их диалоги исключаются из плоского списка виртуализатора. Виртуализатор автоматически пересчитывает общую высоту списка без рывков скролла и артефактов верстки.
4. **Сохранение состояния**:
   Свернутые и развернутые папки сохраняются в штатном персистентном стейте Antigravity (`sidebar_collapsed_section_headers`) и переживают перезапуски.

---

## 2. Структура проекта

Все файлы решения размещены строго в папке:
[`C:\work\research\provision\code\Software\Google\AI\Antigravity\primary\tools\Folders\code`](file:///C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Folders/code)

```text
code/
├── folders-patch.js        # Ядро трансформации бандла main.js для группировки проектов
├── folders-bootstrap.js    # Electron-модуль перехвата HTTPS-запросов и кэширования
├── folders-manager.js      # CLI-утилита для управления папками и назначения проектов
├── folders.json            # Локальная конфигурация папок и привязок проектов
├── install-folders.js      # Безопасное подключение хука в bootstrap.js
├── uninstall-folders.js    # Мгновенное отключение и откат
└── test-suite.js           # Автоматический тестовый набор (V8 compiler, AST, JSON)
```

---

## 3. Управление папками (CLI)

Конфигурационный файл хранится локально в:
[`C:\work\research\provision\code\Software\Google\AI\Antigravity\primary\tools\Folders\code\folders.json`](file:///C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Folders/code/folders.json)

Команды управления:

```powershell
Set-Location 'C:\work\research\provision\code\Software\Google\AI\Antigravity\primary\tools\Folders\code'

# Показать список папок и привязанных проектов
node folders-manager.js list

# Добавить новую папку
node folders-manager.js add-folder "folder-clients" "Клиенты" "#3b82f6"

# Привязать проект к папке
node folders-manager.js assign "d464191e-4dc5-4ca8-a7d7-ed412d141f5f" "folder-upwork"

# Отвязать проект от папки (вернуть в корень)
node folders-manager.js unassign "d464191e-4dc5-4ca8-a7d7-ed412d141f5f"

# Удалить папку
node folders-manager.js remove-folder "folder-archive"
```

---

## 4. Безопасность и надежность

- **`app.asar` не тронут**: Решение использует уже существующий внешний файловый мост `bootstrap.js` из задачи UI.
- **Graceful Fallback**: При несовпадении анкоров в коде бандла (например, при обновлении Antigravity на новую мажорную версию) отдается исходный оригинальный код.
- **Базы данных в безопасности**: Базы Antigravity (`conversation_summaries.db`) не затрагиваются.
- **Сетевые порты не занимаются**: Никаких сторонних HTTP-серверов в Windows не создается.
- **Откат в один клик**: `node uninstall-folders.js` мгновенно возвращает `bootstrap.js` к исходному состоянию.

---

## 5. Дополнительная документация

- Детальный архитектурный разбор Способа 1 с доказательствами и ссылками:  
  [`METHOD_1_SIDEBAR_FOLDERS.md`](file:///C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Folders/KB/METHOD_1_SIDEBAR_FOLDERS.md)
