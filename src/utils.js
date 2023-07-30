// @ts-check
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const _equal = require("deep-equal");
const fs = require("fs");
const { readFile } = require("fs/promises");
const { promisify } = require("util");
const unlink = promisify(fs.unlink);
const writeFile = promisify(fs.writeFile);

const verb = require("./_verbose");

const BASE_LOG_DIR = process.env["PLCT_BASE_LOG_DIR"] || "";

/**
 * @typedef PackageInterface
 * @prop {string} name
 * @prop {number} lastActive
 */

/**
 * @type {{
    userid: number;
    username: string | undefined;
    packages: PackageInterface[];
  }[]}
 */
let packageStatus = [];

/**
 * @type { {
    name: string;
    marks: {
      name: string;
      by: {
        url: string;
        uid: number;
        alias: string;
      } | null;
      comment: string;
    }[];
  }[] }
 */
let _packageMarksForInit;

loadPackageMarks();
// In order to keep refs in plct-archrv-bot.js, this variable should never be assigned again.
const packageMarks = _packageMarksForInit;

/**
 * @type {Record<string, string>}
 */
const aliasMap = {};

/**
 * @type {Record<string, {
      desc: string;
      helpMsg: string;
      requireComment: boolean;
      allowUserModification: { mark: boolean; unmark: boolean; };
      appendTimeComment: boolean;
      triggers: { name: string, op: "mark" | "unmark", when: "mark" | "unmark" }[];
    }>}
 */
const MARK_CONFIG = {
  unknown: {
    desc: "特殊状态，请咨询认领人",
    helpMsg: "这个包还有未知的问题没解决，在其他 tag 都不适用的情况下用。使用时要记得补充说明",
    requireComment: true,
    allowUserModification: { mark: true, unmark: true },
    appendTimeComment: false,
    triggers: [],
  },
  upstreamed: {
    desc: "等待上游",
    helpMsg: "需要等上游修复，可以是包自己的上游，也可以是 Arch Linux x86_64 上游",
    requireComment: true,
    allowUserModification: { mark: true, unmark: true },
    appendTimeComment: false,
    triggers: [],
  },
  outdated: {
    desc: "需要滚版本",
    helpMsg: "这个包因为版本过时的原因无法出包",
    requireComment: false,
    allowUserModification: { mark: true, unmark: true },
    appendTimeComment: false, // must be false for auto-unmark by pkgname to work properly
    triggers: [],
  },
  outdated_dep: {
    desc: "需要滚依赖版本",
    helpMsg: "这个包因为某个依赖版本过时的原因无法出包",
    requireComment: true,
    allowUserModification: { mark: true, unmark: true },
    appendTimeComment: false, // must be false for auto-unmark by pkgname to work properly
    triggers: [],
  },
  stuck: {
    desc: "无进展",
    helpMsg: "这个包处理起来非常棘手，短时间内无法修复",
    requireComment: true,
    allowUserModification: { mark: true, unmark: true },
    appendTimeComment: false,
    triggers: [],
  },
  noqemu: {
    desc: "仅在板子上编译成功",
    helpMsg: "这个包仅在 qemu-user 环境里构建失败",
    requireComment: false,
    allowUserModification: { mark: true, unmark: true },
    appendTimeComment: false,
    triggers: [],
  },
  ready: {
    desc: "无需操作即可从上游编译",
    helpMsg: "可以直接出包。注意：打了 patch 之后才能出包的不适用本标记。",
    requireComment: false,
    allowUserModification: { mark: true, unmark: true },
    appendTimeComment: true,
    triggers: [
      { name: "failing",      op: "unmark", when: "mark" },
      { name: "flaky",        op: "unmark", when: "mark" },
    ],
  },
  ignore: {
    desc: "不适用于 riscv64",
    helpMsg: "该包对 riscv64 无意义。",
    requireComment: false,
    allowUserModification: { mark: true, unmark: true },
    appendTimeComment: false,
    triggers: [
      { name: "failing",      op: "unmark", when: "mark" },
      { name: "flaky",        op: "unmark", when: "mark" },
      { name: "ready",        op: "unmark", when: "mark" },
      { name: "missing_dep",  op: "unmark", when: "mark" },
      { name: "outdated_dep", op: "unmark", when: "mark" },
      { name: "outdated",     op: "unmark", when: "mark" },
      { name: "noqemu",       op: "unmark", when: "mark" },
    ],
  },
  missing_dep: {
    desc: "缺少依赖",
    helpMsg: "这个包的依赖目前缺失，导致无法出包",
    requireComment: true,
    allowUserModification: { mark: true, unmark: true },
    appendTimeComment: false, // must be false for auto-unmark by pkgname to work properly
    triggers: [],
  },
  flaky: {
    desc: "概率性编译失败",
    helpMsg: "这个包可能需要多次打包才能成功",
    requireComment: true,
    allowUserModification: { mark: true, unmark: true },
    appendTimeComment: false,
    triggers: [
      { name: "ready",        op: "unmark", when: "mark" },
    ],
  },
  failing: {
    desc: "无法出包",
    helpMsg: "CI/CD 报告称这个包编译失败，无法出包。注意：不要手动修改此标记。",
    requireComment: false,
    allowUserModification: { mark: false, unmark: false },
    appendTimeComment: true,
    triggers: [
      { name: "ready",        op: "unmark", when: "mark" },
    ],
  },
  nocheck: {
    desc: "无法通过测试",
    helpMsg: "需要 --nocheck 才能出包",
    requireComment: true,
    allowUserModification: { mark: true, unmark: true },
    appendTimeComment: true,
    triggers: [],
  }
};

