## Bot Command

+ `/add pkgname`

+ `/drop pkgname`, `/merge pkgname`

+ `/mark pkgname pkgmark comment`

  + `outdated_dep` and `missing_dep` have auto-track for `pkgname` wrapped in`[]` inside `comment`:

    `/mark pkg1 outdated_dep [pkg2]`

+ `/unmark pkgname pkgmark`

+ `/status`

+ `/helpmark [mark]`

## Integration

+ [cubercsl/archrv-pkg-notification-bot](https://github.com/cubercsl/archrv-pkg-notification-bot)
+ [Ast-x64/plct-archrv-status-worker](https://github.com/Ast-x64/plct-archrv-status-worker)

## Upstream Data Source

+ https://archriscv.felixc.at/.status/status.htm required by `cubercsl/archrv-pkg-notification-bot`, `Ast-x64/plct-archrv-status-worker`
+ [felixonmars/archriscv-packages](https://github.com/felixonmars/archriscv-packages) required by `Ast-x64/plct-archrv-status-worker`

## API

+ `/pkg` dump all data
+ `/pkg?mark=name` get package names with the specified mark
+ `/add/pkgname/{ftbfs,leaf}`
  + `ftbfs`: mark `pkgname` as failing
  + `leaf`: reserved, currently no operation
  + triggers `auto-{mark,unmark}` (see [http-UML.md](./http-UML.md))
+ `/delete/pkgname/{ftbfs,leaf}`
  + mark `pkgname` as built successfully from source
  + triggers `auto-{mark,unmark}` (see [http-UML.md](./http-UML.md))

Some APIs require auth token (see `../config/.env.example`). Pass the token as a URL Search Param for such APIs.

