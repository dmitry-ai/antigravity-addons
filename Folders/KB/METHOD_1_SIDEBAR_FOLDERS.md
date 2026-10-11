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
               |  CSS/code/bootstrap.js                               |
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

1. [`folders-patch.js`](file:///C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Folders/code/folders-patch.js) — ядро трансформации AST/строк бандла. Группирует проекты по папкам, обеспечивает показ пустых папок, перехватывает `storageService` в хуке `hR` для мгновенных реактивных обновлений и бандлит клиентский контроллер.
2. [`folders-client.js`](file:///C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Folders/code/folders-client.js) — клиентский UI-контроллер в окне рендерера: кнопка «Создать папку» `📁+`, контекстные меню папок и проектов, инлайн-переименование (`F2`), Drag & Drop проектов на папки с визуальной подсветкой и обработка горячих клавиш.
3. [`folders-bootstrap.js`](file:///C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Folders/code/folders-bootstrap.js) — Electron-модуль перехвата протокола HTTPS (`protocol.handle`). Обслуживает бандл `/main.js` и внутренний REST API `/api/project-folders` для всех операций (создание, переименование, удаление, привязка/отвязка).
4. [`folders-manager.js`](file:///C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Folders/code/folders-manager.js) — ядро операций с JSON и CLI-утилита.
5. [`install-folders.js`](file:///C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Folders/code/install-folders.js) — безопасный скрипт подключения хука в `bootstrap.js`.
6. [`uninstall-folders.js`](file:///C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Folders/code/uninstall-folders.js) — скрипт мгновенного отката.
7. [`test-suite.js`](file:///C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Folders/code/test-suite.js) — автоматический набор из 21 теста.

---

## 4. Конфигурация папок (`folders.json`)

Хранится локально в каталоге инструмента:
[`C:\work\research\provision\code\Software\Google\AI\Antigravity\primary\tools\Folders\code\folders.json`](file:///C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Folders/code/folders.json)

---

## 5. Гарантии надежности и безопасности

1. **Неприкосновенность `app.asar`**: Архив `app.asar` программы не модифицируется повторно. Вся маршрутизация идет через уже имеющийся внешний вызов `bootstrap.js` в каталоге `CSS/code`.
2. **Нулевой риск падения UI (Graceful Degradation)**: Если контрольные анкоры в бандле не обнаружены (например, при масштабном апдейте Antigravity), `folders-patch.js` возвращает исходный код без изменений.
3. **Мгновенные реактивные обновления (Zero Reload)**: Благодаря перехвату `storageService` в хуке `hR`, любые действия в UI вызывают немедленную перерисовку дерева без `Ctrl+R`.
4. **Сохранность баз данных**: Внутренние базы Antigravity (`conversation_summaries.db`) не затрагиваются, сетевые порты не открываются.
5. **Мгновенный откат**: Для отключения достаточно выполнить `node uninstall-folders.js`.

---

## 6. Результаты верификации

Запуск тестового набора [`test-suite.js`](file:///C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Folders/code/test-suite.js):
```text
--- TEST 1: Anchor discovery in extracted main.js ---
✅ PASS: LOOP_ANCHOR found in main.js
✅ PASS: LOOP_END found in main.js
✅ PASS: HR_ANCHOR found in main.js
--- TEST 2: Syntax and AST validity of patched main.js ---
✅ PASS: Patched source is larger than original source
✅ PASS: Header contains window.__PROJECT_FOLDERS_DATA__
✅ PASS: Header contains window.__PROJECT_FOLDERS_CLIENT__
✅ PASS: Hooks window.__STORAGE_SERVICE__ in hR
✅ PASS: Renders placeholder for empty folders
✅ PASS: Contains folder icon prefix
✅ PASS: Patched main.js parsed by V8 compiler with zero syntax errors
--- TEST 3: folders-client.js standalone syntax validity ---
✅ PASS: folders-client.js exists
✅ PASS: Contains showCreateFolderDialog
✅ PASS: Contains startInlineRename (F2)
✅ PASS: Contains showFolderContextMenu
✅ PASS: Contains showProjectContextMenu
✅ PASS: Contains Drag & Drop handling
--- TEST 4: folders-manager operations on isolated mock config ---
✅ PASS: Folder Alpha added
✅ PASS: Folder Alpha renamed
✅ PASS: Project proj-x assigned to fld-1
✅ PASS: Project proj-x unassigned
✅ PASS: Folder fld-1 removed

🎉 Test Suite Completed: 21/21 tests passed.
```
