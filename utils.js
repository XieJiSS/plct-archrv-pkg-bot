// @ts-check

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const unlink = promisify(fs.unlink);
const writeFile = promisify(fs.writeFile);

const cache = require("./_timedCache");
const verb = require("./_verbose");

/**
 * @type {Object.<string, string>}
 */
const CHATS_TO_ID = {};
/**
 * @type {Object.<string, {
    delete?: boolean;
    seal?: boolean;
    keywords?: boolean;
    censor?: boolean;
    at?: boolean;
    revert?: boolean;
  }>}
 */
let CHAT_SETTINGS = {};
/**
 * @type {{ userid: number; username: string | undefined; packages: string[]; }[]}
 */
let packageStatus = [];
const HELP_DISPLAY_SEC = 120;
const MAX_SLEEP_TIME = 2147483647 - 60 * 1e3;  // to avoid TimeoutOverflowWarning, with redundancy
let WILL_QUIT_SOON = false;
const TZ = +8;  // UTC+8

let id = 0;

setInterval(() => {
  fs.copyFileSync(path.join(__dirname, "checkin.json"), path.join(__dirname, "../", `checkin-backup-${id++}.json`));
  if(id >= 2) id = 0;
}, 60 * 60 * 1e3);

/**
 * @type {Object<string, Object>}
 */
const symbolMap = {};

/**
 * @param {Function} func
 * @param {string} [name]
 */
function registerFunction(func, name) {
  if(!func.name) {
    if(!name) return;
    symbolMap[name] = func;
  } else {
    symbolMap[func.name] = func;
  }
}
registerFunction(registerFunction);

/**
 * @param {Object} obj
 * @param {string} name
 */
function registerObject(obj, name) {
  if(name) {
    symbolMap[name] = obj;
  }
}
registerFunction(registerObject);

/**
 * @type {string[][]}
 */
const keywords = [];

/**
 *
 * @param {string} kw
 * @param {string} resp
 */
function registerKeyword(kw, resp) {
  if(!kw) return;
  keywords.push([kw, resp]);
}
registerFunction(registerKeyword);

/**
 *
 * @param {string[]} kwList
 * @param {string} resp
 */
function registerKeywordList(kwList, resp) {
  kwList.forEach((kw) => {
    registerKeyword(kw, resp);
  });
}
registerFunction(registerKeywordList);

/**
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}
registerFunction(sleep);

/**
 * @param {string} chatUserName
 * @param {string} chatId
 * @param {boolean} shouldSave true for auto detection
 */
function registerChatId(chatUserName, chatId, shouldSave) {
  if(chatUserName in CHATS_TO_ID) {
    if(CHATS_TO_ID[chatUserName] === chatId) {
      return;
    }
  }
  CHATS_TO_ID[chatUserName] = chatId;
  if(shouldSave && !WILL_QUIT_SOON) {
    saveChatIds();
  }
}
registerFunction(registerChatId);

async function storeCheckinStatus() {
  verb(storeCheckinStatus);
  await writeFile(__dirname + "/checkin.json", JSON.stringify(cache.get("checkin"), null, 2));
}
registerFunction(storeCheckinStatus);

async function storeChatSettings() {
  verb(storeChatSettings);
  await writeFile(__dirname + "/chatSettings.json", JSON.stringify(CHAT_SETTINGS, null, 2));
}
registerFunction(storeChatSettings);

async function storePackageStatus() {
  verb(storePackageStatus);
  await writeFile(__dirname + "/packageStatus.json", JSON.stringify(CHAT_SETTINGS, null, 2));
  await writeFile(__dirname + "/packageStatus.bak.json", JSON.stringify(CHAT_SETTINGS, null, 2));
}
registerFunction(storeChatSettings);

function loadChatSettings() {
  verb(loadChatSettings);
  CHAT_SETTINGS = require("./chatSettings.json");
}
registerFunction(loadChatSettings);

