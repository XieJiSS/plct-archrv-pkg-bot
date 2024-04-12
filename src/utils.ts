/**
 * TODO:

change status & marks db to use id instead of name, and retrieve name dynamically
 */

import { config } from "dotenv";
config({
  path: "./config/.env",
});

import assert from "assert";
import crypto from "crypto";
import _equal from "deep-equal";
import fs from "fs";
import { unlink, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import verb from "./_verbose";

import {
  PackageStatus,
  PackageMark,
  MarkConfig,
  OldPackageStatus,
  OldPackageMark,
  MarkRecord,
  PackageInterface,
  GetMessageLinkOptions,
  StrippedPackageStatus,
  StrippedPackageMark,
} from "./types";
import { i18n } from "./i18n";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_LOG_DIR = process.env["PLCT_BASE_LOG_DIR"] || "https://archriscv.felixc.at/.status/logs/{pkgname}/";

if (!process.env["PLCT_BASE_LOG_DIR"]) {
  verb("[ERRO] utils.ts: missing PLCT_BASE_LOG_DIR");
}

let packageStatus: PackageStatus[] = [];
await loadPackageStatus();

let _packageMarksForInit: PackageMark[];
await loadPackageMarks();
// In order to keep refs in plct-archrv-bot.js, this variable should never be assigned again.
// Also, this need to be done immediately in this tick, so that we can write back in next tick
const packageMarks = _packageMarksForInit;

const aliasMap: Record<string, string> = {};
await loadAlias();

const MARK_CONFIG: Record<string, MarkConfig> = {
  unknown: {
    desc: i18n`特殊状态，请咨询认领人`,
    helpMsg: "这个包还有未知的问题没解决，在其他 tag 都不适用的情况下用。使用时要记得补充说明",
    requireComment: true,
    allowUserModification: { mark: true, unmark: true },
    appendTimeComment: false,
    triggers: [],
  },
  upstreamed: {
    desc: i18n`等待上游`,
    helpMsg: "需要等上游修复，可以是包自己的上游，也可以是 Arch Linux x86_64 上游",
    requireComment: true,
    allowUserModification: { mark: true, unmark: true },
    appendTimeComment: false,
    triggers: [],
  },
  outdated: {
    desc: i18n`需要滚版本`,
    helpMsg: "这个包因为版本过时的原因无法出包",
    requireComment: false,
    allowUserModification: { mark: true, unmark: true },
    appendTimeComment: false, // must be false for auto-unmark by pkgname to work properly
    triggers: [],
  },
  outdated_dep: {
    desc: i18n`需要滚依赖版本`,
    helpMsg: "这个包因为某个依赖版本过时的原因无法出包",
    requireComment: true,
    allowUserModification: { mark: true, unmark: true },
    appendTimeComment: false, // must be false for auto-unmark by pkgname to work properly
    triggers: [],
  },
  stuck: {
    desc: i18n`无进展`,
    helpMsg: "这个包处理起来非常棘手，短时间内无法修复",
    requireComment: true,
    allowUserModification: { mark: true, unmark: true },
    appendTimeComment: false,
    triggers: [],
  },
  noqemu: {
    desc: i18n`仅在板子上编译成功`,
    helpMsg: "这个包仅在 qemu-user 环境里构建失败",
    requireComment: false,
    allowUserModification: { mark: true, unmark: true },
    appendTimeComment: false,
    triggers: [],
  },
  ready: {
    desc: i18n`无需操作即可从上游编译`,
    helpMsg: "可以直接出包。注意：打了 patch 之后才能出包的不适用本标记。",
    requireComment: false,
    allowUserModification: { mark: true, unmark: true },
    appendTimeComment: true,
    triggers: [
      { name: "failing", op: "unmark", when: "mark" },
      { name: "flaky", op: "unmark", when: "mark" },
    ],
  },
  ignore: {
    desc: i18n`不适用于 riscv64`,
    helpMsg: "该包对 riscv64 无意义。",
    requireComment: false,
    allowUserModification: { mark: true, unmark: true },
    appendTimeComment: false,
    triggers: [
      { name: "failing", op: "unmark", when: "mark" },
      { name: "flaky", op: "unmark", when: "mark" },
      { name: "ready", op: "unmark", when: "mark" },
      { name: "missing_dep", op: "unmark", when: "mark" },
      { name: "outdated_dep", op: "unmark", when: "mark" },
      { name: "outdated", op: "unmark", when: "mark" },
      { name: "noqemu", op: "unmark", when: "mark" },
    ],
  },
  missing_dep: {
    desc: i18n`缺少依赖`,
    helpMsg: "这个包的依赖目前缺失，导致无法出包",
    requireComment: true,
    allowUserModification: { mark: true, unmark: true },
    appendTimeComment: false, // must be false for auto-unmark by pkgname to work properly
    triggers: [],
  },
  flaky: {
    desc: i18n`概率性编译失败`,
    helpMsg: "这个包可能需要多次打包才能成功",
    requireComment: true,
    allowUserModification: { mark: true, unmark: true },
    appendTimeComment: false,
    triggers: [{ name: "ready", op: "unmark", when: "mark" }],
  },
  failing: {
    desc: i18n`无法出包`,
    helpMsg: "CI/CD 报告称这个包编译失败，无法出包。注意：不要手动修改此标记。",
    requireComment: false,
    allowUserModification: { mark: false, unmark: false },
    appendTimeComment: true,
    triggers: [{ name: "ready", op: "unmark", when: "mark" }],
  },
  nocheck: {
    desc: i18n`无法通过测试`,
    helpMsg: "需要 --nocheck 才能出包",
    requireComment: true,
    allowUserModification: { mark: true, unmark: true },
    appendTimeComment: true,
    triggers: [],
  },
  important: {
    desc: i18n`重要的包`,
    helpMsg: "这个包是重要的，需要特别关注",
    requireComment: false,
    allowUserModification: { mark: true, unmark: true },
    appendTimeComment: false,
    triggers: [],
  },
};

const MARK_TO_DESC: Record<string, string> = objectMap(MARK_CONFIG, (v) => v.desc);

const MAX_SLEEP_TIME = 2147483647; // to avoid TimeoutOverflowWarning
const TZ = +8; // UTC+8

function objectMap<T, U>(obj: Record<string, T>, fn: (value: T, key?: string, index?: number) => U): Record<string, U> {
  return Object.fromEntries(Object.entries(obj).map(([k, v], i) => [k, fn(v, k, i)]));
}

function sleep(ms: number) {
  if (ms > MAX_SLEEP_TIME) {
    ms = MAX_SLEEP_TIME;
  }
  return new Promise((res) => setTimeout(res, ms));
}

async function storePackageStatus() {
  verb(storePackageStatus);
  await writeFile(__dirname + "/../db/packageStatus.json", JSON.stringify(packageStatus, null, 2));
  await writeFile(__dirname + "/../db/packageStatus.bak.json", JSON.stringify(packageStatus, null, 2));
}

function storePackageStatusSync() {
  verb(storePackageStatusSync);
  fs.writeFileSync(__dirname + "/../db/packageStatus.json", JSON.stringify(packageStatus, null, 2));
  fs.writeFileSync(__dirname + "/../db/packageStatus.bak.json", JSON.stringify(packageStatus, null, 2));
}

async function storePackageMarks() {
  verb(storePackageMarks);
  await writeFile(__dirname + "/../db/packageMarks.json", JSON.stringify(packageMarks, null, 2));
  await writeFile(__dirname + "/../db/packageMarks.bak.json", JSON.stringify(packageMarks, null, 2));
}

function storePackageMarksSync() {
  verb(storePackageMarksSync);
  fs.writeFileSync(__dirname + "/../db/packageMarks.json", JSON.stringify(packageMarks, null, 2));
  fs.writeFileSync(__dirname + "/../db/packageMarks.bak.json", JSON.stringify(packageMarks, null, 2));
}

async function loadPackageStatus() {
  verb(loadPackageStatus);
  packageStatus = _updatePackageStatusSchema((await import("../db/packageStatus.json")).default);
  storePackageStatus();
}

function _updatePackageStatusSchema(oldPackageStatus: OldPackageStatus[]): PackageStatus[] {
  if (oldPackageStatus.length === 0) {
    return [];
  }
  if (
    oldPackageStatus.filter(({ packages }) => {
      // is packages already of PackageInterface[] type?
      return packages.filter((p) => typeof p === "string").length === 0;
    }).length === oldPackageStatus.length
  ) {
    // was converted to new schema before
    oldPackageStatus.forEach((user) => {
      // convert `username?: string | undefined` to `username: string | undefined`
      if (!("username" in user)) user.username = undefined;
    });
    const newPackageStatus = (oldPackageStatus as PackageStatus[]).slice();
    for (const user of newPackageStatus) {
      // remove invalid packages
      user.packages = user.packages.filter((p) => p.name !== "[object Object]");
    }

    return newPackageStatus;
  }
  console.error("invalid oldPackageStatus", oldPackageStatus);
  return oldPackageStatus.map((user) => {
    const ret: PackageStatus = {
      userid: user.userid,
      username: user.username,
      packages: user.packages.map((pkg) => {
        if (typeof pkg !== "string") {
          console.error("Unexpected package type: " + JSON.stringify(pkg));
          throw new TypeError("Unexpected package type: " + JSON.stringify(pkg));
        }
        return { name: pkg, lastActive: Date.now() };
      }),
    };
    return ret;
  });
}

async function loadPackageMarks() {
  verb(loadPackageMarks);
  if (typeof _packageMarksForInit !== "undefined") {
    verb("ERROR: packageMarks is already loaded");
    return;
  }

  _packageMarksForInit = _updatePackageMarkSchema((await import("../db/packageMarks.json")).default);
  process.nextTick(() => {
    // wait for `const packageMarks = _packageMarksForInit;`
    storePackageMarksSync();
  });
}

function _updatePackageMarkSchema(oldPackageMarks: OldPackageMark[]) {
  return oldPackageMarks.map((oldPackageMark) => {
    const ret: PackageMark = { name: oldPackageMark.name, marks: [] };
    const marks = oldPackageMark.marks;
    for (const mark of marks) {
      if (typeof mark === "string") {
        ret.marks.push({ name: mark, by: null, comment: "" });
      } else if (typeof mark.comment !== "string") {
        mark.comment = "";
        ret.marks.push(mark as MarkRecord);
      } else {
        ret.marks.push(mark as MarkRecord);
      }
    }
    return ret;
  });
}

async function loadAlias() {
  verb(loadAlias);
  // async require
  const _aliasMap: Record<string, string> = (await import("../config/alias.json")).default;
  for (const uid in _aliasMap) {
    if (_aliasMap.hasOwnProperty(uid)) {
      aliasMap[uid] = _aliasMap[uid];
    }
  }
}

function getMarkConfig(markName: string) {
  if (!MARK_CONFIG.hasOwnProperty(markName)) {
    return null;
  }
  return MARK_CONFIG[markName];
}

function getAvailableMarks() {
  return Object.keys(MARK_CONFIG);
}

function getAlias(uid: number) {
  if (typeof uid !== "number") {
    return "invalid uid";
  }
  if (typeof aliasMap[uid] === "string") {
    return aliasMap[uid];
  }
  return "uid=" + uid;
}

function getUserIdByAlias(alias: string) {
  for (const uid in aliasMap) {
    if (aliasMap[uid] === alias) {
      return Number(uid);
    }
  }
  verb(getUserIdByAlias, "failed to find uid for alias", alias);
  if (process.env["BOT_ID"]) return Number(process.env["BOT_ID"]);
  else return 0;
}

function findUserIdByPackage(pkgname: string): number | null {
  const result = packageStatus.filter((user) => user.packages.some((existingPkg) => existingPkg.name === pkgname));
  if (result.length === 0) return null;
  return result[0].userid;
}

function findPackageMarksByMarkName(mark: string) {
  // prune empty entries. Not doing real work, thus we can save it later
  inplaceFilter(packageMarks, (pkg) => pkg.marks.length > 0);

  return packageMarks.filter((pkg) => pkg.marks.some((markObj) => markObj.name === mark));
}

function getPackageMarksByPkgname(pkgname: string) {
  // prune empty entries. Not doing real work, thus we can save it later
  inplaceFilter(packageMarks, (pkg) => pkg.marks.length > 0);

  const pkgObj = packageMarks.find((pkg) => pkg.name === pkgname);
  if (!pkgObj) return [];
  return pkgObj.marks;
}

function getPackageMarkNamesByPkgname(pkgname: string) {
  return getPackageMarksByPkgname(pkgname).map((mark) => mark.name);
}

function findPackageMarksByComment(comment: string) {
  // prune empty entries. Not doing real work, thus we can save it later
  inplaceFilter(packageMarks, (pkg) => pkg.marks.length > 0);

  return packageMarks.filter((pkg) =>
    pkg.marks.some((markObj) => {
      const markCommentLower = markObj.comment.toLowerCase();
      return markCommentLower.includes(comment.toLowerCase());
    })
  );
}

function findPackageMarksByMarkNamesAndComment(markNames: string[], comment: string) {
  // prune empty entries. Not doing real work, thus we can save it later
  inplaceFilter(packageMarks, (pkg) => pkg.marks.length > 0);

  return packageMarks.filter((pkg) =>
    pkg.marks.some((markObj) => {
      const markCommentLower = markObj.comment.toLowerCase();
      return markNames.includes(markObj.name) && markCommentLower.includes(comment.toLowerCase());
    })
  );
}

function getTodayTimestamp() {
  const now = Date.now();
  const extra = (now + TZ * 3600 * 1e3) % (24 * 3600 * 1e3);
  return now - extra;
}

//  ------------ initialize cache ------------- //

function getMsgLink(options: GetMessageLinkOptions) {
  const chatUserName = options.chatUserName;
  let msgLinkBase = `https://t.me/${chatUserName}`;
  if (!chatUserName) {
    // in this case, we have to locate a chat's message by its chatId
    msgLinkBase = `https://t.me/c/${String(options.chatId).replace("-100", "")}`;
  }
  return `${msgLinkBase}/${options.msgId}`;
}

function getMentionLink(
  uid: string | number,
  username: string,
  firstName: string = "",
  lastName: string = "",
  tag: boolean = false
) {
  let userDisplayName = "@" + username;
  if (!username) {
    // see https://core.telegram.org/bots/api#markdownv2-style
    userDisplayName = toSafeMd(`${firstName} ${lastName}`);
    userDisplayName = userDisplayName.trimEnd();
  } else {
    userDisplayName = toSafeMd(userDisplayName);
  }
  if (tag) {
    return `[${userDisplayName}\u200B](tg://user?id=${uid})`;
  }
  return `[${userDisplayName}](tg://user?id=${uid})`;
}

function getErrorLogDirLink(pkgname: string) {
  return BASE_LOG_DIR.replace("{pkgname}", pkgname);
}

function getErrorLogDirLinkMd(pkgname: string, unsafeMdText: string) {
  const safeMdText = toSafeMd(unsafeMdText);
  if (!BASE_LOG_DIR) return safeMdText;
  return `[${safeMdText}](${getErrorLogDirLink(pkgname)})`;
}

function getArrayXYSize(arr: any[][]): [number, number] {
  const sizeX = arr.length;
  let sizeY;
  for (const elem of arr) {
    if (!Array.isArray(elem)) {
      return [sizeX, NaN];
    }
    if (sizeY === undefined) {
      sizeY = elem.length;
    } else if (sizeY !== elem.length) {
      return [sizeX, NaN];
    }
  }
  return [sizeX, sizeY];
}

function toSafeMd(unsafeMd: string | number) {
  unsafeMd = String(unsafeMd);
  // see https://core.telegram.org/bots/api#markdownv2-style
  // eslint-disable-next-line no-useless-escape
  return unsafeMd.replace(/([[\]()_*~`>#+\-=|{}\.!\\])/g, "\\$1");
}

/**
 * @param {TemplateStringsArray} unsafeMdArr unsafe markdown v2 texts
 * @param {any[]} safeMdArr
 * @description Use this with template strings. ```_safemd`unsafe ${"safe"} unsafe2}` ```
 */
function _safemd(unsafeMdArr: TemplateStringsArray, ...safeMdArr: any[]) {
  safeMdArr = safeMdArr.map((safeMd) => String(safeMd));
  // see https://core.telegram.org/bots/api#markdownv2-style
  // eslint-disable-next-line no-useless-escape
  const escapedMdArr = unsafeMdArr.map((unsafeMd) => unsafeMd.replace(/([[\]()_*~`>#+\-=|{}\.!\\])/g, "\\$1"));
  let result = "";
  for (let i = 0; i < safeMdArr.length; i++) {
    result += escapedMdArr[i];
    result += safeMdArr[i];
  }
  result += escapedMdArr[escapedMdArr.length - 1];
  return result;
}

/**
 * @param {string} unsafeCode unsafe markdown v2 code
 * @returns {string} safe code without backquotes
 */
function toSafeCode(unsafeCode: string): string {
  return unsafeCode.replace(/([`\\])/g, "\\$1");
}

/**
 * @param {string} unsafeCode unsafe markdown v2 code
 * @returns {string} safe code with backquotes
 */
function wrapCode(unsafeCode: string): string {
  return `\`${toSafeCode(unsafeCode)}\``;
}

function readableFileSize(bytes: number) {
  if (bytes > Number.MAX_SAFE_INTEGER) {
    return "This file's size (as bytes) has exceeded the MAX_SAFE_INTEGER limitation of float64.";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let result = "";
  for (let i = units.length - 1; i >= 0; i--) {
    if (bytes >= 1024 ** i) {
      result += ~~(bytes / 1024 ** i);
      result += `${units[i]} `;
      bytes %= 1024 ** i;
    }
  }
  return result.trim();
}

async function cleanup(filePath: string, complain = true) {
  verb(cleanup, "attempting to unlink", filePath.replace(__dirname, "."));
  if (!/\.(mp4|tgs|webp|gif)$/i.test(filePath)) return;
  try {
    await unlink(filePath);
  } catch (err) {
    if (complain) verb(cleanup, err);
  }
}

function marksToStringArr(marks: MarkRecord[]): string[] {
  if (marks.length === 0) return [];

  const result: string[] = [];
  for (const mark of marks) {
    result.push(markToStringWithSource(mark));
  }
  return result;
}

function markToString(mark: string): string {
  if (!mark) return toSafeMd(`(# ${MARK_TO_DESC["unknown"]})`);
  if (mark in MARK_TO_DESC && typeof MARK_TO_DESC[mark] === "string") {
    return toSafeMd(`(#${mark} ${MARK_TO_DESC[mark]})`);
  } else {
    return toSafeMd(`(#${mark} ${MARK_TO_DESC["unknown"]})`);
  }
}

/**
 * @returns {string} MarkdownV2-safe string
 */
function markToStringWithSource(mark: MarkRecord): string {
  const alias = mark.by ? toSafeMd(mark.by.alias) : "null";
  const safeComment = mark.comment ? toSafeMd(" “" + mark.comment + "”") : "";
  if (!mark.name) return _safemd`(# ${toSafeMd(MARK_TO_DESC["unknown"])} by ${alias})`;
  if (mark.name in MARK_TO_DESC && typeof MARK_TO_DESC[mark.name] === "string") {
    return _safemd`(#${toSafeMd(mark.name)} ${toSafeMd(MARK_TO_DESC[mark.name])}${safeComment} by ${alias})`;
  } else {
    return _safemd`(#${toSafeMd(mark.name)} ${toSafeMd(MARK_TO_DESC["unknown"])}${safeComment} by ${alias})`;
  }
}

function addIndent(str: string, tabSize: number = 2) {
  const lines = str.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    lines[i] = " ".repeat(tabSize) + lines[i];
  }
  return lines.join("\n");
}

/**
 * @param {string} str should be a multiple-line string
 * @param {number} splitAt
 * @param {string} [inlineDelimiter]
 */
function forceResplitLines(str: string, splitAt: number, inlineDelimiter: string = " ") {
  const lines = str.split(/\r?\n/);
  let result = "";
  for (let i = 0; i < lines.length; i++) {
    result += lines[i];
    if ((i + 1) % splitAt === 0) {
      // we don't add additional newlines at the end of `str`
      if (i + 1 != lines.length) {
        result += "\n";
      }
    } else {
      result += inlineDelimiter;
    }
  }
  return result;
}

function type(value: any): string {
  return {}.toString.call(value).slice(8, -1).toLowerCase();
}

function strcmp(a: string, b: string): number {
  if (a < b) return -1;
  else if (a > b) return 1;
  return 0;
}

function sha512hex(text: string) {
  const hashInstance = crypto.createHash("sha512");
  const hashResult = hashInstance.update(text, "utf8");
  return hashResult.digest("hex");
}

/**
 * @description 注意！keywords 不会被 escape，不要有特殊字符
 * @param {string[]} keywords
 */
function kwd2regexp(keywords: string[], flags = "i") {
  for (const keyword of keywords) {
    assert(
      /^[a-z0-9\u4e00-\u9FFF\u3400-\u4dbf\u{20000}-\u{2a6df}\u{2a700}-\u{2b73f}\u{2b740}-\u{2b81f}\u{2b820}-\u{2ceaf}\uf900-\ufaff\u3300-\u33ff\ufe30-\ufe4f\uf900-\ufaff\u{2f800}-\u{2fa1f}，《》\.\+]+$/iu.test(
        keyword
      )
    );
  }
  return new RegExp(`(${keywords.join("|")})`, flags);
}

/**
 * @description 注意！keywords 不会被 escape，不要有特殊字符
 * @param {string[]} keywords
 */
function fullKwd2regexp(keywords: string[], flags = "i") {
  for (const keyword of keywords) {
    assert(
      /^[a-z0-9\u4e00-\u9FFF\u3400-\u4dbf\u{20000}-\u{2a6df}\u{2a700}-\u{2b73f}\u{2b740}-\u{2b81f}\u{2b820}-\u{2ceaf}\uf900-\ufaff\u3300-\u33ff\ufe30-\ufe4f\uf900-\ufaff\u{2f800}-\u{2fa1f}，《》]+$/iu.test(
        keyword
      )
    );
  }
  return new RegExp(`^(${keywords.join("|")})$`, flags);
}

function stripPackageStatus(status: PackageStatus[]) {
  const ret: StrippedPackageStatus[] = [];
  for (const user of status) {
    ret.push({
      alias: getAlias(user.userid),
      packages: user.packages.map((pkg) => pkg.name),
    });
  }
  return ret;
}

function stripPackageMarks(status: PackageMark[]) {
  const ret: StrippedPackageMark[] = [];
  for (const pkg of status) {
    ret.push({
      name: pkg.name,
      marks: pkg.marks.map((mark) => {
        const strippedMark = {
          name: mark.name,
          by: {
            alias: mark.by ? mark.by.alias : "null",
          },
          comment: mark.comment,
        };
        return strippedMark;
      }),
    });
  }
  return ret;
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

function equal<T, U>(a: T, b: U): T extends U ? (U extends T ? boolean : false) : false {
  return _equal(a, b, {
    strict: true,
  }) as any;
}

const deferMap: Record<string, Function[]> = Object.create(null);
const deferredKeys: string[] = [];

const defer = {
  async add(key: string, func: Function) {
    verb("defer:", "adding", func, "to key", key);
    if (deferredKeys.includes(key)) {
      await func();
      verb("defer:", "resolved", func, "from already used key", key);
      return;
    }
    if (deferMap[key]) {
      deferMap[key].push(func);
    } else {
      deferMap[key] = [func];
    }
  },
  async resolve(key: string) {
    deferredKeys.push(key);
    if (!deferMap[key]) return;
    for (const func of deferMap[key]) {
      await func(); // preserve the original order
      verb("defer:", "resolved", func, "from key", key);
    }
    deferMap[key] = undefined;
  },
};

function getCurrentTimeStr() {
  return (
    new Date().toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour12: false,
    }) + " (UTC+8)"
  );
}

function inplaceFilter<T>(arr: Array<T>, cond: (element: T) => boolean): Array<T> {
  if (!Array.isArray(arr)) return arr;
  if (typeof cond !== "function") return arr;

  let nextPos = 0;

  for (const el of arr) {
    if (cond(el)) arr[nextPos++] = el;
  }
  arr.splice(nextPos);
  return arr;
}

export default {
  MARK_TO_DESC,
  packageStatus,
  packageMarks,
  defer,
  equal,
  _safemd,
  addIndent,
  marksToStringArr,
  markToString,
  markToStringWithSource,
  findUserIdByPackage,
  getPackageMarksByPkgname,
  getPackageMarkNamesByPkgname,
  findPackageMarksByComment,
  findPackageMarksByMarkName,
  findPackageMarksByMarkNamesAndComment,
  forceResplitLines,
  loadAlias,
  storePackageStatus,
  storePackageStatusSync,
  storePackageMarks,
  storePackageMarksSync,
  getTodayTimestamp,
  getCurrentTimeStr,
  getMarkConfig,
  getAvailableMarks,
  getAlias,
  getUserIdByAlias,
  getMsgLink,
  getMentionLink,
  getErrorLogDirLinkMd,
  getArrayXYSize,
  sha512hex,
  toSafeMd,
  toSafeCode,
  wrapCode,
  readableFileSize,
  cleanup,
  sleep,
  type,
  strcmp,
  kwd2regexp,
  fullKwd2regexp,
  escapeRegExp,
  stripPackageStatus,
  stripPackageMarks,
};
