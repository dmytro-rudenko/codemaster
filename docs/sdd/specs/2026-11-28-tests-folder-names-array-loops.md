# Тести в окремій папці, імена без суфіксів, цикли замість довгих масивів, нові ліміти — design

**Date:** 2026-11-28
**Status:** agreed
**Розширює:** `docs/sdd/specs/2026-11-27-codemaster.md` (розділи 3.2, 3.2a, 3.3, 3.4)

## 1. Problem

Три правила користувача не виконуються або виконуються навпаки:

1. **Тести.** `test-mirror` (3.4) допускає `testsLocation: "colocated"` — тест лежить поруч з кодом, і для розкладу `modular` це типове значення. Ніщо не помічає проєкт, де одночасно є `tests/` на весь проєкт і `__tests__/` у модулях. Скан профілю (3.2a) рахує `colocated` як звичайний варіант.
2. **Імена файлів.** Розпізнавання ролі (3.3) прямо описує `user/user.interfaces.ts` і `user/user.consts.ts`; фікстура `tests/fixtures/modular` так і написана. Для `.css` правил немає, тож `button.styles.css` проходить.
3. **Довгі масиви.** Жодне правило не помічає масив із чотирьох і більше однакових за формою елементів (`<li>…</li>` ×5, `{ id: 1, … }` ×6), і скіл не вчить будувати їх циклом.
4. **Тести без функцій.** `test-mirror` вимагає тест для кожного файлу з роллю `module`, `single-file-module`, `helper`, `util`, навіть коли у файлі немає жодної функції (лише типи, класи-DTO чи реекспорти). Скіл (крок «Coverage») теж не каже, що для `interfaces`/`consts` тести не пишуться.
5. **Ліміти.** `max-nesting` типово 3 рівні, `name-word-count` типово 3 слова — користувачу замало.

## 2. Constraint that shapes the solution

Директива користувача перекриває принцип «стиль проєкту важливіший» (spec 1, розділ 2) для цих трьох правил: вони стають типовими, а не вгадуються з коду. Проєкт, якому вони не підходять, вимикає правило в `rules.<id>: "off"` — цей механізм уже є.

Обмеження мов:

- **Go** вимагає `_test.go` у тому самому каталозі, що й код. Go звільнено від `test-placement` і `test-mirror` лишається в колишньому вигляді (`mirror.awk` вже так працює).
- **Rust**: модульні тести лежать у самому файлі (`#[cfg(test)]`); `test-placement` не чіпає файлів без тестових імен, а інтеграційні тести у `tests/` вже відповідають правилу.
- **JVM** (`src/test/…`) уже є окремим деревом тестів і вважається варіантом «одна окрема тека».
- **CSS Modules** вимагає суфікса `.module.css` від бандлера. Правило `file-name-suffix` це порушить; проєкт вимикає його через `rules`. Прийнятий компроміс (розділ 5).

## 3. Solution

### 3.1. Тести: одна окрема тека

- `testsLocation` — завжди назва теки. Типове значення `"tests"` для обох розкладів. Значення `"colocated"` більше не існує: у конфігу воно дає один рядок `warning config testsLocation: "colocated" is not supported, using "tests"` і працює як `"tests"`.
- `test-mirror` шукає `<testsLocation>/<шлях відносно sourceRoot>/<name>.<testSuffix>.<ext>` і для `modular`, і для `layered`. Решта (імена за мовами, `src/test/` для JVM, `go` поруч) без змін.
- **Новий `test-placement`** (error). Порушення:
  1. тестовий файл (`is_test_name`, 3.3) лежить поза текою `testsLocation` та поза `src/test/`: «test file <path> belongs in <testsLocation>/<mirror>»;
  2. поза коренем проєкту є тека з назвою тестової (`tests`, `test`, `__tests__`, `spec`), яка не дорівнює `testsLocation`: «second test folder <path>; keep all tests in <testsLocation>/».
  Звільнено: Go (`*_test.go`), `tests/fixtures/**` через `exclude` проєкту (як тепер), файли поза `sourceRoot` і `entrypoints`.
- **`conventions`** (3.2a): `testsLocation` береться з домінантної теки серед `tests`, `test`, `__tests__`, `spec` у корені (поріг 60 % / 5 випадків); без домінанти — `tests`. Поруч розташовані тести більше не рахуються варіантом.

### 3.2. Імена без суфіксів

