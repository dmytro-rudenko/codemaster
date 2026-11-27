# codemaster rules

Run `node "${CLAUDE_PLUGIN_ROOT}/bin/codemaster.ts" check [paths...] [--json]`. Without paths it checks the files changed on the branch (committed, uncommitted and new), whole files at a time; `--all` checks every code file. Each finding is one line:

```
error max-params src/modules/user.ts:42 function createUser has 6 parameters (max 5)
```

The last line is `codemaster: <E> errors, <W> warnings in <N> files`. The exit code is 1 when there is at least one error.

Examples use the `layered` layout (`src/modules`, `src/consts`, `src/interfaces`, `src/helpers`, `src/utils`). In a `modular` project the same files live in the entity folder: `user/user.service.ts`, `user/user.consts.ts`, `user/user.interfaces.ts`. Folder names follow the project's `roles`.

## Rules

| rule-id | Severity | Bad | Good |
|---|---|---|---|
| `layout-forbidden-declaration` | error | `src/modules/user.service.ts` declares `export interface User { name: string }` or `export const USER_LIMIT = 10;` | `src/interfaces/user.ts` holds the interface, `src/consts/user.ts` holds the constant |
| `single-file-module-size` | warning | `src/modules/slug.ts` keeps its own constants and types and has grown past 150 non-empty lines | an entity folder: code in `src/modules/slug/slug.ts`, declarations in `src/consts/slug.ts` and `src/interfaces/slug.ts` |
| `helpers-only-functions` | error | `src/helpers/logic/format.ts` exports `class Formatter {}` or `export const format = { price() {} }` | `export function formatPrice(value: number): string { return value.toFixed(2); }` |
| `test-mirror` | error for `module` and `single-file-module`, warning for `helper` and `util` | `src/modules/user.ts` with no `user.test.ts` next to it | `src/modules/user.test.ts`; with `testsLocation: "tests"` it is `tests/modules/user.test.ts` |
| `helpers-mixed-kind` | warning | one helper file imports `pg` and also calls `fetch(` | `src/helpers/infrastructure/user-db.ts` for the database, `src/helpers/external/user-api.ts` for the API |
| `name-abbreviation` | error | `const cfg = load(); function send(msg: string)` | `const config = load(); function send(message: string)` |
| `name-word-count` | warning | `getActiveUserOrderTotalPrice` (5 words) | `getOrderTotal`; the entity prefix (`USER_`, `User`) is not counted |
| `name-entity-prefix` | error | `src/consts/user.ts`: `export const MAX_LIMIT = 10;`<br>`src/interfaces/user.ts`: `export interface Profile {}` | `export const USER_MAX_LIMIT = 10;`<br>`export interface UserProfile {}` |
| `max-params` | error | `function createUser(name, email, age, role, team, locale) {}` (6 parameters) | `function createUser({ name, email, age, role, team, locale }: UserCreateInput) {}` |
| `max-nesting` | error | `if (a) { for (x of xs) { while (y) { if (z) {} } } }`, a callback inside a callback inside a callback, or `.then(` inside a `.then(` callback | early `return` / `continue`, a helper function per level, `async`/`await` |
| `max-call-nesting` | warning | `a(b(c(d())))` | `const inner = c(d()); a(b(inner));` |
| `global-function` | error | `src/consts/user.ts` declares `export function buildKey() {}`, or `globalThis.format = () => {}` | `export function buildKey() {}` in `src/helpers/logic/user.ts`; in an entrypoint only `main` is allowed |
| `prefer-destructuring` | warning | `const name = user.name;` | `const { name } = user;` |
| `simple-package` | warning | `"dependencies": { "axios": "^1.7.0" }` | the built-in `fetch` |

### Details