/**
 * @type {Record<string, string>}
 */
const MARK2STR = objectMap(MARK_CONFIG, v => v.desc);

const MAX_SLEEP_TIME = 2147483647;  // to avoid TimeoutOverflowWarning
const TZ = +8;  // UTC+8


/**
 * @template T
 * @template U
 * @param {Record<string, T>} obj
 * @param {(value: T, key?: string, index?: number) => U} fn
 * @returns {Record<string, U>}
 */
function objectMap(obj, fn) {
  return Object.fromEntries(
    Object.entries(obj).map(
      ([k, v], i) => [k, fn(v, k, i)]
    )
  );
}

/**
 * @param {number} ms
 */
function sleep(ms) {
  if(ms > MAX_SLEEP_TIME) {
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

function loadPackageStatus() {
  verb(loadPackageStatus);
  try {
    packageStatus = _updatePackageStatusSchema(require("../db/packageStatus.json"));
  } catch(e) {
    verb(loadPackageStatus, e);
    try {
      packageStatus = _updatePackageStatusSchema(require("../db/packageStatus.bak.json"));
    } catch(e) {
      verb(loadPackageStatus, e);
      packageStatus = [];
      storePackageStatus();
    }
  }
}
loadPackageStatus();

/**
 * @param {{
      userid: number;
      username: string | undefined;
      packages: (string | PackageInterface)[];
    }[]} oldPackageStatus
    @return {{
        userid: number;
        username: string | undefined;
        packages: PackageInterface[];
    }[]}
 */
function _updatePackageStatusSchema(oldPackageStatus) {
  if(oldPackageStatus.length === 0) {
    return [];
  }
  if(oldPackageStatus.filter(({ packages }) => {
    // is packages already of PackageInterface[] type?
    return packages.length === 0 || packages.filter(p => typeof p === "string").length === 0;
  }).length === 0) {
    // was converted to new schema before
    // @ts-ignore
    return oldPackageStatus.slice();
  }
  return oldPackageStatus.map(user => {
    /**
     * @type {{
        userid: number;
        username: string | undefined;
        packages: PackageInterface[];
      }}
     */
    const ret = {
      userid: user.userid,
      username: user.username,
      packages: user.packages.map(pkg => {
        if(typeof pkg !== "string") {
          throw new Error("Unexpected package type: " + JSON.stringify(pkg));
        }
        return { name: pkg, lastActive: Date.now() };
      }),
    };
    return ret;
  });
}

function loadPackageMarks() {
  verb(loadPackageMarks);
  if(typeof _packageMarksForInit !== "undefined") {
    verb("ERROR: packageMarks is already loaded");
    return;
  }
  try {
    _packageMarksForInit = _updatePackageMarkSchema(require("../db/packageMarks.json"));
  } catch(e) {
    verb(loadPackageMarks, e);
    try {
      _packageMarksForInit = _updatePackageMarkSchema(require("../db/packageMarks.bak.json"));
    } catch(e) {
      verb(loadPackageMarks, e);
      _packageMarksForInit = [];
      storePackageMarks();
    }
  }
}

/**
 * @param {{
    name: string;
    marks: string[] | {
      name: string;
      by: {
        url: string;
        uid: number;
        alias: string;
      } | null;
      comment: string;
    }[];
  }[]} oldPackageMarks
 */
function _updatePackageMarkSchema(oldPackageMarks) {
  return oldPackageMarks.map(oldPackageMark => {
    /**
     * @type {{ name: string; marks: {
        name: string;
        by: {
          url: string;
          uid: number;
          alias: string;
        } | null;
        comment: string;
      }[]; }}
     */
    const ret = { name: oldPackageMark.name, marks: [] };
    const marks = oldPackageMark.marks;
    for(const mark of marks) {
      if(typeof mark === "string") {
        ret.marks.push({ name: mark, by: null, comment: "" });
      } else if(typeof mark.comment !== "string") {
        mark.comment = "";
        ret.marks.push(mark);
      } else {
        ret.marks.push(mark);
      }
    }
    return ret;
  });
}

async function loadAlias() {
  verb(loadAlias);
  try {
    /**
     * @type {Record<string, string>}
     */
    // async require
    const _aliasMap = JSON.parse(await readFile(__dirname + "/../config/alias.json", "utf8"));
    for(const uid in _aliasMap) {
      if(_aliasMap.hasOwnProperty(uid)) {
        aliasMap[uid] = _aliasMap[uid];
      }
    }
  } catch(e) {
    verb(loadAlias, e.message);
  }
}
loadAlias();

/**
 * @param {string} markName
 */
function getMarkConfig(markName) {
  if(!MARK_CONFIG.hasOwnProperty(markName)) {
    return null;
  }
  return MARK_CONFIG[markName];
}

function getAvailableMarks() {
  return Object.keys(MARK_CONFIG);
}

/**
 * @param {number} uid
 */
function getAlias(uid) {
  if(typeof uid !== "number") {
    return "invalid uid";
  }
  if(typeof aliasMap[uid] === "string") {
    return aliasMap[uid];
  }
  return "uid=" + uid;
}

/**
 * @param {string} alias
 */
function getUserIdByAlias(alias) {
  for(const uid in aliasMap) {
    if(aliasMap[uid] === alias) {
      return Number(uid);
    }
  }
  verb(getUserIdByAlias, "failed to find uid for alias", alias);
  if(process.env["BOT_ID"]) return Number(process.env["BOT_ID"]);
  else return 0;
}

/**
 * @param {string} pkgname
 * @returns {number | null}
 */
 function findUserIdByPackage(pkgname) {
  const result = packageStatus.filter(user => user.packages.some(existingPkg => existingPkg.name === pkgname));
  if(result.length === 0) return null;
  return result[0].userid;
}

/**
 * @param {string} mark
 */
function findPackageMarksByMarkName(mark) {
  // prune empty entries. Not doing real work, thus we can save it later
  inplaceFilter(packageMarks, pkg => pkg.marks.length > 0);

  return packageMarks.filter(pkg => pkg.marks.some(markObj => markObj.name === mark));
}

/**
 * @param {string} pkgname
 */
 function getPackageMarksByPkgname(pkgname) {
  // prune empty entries. Not doing real work, thus we can save it later
  inplaceFilter(packageMarks, pkg => pkg.marks.length > 0);

  const pkgObj = packageMarks.find(pkg => pkg.name === pkgname);
  if(!pkgObj) return [];
  return pkgObj.marks;
}

/**
 * @param {string} pkgname
 */
 function getPackageMarkNamesByPkgname(pkgname) {
  return getPackageMarksByPkgname(pkgname).map(mark => mark.name);
}

/**
 * @param {string} comment
 */
function findPackageMarksByComment(comment) {
  // prune empty entries. Not doing real work, thus we can save it later
  inplaceFilter(packageMarks, pkg => pkg.marks.length > 0);

  return packageMarks.filter(pkg => pkg.marks.some(markObj => {
    const markCommentLower = markObj.comment.toLowerCase();
    return markCommentLower.includes(comment.toLowerCase());
  }));
}

/**
 * @param {string[]} markNames
 * @param {string} comment
 */
function findPackageMarksByMarkNamesAndComment(markNames, comment) {
  // prune empty entries. Not doing real work, thus we can save it later
  inplaceFilter(packageMarks, pkg => pkg.marks.length > 0);

  return packageMarks.filter(pkg => pkg.marks.some(markObj => {
    const markCommentLower = markObj.comment.toLowerCase();
    return markNames.includes(markObj.name) && markCommentLower.includes(comment.toLowerCase());
  }));
}

function getTodayTimestamp() {
  const now = Date.now();
  const extra = (now + TZ * 3600 * 1e3) % (24 * 3600 * 1e3);
  return now - extra;
}

//  ------------ initialize cache ------------- //

/**
 * @param {{
    chatUserName?: string;
    chatId?: string | number;
    msgId: string | number;
  }} options
 */
function getMsgLink(options) {
  const chatUserName = options.chatUserName;
  let msgLinkBase = `https://t.me/${chatUserName}`;
  if(!chatUserName) {
    // in this case, we have to locate a chat's message by its chatId
    msgLinkBase = `https://t.me/c/${String(options.chatId).replace("-100", "")}`;
  }
  return `${msgLinkBase}/${options.msgId}`;
}

/**
 * @param {string | number} uid
 * @param {string} [username]
 * @param {string} [firstName]
 * @param {string} [lastName]
 * @param {boolean} [tag]
 */
function getMentionLink(uid, username, firstName = "", lastName = "", tag = false) {
  let userDisplayName = "@" + username;
  if(!username) {
    // see https://core.telegram.org/bots/api#markdownv2-style
    userDisplayName = toSafeMd(`${firstName} ${lastName}`);
    userDisplayName = userDisplayName.trimEnd();
  } else {
    userDisplayName = toSafeMd(userDisplayName);
  }
  if(tag) {
    return `[${userDisplayName}\u200B](tg://user?id=${uid})`;
  }
  return `[${userDisplayName}](tg://user?id=${uid})`;
}

/**
 * @param {string} pkgname
 */
function getErrorLogDirLink(pkgname) {
  return BASE_LOG_DIR.replace("{pkgname}", pkgname);
}

/**
 * @param {string} pkgname
 * @param {string} unsafeMdText
 */
function getErrorLogDirLinkMd(pkgname, unsafeMdText) {
  const safeMdText = toSafeMd(unsafeMdText);
  if(!BASE_LOG_DIR) return safeMdText;
  return `[${safeMdText}](${getErrorLogDirLink(pkgname)})`;
}

/**
 * @param {any[][]} arr
 * @returns {[number, number]}
 */
function getArrayXYSize(arr) {
  const sizeX = arr.length;
  let sizeY;
  for(const elem of arr) {
    if(!Array.isArray(elem)) {
      return [sizeX, NaN];
    }
    if(sizeY === undefined) {
      sizeY = elem.length;
    } else if(sizeY !== elem.length) {
      return [sizeX, NaN];
    }
  }
  return [sizeX, sizeY];
}

/**
 * @param {string | number} unsafeMd unsafe markdown v2 text
 */
function toSafeMd(unsafeMd) {
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
function _safemd(unsafeMdArr, ...safeMdArr) {
  safeMdArr = safeMdArr.map(safeMd => String(safeMd));
  // see https://core.telegram.org/bots/api#markdownv2-style
  // eslint-disable-next-line no-useless-escape
  const escapedMdArr = unsafeMdArr.map(unsafeMd => unsafeMd.replace(/([[\]()_*~`>#+\-=|{}\.!\\])/g, "\\$1"));
  let result = "";
  for(let i = 0; i < safeMdArr.length; i++) {
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
function toSafeCode(unsafeCode) {
  return unsafeCode.replace(/([`\\])/g, "\\$1");
}

/**
 * @param {string} unsafeCode unsafe markdown v2 code
 * @returns {string} safe code with backquotes
 */
function wrapCode(unsafeCode) {
  return `\`${toSafeCode(unsafeCode)}\``;
}

/**
 * @param {number} bytes
 */
function readableFileSize(bytes) {
  if(bytes > Number.MAX_SAFE_INTEGER) {
    return "This file's size (as bytes) has exceeded the MAX_SAFE_INTEGER limitation of float64.";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let result = "";
  for(let i = units.length - 1; i >= 0; i--) {
    if(bytes >= 1024 ** i) {
      result += ~~(bytes / (1024 ** i));
      result += `${units[i]} `;
      bytes %= 1024 ** i;
    }
  }
  return result.trim();
}


/**
 * @param {string} filePath
 */
async function cleanup(filePath, complain = true) {
  verb(cleanup, "attempting to unlink", filePath.replace(__dirname, "."));
  if(!/\.(mp4|tgs|webp|gif)$/i.test(filePath)) return;
  try {
    await unlink(filePath);
  } catch (err) {
    if(complain)
      verb(cleanup, err);
  }
}

/**
 * @param {{ name: string; by: {
    url: string;
    uid: number;
    alias: string;
  } | null; comment: string; }[]} marks
 * @returns {string[]}
 */
function marksToStringArr(marks) {
  if(marks.length === 0) return [];
  /**
   * @type {string[]}
   */
  const result = [];
  for(const mark of marks) {
    result.push(markToStringWithSource(mark));
  }
  return result;
}

/**
 * @param {string} mark
 * @returns {string}
 */
function markToString(mark) {
  if(!mark) return toSafeMd(`(# ${MARK2STR["unknown"]})`);
  if(mark in MARK2STR && typeof MARK2STR[mark] === "string") {
    return toSafeMd(`(#${mark} ${MARK2STR[mark]})`);
  } else {
    return toSafeMd(`(#${mark} ${MARK2STR["unknown"]})`);
  }
}

/**
 * @param {{ name: string; by: {
    url: string;
    uid: number;
    alias: string;
  } | null; comment: string; }} mark
 * @returns {string} MarkdownV2-safe string
 */
function markToStringWithSource(mark) {
  const alias = mark.by ? toSafeMd(mark.by.alias) : "null";
  const safeComment = mark.comment ? toSafeMd(" “" + mark.comment + "”") : "";
  if(!mark.name) return _safemd`(# ${toSafeMd(MARK2STR["unknown"])} by ${alias})`;
  if(mark.name in MARK2STR && typeof MARK2STR[mark.name] === "string") {
    return _safemd`(#${toSafeMd(mark.name)} ${toSafeMd(MARK2STR[mark.name])}${safeComment} by ${alias})`;
  } else {
    return _safemd`(#${toSafeMd(mark.name)} ${toSafeMd(MARK2STR["unknown"])}${safeComment} by ${alias})`;
  }
}

/**
 * @param {string} str
 * @param {number} [tabSize]
 */
function addIndent(str, tabSize = 2) {
  const lines = str.split(/\r?\n/);
  for(let i = 0; i < lines.length; i++) {
    if(!lines[i].trim()) continue;
    lines[i] = " ".repeat(tabSize) + lines[i];
  }
  return lines.join("\n");
}

/**
 * @param {string} str should be a multiple-line string
 * @param {number} splitAt
 * @param {string} [inlineDelimiter]
 */
function forceResplitLines(str, splitAt, inlineDelimiter = " ") {
  const lines = str.split(/\r?\n/);
  let result = "";
  for(let i = 0; i < lines.length; i++) {
    result += lines[i];
    if((i + 1) % splitAt === 0) {
      // we don't add additional newlines at the end of `str`
      if(i + 1 != lines.length) {
        result += "\n";
      }
    } else {
      result += inlineDelimiter;
    }
  }
  return result;
}

/**
 * @param {any} symbol
 * @returns {string}
 */
function type(symbol) {
  return ({}).toString.call(symbol).slice(8, -1).toLowerCase();
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function strcmp(a, b) {
  if(a < b) return -1;
  else if(a > b) return 1;
  return 0;
}

/**
 * @param {string} text
 */
function sha512hex(text) {
  const hashInstance = crypto.createHash("sha512");
  const hashResult = hashInstance.update(text, "utf8");
  return hashResult.digest("hex");
}


/**
 * @description 注意！keywords 不会被 escape，不要有特殊字符
 * @param {string[]} keywords
 */
function kwd2regexp(keywords, flags = "i") {
  for(const keyword of keywords) {
    assert(/^[a-z0-9\u4e00-\u9FFF\u3400-\u4dbf\u{20000}-\u{2a6df}\u{2a700}-\u{2b73f}\u{2b740}-\u{2b81f}\u{2b820}-\u{2ceaf}\uf900-\ufaff\u3300-\u33ff\ufe30-\ufe4f\uf900-\ufaff\u{2f800}-\u{2fa1f}，《》\.\+]+$/iu.test(keyword));
  }
  return new RegExp(`(${keywords.join("|")})`, flags);
}

/**
 * @description 注意！keywords 不会被 escape，不要有特殊字符
 * @param {string[]} keywords
 */
function fullKwd2regexp(keywords, flags = "i") {
  for(const keyword of keywords) {
    assert(/^[a-z0-9\u4e00-\u9FFF\u3400-\u4dbf\u{20000}-\u{2a6df}\u{2a700}-\u{2b73f}\u{2b740}-\u{2b81f}\u{2b820}-\u{2ceaf}\uf900-\ufaff\u3300-\u33ff\ufe30-\ufe4f\uf900-\ufaff\u{2f800}-\u{2fa1f}，《》]+$/iu.test(keyword));
  }
  return new RegExp(`^(${keywords.join("|")})$`, flags);
}

/**
 * @param {{ userid: number; username: string | undefined; packages: PackageInterface[]; }[]} status
 */
function stripPackageStatus(status) {
  /**
   * @type {{ alias: string; packages: string[]; }[]}
   */
  const ret = [];
  for(const user of status) {
    ret.push({
      alias: getAlias(user.userid),
      packages: user.packages.map(pkg => pkg.name),
    });
  }
  return ret;
}

/**
 * @param { {
    name: string;
    marks: {
      name: string;
      by: {
        url: string;
        uid: number;
        alias: string;
      } | null;
      comment: string;
    }[];
  }[] } status
 */
function stripPackageMarks(status) {
  /**
   * @type { {
    name: string;
    marks: {
      name: string;
      by: {
        alias: string;
      };
      comment: string;
    }[];
  }[] }
   */
  const ret = [];
  for(const pkg of status) {
    ret.push({
      name: pkg.name,
      marks: pkg.marks.map(mark => {
        const strippedMark = {
          name: mark.name,
          by: {
            alias: mark.by ? mark.by.alias : "null"
          },
          comment: mark.comment,
        };
        return strippedMark;
      }),
    });
  }
  return ret;
}

/**
 * @param {string} string
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

/**
 * @param {any} a
 * @param {any} b
 * @returns 
 */
function equal(a, b) {
  return _equal(a, b, {
    strict: true,
  });
}

/**
 * @type {Record<string, Function[]>}
 */
const deferMap = Object.create(null);

/**
 * @type {string[]}
 */
const deferredKeys = [];

const defer = {
  /**
   * @param {string} key
   * @param {Function} func
   */
  async add(key, func) {
    verb("defer:", "adding", func, "to key", key);
    if(deferredKeys.includes(key)) {
      await func();
      verb("defer:", "resolved", func, "from already used key", key);
      return;
    }
    if(deferMap[key]) {
      deferMap[key].push(func);
    } else {
      deferMap[key] = [ func ];
    }
  },
  /**
   * @param {string} key
   */
  async resolve(key) {
    deferredKeys.push(key);
    if(!deferMap[key]) return;
    for(const func of deferMap[key]) {
      await func();  // preserve the original order
      verb("defer:", "resolved", func, "from key", key);
    }
    deferMap[key] = undefined;
  }
};

function getCurrentTimeStr() {
  return new Date().toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  }) + " (UTC+8)";
}

/**
 * @template T
 * @param {Array.<T>} arr
 * @param {(element: T) => boolean} cond
 * @returns {Array.<T>}
 */
function inplaceFilter(arr, cond) {
  if(!Array.isArray(arr)) return arr;
  if(typeof cond !== "function") return arr;

  let nextPos = 0;

  for (const el of arr) {
    if (cond(el)) arr[nextPos++] = el;
  }
  arr.splice(nextPos);
  return arr;
}

module.exports = {
  MARK2STR,
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