- **Новий `file-name-suffix`** (warning). Файл з роллю `consts` чи `interfaces` (за `roles` з профілю) і ім'ям `<x>.<слово ролі>.<ext>` — порушення: `user/user.consts.ts` → «rename to user/consts.ts». Те саме для layered: `consts/user.consts.ts` → `consts/user.ts`.
- Для стилів (`.css`, `.scss`, `.sass`, `.less`, моє рішення: одна родина) порушення — ім'я з крапкою перед розширенням, де середня частина `styles`, `style`, `module`, `component` чи `css`: `button.styles.css` → `button.css`, `button.module.css` → `button.css`.
- Розпізнавання ролі за суфіксним іменем (3.3) **лишається**: `user.consts.ts` і далі має роль `consts`, інакше його константи стали б порушенням `layout-forbidden-declaration`, а не підказкою про ім'я.
- Тека сутності в `modular`: ім'я файлу `consts.ts` / `interfaces.ts` (або псевдонім із `roles`) і є роль; сутність — ім'я теки (вже так у 3.3).
- Стильові файли додаються до списку файлів лише для цього правила; AST-аналіз (`analyze.awk`) їх не бачить.

### 3.3. Масиви: цикл замість хардкоду

- **Новий `array-repeated-elements`** (warning), TypeScript, TSX, JavaScript і Python (моє рішення: решта мов мовчить, поки немає потреби). Умови:
  1. літерал масиву чи списку містить понад `max` (типово `3`, тобто 4+) **складених** елементів однакової форми поспіль. Форма елемента — послідовність видів вузлів його піддерева, де значення рядкових, числових і булевих літералів замінено заповнювачем, а імена властивостей, виклики й теги JSX зберігаються; прості літерали без дітей (`['a','b','c','d']`) формою не вважаються;
  2. або понад `max + 1` (5+) числових літералів утворюють арифметичну прогресію (`[1,2,3,4,5]`, `[0,10,20,30,40]`).
- Не перевіряються файли з роллю `consts`, `interfaces` і `test` (таблиці даних живуть у `consts`, тестові таблиці випадків допустимі — моє рішення).
- `rules.array-repeated-elements.max` змінює поріг; `"off"` вимикає.
- Повідомлення: `array has <N> elements of the same shape; build it with a for loop`.
- **Скіл** (`skills/codemaster/SKILL.md`, «Rules while coding», і `references/rules.md`): повторювані елементи будувати циклом `for`/`for…of` (чи еквівалентною ітерацією мови — `map` над масивом даних у JSX; моє рішення), а не довгим літералом; це стосується й створення компонентів: список пунктів, рядків, іконок — цикл над даними.

### 3.4. Тести лише для функцій

- `test-mirror` вимагає тест лише для файлу, у якому є хоча б одна функція: оголошення функції, метод класу, `const x = (…) => …` / функціональний вираз (ті самі визначення, що в `helpers-only-functions` і `max-params`). Файл без функцій тесту не потребує.
- Ролі `consts` та `interfaces` тестів не потребують ніколи (вже так), і це записано явно в `references/rules.md`.
- Скіл: тести пишуться лише для функцій. Для констант, інтерфейсів і типів тести не пишуться; покриття 100 % рахується по рядках функцій.

### 3.5. Нові типові ліміти

- `max-nesting`: типово **4** рівні блоків (було 3). Межа для колбеків (2) і `.then` у `.then` без змін.
- `name-word-count`: типово **4** слова (було 3). Префікс сутності, як і раніше, не рахується.
- Значення з `rules.<id>.max` проєкту й імпорт з ESLint/Biome (3.2a) і далі мають пріоритет.
- Оновити `README.md` і `skills/codemaster/references/rules.md` (приклади: `getActiveUserOrderTotalPrice` — 5 слів, і далі порушення).

### 3.6. Ланцюги `if` над літералами: таблиця замість розгалужень