- `layout-forbidden-declaration`: roles `module`, `helper`, `util` hold no `interface`, `type`, `enum` and no top-level constant. A constant is a `const` or `let` whose initializer is data: a literal (string, number, bigint, boolean, `null`, regex, template without substitutions), an array or object literal made only of such data, the same with `as const`, or inside `Object.freeze(...)`. Objects with methods, `new ...`, function calls and classes are not constants. A `single-file-module` may hold anything.
- `single-file-module-size`: the limit is `singleFileMaxLines` (default 150) non-empty lines, and it applies only to a `single-file-module` with its own constants, interfaces or types.
- `helpers-only-functions`: in roles `helper` and `util` the top level has only `function` declarations and `const x = (...) => ...` or `function` expressions.
- `test-mirror`: the hook checks only that the test file exists. Coverage is checked by the skill (100% of changed `module` and `single-file-module` lines).
- `helpers-mixed-kind`: the file imports a package from `infrastructurePackages` and calls `fetch(` or `http(s).request`, or has both such calls and functions without them. Subfolder names are not checked.
- `name-abbreviation`: applies to functions, variables, parameters, classes, interfaces, types and constants. Words come from splitting camelCase, PascalCase and SNAKE_CASE. One-letter names are violations, except `_` and type parameters. Words in `abbreviationAllowlist` are allowed. The built-in list: `cfg conf ctx req res msg btn tmp temp val idx err cb fn str num arr obj elem el evt e args params prev cur curr cnt len mgr svc repo impl init info ref usr pwd addr src dst desc opts env doc docs db`.
- `name-entity-prefix`: applies in roles `consts` and `interfaces` that belong to an entity. Constants follow `constantCase` (`upper-snake`: `<ENTITY>_...`, `camel`: `<entity>...`) and, with `entityPrefix: true`, start with the entity. Interfaces and types are PascalCase: `<interfacePrefix><Entity>...`. An entity with a hyphen or underscore is folded: `order-item` gives `ORDER_ITEM_`, `orderItem`, `OrderItem`. Global files (`global`, `globals`, `shared`, `index` in a `consts` or `interfaces` folder, or a `global` or `shared` entity folder) take `constantCase` without a prefix.
- `max-params`: functions, methods and constructors; the limit is 5.
- `max-nesting`: control blocks (`if`, `for`, `while`, `switch`, `try`) deeper than 3 levels inside one function; a function argument nested in another function argument deeper than 2 levels; `.then(` inside the callback of another `.then(`.
- `max-call-nesting`: a call used as an argument of a call, deeper than 3 levels.
- `global-function`: a top-level function in a file whose role is not `module`, `single-file-module`, `helper`, `util` or `test`; the exception is `main` in an `entrypoint`. Assignments to `globalThis`, `window`, `global` and `declare global` with a function are also errors.
- `prefer-destructuring`: `const $X = $OBJ.$X` and `const $X = $OBJ["$X"]`.
- `simple-package`: `dependencies` or `devDependencies` in `package.json` lists a package from `simplePackages`.

Rules that depend on layout (`layout-forbidden-declaration`, `helpers-only-functions`, `test-mirror`, `helpers-mixed-kind`, `name-entity-prefix`, `single-file-module-size`) do not apply when the layout is `off`.

### File roles

The role of a file comes from its name without the extension, or from its folder name, optionally prefixed with `<entity>.`:

- `interfaces`, `interface`, `types`, `type` give role `interfaces`;
- `consts`, `const`, `constants`, `constant` give role `consts`;
- `helpers`, `helper` give role `helper`;
- `utils`, `util` give role `util`;
- anything else (`<entity>.service`, `<entity>.module`, `<entity>.controller`) gives role `module`.

Test files (`*.test.*`, `*.spec.*`, anything under the tests folder, `tests/`, `test/`, `__tests__/`) have role `test` and only `test-mirror` concerns them. A file matching `entrypoints` has role `entrypoint`. A file outside `sourceRoot` that is not an entrypoint has role `other`: only the naming, parameter, nesting and destructuring rules apply.

## Turning a rule off or changing it

`rules.<id>` in `.codemaster.json`:

```json
{
  "rules": {
    "prefer-destructuring": "off",
    "max-params": { "max": 8, "reason": "CLAUDE.md: up to 8 parameters are allowed in handlers" },
    "name-word-count": { "severity": "error", "max": 4 }
  }
}
```

A value is `"off"` (the rule does not run), `"error"` or `"warning"` (a new severity), or an object with `severity`, `max` (for `max-params`, `max-nesting`, `max-call-nesting`, `name-word-count`, `single-file-module-size`) and `reason` (printed with `check --json` and quoted in the skill report).

## `.codemaster.json`

