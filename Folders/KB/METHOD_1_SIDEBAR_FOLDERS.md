# Реализация Способа 1: Папки проектов в левом сайдбаре Antigravity 2.0

Архитектурная и эксплуатационная документация реализации папок непосредственно в основном левом списке проектов (**Projects list**) Antigravity 2.0.

---

## 1. Суть реализации (Метод 1)

Способ 1 модифицирует массив виртуализированных элементов (`flatItems`), который компонент левой панели `jZb` передает в виртуализатор TanStack Virtual (`GRb`), не ломая нативные обработчики, кнопки и контекстные меню проектов.

- **Исходная точка формирования строк**: Функция [`$Ib`](file:///C:/Users/dfedi/AppData/Local/Temp/antigravity_main.js#L10456) в `main.js` агрегирует проекты и диалоги и вызывает [`VIb`](file:///C:/Users/dfedi/AppData/Local/Temp/antigravity_main.js#L10448).
- **Виртуализатор TanStack**: Компонент [`GRb`](file:///C:/Users/dfedi/AppData/Local/Temp/antigravity_main.js#L10805) осуществляет виртуализацию строк на базе [`sL`](https://tanstack.com/virtual/latest/docs/api/virtualizer#count) (TanStack Virtualizer), вычисляя высоту (`estimateSize`) и абсолютное смещение (`transform: translateY(...)`).
- **Сворачивание / разворачивание**:
  - Папки объявляются как строки типа `section-header` с уникальным `collapseId: "folder-" + folder.id`.
  - При клике на папку вызывается нативный обработчик `onToggleSectionHeader`, который сохраняет состояние сворачивания в штатный персистентный стейт Antigravity (`sidebar_collapsed_section_headers`).
  - При сворачивании папки все входящие в неё проекты и их диалоги исключаются из массива `flatItems`, благодаря чему виртуализатор автоматически пересчитывает размер списка без сдвигов и артефактов верстки.

---

## 2. Архитектура и цепочка выполнения

```text
               +------------------------------------------------------+
               |                  Antigravity.exe                     |
               |                                                      |
               |  dist/utils.js: createWindow()                       |
               |     |                                                |
               |     v                                                |
               |  1 - UI/code/bootstrap.js                            |
               |     |                                                |
               |     v                                                |
               |  Folders/code/folders-bootstrap.js                   |
               |     | (Регистрирует protocol.handle('https'))         |
               +-----+------------------------------------------------+
                     |
                     | Запрос: https://127.0.0.1:<port>/main.js
                     v
+---------------------------------------------------------------------+
|                      Electron Main Process                          |
|                                                                     |
| 1. Перехват запроса к /main.js                                      |
| 2. Загрузка реального main.js из Language Server через net.fetch()   |
| 3. Чтение конфигурации из folders.json                              |
| 4. Применение трансформации: folders-patch.js (applyFolderPatch)     |
| 5. Возврат пропатченного Response в окно Chromium                   |
+---------------------------------------------------------------------+
                     |
                     | Выполнение в окне рендерера
                     v
+---------------------------------------------------------------------+
|                     Renderer UI (React + TanStack)                  |
|                                                                     |
| 1. $Ib -> VIb строит список:                                        |
|    - section-header: "📁 Upwork (3)"                               |
|       ↳ header: "U.P - 2026-10-11 - howaboutnope.com" (нативный)    |
|          ↳ row: "Чат 1"                                             |
|       ↳ header: "Другой проект Upwork"                             |
|    - section-header: "📁 Клиенты (1)"                               |
|    - section-header: "📁 Внутренние (4)"                            |
|    - [Проекты без папки на верхнем уровне]                          |
|    - section-header: "Conversations" (Standalone)                   |
| 2. TanStack Virtualizer гладко рендерит только видимые строки       |
+---------------------------------------------------------------------+
```

---

## 3. Компоненты решения в `Folders/code`

Все исходные файлы и утилиты размещены строго в папке:
[`C:\work\research\provision\code\Software\Google\AI\Antigravity\primary\tools\Folders\code`](file:///C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Folders/code)

1. [`folders-patch.js`](file:///C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Folders/code/folders-patch.js) — ядро трансформации AST/строк бандла. Находит точки внедрения в цикле `VIb`, группирует проекты по папкам, внедряет структуру `folders.json` и защищенный fallback.
2. [`folders-bootstrap.js`](file:///C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Folders/code/folders-bootstrap.js) — модуль для главного процесса Electron. Перехватывает запросы протокола HTTPS (`protocol.handle`), кэширует пропатченный бандл и следит за изменением `folders.json`.
3. [`folders-manager.js`](file:///C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Folders/code/folders-manager.js) — CLI и программный интерфейс для управления папками и привязками проектов.
4. [`install-folders.js`](file:///C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Folders/code/install-folders.js) — безопасный скрипт подключения хука в `bootstrap.js` с автоматическим созданием резервной копии (`.bak`).
5. [`uninstall-folders.js`](file:///C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Folders/code/uninstall-folders.js) — скрипт мгновенного отката.
6. [`test-suite.js`](file:///C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Folders/code/test-suite.js) — автоматический набор тестов (парсинг V8, проверка целостности AST, операции с JSON).

---

## 4. Конфигурация папок (`folders.json`)

Хранится локально в каталоге инструмента:
[`C:\work\research\provision\code\Software\Google\AI\Antigravity\primary\tools\Folders\code\folders.json`](file:///C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Folders/code/folders.json)

Текущее распределение:
- **Upwork** (`folder-upwork`):
  - `d464191e-4dc5-4ca8-a7d7-ed412d141f5f` (`U.P - 2026-10-11 - howaboutnope.com`)
  - `0b25ef38-ecf5-44eb-8cc2-1f8b4611e19e`
  - `c9d81597-a231-4809-baf0-f4873e50b7c2`
- **Клиенты** (`folder-clients`):
  - `3b33b970-7f45-42b5-ba3d-a82584d1e07b`
- **Внутренние** (`folder-internal`):
  - `35a3532c-a530-4eb4-820b-46461ce86e4e`
  - `a1632d2e-185c-4456-87ce-49d0de5ebab7`
  - `9c3529dd-3238-4418-a9e5-43fff7ff80ee`
  - `cd16380f-c085-4876-a083-62bf924eda55`
- **Архив** (`folder-archive`)

Управление через CLI:
```powershell
# Список папок и проектов
node "C:\work\research\provision\code\Software\Google\AI\Antigravity\primary\tools\Folders\code\folders-manager.js" list

# Добавить папку
node "C:\work\research\provision\code\Software\Google\AI\Antigravity\primary\tools\Folders\code\folders-manager.js" add-folder "folder-my" "Моя папка"

# Назначить проект в папку
node "C:\work\research\provision\code\Software\Google\AI\Antigravity\primary\tools\Folders\code\folders-manager.js" assign "<projectId>" "folder-my"
```

---

## 5. Гарантии надежности и безопасности

1. **Неприкосновенность `app.asar`**: Архив `app.asar` программы не модифицируется повторно. Вся маршрутизация идет через уже имеющийся внешний вызов `bootstrap.js` в каталоге `1 - UI/code`.
2. **Нулевой риск падения UI (Graceful Degradation)**: Если контрольные анкоры в бандле не обнаружены (например, при масштабном апдейте Antigravity), `folders-patch.js` возвращает исходный код без изменений. Пользователь получает штатный интерфейс без падения или белого экрана.
3. **Сохранность баз данных**: Внутренние базы Antigravity (`conversation_summaries.db`) не затрагиваются, риск повреждения метаданных исключен.
4. **Мгновенный откат**: Для отключения достаточно выполнить `node uninstall-folders.js`.

---

## 6. Результаты верификации

Запуск тестового набора [`test-suite.js`](file:///C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Folders/code/test-suite.js):
```text
--- TEST 1: Anchor discovery in extracted main.js ---
✅ PASS: LOOP_ANCHOR found in main.js
✅ PASS: LOOP_END found in main.js
--- TEST 2: Syntax and AST validity of patched main.js ---
✅ PASS: Patched source is larger than original source
✅ PASS: Header contains window.__PROJECT_FOLDERS_DATA__
✅ PASS: Contains folder icon prefix
✅ PASS: Patched main.js parsed by V8 compiler with zero syntax errors
--- TEST 3: folders-manager operations on isolated mock config ---
✅ PASS: Folder Alpha added
✅ PASS: Project proj-x assigned to fld-1
✅ PASS: Project proj-x unassigned
✅ PASS: Folder fld-1 removed

🎉 Test Suite Completed: 10/10 tests passed.
```
