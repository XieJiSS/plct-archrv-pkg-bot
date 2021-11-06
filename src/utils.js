// @ts-check
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const unlink = promisify(fs.unlink);
const writeFile = promisify(fs.writeFile);

const verb = require("./_verbose");

/**
 * @type {{ userid: number; username: string | undefined; packages: string[]; }[]}
 */
let packageStatus = [];
/**
 * @type {{ name: string; marks: string[]; }[]}
 */
let packageMarks = [];
/**
 * @type {Object<string, string>}
 */
const MARK2STR = {
  unknown: "特殊状态，请咨询认领人",
  upstreamed: "等待上游",
  outdated: "需要滚版本",
  outdated_dep: "需要滚依赖版本",
  stuck: "无进展",
  noqemu: "仅在板子上编译成功",
  ready: "无需操作即可从上游编译",
  pending: "已修好但网页上状态仍为 FTBFS",
};

const MAX_SLEEP_TIME = 2147483647;  // to avoid TimeoutOverflowWarning
const TZ = +8;  // UTC+8


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

async function storePackageMarks() {
  verb(storePackageMarks);
  await writeFile(__dirname + "/../db/packageMarks.json", JSON.stringify(packageMarks, null, 2));
  await writeFile(__dirname + "/../db/packageMarks.bak.json", JSON.stringify(packageMarks, null, 2));
}

function loadPackageStatus() {
  verb(loadPackageStatus);
  try {
    packageStatus = require("../db/packageStatus.json");
  } catch(e) {
    try {
      packageStatus = require("../db/packageStatus.bak.json");
    } catch(e) {
      packageStatus = [];
      storePackageStatus();
    }
  }
}
loadPackageStatus();

function loadPackageMarks() {
  verb(loadPackageMarks);
  try {
    packageMarks = require("../db/packageMarks.json");
  } catch(e) {
    try {
      packageMarks = require("../db/packageMarks.bak.json");
    } catch(e) {
      packageMarks = [];
      storePackageMarks();
    }
  }
}
loadPackageMarks();

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
 * @param {string} unsafeCode unsafe markdown v2 code
 */
function toSafeCode(unsafeCode) {
  return unsafeCode.replace(/([`\\])/g, "\\$1");
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
 * @param {string[]} marks
 * @returns {string[]}
 */
 function marksToStringArr(marks) {
  if(marks.length === 0) return [];
  /**
   * @type {string[]}
   */
  const result = [];
  for(const mark of marks) {
    result.push(markToString(mark));
  }
  return result;
}

/**
 * @param {string} mark
 * @returns {string}
 */
 function markToString(mark) {
  if(!mark) return `(# ${MARK2STR["unknown"]})`;
  if(mark in MARK2STR && typeof MARK2STR[mark] === "string") {
    return `(#${mark} ${MARK2STR[mark]})`;
  } else {
    return `(#${mark} ${MARK2STR["unknown"]})`;
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

module.exports = {
  MARK2STR,
  packageStatus,
  packageMarks,
  addIndent,
  marksToStringArr,
  markToString,
  forceResplitLines,
  storePackageStatus,
  storePackageMarks,
  getTodayTimestamp,
  getMsgLink,
  getMentionLink,
  getArrayXYSize,
  sha512hex,
  toSafeMd,
  toSafeCode,
  readableFileSize,
  cleanup,
  sleep,
  type,
  kwd2regexp,
  fullKwd2regexp,
};