The file is optional and lives in the project root. Unknown fields are ignored. A field of the wrong type produces one line `warning config <field>: expected <type>` and the default is used. `.codemaster.local.json` next to it has the same format and its fields override `.codemaster.json`; it holds personal switches and goes into the project's `.gitignore`.

| Field | Type | Default |
|---|---|---|
| `hook` | boolean | `true` |
| `layout` | `"auto"`, `"modular"`, `"layered"` or `"off"` | `"auto"` |
| `sourceRoot` | string | `"src"` |
| `entrypoints` | string[] (glob) | `["src/index.ts", "src/main.ts", "bin/*.ts"]` |
| `singleFileMaxLines` | number | `150` |
| `coverageCommand` | string | detected from `package.json` |
| `abbreviationAllowlist` | string[] | `["id", "url", "uri", "api", "http", "https", "json", "html", "css", "sql", "uuid", "io", "ui"]` |
| `simplePackages` | string[] | `["axios", "node-fetch", "got", "superagent", "request"]` |
| `infrastructurePackages` | string[] | `["pg", "mysql2", "mongodb", "mongoose", "ioredis", "redis", "@prisma/client", "typeorm", "knex", "sequelize", "drizzle-orm"]` |
| `tournament.minComplexity` | number | `5` |
| `tournament.minLines` | number | `10` |
| `tournament.weights` | `{readability, length, bytecode, speed, closeness}` | all `0.2` |
| `libraryDigest` | boolean | `true` |
| `libraryDigestDev` | boolean (include `devDependencies`) | `false` |
| `libraryDigestPerRun` | number | `5` |
| `roles` | `{module, interfaces, consts, helper, util: string[]}` | aliases found by `conventions` |
| `testsLocation` | `"colocated"` or a folder name | from the profile; else `colocated` for `modular`, `tests` for `layered` |
| `testSuffix` | `"test"` or `"spec"` | from the profile; else `test` |
| `constantCase` | `"upper-snake"` or `"camel"` | from the profile; else `upper-snake` |
| `interfacePrefix` | `""` or `"I"` | from the profile; else `""` |
| `entityPrefix` | boolean | from the profile; else `true` |
| `rules` | `{"<rule-id>": "off" or "error" or "warning" or {severity?, max?, reason?}}` | `{}` |
| `sources` | `{"<field>": "<source>"}` | written by `conventions` |

### Layout detection (`layout: "auto"`)

- `layered`: `sourceRoot` has folders of at least two different roles from `roles` (for example `services` and `types`).
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

`node "${CLAUDE_PLUGIN_ROOT}/bin/codemaster.ts" conventions [--refresh]` scans the project and writes the profile into `.codemaster.json`. It runs by itself on the first hook run when the file is missing, but that run never executes the project's ESLint; ESLint limits are imported only by an explicit `conventions --refresh`. Every written field gets a source in `sources`: a config path (`eslint.config.js`), `dominant 83% (41/49)` or `default`.

- `sourceRoot`: the first of `src`, `app`, `server`, `lib` that exists, otherwise `.`.
- `roles`: the aliases that exist as folders in `sourceRoot` or in entity folders.
- `testsLocation`, `testSuffix`: the share of tests next to the code against `tests/`, `test/`, `__tests__/`, and of `.test.` against `.spec.`.
- `constantCase`, `interfacePrefix`, `entityPrefix`: taken from the existing top-level data constants, interfaces and types.
- A convention counts as dominant at 60% or more with at least 5 cases; otherwise the codemaster default applies.
- Linter rules move into `rules`: with `node_modules/.bin/eslint` present, `eslint --print-config <file>` supplies `max-params` (to `rules.max-params.max` or `off`), `max-depth` (to `rules.max-nesting.max`), `prefer-destructuring: off` (to `rules.prefer-destructuring: "off"`) and `@typescript-eslint/naming-convention` for `variable` and `interface` (to `constantCase` and `interfacePrefix`). Without ESLint it reads `biome.json` (`complexity.useMaxParams`, `style.useNamingConvention`). Without both nothing is imported.
- A field already in the file without an entry in `sources` was written by a person and is never overwritten.
- The scanner does not read the free text of `CLAUDE.md`, `AGENTS.md` or `CONTRIBUTING*`; the skill does.