loadChatSettings();
verb("Saved chat settings", CHAT_SETTINGS);

function loadPackageStatus() {
  verb(loadPackageStatus);
  try {
    packageStatus = require("./packageStatus.json");
  } catch(e) {
    try {
      packageStatus = require("./packageStatus.bak.json");
    } catch(e) {
      packageStatus = [];
      storePackageStatus();
    }
  }
}
registerFunction(loadPackageStatus);
loadPackageStatus();

async function saveChatIds() {
  await writeFile(__dirname + "/chats.json", JSON.stringify(CHATS_TO_ID, null, 2));
}
registerFunction(saveChatIds);

function loadChatIds() {
  if(fs.existsSync(__dirname + "/chats.json")) {
    /**
     * @type {Object.<string, string>}
     */
    // @ts-ignore
    const savedChats = require("./chats.json");
    for(let chat in savedChats) {
      if(typeof savedChats[chat] !== "string") {
        throw TypeError("chats.json should be of type Object.<string, string>. Check " + chat);
      }
      if(chat.startsWith("@")) CHATS_TO_ID[chat] = String(savedChats[chat]);
      else throw RangeError("In chats.json, chat username should starts with @. Check " + chat);
    }
  }
}
registerFunction(loadChatIds);

loadChatIds();
verb("savedChatsInfo", CHATS_TO_ID);

function getTodayTimestamp() {
  const now = Date.now();
  const extra = (now + TZ * 3600 * 1e3) % (24 * 3600 * 1e3);
  return now - extra;
}
registerFunction(getTodayTimestamp);

/**
 * @type {Object.<string, [number, number, number][]>}
 */
// @ts-ignore
const checkinStatus = require("./checkin.json");

for (let uid in checkinStatus) {
  checkinStatus[uid] = checkinStatus[uid].filter((dateArr) => {
    const then = new Date(...dateArr).getTime();
    const lowerBound = getTodayTimestamp() - 30 * (24 * 3600 * 1e3);
    return then >= lowerBound;
  });
}

//  ------------ initialize cache ------------- //

cache.add("stoppedPids", [], Infinity);
cache.add("checkin", checkinStatus, Infinity);
storeCheckinStatus();

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
registerFunction(getMsgLink);

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
registerFunction(getMentionLink);


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
registerFunction(getArrayXYSize);

/**
 * @param {string | number} unsafeMd unsafe markdown v2 text
 */
function toSafeMd(unsafeMd) {
  unsafeMd = String(unsafeMd);
  // see https://core.telegram.org/bots/api#markdownv2-style
  // eslint-disable-next-line no-useless-escape
  return unsafeMd.replace(/([[\]()_*~`>#+\-=|{}\.!\\])/g, "\\$1");
}
registerFunction(toSafeMd);

/**
 * @param {string} unsafeCode unsafe markdown v2 code
 */
function toSafeCode(unsafeCode) {
  return unsafeCode.replace(/([`\\])/g, "\\$1");
}
registerFunction(toSafeCode);

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
registerFunction(readableFileSize);


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
registerFunction(cleanup);

/**
 * @param {any} symbol
 * @returns {string}
 */
function type(symbol) {
  return ({}).toString.call(symbol).slice(8, -1).toLowerCase();
}
registerFunction(type);

/**
 * @param {string} text
 */
function sha512hex(text) {
  const hashInstance = crypto.createHash("sha512");
  const hashResult = hashInstance.update(text, "utf8");
  return hashResult.digest("hex");
}
registerFunction(sha512hex);


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
  CHATS_TO_ID,
  CHAT_SETTINGS,
  HELP_DISPLAY_SEC,
  MAX_SLEEP_TIME,
  WILL_QUIT_SOON,
  symbolMap,
  checkinStatus,
  keywords,
  packageStatus,
  registerFunction,
  registerObject,
  registerChatId,
  registerKeyword,
  registerKeywordList,
  storeCheckinStatus,
  storeChatSettings,
  storePackageStatus,
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
