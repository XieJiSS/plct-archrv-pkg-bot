export function generate_token(len: number): string {
  const literal = "abcdefghijklmnopqrstuvwxyz1234567890";
  const max = literal.length;
  let result = "";
  for (let i = 0; i < len; i++) {
    result += literal[Math.floor(Math.random() * max)];
  }

  return result;
}

export const COLOR = {
  ALL_OFF: "\x1b[0m",
  BOLD: "\x1b[1m",
  RED: "\x1b[1m\x1b[31m",
  GREEN: "\x1b[1m\x1b[32m",
  YELLOW: "\x1b[1m\x1b[33m",
  BLUE: "\x1b[1m\x1b[34m",
};

export function MSG(s: string) {
  console.log(
    `${COLOR.GREEN}==>${COLOR.ALL_OFF}${COLOR.BOLD} ${s}${COLOR.ALL_OFF}`,
  );
}

export function MSG2(s: string) {
  console.log(
    `${COLOR.BLUE}  ->${COLOR.ALL_OFF}${COLOR.BOLD} ${s}${COLOR.ALL_OFF}`,
  );
}

export function ERROR(s: string) {
  console.log(
    `${COLOR.RED}==> ERROR:${COLOR.ALL_OFF}${COLOR.BOLD} ${s}${COLOR.ALL_OFF}`,
  );
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function migrate_db(db: string) {
  try {
    const path = await Deno.realPath(db);
    await Deno.remove(path);
  } catch {
    //-
  }

  const migrate_status = await Deno.run({
    cmd: ["sqlx", "database", "setup"],
    env: {
      "DATABASE_URL": `sqlite:${db}`,
    },
  }).status();

  if (!migrate_status.success) {
    throw new Error("fail to migrate database, exit");
  }

  const query = `
  PRAGMA foreign_keys = ON;
  INSERT INTO packager VALUES(123456, "John");
  INSERT INTO packager VALUES(678901, "Carl");

  INSERT INTO pkg(name) VALUES("adb");
  INSERT INTO pkg(name) VALUES("electron8");

  INSERT INTO mark VALUES("upstreamed", 123456, 1669088178, 18, "upstream fault...", 1);
  INSERT INTO mark VALUES("stuck",      678901, 1669088178, 89, "hard to port...", 2);

  INSERT INTO assignment(pkg, assignee, assigned_at) VALUES(1, 123456, 1669088180);
  INSERT INTO assignment(pkg, assignee, assigned_at) VALUES(2, 678901, 1669088190);
`;

  const sqlite3 = Deno.run({
    cmd: ["sqlite3", db],
    stdin: "piped",
  });
  await sqlite3.stdin.write((new TextEncoder()).encode(query));
  sqlite3.stdin.close();

  const prepare_status = await sqlite3.status();
  if (!prepare_status) {
    throw new Error("fail to insert query into prepare status");
  }
  sqlite3.close();
}

export async function oneshot_run(cmd: string[]) {
  const status = await Deno.run({
    cmd: cmd,
  }).status();
  if (!status.success) {
    return `Fail to run ${cmd}`;
  }

  return null;
}

export interface ErrorResponse {
  msg: string;
  detail: string;
}

interface WorkUnit {
  alias: string;
  packages: string[];
}

interface Mark {
  name: string;
  comment: string;
}

export interface PkgResponse {
  workList: WorkUnit[];
  markList: {
    name: string;
    marks: Mark[];
  }[];
}

export async function extract_error_resp(resp: Response) {
  const result = await resp.json() as ErrorResponse;
  ERROR(`Message: ${result.msg}`);
  ERROR(`Details: ${result.detail}`);
}

export class TestSuites<T> {
  suites: { name: string; assert: { get: T; want: T } }[];

  constructor() {
    this.suites = [];
  }

  add(name: string, get: T, want: T) {
    this.suites.push({
      name: name,
      assert: {
        get: get,
        want: want,
      },
    });
  }

  start() {
    for (const test of this.suites) {
      MSG2(test.name);
      if (test.assert.get !== test.assert.want) {
        return `${test.assert.get} is not equal to ${test.assert.want}`;
      }
    }

    return null;
  }
}
