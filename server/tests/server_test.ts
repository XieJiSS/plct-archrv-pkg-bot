#!/usr/bin/env -S deno test -A

import "https://deno.land/std@0.167.0/dotenv/load.ts";
import { assert, assertEquals } from "https://deno.land/std@0.167.0/testing/asserts.ts";
import {
  afterAll,
  beforeAll,
  beforeEach,
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

const db = "test.db";
const server_env = {
  DATABASE_URL: `sqlite:${db}`,
  TGBOT_TOKEN: Deno.env.get("TEST_TGBOT_TOKEN") || "abcdefg",
  GROUP_ID: Deno.env.get("TEST_GROUP_ID") || "1234567",
  HTTP_API_TOKEN: ((len: number) => {
    const literal = "abcdefghijklmnopqrstuvwxyz1234567890";
    const max = literal.length;
    let result = "";
    for (let i = 0; i < len; i++) {
      result += literal[Math.floor(Math.random() * max)];
    }

    return result;
  })(16),
  RUST_BACKTRACE: "1",
};
const backend_api = "http://localhost:11451";

let server_process: Deno.Process;
let mock_tg_server: Deno.Listener;

function gen_mention_link(name: string, id: number) {
  return `<a href="tg://user?id=${id}">${name}</a>`;
}

async function recv_msg() {
  interface Req {
    text: string;
  }
  const conn = await mock_tg_server.accept();
  const httpReq = Deno.serveHttp(conn);
  const event = await httpReq.nextRequest();
  const req: Req = await event?.request.json();
  await event?.respondWith(new Response("OK", { status: 200 }));

  httpReq.close();
  //conn.close();

  return req.text;
}

// Most of the sqlite3 binding for deno are doesn't support WAL.
// Or required a pre-built share library. So using the sqlite3 executable
// here is more efficient.
async function sqlite3(query: string) {
  const sqlite3 = Deno.run({
    cmd: ["sqlite3", db],
    stdin: "piped",
  });
  await sqlite3.stdin.write(new TextEncoder().encode(query));
  sqlite3.stdin.close();

  const prepare_status = await sqlite3.status();
  if (!prepare_status) {
    throw new Error("fail to insert query into prepare status");
  }
  sqlite3.close();
}

async function run_server() {
  const compile_process = Deno.run({
    cmd: ["cargo", "build", "--quiet"],
    stdout: "null",
    stderr: "null",
  });
  if (!(await compile_process.status()).success) {
    throw new Error("fail to compile server");
  }
  compile_process.close();

  const process = Deno.run({
    cmd: ["cargo", "run", "--quiet"],
    stdout: "null",
    stderr: "null",
    env: server_env,
  });
  server_process = process;
}

beforeAll(async () => {
  try {
    const path = await Deno.realPath(db);
    await Deno.remove(path);
  } catch {
    //-
  }

  const migrate_process = Deno.run({
    cmd: ["sqlx", "database", "setup"],
    env: {
      DATABASE_URL: `sqlite:${db}`,
    },
  });

  if (!(await migrate_process.status()).success) {
    throw new Error("fail to migrate database, exit");
  }

  migrate_process.close();

  const query = `
  PRAGMA foreign_keys = ON;
  INSERT INTO packager VALUES(123456, "John");
  INSERT INTO packager VALUES(678901, "Carl");

  INSERT INTO pkg(name) VALUES("adb");
  INSERT INTO pkg(name) VALUES("electron8");

  INSERT INTO mark VALUES("upstreamed", 123456, 1669088178, 18, "upstream fault...", 1);
  INSERT INTO mark VALUES("stuck",      678901, 1669088178, 89, "hard to port...", 2);
  INSERT INTO mark VALUES("ftbfs",      678901, 1669088178, 90, "", 2);

  INSERT INTO assignment(pkg, assignee, assigned_at) VALUES(1, 123456, 1669088180);
  INSERT INTO assignment(pkg, assignee, assigned_at) VALUES(2, 678901, 1669088190);
`;
  await sqlite3(query);

  await run_server();

  mock_tg_server = Deno.listen({ port: 19198 });

  await new Promise((r) => setTimeout(r, 2000));
});

afterAll(() => {
  server_process.kill("SIGABRT");
  server_process.close();

  mock_tg_server.close();
});

//-
//- Test Main
//-

describe("Test route /pkg", () => {
  let pkg: PkgResponse;
  beforeAll(async () => {
    const pkg_response = await fetch("http://localhost:11451/pkg");
    if (!pkg_response.ok) {
      const error = (await pkg_response.json()) as ErrorResponse;
      throw new Error(`fail to fetch /pkg: ${error.msg} : ${error.detail}`);
    }

    pkg = await pkg_response.json();
  });

  it("Expect alias match", () => {
    assertEquals(pkg.workList[0].alias, "John");
  });

  it("Expect packages match", () => {
    assertEquals(pkg.workList[1].packages[0], "electron8");
  });

  it("Expect mark name match", () => {
    assertEquals(pkg.markList[0].marks[0].name, "upstreamed");
  });

  it("Expect comment match", () => {
    assertEquals(pkg.markList[1].marks[0].comment, "hard to port...");
  });
});

describe("Test route /delete", () => {
  //-

  describe("Invalid request test", () => {
    it("Expect invalid token", async () => {
      const resp: ErrorResponse = await fetch(
        new URL("/delete/test1/test2?token=invalid", backend_api)
      ).then((r) => r.json());

      assertEquals(resp.detail, "invalid token");
    });

    it("Expect invalid status", async () => {
      const url = new URL(
        `/delete/test1/test2?token=${server_env.HTTP_API_TOKEN}`,
        backend_api
      );
      const resp: ErrorResponse = await fetch(url).then((r) => r.json());

      assertEquals(resp.detail, "Required 'ftbfs' or 'leaf', get test2");
    });

    it("Expect invalid packager", async () => {
      const url = new URL(
        `/delete/test1/ftbfs?token=${server_env.HTTP_API_TOKEN}`,
        backend_api
      );
      const resp: ErrorResponse = await fetch(url).then((r) => r.json());
      assertEquals(resp.msg, "Error occur when deleting mark");

      const msg1 = await recv_msg();
      assert(msg1.search("fail to delete marks for test1") !== -1)
    });
  });

  //-
  describe("Individual ready package test", () => {
    it("Expect auto-merge message", async () => {
      const url = new URL(
        `/delete/electron8/ftbfs?token=${server_env.HTTP_API_TOKEN}`,
        backend_api
      );
      const resp: ErrorResponse = await fetch(url).then((r) => r.json());
      assertEquals(resp.msg, "Request success");
      assertEquals(resp.detail, "package deleted");
      const msg1 = await recv_msg();
      assertEquals(
        msg1,
        `<code>(auto-merge)</code> ping ${gen_mention_link(
          "Carl",
          678901
        )}: electron8 已出包\n`
      );
    });
  });
});
