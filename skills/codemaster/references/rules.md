# codemaster rules

Run `bash "${CLAUDE_PLUGIN_ROOT}/bin/codemaster" check [paths...] [--json]`. Without paths it checks the files changed on the branch (committed, uncommitted and new), whole files at a time; `--all` checks every code file. Each finding is one line:

```
error max-params src/modules/user.ts:42 function createUser has 6 parameters (max 5)
```

The last line is `codemaster: <E> errors, <W> warnings in <N> files`. The exit code is 1 when there is at least one error.

The rules read TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, C#, PHP, Ruby, C and C++; the section "Languages" below says how each rule reads each language. Examples use TypeScript and the `layered` layout (`src/modules`, `src/consts`, `src/interfaces`, `src/helpers`, `src/utils`). In a `modular` project the same files live in the entity folder: `user/user.service.ts`, `user/consts.ts`, `user/interfaces.ts`. Folder names follow the project's `roles`.

## Rules

| rule-id | Severity | Bad | Good |
|---|---|---|---|
| `layout-forbidden-declaration` | error | `src/modules/user.service.ts` declares `export interface User { name: string }` or `export const USER_LIMIT = 10;` | `src/interfaces/user.ts` holds the interface, `src/consts/user.ts` holds the constant |
| `single-file-module-size` | warning | `src/modules/slug.ts` keeps its own constants and types and has grown past 150 non-empty lines | an entity folder: code in `src/modules/slug/slug.ts`, declarations in `src/consts/slug.ts` and `src/interfaces/slug.ts` |
| `helpers-only-functions` | error | `src/helpers/logic/format.ts` exports `class Formatter {}` or `export const format = { price() {} }` | `export function formatPrice(value: number): string { return value.toFixed(2); }` |
| `test-mirror` | error for `module` and `single-file-module`, warning for `helper` and `util` | `src/modules/user.ts` has a function and `tests/modules/user.test.ts` does not exist | `tests/modules/user.test.ts`: the tests folder (`testsLocation`) mirrors the source tree |
| `test-placement` | error | `src/modules/user.test.ts` next to the code, or a second test folder `src/user/__tests__/` | every test under the one tests folder: `tests/modules/user.test.ts` |
| `helpers-mixed-kind` | warning | one helper file imports `pg` and also calls `fetch(` | `src/helpers/infrastructure/user-db.ts` for the database, `src/helpers/external/user-api.ts` for the API |
| `name-abbreviation` | error | `const cfg = load(); function send(msg: string)` | `const config = load(); function send(message: string)` |
| `name-word-count` | warning | `getActiveUserOrderTotalPrice` (5 words; the limit is 4) | `getOrderTotal`; the entity prefix (`USER_`, `User`) is not counted |
| `name-entity-prefix` | error | `src/consts/user.ts`: `export const MAX_LIMIT = 10;`<br>`src/interfaces/user.ts`: `export interface Profile {}` | `export const USER_MAX_LIMIT = 10;`<br>`export interface UserProfile {}` |
| `file-name-suffix` | warning | `src/user/user.consts.ts`, `src/user/user.interfaces.ts`, `src/button/button.styles.css`, `src/button/button.module.css` | `src/user/consts.ts`, `src/user/interfaces.ts`, `src/button/button.css` |
| `max-params` | error | `function createUser(name, email, age, role, team, locale) {}` (6 parameters) | `function createUser({ name, email, age, role, team, locale }: UserCreateInput) {}` |
| `max-nesting` | error | `if (a) { for (x of xs) { while (y) { if (z) { switch (w) {} } } } }` (5 levels), a callback inside a callback inside a callback, or `.then(` inside a `.then(` callback | early `return` / `continue`, a helper function per level, `async`/`await` |
| `max-call-nesting` | warning | `a(b(c(d())))` | `const inner = c(d()); a(b(inner));` |
| `global-function` | error | `src/consts/user.ts` declares `export function buildKey() {}`, or `globalThis.format = () => {}` | `export function buildKey() {}` in `src/helpers/logic/user.ts`; in an entrypoint only `main` is allowed |
| `prefer-destructuring` | warning | `const name = user.name;` | `const { name } = user;` |
| `array-repeated-elements` | warning | `const items = [<li>Home</li>, <li>Docs</li>, <li>Blog</li>, <li>About</li>];` or `[1, 2, 3, 4, 5]` | `labels.map((label) => <li key={label}>{label}</li>)`, or a `for (const label of labels)` loop that builds the list |
| `lookup-chain` | warning | `if (kind === "a") return 1; if (kind === "b") return 2; if (kind === "c") return 3; if (kind === "d") return 4;` | `return KIND_CODES[kind];` with `KIND_CODES = { a: 1, b: 2, c: 3, d: 4 }` in the entity's consts file |
| `simple-package` | warning | `"dependencies": { "axios": "^1.7.0" }` | the built-in `fetch` |

