# CSS — оформление Antigravity через Less

Модуль добавляет компактное оформление сайдбара и стили иерархических папок. Исходники находятся в [style.less](C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/CSS/code/style.less) и папке `CSS/code/less/`. Файл `style.css` генерируется из них и затем вставляется в каждое окно Antigravity.

## Правка оформления

1. Откройте нужный исходник Less из таблицы ниже.
2. Измените правила и сохраните файл.
3. Если Antigravity открыт и модуль CSS включён, сборка и применение стилей выполнятся автоматически.
4. Если после изменения размеров виртуальный список не пересчитал высоты, нажмите `Ctrl+R`.

| Файл | Что редактировать |
|---|---|
| [style.less](C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/CSS/code/style.less) | Общие параметры и список импортов. |
| [compact.less](C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/CSS/code/less/compact.less) | Размеры и интервалы элементов сайдбара. |
| [folders.less](C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/CSS/code/less/folders.less) | Заголовки, кнопки, контекстные меню и диалоги папок. |
| [indent.less](C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/CSS/code/less/indent.less) | Отступы по глубине дерева, строки разговоров и их кнопки. |
| [style.css](C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/CSS/code/style.css) | Результат сборки, который читает Electron. Его изменения будут заменены следующей сборкой. |

Настройки в `style.less`:

| Переменная | Значение по умолчанию | Назначение |
|---|---|---|
| `@folder-indent` | `14px` | Шаг отступа дерева; используется также в CSS-переменной `--folder-indent-unit`. |
| `@folder-depth-limit` | `12` | Последний уровень генерации правил `[data-folder-depth]` для CSS-переменной глубины. |
| `@explicit-depth-limit` | `8` | Последний уровень генерации дополнительных правил с вычисленным числовым отступом. |

Уровни в этих правилах начинаются с нуля. Это диапазоны дополнительных CSS-правил, а не ограничения глубины дерева: Folders передаёт `--folder-depth` также через стиль виртуальной строки.

Дополнительные исходники помещайте непосредственно в `CSS/code/less/` и добавляйте их импорт в `style.less`. Наблюдатели отслеживают сам `style.less` и события в этой папке; вложенные каталоги отдельно не наблюдаются.

Названия проектов в `conversation-list-sidebar` занимают доступную ширину карточки: в `compact.less` вложенные flex-контейнеры и `span.truncate` растягиваются, правый отступ в покое — 6 px. При наведении или фокусе в карточке возвращается 64 px под штатные кнопки. Отступ по глубине дерева сохраняется; длинные названия сокращаются у края доступной области. Проверено на компоненте и CSS Antigravity 2.23.1 при ширине 280, 380 и 547 px, на глубинах 0 и 5, включая hover и клавиатурный фокус.

Плотность дерева задают `@tree-row-height: 16px` и `@tree-line-height: 14px` в `style.less`. Папки, проекты, разговоры, пустые строки и «See all» имеют одинаковую высоту; вертикальные padding строк и margin заголовков убраны. Внутренние контейнеры, кнопки и иконки помещаются в строку, размер названий папок и проектов сохранён. Виртуальный список измеряет реальные высоты через `measureElement` и пересчитывает позиции после изменения CSS.

## Сборка при закрытом Antigravity

Из любой папки выполните:

```powershell
node 'C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/CSS/code/build.js'
```

Сообщение `Less → style.css: обновлено.` означает, что CSS записан. Сообщение `Less → style.css: без изменений.` означает, что уже сохранён тот же результат. Для изменения Less и ручной сборки не нужно переустанавливать подключение внутри `app.asar`.

При ошибке компиляции новый CSS не записывается: остаётся последняя успешно собранная версия. Исправьте указанный исходник и сохраните его снова либо повторите команду сборки. Компилятор Less установлен среди зависимостей `Upgrade/code/node_modules`; общая установка зависимостей описана в [руководстве Upgrade](C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Upgrade/KB/README.md).

## Как модуль подключается

Подключение принадлежит общему инструменту Upgrade:

```text
app.asar: создание основного окна перед loadURL
	Upgrade/code/bootstrap.js
		Upgrade/code/registry.js → CSS/code/tool.json
			CSS/code/bootstrap.js
				CSS/code/build.js → style.less + less/*.less → style.css
				dom-ready / изменение style.css → webContents.insertCSS()
```

