# codemaster — design

**Date:** 2026-11-27
**Status:** agreed

## 1. Problem

Правила організації коду користувача (розклад папок, де живуть константи й інтерфейси, імена, кількість аргументів, вкладеність, деструктуризація, KISS) існують лише в голові й у повідомленнях. Жоден інструмент їх не перевіряє, тому кожна сесія Claude відтворює їх з пам'яті або не відтворює зовсім, і код у гілці не покращується систематично.

Зразок — [unclebob/ub-mode](https://github.com/unclebob/ub-mode): скіл із принципами плюс детерміновані інструменти (dryer, crapper, mutator), які кажуть, що виправити. Потрібен такий самий механізм для правил користувача: наприкінці задачі хук викликає один скіл, скіл запускає скрипти перевірок і виправляє знайдене.

Репозиторій `codemaster` порожній: це новий плагін Claude Code.

## 2. Constraint that shapes the solution

**Стиль проєкту важливіший за правила плагіна.** Плагін вписується в проєкт, його код, правила й пріоритети розробника; назви папок (`modules`, `services`, `helpers`, `utils`, `consts`) і будь-які конвенції підлаштовуються під проєкт, а не навпаки. Порядок пріоритетів:

1. явні правила проєкту: `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING*`, конфіги лінтера (ESLint, Biome);
2. домінантні конвенції наявного коду;
3. типові значення codemaster — лише там, де проєкт мовчить.

Тому кожне правило читає профіль проєкту (3.2a), плагін ніколи не пропонує перейменувати наявні папки під свої назви, а будь-яке правило вимикається чи налаштовується в `.codemaster.json`.

**Правила мають перевірятися детерміновано на TS/JS зараз і бути переносними на інші мови потім, а хук `Stop` у Claude Code спрацьовує після кожної відповіді.**

- **Рушій — ast-grep** (tree-sitter, правила в YAML, ~25 мов). Відкинуто ESLint + typescript-eslint (лише TS/JS, конфлікт із власним ESLint-конфігом проєкту) і власний скрипт на TypeScript compiler API (лише TS/JS, кожне правило руками). Розклад папок і дзеркало тестів ast-grep не бачить, їх перевіряє Node-скрипт.
- **Хук `Stop` спрацьовує на кожній відповіді**, зокрема на запитання без змін. Тому хук мовчить, поки хеш змінених файлів коду збігається з хешем останньої перевірки, і не блокує повторно, коли `stop_hook_active` істинний.
- **Node 26 запускає `.ts` напряму** (вирізання типів, перевірено 2026-11-27 на v26.4.0), а `node --print-bytecode --print-bytecode-filter=<name>` друкує `Bytecode length: N` для функції. Тому турнір варіантів і сам плагін обходяться без компілятора TypeScript; плагін пише лише стираний синтаксис TS.
- **Node не перетворює JS на C++.** V8 компілює JS у байткод Ignition, гарячі функції — у машинний код Maglev/TurboFan. «Що бачить компілятор» вимірюється байткодом, деоптимізаціями і тим, наскільки TS-джерело відрізняється від JS, який виконує V8.
- **Плагін кешується за версією** (`~/.claude/plugins/cache/...`) без `node_modules`. Тому залежності ставляться окремо, в `~/.local/share/codemaster/`, а не в проєкт користувача.

Середовище перевірки: Node v26.4.0, npm 11.17.0, Python 3.14.4, `@ast-grep/cli` і `@ast-grep/napi` 0.51.3 (npm, 2026-11-27).

## 3. Solution

### 3.1. Структура плагіна

```
.claude-plugin/plugin.json        name "codemaster", version "0.1.0"
.claude-plugin/marketplace.json   один плагін "codemaster", source "./"
hooks/hooks.json                  Stop → node ${CLAUDE_PLUGIN_ROOT}/bin/codemaster.ts hook-stop
                                  SessionStart → node ${CLAUDE_PLUGIN_ROOT}/bin/codemaster.ts hook-session-start
bin/codemaster.ts                 точка входу; єдина функція верхнього рівня — main
skills/codemaster/SKILL.md        правила, порядок роботи
skills/codemaster/references/     rules.md, tournament.md, libraries.md
skills/codemaster-audit/SKILL.md  прогін по наявному коду (3.12)
rules/typescript/*.yml            правила ast-grep, один файл на rule-id
src/                              код плагіна, розклад «по шарах»
  modules/                        check.ts, conventions.ts, tournament.ts, libraries.ts, hook.ts, install.ts
  consts/  interfaces/  utils/
  helpers/infrastructure/         git, файлова система, запуск процесів
  helpers/external/               npm registry
  helpers/logic/                  чисті функції
tests/                            тінь src/: tests/modules/check.test.ts тощо
tests/fixtures/{modular,layered,libraries,tournament}/
README.md                         англійською
```

Плагін сам дотримується правил, які перевіряє: `node bin/codemaster.ts check src bin` на ньому самому дає 0 помилок.

Вимога до середовища: Node ≥ 22.18. На старшій версії `main` друкує `codemaster: requires Node >= 22.18 (found <v>)` і виходить з 0.

### 3.2. Конфігурація `.codemaster.json` (корінь проєкту, необов'язкова)

| Поле | Тип | Типово |
|---|---|---|
| `hook` | boolean | `true` |
| `layout` | `"auto" \| "modular" \| "layered" \| "off"` | `"auto"` |
| `sourceRoot` | string або string[] (корені пакетів монорепо) | `"src"` |
| `exclude` | string[] (glob) — файли, яких не торкаються `check`, хук і `conventions` | `[]` |
| `entrypoints` | string[] (glob) | `["src/index.ts", "src/main.ts", "bin/*.ts"]` |
| `singleFileMaxLines` | number | `150` |
| `coverageCommand` | string | автовизначення (3.11) |
| `abbreviationAllowlist` | string[] | `["id", "url", "uri", "api", "http", "https", "json", "html", "css", "sql", "uuid", "io", "ui"]` |
| `simplePackages` | string[] | `["axios", "node-fetch", "got", "superagent", "request"]` |
| `infrastructurePackages` | string[] | `["pg", "mysql2", "mongodb", "mongoose", "ioredis", "redis", "@prisma/client", "typeorm", "knex", "sequelize", "drizzle-orm"]` |
| `tournament.minComplexity` | number | `5` |
| `tournament.minLines` | number | `10` |
| `tournament.weights` | `{readability, length, bytecode, speed, closeness}` | усі `0.2` |
| `libraryDigest` | boolean | `true` |
| `libraryDigestDev` | boolean | `false` (чи включати `devDependencies`) |
| `libraryDigestPerRun` | number | `5` |
| `roles` | `{module, interfaces, consts, helper, util: string[]}` | псевдоніми з 3.2a |
| `testsLocation` | `"colocated" \| "<папка>"` | з 3.2a, інакше `colocated` для `modular` і `tests` для `layered` |
| `testSuffix` | `"test" \| "spec"` | з 3.2a, інакше `test` |
| `constantCase` | `"upper-snake" \| "camel"` | з 3.2a, інакше `upper-snake` |
| `interfacePrefix` | `"" \| "I"` | з 3.2a, інакше `""` |
| `entityPrefix` | boolean | з 3.2a, інакше `true` |
| `rules` | `{"<rule-id>": "off" \| "error" \| "warning" \| {severity?, max?, reason?}}` | `{}` |
| `sources` | `{"<поле>": "<джерело>"}` | пише `conventions` |

Невідомі поля ігноруються; поле хибного типу дає один рядок `warning config <поле>: expected <тип>` і типове значення. Конфіг читається й перевіряється один раз у `main`, далі модулі отримують готовий об'єкт.

`.codemaster.local.json` поруч (той самий формат, поля перекривають `.codemaster.json`) — особисті перемикачі розробника; `install` нічого не робить із `.gitignore`, а скіл при першому створенні локального файлу додає його в `.gitignore` проєкту. *(Моє рішення: щоб один розробник не вимикав функцію всій команді.)*

**Визначення розкладу при `auto`:** якщо в `sourceRoot` (при списку — в усіх коренях разом) є папки щонайменше двох різних ролей з `roles` (наприклад `services` і `types`) — `layered`; інакше якщо хоча б одна папка в `sourceRoot` містить файл чи папку з роллю `interfaces`, `consts` або `helper` (3.3) — `modular`; інакше — `off`. При `off` правила розкладу (`layout-forbidden-declaration`, `helpers-only-functions`, `test-mirror`, `helpers-mixed-kind`, `name-entity-prefix`, `single-file-module-size`) не застосовуються, решта правил працює. *(Моє рішення.)*

### 3.2a. `codemaster conventions [--refresh]` — профіль проєкту

Запускається автоматично на першому прогоні хука, коли `.codemaster.json` немає, і вручну з `--refresh`. Сканує проєкт і записує профіль у `.codemaster.json`. Поле, яке вже є у файлі без запису в `sources` (його заповнив користувач), сканер ніколи не перезаписує. Для кожного записаного поля в `sources` фіксується джерело: шлях конфігу (`eslint.config.js`), `dominant 83% (41/49)` або `default`.

- **`sourceRoot`:** перша наявна з `src`, `app`, `server`, `lib`; інакше — монорепо: список коренів, по одному на кожну папку верхнього рівня з `package.json` (її `src`, `app`, `server` чи `lib`, якщо є, інакше сама папка), джерело `packages: <назви>`; без таких папок — `.`.
- **`roles`:** для кожної ролі — ті псевдоніми, які справді є як папки в `sourceRoot` або в папках сутностей (як папка чи ім'я файлу з 3.3):
  - `module` — `modules`, `services`, `controllers`, `features`, `domains`, `handlers`;
  - `interfaces` — `interfaces`, `types`, `typings`, `contracts`, `dto`;
  - `consts` — `consts`, `constants`, `enums`;
  - `helper` — `helpers`;
  - `util` — `utils`, `util`, `shared`, `common`, `lib`.

  Роль без жодного знайденого псевдоніма отримує повний список. Користувач може додати власні назви (наприклад `"helper": ["support"]`).
- **`testsLocation` і `testSuffix`:** частка тестових файлів поруч із кодом проти тестів у `tests/`, `test/`, `__tests__/`; частка `.test.` проти `.spec.`.
- **`constantCase`, `interfacePrefix`, `entityPrefix`:** серед наявних констант-даних верхнього рівня (визначення з `layout-forbidden-declaration`), інтерфейсів і типів.
- **Поріг домінантності:** ≥ 60 % і щонайменше 5 випадків; інакше — типове значення codemaster.
- **Правила лінтера → `rules`:** якщо є `node_modules/.bin/eslint`, сканер для одного файлу з `sourceRoot` викликає `eslint --print-config <file>` (конфіг проєкту не виконується вручну) і переносить: `max-params` → `rules.max-params.max` (або `off`), `max-depth` → `rules.max-nesting.max`, `prefer-destructuring: off` → `rules.prefer-destructuring: "off"`, `@typescript-eslint/naming-convention` для `variable`/`interface` → `constantCase`/`interfacePrefix`. Без ESLint — з `biome.json` (`complexity.useMaxParams`, `style.useNamingConvention`). Без обох — нічого.
- **Вивід.** Після першого сканування хук додає профіль одним блоком на початок звіту `Stop` (поле → значення → джерело), щоб розробник побачив і за потреби виправив `.codemaster.json`.

Скрипт не розбирає вільний текст `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING*` — їх читає Claude у скілі (3.11).

**Налаштування правил.** `rules.<id>`: `"off"` — правило не запускається; `"error"`/`"warning"` — новий рівень; об'єкт — `severity`, ліміт `max` (для `max-params`, `max-nesting`, `max-call-nesting`, `name-word-count`, `single-file-module-size`) і `reason` (друкується в звіті `check` при `--json` і у скілі).

### 3.3. Роль файлу

Кожен перевірюваний файл отримує одну роль; правила спираються на неї.

**Розпізнавання імені** (обидва розклади). Ім'я файлу без розширення або ім'я папки, необов'язково з префіксом `<entity>.`:

- `interfaces`, `interface`, `types`, `type` → `interfaces`;
- `consts`, `const`, `constants`, `constant` → `consts`;
- `helpers`, `helper` → `helper`;
- `utils`, `util` → `util`;
- решта, зокрема `<entity>.service`, `<entity>.module`, `<entity>.controller` → `module`.

Приклади: `user/user.interfaces.ts` → `interfaces`, `user/types.ts` → `interfaces`, `user/user.service.ts` → `module`. *(Моє рішення.)*

Списки вище — типові; насправді роль визначається за `roles` з профілю (3.2a), тож `types/` чи `constants/` проєкту працюють так само, як `interfaces/` і `consts/`. У повідомленнях `check` папки названо так, як у проєкті.

- **layered:** перший сегмент шляху всередині `sourceRoot` належить до однієї з `roles` → ця роль. Сутність — другий сегмент (папка або ім'я файлу без розширення). Файл прямо в папці ролі `module` або в `sourceRoot` (не в папці сутності) → `single-file-module`. Файл прямо в папці ролі `consts` чи `interfaces` з іменем `global`, `globals`, `shared` або `index` — глобальний, без сутності.
- **modular:** `utils/` → `util`. У папці сутності `<entity>/` роль визначає розпізнавання імені. Сутність — ім'я папки. Файл прямо в `sourceRoot` (не в папці) → `single-file-module`. Папка сутності `global` або `shared` — глобальна: правило `name-entity-prefix` до неї не застосовується.
- Файли тестів (`*.test.*`, `*.spec.*`, усе в папці `testsLocation`, `tests/`, `test/`, `__tests__/`) — роль `test`, правила розкладу до них не застосовуються, крім `test-mirror`.
- Файл, що відповідає glob з `entrypoints`, — роль `entrypoint`.
- При списку `sourceRoot` роль файлу визначається відносно найглибшого кореня, що його містить.
- Файл поза `sourceRoot` і не з `entrypoints` (конфіги, скрипти) — роль `other`: працюють лише правила імен, параметрів, вкладеності й деструктуризації, а також `global-function`.

### 3.4. `codemaster check [paths...] [--json]`

Без `paths` перевіряє змінені файли гілки (3.7) повністю: кожне порушення в зміненому файлі має свій рівень з таблиці, незалежно від того, які рядки змінено. `--all` перевіряє всі файли коду проєкту (ті самі фільтри, що в 3.7) — для скіла `codemaster-audit` (3.12). Вивід — по рядку на порушення:

```
error max-params src/modules/user.ts:42 function createUser has 6 parameters (max 5)
```

Останній рядок — `codemaster: <E> errors, <W> warnings in <N> files`. З `--json` друкує `{"findings":[{"severity","ruleId","file","line","message"}],"summary":{...}}`. Код виходу `1`, коли `E > 0`, інакше `0`.

| rule-id | Що перевіряє | Рівень |
|---|---|---|
| `layout-forbidden-declaration` | У ролях `module`, `helper`, `util` немає `interface`, `type`, `enum` і константи верхнього рівня. Константа — `const`/`let`, ініціалізатор якої є даними: літерал (рядок, число, bigint, boolean, `null`, regex, шаблон без підстановок), масив чи об'єкт-літерал, що рекурсивно складається лише з таких даних, той самий вираз з `as const` або в `Object.freeze(…)`. Об'єкти з методами чи функціями-значеннями, `new …`, виклики функцій і класи — дозволені об'єкти, не константи (у `module`; у `helper`/`util` їх забороняє `helpers-only-functions`). `single-file-module` дозволено все | error |
| `single-file-module-size` | `single-file-module` із власними константами, інтерфейсами чи типами має понад `singleFileMaxLines` непорожніх рядків — час перетворити його на папку | warning |
| `helpers-only-functions` | У ролях `helper`, `util` на верхньому рівні лише `function`-оголошення і `const x = (…) => …` / `function`-вирази; класи й об'єкти — порушення | error |
| `test-mirror` | Для `module`, `single-file-module`, `helper`, `util` є тест `<name>.<testSuffix>.<ext>`: при `testsLocation: "colocated"` — у тій самій папці; при папці — `<testsLocation>/<шлях відносно sourceRoot>/`. Наявність файлу — все, що перевіряє хук; покриття перевіряє скіл (3.11) | error для `module`/`single-file-module`, warning для `helper`/`util` |
| `helpers-mixed-kind` | Файл `helper` змішує категорії: водночас імпортує пакет з `infrastructurePackages` і викликає `fetch(` чи `http(s).request`, або містить і такі виклики, і функції без них. Назви підпапок не перевіряються — `infrastructure`/`external`/`logic` лише рекомендація скіла, коли проєкт не має своїх | warning |
| `name-abbreviation` | Ім'я функції, змінної, параметра, класу, інтерфейсу, типу чи константи містить слово зі списку скорочень у `src/consts/abbreviations.ts` і не з `abbreviationAllowlist`. Слова — розбиття camelCase/PascalCase/SNAKE_CASE. Однолітерні імена — порушення, крім `_` і параметрів типу | error |
| `name-word-count` | Ім'я має понад 3 слова; префікс сутності (`USER_`, `User`) не рахується | warning |
| `name-entity-prefix` | У ролях `consts`, `interfaces` з сутністю `<entity>`: константи в регістрі `constantCase` і (при `entityPrefix: true`) з префіксом сутності: `upper-snake` → `<ENTITY>_…`, `camel` → `<entity>…`; інтерфейси й типи — PascalCase, `<interfacePrefix><Entity>…`; сутність з дефісом чи підкресленням зводиться до регістру (`order-item` → `ORDER_ITEM_`, `orderItem`, `OrderItem`). Глобальні константи — у `constantCase` без префікса. Типово (проєкт мовчить) — UPPER_SNAKE з префіксом | error |
| `max-params` | Функція, метод чи конструктор має понад 5 параметрів | error |
| `max-nesting` | Блоки керування (`if`, `for`, `while`, `switch`, `try`) вкладені глибше 3 рівнів у межах однієї функції, або функція-аргумент виклику вкладена в іншу функцію-аргумент глибше 2 рівнів (callback hell), або `.then(` викликано всередині колбека іншого `.then(` | error |
| `max-call-nesting` | Виклик як аргумент виклику глибше 3 рівнів: `a(b(c(d())))` | warning |
| `global-function` | Функція верхнього рівня у файлі з роллю поза `module`, `single-file-module`, `helper`, `util`, `test`; виняток — функція `main` у ролі `entrypoint`. Також присвоєння властивості `globalThis`, `window`, `global` і `declare global` з функцією | error |
| `prefer-destructuring` | `const $X = $OBJ.$X` або `const $X = $OBJ["$X"]` | warning |
| `simple-package` | `dependencies` чи `devDependencies` будь-якого `package.json` проєкту (усі підпапки, крім `node_modules`, `.git`, вкладених git-репозиторіїв і `exclude`) містить пакет із `simplePackages` | warning |

Список скорочень у `src/consts/abbreviations.ts` (початковий): `cfg conf ctx req res msg btn tmp temp val idx err cb fn str num arr obj elem el evt e args params prev cur curr cnt len mgr svc repo impl init info ref usr pwd addr src dst desc opts env doc docs db`.

### 3.5. `codemaster tournament <dir>`

**Кандидати.** `codemaster tournament --candidates` перелічує змінені функції гілки з когнітивною складністю ≥ `minComplexity` або тілом ≥ `minLines` непорожніх рядків, яких немає в `<git-path codemaster>/tournament-done.json` (ключ — `<file>#<functionName>` плюс SHA-256 тіла). Формат: `<file>:<line> <functionName> complexity=<c> lines=<l>`.

- **Змінена функція** — її діапазон рядків перетинається з hunk'ом `git diff -U0 <merge-base>` або файл новий.
- **Ім'я** — ім'я функції; метод класу — `<Class>.<method>`; анонімна функція, присвоєна змінній, — ім'я змінної; решта анонімних функцій кандидатами не бувають.
- **Не кандидати** *(моє рішення)*: функції в `.tsx`/`.jsx`, методи, що звертаються до `this`, і функції в `helpers/infrastructure` та `helpers/external` (залежать від бази чи мережі, ізольовано не запускаються).
- **Пропуск.** `codemaster tournament --skip <file>#<functionName> --reason "<текст>"` записує функцію в `tournament-done.json` з `skipped: true` і причиною — для функцій, які неможливо ізолювати (замикання на стан модуля, path aliases); скіл називає пропущені у звіті.

**Вхід.** `<dir>` містить:

- `first.ts`, `readable.ts`, `optimized.ts` — кожен експортує функцію з однаковим іменем і сигнатурою (або `.js`);
- `cases.ts` — `export const cases: { input: unknown[]; expected: unknown }[]` і необов'язкове `export const benchmark = false`;
- `target.json` — `{"file": "<шлях у проєкті>", "functionName": "<ім'я>"}`.

**Кроки.**

1. **Коректність.** Для кожного варіанта кожен `case`: `await fn(...input)`, порівняння з `expected` через `node:util.isDeepStrictEqual`. Варіант із хоча б однією невідповідністю чи винятком вибуває з причиною.
2. **Метрики** (менше — краще), для кожного варіанта, що лишився:
   - `readability` — когнітивна складність за правилами SonarSource (через `@ast-grep/napi`);
   - `length` — непорожні рядки тіла функції;
   - `bytecode` — `Bytecode length` з `node --print-bytecode --print-bytecode-filter=<functionName>` після 10 000 викликів на `cases`, плюс 50 за кожен рядок деоптимізації цієї функції з `--trace-deopt`;
   - `speed` — медіана ns/op за 5 прогонів по 10 000 викликів на `cases` (кожен прогін в окремому процесі); не міряється при `benchmark = false`;
   - `closeness` — наскільки джерело відрізняється від того, що виконує V8. Складається з двох підметрик:
     - `bytecodePerToken` — `Bytecode length` (без штрафу за деоптимізації), поділена на кількість токенів джерела функції (листові вузли ast-grep без коментарів);
     - `desugared` — кількість конструкцій, які V8 розгортає в приховані операції: spread і rest (`...`), деструктуризація, optional chaining `?.`, `??`, генератори, `async`/`await`, вкладені функції, що захоплюють змінні зовнішньої функції (замикання), `try`/`catch`/`finally`, шаблонні рядки з підстановками.
3. **Оцінка.** Для кожної метрики `score = (min + 1) / (value + 1)`, де `min` — найменше значення серед варіантів. `bytecodePerToken` порівнюється як є, без `+1`: `score = min / value`. Оцінка `closeness` — середнє оцінок двох її підметрик. Підсумок — сума `score × weight`. Метрика, що не міряється, випадає, а її вага ділиться порівну між рештою. Нічия — перемагає раніший у порядку `readable`, `first`, `optimized`.
4. **Вивід.** Таблиця варіантів із сирими значеннями й підсумком, рядок `winner: <variant>`, файл `<dir>/result.json`. `codemaster tournament --done <dir>` записує ціль у `tournament-done.json` (Claude викликає його після перенесення переможця в код).

Якщо всі три варіанти вибули, вивід `winner: none` і код виходу `1`.

### 3.6. `codemaster libraries [--prune]`

- Читає `dependencies` (і `devDependencies`, коли `libraryDigestDev: true`) з усіх `package.json` проєкту — у корені й підпапках, крім `node_modules`, `.git`, вкладених git-репозиторіїв (worktree, submodule) і шляхів з `exclude`, без `@types/*`. *(Моє рішення: dev-інструменти — eslint, typescript, тест-раннери — мало що кажуть про можливості проєкту, а перший запуск інакше видає десятки `add`.)* У вивід потрапляють не більше `libraryDigestPerRun` рядків `add`/`stale` (за алфавітом), останнім рядком `… and <N> more` — решта на наступних прогонах. Версію бере з `node_modules/<name>/package.json` у теці маніфесту, а далі в кожній батьківській теці до кореня; немає встановленого пакета — рядок `missing <name> (not installed)`.
- Порівнює зі списком файлів `.claude/skills/codemaster-libraries/<name>.md` (scope `@a/b` → `a__b.md`); у frontmatter кожного файлу `name`, `version`.
- Вивід: `add <name> <version> readme=<шлях або -> homepage=<url або ->`, `remove <name>`, `stale <name> <old> -> <new>` (змінилась мажорна версія).
- `--prune` видаляє файли `remove` і перебудовує `.claude/skills/codemaster-libraries/SKILL.md` — індекс: frontmatter скіла (`name: codemaster-libraries`, `description`) і по рядку на бібліотеку з одним реченням з її файлу. Також перебудовує індекс після того, як Claude додав файли (`--index`).
- Шаблон підсумку (пише Claude, до 60 рядків): `## Purpose`, `## Key APIs`, `## Pitfalls`, `## Documentation` (посилання на конкретні сторінки). Джерела: README з `node_modules` і `homepage`.
- `"libraryDigest": false` — підкоманда друкує `libraries: disabled` і нічого не робить; хук її не викликає.

### 3.7. Змінені файли гілки

Основна гілка: `git symbolic-ref refs/remotes/origin/HEAD`, інакше перша наявна з `main`, `master`, `dev`. Змінені файли — `git diff --name-only <merge-base>` (зокрема незакомічені) плюс `git ls-files --others --exclude-standard`, лише наявні файли з розширеннями `.ts .tsx .mts .cts .js .jsx .mjs .cjs`, без `node_modules/`, `dist/`, `build/`, `coverage/` і `*.d.ts`. На основній гілці без merge-base — лише незакомічені й нові файли. Поза git-репозиторієм хук мовчить, а `check` без `paths` друкує `codemaster: not a git repository; pass paths` і виходить з 0.

### 3.8. Хук `Stop` (`hook-stop`)

Вхід — JSON хука Claude Code зі stdin (`cwd`, `stop_hook_active`).

1. `hook: false`, не git-репозиторій або немає ні змінених файлів коду, ні зміни `package.json` відносно merge-base → вихід 0 без виводу. Хеш і стан гілкові: перша зупинка нової сесії на гілці з неперевіреними змінами блокує, навіть якщо відповідь була без правок — це навмисно.
2. Хеш — SHA-256 від відсортованого списку змінених файлів разом із вмістом кожного плюс вмісту `package.json`. Збігається з `<git-path codemaster>/last-checked` → вихід 0.
3. `stop_hook_active` істинний → записати хеш, вихід 0.
4. Немає залежностей ast-grep → `install` (3.10); невдача → stderr `codemaster: <причина>`, вихід 0.
5. Немає `.codemaster.json` → `conventions` (3.2a), профіль іде на початок звіту і сам по собі є причиною блокувати цей раз. Далі запуск `check`, `tournament --candidates`, `libraries` (при `libraryDigest`). Усе чисто → записати хеш, вихід 0.
6. Інакше stdout `{"decision":"block","reason":"<звіт>"}`. Звіт: перший рядок `Run the codemaster skill (codemaster:codemaster) for this branch.`, далі до 30 рядків знахідок `check`, список кандидатів турніру й список `add/remove/stale` бібліотек, кожен блок з підсумковим лічильником.

Будь-яка внутрішня помилка → stderr з одним рядком, вихід 0: хук ніколи не ламає сесію.

### 3.9. Хук `SessionStart` (`hook-session-start`)

Друкує в контекст три рядки: розклад проєкту (`codemaster: layout=<layered|modular>, sourceRoot=<...>`), правило `Before a task, check whether the framework or an installed library already does it; see the codemaster-libraries skill.` (другу половину — лише коли індекс існує) і `Follow the codemaster skill rules while coding.` При `hook: false` нічого не друкує.

### 3.10. `codemaster install`

Ставить `@ast-grep/cli@0.51.3` і `@ast-grep/napi@0.51.3` командою `npm install --prefix ~/.local/share/codemaster --no-save --no-audit --no-fund` (`$XDG_DATA_HOME/codemaster`, коли змінна задана). Версії — константи в `src/consts/install.ts`. Хук викликає його автоматично на першому запуску й друкує `codemaster: installed ast-grep 0.51.3 into <шлях>` у stderr. Без мережі чи npm — рядок із причиною, вихід 0. Повторний запуск при наявних версіях нічого не робить.

### 3.11. Скіл `codemaster`

`skills/codemaster/SKILL.md`, frontmatter `name: codemaster`, `version: 0.1.0`, опис, що спрацьовує при написанні коду і після хука `Stop`.

**Порядок роботи після хука:**

1. Прочитати звіт хука, а також `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING*` проєкту. Правила проєкту стоять вище за правила codemaster (розділ 2). Коли знахідка `check` суперечить правилу проєкту, Claude не виправляє її, а записує в `.codemaster.json` `rules.<id>` (`"off"` або нове значення) з `reason`, що цитує правило проєкту, і називає це у звіті. Вимоги «перейменуй папку під codemaster» не існує: розходження назв закриває `roles`.
2. Виправити всі `error`; `warning` — виправити, коли зміна мала, інакше назвати у звіті.
3. Для кожного кандидата турніру: написати `first`, `readable`, `optimized` і `cases` у `<scratchpad>/tournament/<functionName>/`, запустити `codemaster tournament`, перенести переможця в код, запустити тести проєкту, викликати `--done`.
4. Бібліотеки: для `add` і `stale` написати підсумок за шаблоном, `libraries --prune --index`.
5. **Покриття.** Запустити тести проєкту з покриттям і довести покриття рядків змінених файлів з ролями `module` і `single-file-module` до 100 %, дописуючи тести у файли-дзеркала. Команда — `coverageCommand`, інакше за `package.json`: є `vitest` → `npx vitest run --coverage`; є `jest` → `npx jest --coverage`; інакше `node --test --experimental-test-coverage`. Рядок, який чесно не покрити (захисна гілка на неможливий стан), — назвати у звіті, а не писати порожній тест.
6. Повторний `check`; лишилися `error` — назвати їх користувачу з причиною.
7. Звіт: що виправлено, покриття змінених модулів, переможці турнірів і пропущені функції, які бібліотеки додано чи видалено.

**Правила, що перевіряються лише текстом скіла:** KISS; перед задачею перевірити, чи її вже вміє фреймворк або встановлена бібліотека (скіл `codemaster-libraries`); прості речі (HTTP-запити, CRUD) писати самому, для складних (планувальник за cron, черги, парсери) шукати готовий інструмент; менша вкладеність викликів, без callback hell (async/await, ранній return); деструктуризація там, де вона доречна; повні імена, два слова, де вистачає; на фронтенді компонентний підхід і MVC, якщо в проєкті не задано інше; helpers розділяти на `infrastructure` (база, redis, внутрішні інструменти), `external` (сторонні API), `logic`.

`references/rules.md` — таблиця rule-id з прикладами «погано / добре» для обох розкладів; `references/tournament.md` — формат `<dir>`; `references/libraries.md` — шаблон підсумку.

### 3.12. Скіл `codemaster-audit`

`skills/codemaster-audit/SKILL.md`, frontmatter `name: codemaster-audit`, `version: 0.1.0`. Запускається лише користувачем (`/codemaster:codemaster-audit [path]`), хук його не викликає. Прогін по наявному коду, а не по змінах гілки:

1. `codemaster check --all` (або `check <path>`) і підсумок: кількість порушень по rule-id і по папках сутностей.
2. Робота партіями: одна папка сутності (`modular`) або одна сутність у всіх шарах (`layered`) за партію; партія — виправлення `error` того самого порядку, що в 3.11, тести проєкту зелені, окремий коміт `refactor(<entity>): codemaster audit`.
3. Турнір в аудиті не запускається (функції не змінювались); покриття — лише для модулів партії.
4. Після кожної партії — коротке повідомлення користувачу і пропозиція наступної; аудит зупиняється, коли користувач каже стоп або порушень не лишилось.

### Public interface

| Інтерфейс | Фраза-підстава | Альтернативне прочитання |
|---|---|---|
| Один скіл `codemaster`, який викликає хук | «через хук викликали один скілл» | Кілька скілів на кожну перевірку — відкинуто |
| Хук `Stop` із фільтром змін | «по завершенню задачі» | `PreToolUse` на `git commit` — користувач обрав `Stop` |
| `global-function` — функції верхнього рівня лише в helpers/utils/модулях, `main` у точці входу | «Заборонити глобальні функції (за виключенням тої яка ранить проєкт)» | Лише `globalThis`/`window` — користувач обрав ширше прочитання |
| `name-word-count` — warning понад 3 слова | «якщо можна впоратись двома слова, то треба це використовувати» | Error понад 2 слова — моє рішення: «можна впоратись» не завжди перевіряється механічно |
| Турнір лише для нетривіальних функцій | «У будь-якої функції» | Кожна функція — користувач обрав поріг |
| Ваги 20 % | «обирає ту яка найкраща» | Читабельність першою — користувач обрав рівні ваги |
| Підсумки бібліотек — проєктний скіл у git | «робив коротку сводку/скілл» | Локально чи поза репозиторієм — користувач обрав git |
| `name-entity-prefix` — `USER_` / `User`, UPPER_SNAKE | «наслідують в назві сутность» | Суфікс замість префікса — моє рішення; camelCase — користувач обрав UPPER_SNAKE |
| Профіль проєкту перекриває типові назви й конвенції; явні правила проєкту > домінантні конвенції > типові codemaster | «code-style проєкта важливіше за наш плагін… Дозволяється відхилення від назв» | Фіксовані назви codemaster — відкинуто користувачем |
| Хук перевіряє змінені файли цілком, наявний код — окремий `codemaster-audit` | відповідь користувача: «скілл опрацьовує файли в кінці роботи над задачею, але є окремий скілл який робить прогон по існуючому коду» | Лише змінені рядки — відкинуто |
| `test-mirror` — наявність файлу в хуку, 100 % рядків змінених модулів у скілі | «тести які повністю покривають модуль» | Лише наявність або покриття в хуку — користувач обрав поділ |
| `closeness` = `bytecodePerToken` + `desugared` | «меньша відміність від того, що бачить компілятор вважається перевагою» | Одна з двох підметрик — користувач обрав обидві |
| `max-nesting` + `max-call-nesting` | «меньшою вкладеністю викликів, запобігати callback hell» | Лише глибина блоків (lint `max-depth`) — замало для «вкладеності викликів» |

## 4. Out of scope

- Мови, крім TS/JS. Структура `rules/<language>/` і роль файлу від мови не залежать, але правил і тестів для інших мов немає.
- Автоматичне перенесення переможця турніру в код: це робить Claude.
- dryer, crapper, mutator та інші інструменти ub-mode.
- Перевірка MVC і компонентного підходу на фронтенді скриптом.
- Завантаження сторінок документації скриптом: це робить Claude у скілі.
- Розбір вільного тексту `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING*` скриптом: їх читає Claude у скілі.
- Перейменування наявних папок проєкту під назви codemaster.
- Конфіги лінтерів, крім ESLint (через `--print-config`) і Biome (`biome.json`).
- Транзитивні залежності в дайджесті бібліотек.
- Цикл «запускай, доки зелено»: хук блокує один раз на кожен новий стан змін.
- Draft PR: віддаленого репозиторію немає.

## 5. Trade-offs accepted

- Перший запуск хука потребує мережі й ставить ~30 МБ ast-grep у `~/.local/share/codemaster/` без питання.
- Турнір множить роботу Claude на нетривіальних функціях утричі; поріг це обмежує, не прибирає.
- Метрики турніру — наближення: когнітивна складність і рядки не дорівнюють читабельності, а байткод після 10 000 викликів не дорівнює продуктивності в бойовому навантаженні.
- `name-abbreviation` дасть хибні спрацювання на доменних словах; їх треба додавати в `abbreviationAllowlist`.
- Хук на кожній відповіді рахує хеш змінених файлів: на великій гілці це десятки мілісекунд.
- Node ≥ 22.18 обов'язковий; на старшій версії плагін мовчить.

## 6. Verification

- `node --test tests/` зелений. Він перевіряє:
  - **Кожне правило 3.4:** у `tests/fixtures/modular` і `tests/fixtures/layered` по одному файлу-порушенню і одному чистому файлу; `check --json` дає рівно очікувані `ruleId`, `file`, `line`.
  - **Роль файлу:** таблиця шлях → роль для обох розкладів, зокрема `single-file-module` в обох, `user/user.interfaces.ts` і `user/types.ts` → `interfaces`, глобальні `consts/global.ts` і `global/consts.ts`, `other` для файлу поза `sourceRoot`.
  - **Константа чи об'єкт:** у `module` `const USER_LIMIT = 5` і `const USER_ROLES = ["a"] as const` → `layout-forbidden-declaration`; `const userService = { create() {} }`, `const router = Router()`, `const cache = new Map()` → без порушення.
  - **Розклад `auto`:** фікстура з `modules/` і `consts/` → `layered`; фікстура з папками сутностей → `modular`; фікстура з `components/` і `pages/` без ролей → `off`, правила розкладу мовчать, `max-params` працює.
  - **Турнір:** фікстура з трьома варіантами, з яких `optimized` повертає хибний результат → він вибуває, `result.json` має переможця і обидві підметрики `closeness`; при `benchmark = false` вага `speed` розподілена; три хибні → `winner: none`, код 1; `--skip` записує `skipped: true`; функція з `this` і функція в `.tsx` не потрапляють у `--candidates`.
  - **Бібліотеки:** фальшивий `node_modules` з двома пакетами і один зайвий файл підсумку → `add` ×1, `remove` ×1, `stale` ×1; `--prune` видаляє зайвий файл і перебудовує індекс; `@types/*` і `devDependencies` пропущено (з `libraryDigestDev: true` — включено); 7 нових пакетів → 5 рядків `add` і `… and 2 more`; `libraryDigest: false` → `libraries: disabled`.
  - **Хук `Stop`:** тимчасовий git-репозиторій зі зміненим файлом-порушенням → `decision: block` з першим рядком `Run the codemaster skill`; той самий стан удруге → без виводу; зміна лише `package.json` → хук запускається; `stop_hook_active: true` → без виводу і записаний хеш; `hook: false` → без виводу; `hook: false` лише в `.codemaster.local.json` → без виводу; поза git → без виводу; завжди код 0.
  - **`check --all`:** на фікстурі бачить порушення у файлах, яких немає в diff.
  - **Профіль проєкту:** фікстура з `src/services/`, `src/types/`, `src/constants/`, тестами `*.spec.ts` у `__tests__/` і 6 camelCase-константами з 8 → `conventions` записує `roles.module: ["services"]`, `roles.interfaces: ["types"]`, `roles.consts: ["constants"]`, `testsLocation: "__tests__"`, `testSuffix: "spec"`, `constantCase: "camel"` з `sources` `dominant …`; розклад `layered`; `interface` у `src/services/user.ts` → `layout-forbidden-declaration`, а повідомлення називає папку `types`. 3 camelCase з 5 (нижче порогу 60 %) → `constantCase: "upper-snake"`, `sources` `default`. Поле, записане користувачем без `sources`, після `--refresh` не змінилось.
  - **ESLint проєкту:** фікстура з фальшивим `node_modules/.bin/eslint`, що друкує конфіг з `max-params: ["error", 3]` і `prefer-destructuring: "off"` → `rules.max-params.max = 3`, функція з 4 параметрами дає `max-params`, `prefer-destructuring` мовчить.
  - **Налаштування правил:** `rules: {"max-params": "off"}` → правило мовчить; `{"name-word-count": {"max": 4}}` → ім'я з 4 слів без порушення.
  - **Хук `SessionStart`:** друкує `codemaster: layout=`.
- `node bin/codemaster.ts check src bin` на самому плагіні: `codemaster: 0 errors`.
- Вручну: `claude --plugin-dir .` у тестовому TS-проєкті з функцією на 6 параметрів; після відповіді, що змінила файл, хук блокує зупинку, Claude запускає скіл і виправляє сигнатуру на об'єкт, наступна зупинка проходить.
- `.claude-plugin/plugin.json`, `skills/codemaster/SKILL.md` і `skills/codemaster-audit/SKILL.md` мають `version` `0.1.0`.
- Останнім: `git status` чистий, у дереві немає `node_modules/`, а `.pasadena/` закомічено лише на гілці задачі.
