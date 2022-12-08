#!/usr/bin/env -S deno test -A

import "https://deno.land/std@0.167.0/dotenv/load.ts";
import { assertEquals } from "https://deno.land/std@0.167.0/testing/asserts.ts";
import {
  afterAll,
  beforeAll,
  describe,
  it,
} from "https://deno.land/std@0.167.0/testing/bdd.ts";

interface ErrorResponse {
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

interface PkgResponse {
  workList: WorkUnit[];
  markList: {
    name: string;
    marks: Mark[];
  }[];
}

let server_pid = -1;

const db = "test.db";
const server_env = {
  "DATABASE_URL": `sqlite:${db}`,
  "TGBOT_TOKEN": Deno.env.get("TEST_TGBOT_TOKEN") || "",
  "GROUP_ID": Deno.env.get("TEST_GROUP_ID") || "",
  "HTTP_API_TOKEN": ((len: number) => {
    const literal = "abcdefghijklmnopqrstuvwxyz1234567890";
    const max = literal.length;
    let result = "";
    for (let i = 0; i < len; i++) {
      result += literal[Math.floor(Math.random() * max)];
    }

    return result;
  })(16),
};

beforeAll(async () => {
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

  const compile_status = await Deno.run({
    cmd: ["cargo", "build"],
  }).status();
  if (!compile_status.success) {
    throw new Error("fail to compile server");
  }

  const server_process = Deno.run({
    cmd: ["cargo", "run"],
    env: server_env,
  });
  server_pid = server_process.pid;

  await new Promise((r) => setTimeout(r, 2000));
});

afterAll(() => {
  Deno.kill(server_pid, "SIGABRT");
});

describe("Test route /pkg", () => {
  let pkg: PkgResponse;
  beforeAll(async () => {
    const pkg_response = await fetch("http://localhost:11451/pkg");
    if (!pkg_response.ok) {
      const error = await pkg_response.json() as ErrorResponse;
      throw new Error(`fail to fetch /pkg: ${error.msg} : ${error.detail}`);
    }

    pkg = await pkg_response.json();
  });

  it("#1", () => {
    assertEquals(pkg.workList[0].alias, "John");
  });

  it("#2", () => {
    assertEquals(pkg.workList[1].packages[0], "electron8");
  });

  it("#3", () => {
    assertEquals(pkg.markList[0].marks[0].name, "upstreamed");
  });

  it("#4", () => {
    assertEquals(pkg.markList[1].marks[0].comment, "hard to port...");
  });
});