### Details

- `layout-forbidden-declaration`: roles `module`, `helper`, `util` hold no `interface`, `type`, `enum` and no top-level constant. A constant is a `const` or `let` whose initializer is data: a literal (string, number, bigint, boolean, `null`, regex, template without substitutions), an array or object literal made only of such data, the same with `as const`, or inside `Object.freeze(...)`. Objects with methods, `new ...`, function calls and classes are not constants. A `single-file-module` may hold anything.
- `single-file-module-size`: the limit is `singleFileMaxLines` (default 150) non-empty lines, and it applies only to a `single-file-module` with its own constants, interfaces or types.
- `helpers-only-functions`: in roles `helper` and `util` the top level has only `function` declarations and `const x = (...) => ...` or `function` expressions.
- `test-mirror`: the hook checks only that the test file exists, and only for a file with at least one named function or method (a function declaration, a class method, `const x = (...) => ...` or a function expression, the same definitions as `helpers-only-functions` and `max-params`). A file with no function (only types, DTO classes or re-exports) needs no test, and files with the role `consts` or `interfaces` never do. The test is expected at `<testsLocation>/<path relative to the source root>/<name>.<testSuffix>.<ext>`, for example `tests/modules/user.test.ts`; the name follows the language (see the table in the README): `user.test.ts`, `test_user.py`, `user_test.go`, `UserTest.java`, `UserTests.cs`, `user_spec.rb`, `user_test.c`. Coverage is checked by the skill (100% of the lines of functions in changed `module` and `single-file-module` files).
- `test-placement`: all tests live in the one tests folder, `testsLocation` (default `tests`), at `<testsLocation>/<path relative to the source root>`. Two findings, both errors: a test file outside that folder (`test file <path> belongs in <location>/<path relative to source root>`), and a second test folder, any folder named `tests`, `test`, `__tests__` or `spec` at any depth other than `testsLocation` (`second test folder <folder>; keep all tests in <location>/`). Exempt: Go `*_test.go`, which Go requires next to the code; JVM `src/test/`; and files outside the source roots, except a test folder at the project root (a root `test/` or `spec/` next to a `lib/` source root is still a second test folder; `e2e/tests/` is exempt). Fixtures are skipped through `exclude`.
- `helpers-mixed-kind`: the file imports a package from `infrastructurePackages` and makes a network call, or has both functions with network calls and functions without them. Network calls are `fetch(` and `http(s).request` (TypeScript, JavaScript), `requests.`, `httpx.`, `aiohttp.`, `urlopen(` (Python), `http.Get`/`Post`/`NewRequest` (Go), `reqwest::`, `ureq::` (Rust), `HttpClient`, `RestTemplate`, `WebClient`, `OkHttpClient` (Java, Kotlin, C#), `curl_exec(`, Guzzle, `Http::` (PHP), `Net::HTTP`, Faraday, HTTParty (Ruby), `curl_easy_perform` (C, C++). Subfolder names are not checked.
- `name-abbreviation`: applies to functions, variables, parameters, classes, interfaces, types and constants. Words come from splitting camelCase, PascalCase, snake_case and SNAKE_CASE. One-letter names are violations, except `_` and type parameters. Words in `abbreviationAllowlist` are allowed. The built-in list: `cfg conf ctx req res msg btn tmp temp val idx err cb fn str num arr obj elem el evt e args params prev cur curr cnt len mgr svc repo impl init info ref usr pwd addr src dst desc opts env doc docs db`.
- `file-name-suffix`: a `consts` or `interfaces` file is named by its role only, `<x>.<role word>.<ext>` is renamed (`rename to src/user/consts.ts` for `src/user/user.consts.ts`; in a layered project `src/consts/user.consts.ts` becomes `src/consts/user.ts`). A stylesheet (`.css`, `.scss`, `.sass`, `.less`, outside `node_modules/`, `dist/` and the other skipped folders) with `.styles`, `.style`, `.module`, `.component` or `.css` before the extension is renamed too (`rename to src/button/button.css` for `src/button/button.styles.css`). The role is still read from the suffixed name, so the finding is the name, not `layout-forbidden-declaration`. CSS Modules needs `.module.css` from the bundler: set `rules.file-name-suffix` to `"off"` there.
- `name-entity-prefix`: applies in roles `consts` and `interfaces` that belong to an entity. Constants follow `constantCase` (`upper-snake`: `<ENTITY>_...`, `camel`: `<entity>...`) and, with `entityPrefix: true`, start with the entity. Interfaces and types are PascalCase: `<interfacePrefix><Entity>...`. An entity with a hyphen or underscore is folded: `order-item` gives `ORDER_ITEM_`, `orderItem`, `OrderItem`. Global files (`global`, `globals`, `shared`, `index` in a `consts` or `interfaces` folder, or a `global` or `shared` entity folder) take `constantCase` without a prefix.
- `max-params`: functions, methods, constructors and lambdas; the limit is 5. `this`, `self`, Go receivers and C's `(void)` are not counted; each name of a Go parameter group (`a, b int`) is.
- `max-nesting`: control blocks (`if`, `for`, `while`, `switch`/`match`/`when`/`case`, `try`, `loop`) deeper than 4 levels inside one function, where `else if`/`elif`/`elsif` is not a new level; a function argument (a lambda, closure, Ruby block, Kotlin trailing lambda) nested in another function argument deeper than 2 levels; `.then(` inside the callback of another `.then(` (TypeScript, JavaScript).
- `max-call-nesting`: a call used as an argument of a call, deeper than 3 levels.
- `global-function`: a top-level function in a file whose role is not `module`, `single-file-module`, `helper`, `util` or `test`; the exception is `main` in an `entrypoint`. Assignments to `globalThis`, `window`, `global` and `declare global` with a function are also errors.
- `array-repeated-elements` (TypeScript, TSX, JavaScript, Python): an array or list literal with more than `max` (default 3, so 4 or more) compound elements of the same shape in a row. The shape of an element is the sequence of node kinds in its subtree, with string, number and boolean values replaced by a placeholder and with property names, calls and JSX tags kept; plain literals without children (`['a', 'b', 'c', 'd']`) have no shape. More than `max + 1` (5 or more) numeric literals in an arithmetic progression (`[1, 2, 3, 4, 5]`, `[0, 10, 20, 30, 40]`) are flagged too. Message: `array has <N> elements of the same shape; build it with a for loop`. Files with the role `consts`, `interfaces` or `test` are not checked: keep data tables in `consts`. Build the elements with a `for` / `for...of` loop, or with `map` over a data array in JSX.
- `lookup-chain` (TypeScript, TSX, JavaScript, Python): more than `max` (default 3, so 4 or more) consecutive `if` branches, siblings or an `else if` / `elif` chain, where each condition compares one name with literals (`==` / `===`, joined by `||` / `or`) and each body is only `return <literal>`. Message at the first `if`: `<N> if branches compare <name> with literals; use a lookup table`. Files with the role `consts`, `interfaces` or `test` are not checked. Replace the chain with a lookup table (object, map or array), kept in the entity's consts file.
- `prefer-destructuring`: `const $X = $OBJ.$X` and `const $X = $OBJ["$X"]` (TypeScript, JavaScript). The rule is an ast-grep YAML rule in `rules/typescript/`; YAML rules dropped into `rules/<language>/` run for that language too.
- `simple-package`: `dependencies` or `devDependencies` of any `package.json` in the project lists a package from `simplePackages` (npm only). Manifests are found the same way as for the library digest: every subfolder except `node_modules`, `.git`, nested git repositories and `exclude`.

### Languages

Every language goes through the same rules; what counts as a constant, a type or a callback follows the language.

| Language | Constants | Interfaces and types | Notes |
|---|---|---|---|
| TypeScript, JavaScript | top-level `const`/`let` with data | `interface`, `type`, `enum` | `prefer-destructuring` and `.then(` inside `.then(` apply only here |
| Python | module-level assignments with data (not `__dunder__`) | classes on `Protocol`/`ABC` (interface), `TypedDict`/`NamedTuple`/`BaseModel` or `@dataclass` (type), `Enum` (enum), `type X = ...` | `self`/`cls` and `__dunder__` names are skipped; `args`, `kwargs` are allowed |
| Go | `const`, and `var` with data | `type X interface` (interface), other `type` declarations (type) | constants and types are PascalCase or camelCase (exported or not), whatever `constantCase` says; receivers are not parameters; `err`, `ctx` are allowed; tests are always next to the file |
| Rust | `const`, `static` with data | `struct`, `union`, `type`, `trait`, `enum` | `self` is not a parameter; a `#[cfg(test)]` module satisfies `test-mirror` |
| Java | `static final` data fields | `interface`, `record`, `enum`, annotation types | code lives in classes, so `helpers-only-functions` and `global-function` do not apply; `args` is allowed |
| Kotlin | `const val`, top-level `val` with data | `interface`, `data class`, `enum class`, `typealias` | `args` is allowed |
| C# | `const` and `static readonly` data fields | `interface`, `struct`, `record`, `enum`, `delegate` | constants are PascalCase; like Java, no `helpers-only-functions` and `global-function`; `args` is allowed |
| PHP | `const`, `define()`, class constants | `interface`, `enum` | `__construct` and other magic names are skipped |
| Ruby | constant assignments with data | — | blocks (`do ... end`, `{ ... }`) count as callbacks; a `module` is a namespace |
| C, C++ | `#define` with a value, `const`/`constexpr` data | `struct`, `union`, `typedef`, `enum`, `using` | `argc`, `argv` are allowed |

Data is a literal (string without interpolation, number, boolean, null, regex) or an array, tuple, list, map or initializer list made only of data. A file that does not parse (an `ERROR` or a missing token in the tree) gets one `parse` warning and no other finding.

Rules that depend on layout (`layout-forbidden-declaration`, `helpers-only-functions`, `test-mirror`, `helpers-mixed-kind`, `name-entity-prefix`, `single-file-module-size`) do not apply when the layout is `off`.

### File roles

The role of a file comes from its name without the extension, or from its folder name, optionally prefixed with `<entity>.`:

- `interfaces`, `interface`, `types`, `type` give role `interfaces`;
- `consts`, `const`, `constants`, `constant` give role `consts`;
- `helpers`, `helper` give role `helper`;
- `utils`, `util` give role `util`;
- anything else (`<entity>.service`, `<entity>.module`, `<entity>.controller`) gives role `module`.

A `consts` or `interfaces` file written with the entity prefix (`user.consts.ts`) keeps its role, and `file-name-suffix` asks for the plain name (`consts.ts`).

Test files (`*.test.*`, `*.spec.*`, `test_*.py`, `*_test.<ext>`, `*_spec.rb`, `*Test.java`, `*Tests.cs` and the like, and anything under a test folder (`tests/`, `test/`, `__tests__/`, `spec/`) at any depth or under `src/test/`, whatever its name) have role `test` and only `test-mirror` and `test-placement` concern them. A file matching `entrypoints` has role `entrypoint`. With a list of source roots, a file is resolved against the deepest root that holds it. A file outside `sourceRoot` that is not an entrypoint has role `other`: only the naming, parameter, nesting, destructuring and `global-function` rules apply.

## Turning a rule off or changing it

`rules.<id>` in `.codemaster.json`:

```json
{
  "rules": {
    "prefer-destructuring": "off",
    "max-params": { "max": 8, "reason": "CLAUDE.md: up to 8 parameters are allowed in handlers" },
    "name-word-count": { "severity": "error", "max": 5 }
  }
}
```

A value is `"off"` (the rule does not run), `"error"` or `"warning"` (a new severity), or an object with `severity`, `max` (for `max-params`, `max-nesting`, `max-call-nesting`, `name-word-count`, `single-file-module-size`, `array-repeated-elements`, `lookup-chain`) and `reason` (printed with `check --json` and quoted in the skill report).

## `.codemaster.json`

The file is optional and lives in the project root. Unknown fields are ignored. A field of the wrong type produces one line `warning config <field>: expected <type>` and the default is used. `.codemaster.local.json` next to it has the same format and its fields override `.codemaster.json`; it holds personal switches and goes into the project's `.gitignore`.

| Field | Type | Default |
|---|---|---|
| `hook` | boolean | `true` |
| `layout` | `"auto"`, `"modular"`, `"layered"` or `"off"` | `"auto"` |
| `sourceRoot` | string, or string[] with one root per package of a monorepo | `"src"` |
| `exclude` | string[] (glob) of files `check`, the hook and `conventions` skip | `[]` |
| `languages` | string[] of `typescript` (also `.tsx`), `javascript`, `python`, `go`, `rust`, `java`, `kotlin`, `csharp`, `php`, `ruby`, `c`, `cpp` | all of them |
| `entrypoints` | string[] (glob) | `["src/index.*", "src/main.*", "bin/*", "main.go", "cmd/**/*.go", "src/bin/*.rs", "**/__main__.py", "manage.py"]` |
| `singleFileMaxLines` | number | `150` |
| `coverageCommand` | string | detected from the project's manifest by the skill |
| `abbreviationAllowlist` | string[] | `["id", "url", "uri", "api", "http", "https", "json", "html", "css", "sql", "uuid", "io", "ui"]` |
| `simplePackages` | string[] | `["axios", "node-fetch", "got", "superagent", "request"]` |
| `infrastructurePackages` | string[] of imported package names | database and cache clients of each ecosystem: `pg`, `mongoose`, `@prisma/client`, ... (npm); `psycopg2`, `sqlalchemy`, `pymongo`, ... (Python); `database/sql`, `gorm.io/gorm`, ... (Go); `sqlx`, `diesel` (Rust); `java.sql`, `jakarta.persistence`, ... (Java, Kotlin); `Microsoft.EntityFrameworkCore`, `Npgsql`, ... (C#); `PDO`, `Illuminate\Database`, ... (PHP); `active_record`, `sequel` (Ruby); `libpq-fe.h`, `sqlite3.h`, ... (C, C++); see `lib/defaults.json` |
| `tournament.minComplexity` | number | `5` |
| `tournament.minLines` | number | `10` |
| `tournament.weights` | `{readability, length, bytecode, speed, closeness}` | all `0.2` |
| `libraryDigest` | boolean | `true` |
| `libraryDigestDev` | boolean (include `devDependencies`) | `false` |
| `libraryDigestPerRun` | number | `5` |
| `roles` | `{module, interfaces, consts, helper, util: string[]}` | aliases found by `conventions` |
| `testsLocation` | a folder name | from the profile; else `tests`. `"colocated"` is not supported: it gives `warning config testsLocation: "colocated" is not supported, using "tests"` and works as `tests`; `""` (old profiles) works as `tests` |
| `testSuffix` | `"test"` or `"spec"` | from the profile; else `test` |
| `constantCase` | `"upper-snake"`, `"camel"` or `"pascal"` | from the profile; else `upper-snake` (Go and C# always use PascalCase) |
| `interfacePrefix` | `""` or `"I"` | from the profile; else `""` |
| `entityPrefix` | boolean | from the profile; else `true` |
| `rules` | `{"<rule-id>": "off" or "error" or "warning" or {severity?, max?, reason?}}` | `{}` |
| `sources` | `{"<field>": "<source>"}` | written by `conventions` |

### Layout detection (`layout: "auto"`)

- `layered`: `sourceRoot` (all roots together, for a list) has folders of at least two different roles from `roles` (for example `services` and `types`).
- `modular`: otherwise, when at least one folder in `sourceRoot` contains a file or folder with role `interfaces`, `consts` or `helper`.
- `off`: otherwise.

### Role aliases scanned by `conventions`

| Role | Aliases |
|---|---|
| `module` | `modules`, `services`, `controllers`, `features`, `domains`, `handlers` |
| `interfaces` | `interfaces`, `types`, `typings`, `contracts`, `dto` |
| `consts` | `consts`, `constants`, `enums` |
| `helper` | `helpers` |
| `util` | `utils`, `util`, `shared`, `common`, `lib` |

A role with no alias found as a folder gets the full list. Add your own names, for example `"helper": ["support"]`.

### The project profile

`bash "${CLAUDE_PLUGIN_ROOT}/bin/codemaster" conventions [--refresh]` scans the project and writes the profile into `.codemaster.json`. It runs by itself on the first hook run when the file is missing, but that run never executes the project's ESLint; ESLint limits are imported only by an explicit `conventions --refresh`. Every written field gets a source in `sources`: a config path (`eslint.config.js`), `dominant 83% (41/49)` or `default`.

- `sourceRoot`: the first of `src`, `app`, `server`, `lib` that exists. Otherwise, in a monorepo, one root per top-level folder with a `package.json` (its `src`, `app`, `server` or `lib` when present, else the folder itself), with the source `packages: <names>`. Otherwise `.`.
- `roles`: the aliases that exist as folders in `sourceRoot` or in entity folders.
- `testsLocation`, `testSuffix`: `testsLocation` is the dominant test folder among `tests/`, `test/`, `__tests__/`, `spec/` (`tests` without a dominant one); tests next to the code are never a choice. `testSuffix` is the share of `.test.` against `.spec.`.
- `constantCase`, `interfacePrefix`, `entityPrefix`: taken from the existing top-level data constants, interfaces and types.
- A convention counts as dominant at 60% or more with at least 5 cases; otherwise the codemaster default applies.
- `sourceRoot` of a monorepo: a top-level folder counts as a package when it holds `package.json`, `pyproject.toml`, `setup.py`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle(.kts)`, `composer.json` or `Gemfile`.
- Linter rules move into `rules`: with `node_modules/.bin/eslint` present, `eslint --print-config <file>` supplies `max-params` (to `rules.max-params.max` or `off`), `max-depth` (to `rules.max-nesting.max`), `prefer-destructuring: off` (to `rules.prefer-destructuring: "off"`) and `@typescript-eslint/naming-convention` for `variable` and `interface` (to `constantCase` and `interfacePrefix`). Without ESLint it reads `biome.json` (`complexity.useMaxParams`, `style.useNamingConvention`). Without both nothing is imported.
- A field already in the file without an entry in `sources` was written by a person and is never overwritten.
- The scanner does not read the free text of `CLAUDE.md`, `AGENTS.md` or `CONTRIBUTING*`; the skill does.