[tool.json](C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/CSS/code/tool.json) регистрирует модуль `css`: `entry` указывает на `bootstrap.js`, а `prepare` — на `build.js`. При восстановлении Upgrade сначала проверяет сборку без записи, затем при применении выполняет обычную сборку. Сам загрузчик вызывает модуль CSS один раз для каждого нового окна.

[bootstrap.js](C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/CSS/code/bootstrap.js) запускает сборку при подключении окна, вставляет CSS на `dom-ready` и последовательно заменяет ранее вставленную версию после изменений файла. Он создаёт два наблюдателя `fs.watch`: для `CSS/code/` и для `CSS/code/less/`. Проверки по периодическому таймеру не используются; таймер в 100 мс объединяет события изменения готового CSS. Оба наблюдателя закрываются вместе с окном.

Folders имеет собственный манифест и собственную точку входа. CSS содержит оформление его элементов, поэтому манифест Folders объявляет зависимость от `css`; ручной строки подключения Folders в CSS bootstrap нет.

## Установка и восстановление после обновления

1. Сохраните работу и полностью выйдите из Antigravity во всех профилях Windows: `Ctrl+Q` либо `Quit` в трее.
2. Запустите ярлык **Antigravity - Upgrade** на Рабочем столе.
3. Дождитесь сообщения об успешном восстановлении или уже подключённых модулях.
4. Запустите Antigravity обычным способом.

Общая установка возвращает **все включённые модули**, а не только оформление. Её проверки процессов, резервные копии и защита от отката на другую версию описаны в [руководстве Upgrade](C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Upgrade/KB/README.md).

Ручной запуск восстановления:

```powershell
node 'C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Upgrade/code/upgrade.js'
```

Проверка подключения без изменения установленного архива:

```powershell
node 'C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Upgrade/code/upgrade.js' --check
```

Установка и откат требуют отсутствия всех процессов `Antigravity.exe`. Правки Less, ручная сборка и `--check` этого не требуют. Если несколько профилей используют одну и ту же установку приложения и эту папку инструментов, изменение общего оформления затрагивает их окна.

## Прежние команды `patch.js` и `restore.js`

| Команда | Текущее действие |
|---|---|
| `node CSS/code/patch.js` | Делегирует установку общему `Upgrade/code/upgrade.js`; подключает все включённые модули. |
| `node CSS/code/restore.js` | Делегирует общий откат архива режиму `--restore`; затрагивает подключение всех модулей в этом архиве. |

В таблице пути относительно `primary/tools`; из другой папки используйте полный путь к файлу. Эти обёртки не принимают параметры командной строки Upgrade. Для `--check`, `--app-dir` и других параметров запускайте непосредственно `upgrade.js`.

Резервные копии создаёт Upgrade в `Upgrade/code/state/<идентификатор установки>/`: имя архива — его исходный SHA-256, рядом хранится JSON с версией и хешами. Копии сохраняются после отката. Файлы Less, готовый CSS, манифесты и конфигурация Folders при откате архива сохраняются. Откат восстанавливает архив до установки конкретного хука Upgrade; такой архив мог уже содержать прежние доработки. Для обратного подключения после отката снова запустите Upgrade при закрытом приложении.

## Отключение оформления

Чтобы отключить весь модуль CSS, задайте `"enabled": false` в его `tool.json` и в `Folders/code/tool.json`, затем полностью перезапустите Antigravity. Folders требует CSS, поэтому оставить Folders включённым при отключённом `css` нельзя: проверка реестра завершится ошибкой зависимости.

Чтобы отключить только отдельные правила, измените соответствующий исходник Less. Чтобы отключить только папки, следуйте [руководству Folders](C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Folders/KB/README.md); компактное оформление CSS можно оставить включённым.

## Диагностика

| Симптом | Что проверить |
|---|---|
| Сохранение Less не меняет интерфейс | Включён ли `css`, установлен ли общий хук; затем выполнить сборку вручную и проверить её вывод. |
| Компиляция завершается ошибкой | Указанный исходник Less и наличие зависимостей Upgrade. |
| Стили пропали после обновления | Выполнить восстановление через ярлык Upgrade при закрытом приложении. |
| Размеры строк после правки выглядят неверно | Перезагрузить интерфейс через `Ctrl+R`. |
| Ошибка применения CSS | Журнал `%APPDATA%/Antigravity/logs/main.log`, метки `[custom-ui]` и `[antigravity-tools:css]`. |

Изменения JavaScript в `bootstrap.js` и `build.js` требуют полного перезапуска Antigravity: модули уже загружены в основном процессе. Изменения Less подхватываются наблюдателями.