- **Новий `lookup-chain`** (warning), TypeScript, TSX, JavaScript і Python (решта мов мовчить, як у 3.3). Порушення: понад `max` (типово `3`, тобто 4+) поспіль `if`-гілок — сусідніх `if` або ланцюга `else if` / `elif` — де умова порівнює одне й те саме ім'я з літералами (`==` / `===`, кілька літералів через `||` / `or`), а тіло гілки — лише `return <літерал>`. Ланцюг `else if` рахується так само, як сусідні `if`.
- Не перевіряються файли з роллю `consts`, `interfaces` і `test`.
- `rules.lookup-chain.max` змінює поріг; `"off"` вимикає.
- Повідомлення: `<N> if branches compare <name> with literals; use a lookup table`.
- **Скіл** (`skills/codemaster/SKILL.md`, «Rules while coding», і `references/rules.md`): ланцюг `if (x == літерал) return літерал` замінювати таблицею (об'єкт, map, масив).

### 3.7. Власний awk codemaster: таблиці замість ланцюгів `if`

- `lib/awk/lang.awk` (`language_of`, `language_extensions`) і `lib/awk/mirror.awk` (`default_test_name`, `test_names`) беруть значення з таблиць, які заповнюються один раз у циклі, а не з ланцюгів `if (x == літерал) return літерал`. Сигнатури й повернені значення функцій не змінюються.
- Awk codemaster не перевіряє (мови awk немає серед підтримуваних), тому цю вимогу охороняє тест `test_codemaster_awk_uses_lookup_tables`.

### Public interface

| Що | Значення | Фраза користувача |
|---|---|---|
| `testsLocation` | назва теки, типово `"tests"` | «тести в окремій папці», «лише один варіант теки» |
| rule `test-placement` | error | «тести не можуть лежати на тому ж рівні, що і звичайні файли» |
| rule `file-name-suffix` | warning | «у .css файлів/consts/interfaces не повинно бути суфіксів» |
| rule `array-repeated-elements` | warning, `max` типово 3 | «цикл for замість хардкода довгого массива» |
| `test-mirror` | лише файли з функціями | «тести для interfaces/consts не пишуться. Тільки для функцій» |
| `max-nesting` | типовий `max` 4 | «вкладеністю за замовчуванням до 4» |
| `name-word-count` | типовий `max` 4 | «називати змінні та інші чотирма словами за замовчуванням» |
| rule `lookup-chain` | warning, `max` типово 3 | «Оце можна було написать через массив» |
| awk codemaster (`lang.awk`, `mirror.awk`) | таблиці пошуку замість ланцюгів `if` | «Оце можна було написать через массив» |

Альтернативні прочитання, які спек відкидає: «вкладеність до 4» як межа колбеків (відкинуто: йдеться про `max-nesting` блоків; колбеки лишаються 2); «тека на кожен модуль» як типова (відкинуто обраним варіантом: одна `tests/` у корені); «без суфікса» як `consts/user.ts` у modular (відкинуто: ім'я `consts.ts` у теці сутності).

## 4. Out of scope

- Автоматичне перенесення тестів чи перейменування файлів (`check` лише повідомляє).
- Правило `array-repeated-elements` для Go, Rust, Java, Kotlin, C#, PHP, Ruby, C, C++.
- Виявлення повторів між кількома масивами чи в об'єктах, не в масивах.
- Зміна `testSuffix` (`test`/`spec`) і `constantCase`.

## 5. Trade-offs accepted

- Проєкт з `*.module.css` (CSS Modules) отримує warning, поки не вимкне `file-name-suffix`.
- Проєкт із тестами поруч з кодом отримує error `test-placement` на кожен такий файл: свідомий вибір користувача.
- Евристика форми може пропустити масив, де елементи майже однакові, і хибно спрацювати на справжню таблицю даних поза `consts`; поріг `max` і `"off"` це гасять.

## 6. Verification

`bash tests/run.sh` зелений, а тести охоплюють:

- `tests/fixtures/modular`: тести переїхали в `tests/` кореня фікстури; `*.consts.ts` / `*.interfaces.ts` перейменовано в `consts.ts` / `interfaces.ts`; `check --json` на чистій фікстурі не дає `test-placement` і `file-name-suffix`.
- Фікстури-порушення: тест поруч з кодом → `test-placement` у `file:line 1`; друга тека `src/user/__tests__/` → `test-placement`; `user.consts.ts`, `button.styles.css`, `button.module.css` → `file-name-suffix`; Go `billing_test.go` поруч → без `test-placement`.
- `array-repeated-elements`: масив з 4 однакових JSX-елементів, масив з 4 об'єктів однакової форми, `[1,2,3,4,5]` → по одному warning; масив із 4 рядків-літералів, масив у `consts/`, масив у тесті, 3 однакових елементи → тиша; `rules.array-repeated-elements: "off"` → тиша.
- `conventions` на фікстурі з поруч розташованими тестами: `testsLocation` — `tests`, джерело `default`; `testsLocation: "colocated"` у конфігу → рядок `warning config` і поведінка `tests`.
- `test-mirror`: `module` лише з `interface` і класом без методів → без знахідки; `module` з однією функцією без тесту → error; файли `consts`/`interfaces` → без знахідки.
- `lookup-chain`: ланцюг `else if` з 4 гілок `return <літерал>` над одним іменем і 4 сусідні `if` → по одному warning; 3 гілки, 4 гілки над двома різними іменами, 4 гілки з викликом у тілі, файл у ролі `consts`, `rules.lookup-chain: "off"` → тиша.
- Awk codemaster: `test_codemaster_awk_uses_lookup_tables` зелений; `languages`, `check`, `roles`, `portability` дають ті самі знахідки, що й до рефакторингу.
- `max-nesting`: функція з 4 рівнями блоків → тиша, з 5 → error; `name-word-count`: ім'я з 4 слів → тиша, з 5 → warning; `rules.max-nesting.max: 3` повертає стару межу.
- Власний репозиторій: `bash bin/codemaster check --all` не додає нових error.
