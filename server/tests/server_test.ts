#!/usr/bin/env -S deno run -A

import "https://deno.land/std@0.167.0/dotenv/load.ts";

let server_pid = -1;

function generate_token(len: number): string {
  const literal = "abcdefghijklmnopqrstuvwxyz1234567890";
  const max = literal.length;
  let result = "";
  for (let i = 0; i < len; i++) {
    result += literal[Math.floor(Math.random() * max)];
  }

  return result;
}

const COLOR = {
  ALL_OFF: "\x1b[0m",
  BOLD: "\x1b[1m",
  RED: "\x1b[1m\x1b[31m",
  GREEN: "\x1b[1m\x1b[32m",
  YELLOW: "\x1b[1m\x1b[33m",
  BLUE: "\x1b[1m\x1b[34m",
};

function MSG(s: string) {
  console.log(
    `${COLOR.GREEN}==>${COLOR.ALL_OFF}${COLOR.BOLD} ${s}${COLOR.ALL_OFF}`,
  );
}

function MSG2(s: string) {
  console.log(
    `${COLOR.BLUE}  ->${COLOR.ALL_OFF}${COLOR.BOLD} ${s}${COLOR.ALL_OFF}`,
  );
}

function ERROR(s: string) {
  console.log(
    `${COLOR.RED}==> ERROR:${COLOR.ALL_OFF}${COLOR.BOLD} ${s}${COLOR.ALL_OFF}`,
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function FATAL(s: string) {
  ERROR(s);
  if (server_pid != -1) {
    Deno.kill(server_pid, "SIGABRT")
  }
  Deno.exit(1);
}

const db_file = "test.db";
const server_env = {
  "DATABASE_URL": `sqlite:${db_file}`,
  "TGBOT_TOKEN": Deno.env.get("TEST_TGBOT_TOKEN") || "",
  "GROUP_ID": Deno.env.get("TEST_GROUP_ID") || "",
  "HTTP_API_TOKEN": generate_token(16),
};

try {
  const path = await Deno.realPath(db_file);
  await Deno.remove(path);
} catch {
  //-
}

MSG(`Migrating DB ${db_file}`);

const migrate_status = await Deno.run({
  cmd: ["sqlx", "database", "setup"],
  env: server_env,
}).status();

if (!migrate_status.success) {
  FATAL("fail to migrate database, exit");
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
  cmd: ["sqlite3", db_file],
  stdin: "piped",
});
await sqlite3.stdin.write((new TextEncoder()).encode(query));
sqlite3.stdin.close();

const prepare_status = await sqlite3.status();
if (!prepare_status) {
  FATAL("fail to insert query into prepare status");
}
sqlite3.close();

MSG("Compiling Server");
const compile_status = await Deno.run({
  cmd: ["cargo", "build"],
}).status();
if (!compile_status.success) {
  FATAL("Fail to compile the server");
}

MSG("Start server");
const server_process = Deno.run({
  cmd: ["cargo", "run"],
  env: server_env,
});
server_pid = server_process.pid
MSG2("Wait for server started");
await sleep(2000);

interface ErrorResponse {
  msg: string;
  detail: string;
}

async function extract_resp_and_exit(resp: Response) {
  const result = await resp.json() as ErrorResponse;
  ERROR(`Message: ${result.msg}`);
  ERROR(`Details: ${result.detail}`);
  FATAL("fail to fetch /pkg");
}

MSG("[ROUTE] Testing /pkg");
const pkg_response = await fetch("http://localhost:11451/pkg");
if (!pkg_response.ok) {
  await extract_resp_and_exit(pkg_response);
}

interface WorkUnit {
  alias: string;
  packages: string[];
}

interface Mark {
  name: string;
  comment: string;
}
interface PkgResponse {
  workList: WorkUnit[];
  markList: {
    name: string;
    marks: Mark[];
  }[];
}

const pkg = await pkg_response.json() as PkgResponse;

class TestSuites<T> {
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
    this.suites.forEach((test) => {
      MSG2(test.name);
      if (test.assert.get != test.assert.want) {
        FATAL(`${test.assert.get} is not equal to ${test.assert.want}`);
      }
    });
  }
}

const route_pkg_test_suites = new TestSuites();
route_pkg_test_suites.add("Test 1", pkg.workList[1].packages[0], "electron8");
route_pkg_test_suites.add("Test 2", pkg.workList[0].alias, "John");
route_pkg_test_suites.add(
  "Test 3",
  pkg.markList[0].marks[0].name,
  "upstreamed",
);
route_pkg_test_suites.add(
  "Test 4",
  pkg.markList[1].marks[0].comment,
  "hard to port...",
);
route_pkg_test_suites.start();

MSG("All test passed.");

server_process.kill("SIGABRT");
