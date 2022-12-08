#!/usr/bin/env -S deno run -A

import "https://deno.land/std@0.167.0/dotenv/load.ts";
import {
  ERROR,
  extract_error_resp,
  generate_token,
  migrate_db,
  MSG,
  MSG2,
  oneshot_run,
  PkgResponse,
  sleep,
  TestSuites,
} from "./libtest.ts";

let server_pid = -1;

function FATAL(s: string) {
  ERROR(s);
  if (server_pid !== -1) {
    Deno.kill(server_pid, "SIGABRT");
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

MSG(`Migrating DB ${db_file}`);
await migrate_db(db_file);

MSG("Compiling Server");
const error = await oneshot_run(["cargo", "build"]);
if (error) {
  FATAL(error);
}

MSG("Start server");
const server_process = Deno.run({
  cmd: ["cargo", "run"],
  env: server_env,
});
server_pid = server_process.pid;
MSG2("Wait for server started");
await sleep(2000);

MSG("[ROUTE] Testing /pkg");
const pkg_response = await fetch("http://localhost:11451/pkg");
if (!pkg_response.ok) {
  await extract_error_resp(pkg_response);
  FATAL("fail to fetch /pkg");
}

const pkg = await pkg_response.json() as PkgResponse;

const pkg_test = new TestSuites();
pkg_test.add("Test 1", pkg.workList[1].packages[0], "electron8");
pkg_test.add("Test 2", pkg.workList[0].alias, "John");
pkg_test.add(
  "Test 3",
  pkg.markList[0].marks[0].name,
  "upstreamed",
);
pkg_test.add(
  "Test 4",
  pkg.markList[1].marks[0].comment,
  "hard to port...",
);
const result = pkg_test.start();
if (result) {
  FATAL(result);
}

const delete_test = new TestSuites();


MSG("All test passed.");

server_process.kill("SIGABRT");
