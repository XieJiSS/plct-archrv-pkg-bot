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

const db = "test.db";
const server_env = {
  "DATABASE_URL": `sqlite:${db}`,
  "TGBOT_TOKEN": Deno.env.get("TEST_TGBOT_TOKEN") || "abcdefg",
  "GROUP_ID": Deno.env.get("TEST_GROUP_ID") || "1234567",
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
const backend_api = "http://localhost:11451";

let server_process: Deno.Process;
const mock_tg_server = Deno.listen({ port: 19198 });

async function recv_msg() {
  interface Req {
    text: string;
  }
  const conn = await mock_tg_server.accept();
  const httpReq = Deno.serveHttp(conn);
  const event = await httpReq.nextRequest();
  const req: Req = await event?.request.json();
  event?.respondWith(new Response("OK", { status: 200 }));
  return req.text;
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
      "DATABASE_URL": `sqlite:${db}`,
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

  const compile_process = Deno.run({
    cmd: ["cargo", "build"],
  });
  if (!(await compile_process.status()).success) {
    throw new Error("fail to compile server");
  }
  compile_process.close();

  const process = Deno.run({
    cmd: ["cargo", "run"],
    env: server_env,
  });
  server_process = process;

  await new Promise((r) => setTimeout(r, 2000));
});

afterAll(() => {
  server_process.kill("SIGABRT");
  server_process.close();
});

//-
//- Test Main
//-

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

describe("Test route /delete", () => {
  //-

  describe("# Invalid Request", () => {
    it("invalid token", async () => {
      const resp: ErrorResponse = await fetch(
        new URL("/delete/test1/test2?token=invalid", backend_api),
      ).then((r) => r.json());

      assertEquals(resp.detail, "invalid token");
    });

    it("invalid status", async () => {
      const url = new URL(
        `/delete/test1/test2?token=${server_env.HTTP_API_TOKEN}`,
        backend_api,
      );
      const resp: ErrorResponse = await fetch(url).then((r) => r.json());

      assertEquals(resp.detail, "Required 'ftbfs' or 'leaf', get test2");
    });

    it("invalid package", async () => {
      const url = new URL(
        `/delete/test1/ftbfs?token=${server_env.HTTP_API_TOKEN}`,
        backend_api,
      );
      const resp: ErrorResponse = await fetch(url).then((r) => r.json());

      assertEquals(resp.msg, "fail to fetch packager");
    });
  });

  //-
  // describe("# Normal Request", () => {
  //   it("1", async() => {
  //     const url = new URL(
  //       `/delete/electron8/ftbfs?`,
  //       backend_api,
  //     )
  //   })
  // })
});
