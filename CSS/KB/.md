> Обновлено 13 октября 2026 года: после обновления используйте ярлык **Antigravity - Upgrade**. Актуальные установка, откат, резервные копии и расширение реестра описаны в [руководстве Upgrade](C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Upgrade/KB/README.md). Исходники оформления теперь находятся в `CSS/code/style.less` и `CSS/code/less/`; `style.css` генерируется автоматически. Ниже сохранено прежнее описание; при расхождениях следуйте руководству Upgrade.

# Antigravity: свой CSS для интерфейса — инструкция

## 1. Как это устроено

1. В `resources\app.asar` (файл `dist/utils.js`, функция `createWindow`) добавлена **одна строка**, которая вызывает `bootstrap.js` из папки `code/`.
2. [`bootstrap.js`](file:///C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/CSS/code/bootstrap.js) на каждой загрузке страницы окна (событие `dom-ready`) читает `style.css` и вставляет его через `webContents.insertCSS()`.
3. [`style.css`](file:///C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/CSS/code/style.css) — ваши стили. Это единственный файл, который нужно редактировать в обычной работе.
4. [`patch.js`](file:///C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/CSS/code/patch.js) — добавляет эту строку в `app.asar` и делает резервную копию `app.asar.original`.
5. [`restore.js`](file:///C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/CSS/code/restore.js) — возвращает оригинальный `app.asar` из копии и удаляет копию.

Вне папки `code/` есть только:
- изменённый `C:\Users\dfedi\AppData\Local\Programs\antigravity\resources\app.asar`;
- его копия `app.asar.original` рядом;
- кэш `npx` (`%LOCALAPPDATA%\npm-cache\_npx`).

> [!IMPORTANT]
> Папка программы одна на всех пользователей Windows (`dfedi`, `A1`, `A2`). Поэтому патч действует на **все** профили Antigravity сразу. Перед `patch.js` и `restore.js` должны быть закрыты все экземпляры у всех пользователей. Сами скрипты это проверяют и откажутся работать, если найдут хотя бы один процесс `Antigravity.exe`.

---

## 2. «Скрипт постоянно долбит файловую систему?» — нет

`bootstrap.js` **ничего не опрашивает и не сканирует**. Он один раз подписывается у Windows на уведомления об изменениях в папке `code/` (`fs.watch`). Потом он спит, пока Windows сама не сообщит, что в папке что-то изменилось.

Доказательства — документация Node.js:
- [fs.watch → Availability](https://nodejs.org/api/fs.html#availability):
  > *"On Windows systems, this feature depends on `ReadDirectoryChangesW`."*

  Это системный механизм уведомлений Windows: событие присылает ядро, никакого цикла проверки нет.
- [fs.watchFile](https://nodejs.org/api/fs.html#fswatchfilefilename-options-listener) — вот это как раз опрос по таймеру (`stat` раз в N мс). Он **не используется**. Документация прямо говорит:
  > *"Using `fs.watch()` is more efficient than `fs.watchFile()` and `fs.unwatchFile()`."*

Цена в простое: один дескриптор каталога на окно и ноль процессорного времени. Наблюдатель закрывается при закрытии окна (`win.on('closed', …)`).

---

## 3. Активация и перепатчивание

Когда Antigravity закрыт (у всех пользователей Windows):

1. Полностью выйдите из Antigravity во всех профилях: `Ctrl+Q` в окне или «Quit» в значке трея.
2. Проверьте, что процессов не осталось:
   ```powershell
   tasklist /FI "IMAGENAME eq Antigravity.exe" /NH | Select-String Antigravity
   ```
3. Выполните:
   ```powershell
   Set-Location 'C:\work\research\provision\code\Software\Google\AI\Antigravity\primary\tools\CSS\code'
   node restore.js
   node patch.js
   ```
   Ожидаемый вывод: `Restored.`, затем `Patched. Unpacked dirs preserved: node_modules/chrome-devtools-mcp`.
4. Запустите Antigravity как обычно. Стили из `style.css` применятся автоматически.

---

## 4. Повседневная работа: правка стилей

1. Откройте [`style.css`](file:///C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/CSS/code/style.css) в любом редакторе.
2. Измените правила и нажмите **`Ctrl+S`**.
3. **Всё.** Примерно через 0,1 с стили применятся во всех открытых окнах Antigravity. Ничего запускать и перезапускать не нужно.

Если изменение не видно:
- Нажмите **`Ctrl+R`** в окне Antigravity (перезагрузка интерфейса). Виртуальный список (TanStack Virtual) пересчитает высоту строк.
- Ошибки самого `bootstrap.js` пишутся с меткой `[custom-ui]` в `C:\Users\dfedi\AppData\Roaming\Antigravity\logs\main.log`.

---

## 5. После автообновления Antigravity

Признак: после обновления ваши стили пропали. Обновление ставит новый `app.asar` без хука.

1. Полностью выйдите из Antigravity во всех профилях (`Ctrl+Q` / Quit в трее).
2. Выполните **только** `patch.js`:
   ```powershell
   Set-Location 'C:\work\research\provision\code\Software\Google\AI\Antigravity\primary\tools\CSS\code'
   node patch.js
   ```
   Он сделает свежую копию **новой** версии и встроит хук.
3. Запустите Antigravity.

---

## 6. Полный откат

1. Полностью выйдите из Antigravity во всех профилях (`Ctrl+Q` / Quit в трее).
2. Выполните:
   ```powershell
   Set-Location 'C:\work\research\provision\code\Software\Google\AI\Antigravity\primary\tools\CSS\code'
   node restore.js
   ```
3. Запустите Antigravity — он будет полностью оригинальным, а копия `app.asar.original` удалится.

---

## 7. Краткая памятка

- Поменять стили: правка `style.css` → `Ctrl+S`. Если не пересчиталась высота виртуального списка — `Ctrl+R`.
- Пропали стили после обновления: выйти из всех экземпляров → `node patch.js` → запустить.
- Убрать всё: выйти из всех экземпляров → `node restore.js` → запустить.
- `patch.js` и `restore.js` — только при **полностью** закрытом Antigravity у **всех** пользователей Windows.
