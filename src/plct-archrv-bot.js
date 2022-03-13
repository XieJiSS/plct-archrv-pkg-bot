/* eslint-disable no-case-declarations */
"use strict";

;(async () => {

require("dotenv").config({
  path: "./config/.env",
});

const TelegramBot = require("node-telegram-bot-api");
const { inspect } = require("util");
const crypto = require("crypto");
const http = require("http");
const lock = require("lockfile");

console.log("[INFO]", "PID", process.pid);  // eslint-disable-line
const verb = require("./_verbose");

try {
  const lockPromise = new Promise((res, rej) => {
    lock.lock("plct.lock", function (err) {
      err ? rej(err) : res();
    });
  });
  await lockPromise;
  verb(lock.lock, "successfully locked plct.lock");
} catch (e) {
  verb(lock.lock, "failed to lock lockfile:", e);
  process.exit(1);
}

require("async-exit-hook")(() => {
  try {
    if(messageQueue.length) {
      console.log("[INFO]", "messages that fail to send:");
      console.log(messageQueue);
    }
    lock.unlockSync("plct.lock");
    verb(lock.unlockSync, "successfully unlocked plct.lock");
  } catch (e) {
    verb(lock.unlockSync, "failed to unlock lockfile:", e);
  }
});

const localUtils = require("./utils");

const {
  defer,
  equal,
  getAlias,
  escapeRegExp,
  marksToStringArr,
  getMentionLink,
  getCurrentTimeStr,
  findUserIdByPackage,
  findPackageMarksByMarkName,
  findPackageMarksByMarkNamesAndComment,
  toSafeMd,
  toSafeCode,
  wrapCode,
  sleep,
  strcmp,
  packageStatus,
  storePackageStatus,
  packageMarks,
  storePackageMarks,
  stripPackageStatus,
  stripPackageMarks,
} = localUtils;

// replace the value below with the Telegram token you receive from @BotFather
const token = process.env["PLCT_BOT_TOKEN"];

/**
 * @template T
 * @param {T} value
 * @method
 * @returns {T[]}
 */
// @ts-ignore
Array.prototype.remove = function (value) {
  if(typeof this !== "object" || typeof this.length !== "number") {
    throw new TypeError("Array.prototype.remove should only be invoked on arrays.");
  }
  /**
   * @type {T[]}
   */
  const that = this;
  while(that.indexOf(value) !== -1) {
    that.splice(that.indexOf(value), 1);
  }
  return that;
}

const bot = new TelegramBot(token, { polling: true });
const BOT_ID = await bot.getMe().then((me) => me.id);
const ADMIN_ID = Number(process.env["PLCT_BOT_ADMIN_USERID"]);
const CHAT_ID = process.env["PLCT_CHAT_ID"];
const HTTP_API_TOKEN = process.env["PLCT_HTTP_API_TOKEN"];

//  --------- initialize cache ends ----------- //

/**
 * @type {TelegramBot.SendMessageOptions}
 */
const defaultMessageOption = Object.freeze({
  disable_notification: true,
});
const defaultPollOption = Object.freeze({
  is_anonymous: false,
});

verb("defaultMessageOption", defaultMessageOption);
verb("defaultPollOption", defaultPollOption);

/**
 * @param {RegExp} regexp
 * @param {(msg: TelegramBot.Message, match: RegExpExecArray | null) => void} cb
 */
function onText(regexp, cb) {
  /**
   * @param {TelegramBot.Message} msg
   * @param {RegExpExecArray | null} match
   */
  function wrappedCallback(msg, match) {
    if(!msg.text) return;
    if(/^\/[a-zA-Z0-9_]+?@[\S]/.test(msg.text)) {
      let botName = msg.text.replace(/^\/[a-zA-Z0-9_]+?@/, "").toLowerCase();
      if(/^[a-zA-Z0-9_]+? /.test(botName)) {
        botName = botName.split(" ", 2)[0];
      }
      if(botName !== process.env["PLCT_BOT_NAME"]) {
        verb("Not my command: expecting", process.env["PLCT_BOT_NAME"], "but got", botName)
        return;
      }
    }

    return cb(msg, match);
  }

  return bot.onText(regexp, wrappedCallback);
}


//  ---------- TelegramBot related functions ----------- //

/**
 * @type {{
   chatId: number | string;
   text: string;
   options: TelegramBot.SendMessageOptions;
   _options: TelegramBot.SendMessageOptions;
   throttle: boolean;
   timestamp: number;
   resolve: (value: any) => void;
   reject: (reason?: any) => void;
  }[]}
 */
const messageQueue = [];

// wrapper: push message to queue
/**
 * @param {number | string} chatId
 * @param {string} text
 * @param {boolean} throttle
 * @param {TelegramBot.SendMessageOptions} _options
 * @param {TelegramBot.SendMessageOptions} [options]
 * @returns {Promise<TelegramBot.Message>}
 */
function sendMessageWithRateLimit(chatId, text, throttle, _options, options = {}) {
  return new Promise((resolve, reject) => {
    messageQueue.push({
      chatId,
      text,
      options,
      _options,
      throttle,
      timestamp: Date.now(),
      resolve,
      reject,
    });
  });
}

// consume message from queue with rate limit
// messages are added to queue by `sendMessage()`
async function doSendMessage() {
  if(messageQueue.length === 0) {
    await sleep(200);
    setTimeout(() => doSendMessage(), 0);
    return;
  }
  let index = 0;
  while(index < messageQueue.length) {
    if(!messageQueue[index].throttle) {
      break;
    }
    index++;
  }
  if(index === messageQueue.length) {
    setTimeout(() => doSendMessage(), 800);
    return;
  }
  let { chatId, text, options, _options, timestamp, resolve, reject } = messageQueue.splice(index, 1)[0];
  
  const slimText = (text.length > 20 ? text.substring(0, 20) + "..." : text).replace(/\n/g, "\\n");
  verb("Sending message", slimText, "to chat", chatId);
  verb("with options", options);
  verb("lagging behind", Date.now() - timestamp, "ms");

  bot.sendMessage(chatId, text, options).then(resolve).catch((err) => {
    verb(sendMessage, err.name, inspect(err), options);
    if(inspect(err).includes("429 Too Many Requests")) {
      const sleepTime = parseInt(inspect(err).match(/ETELEGRAM: 429 Too Many Requests: retry after (\d+)/)[1], 10) * 1000 || 3000;
      verb(sendMessage, "waiting for", sleepTime, "ms before retrying...");
      sleep(sleepTime).then(() => bot.sendMessage(chatId, text, Object.assign(Object.assign({}, defaultMessageOption), _options)).then(resolve).catch(reject));
    } else {
      bot.sendMessage(chatId, text, Object.assign(Object.assign({}, defaultMessageOption), _options)).then(resolve).catch(reject);
    }
  });
  setTimeout(() => doSendMessage(), 800);
  return;
}
setTimeout(() => doSendMessage(), 200);

// no (throttled) message: sleep 200ms
// has throttled message: send per chat and sleep 20ms
/**
 * @description Take throttled messages from queue, merge them, and push to the end of queue
 */
async function doSendThrottleMessage() {
  if(messageQueue.length === 0) {
    setTimeout(() => doSendThrottleMessage(), 200);
    return;
  }
  /** @type {string | number} */
  let currChatId;
  /** @type {number[]} */
  const currChatMsgIndex = [];

  for(let i = 0; i < messageQueue.length; i++) {
    if(messageQueue[i].throttle) {
      const { chatId, timestamp } = messageQueue[i];
      // 只要这个 chatId 的所有 throttled message 里存在被压了 120 秒还没发的消息，
      // 就把这个 chatId 匹配的所有消息都发出去
      if(Date.now() - timestamp >= 120e3) {
        if(!currChatId) {
          currChatId = chatId;
          verb(doSendThrottleMessage, "chat", chatId, "has been throttled for 120 seconds,");
          verb(doSendThrottleMessage, "sending all throttled messages for chat", chatId, "...");
          // fall through to push
        }
      }
      if(currChatId && currChatId === chatId) {
        currChatMsgIndex.push(i);
      }
    }
  }
  if(!currChatId) {
    setTimeout(() => doSendThrottleMessage(), 200);
    return;
  }
  verb(doSendThrottleMessage, "trying to throttle messages in chat", currChatId);
  // 从这里开始，为了避免 race condition，不能用 await，i.e. 要在一个 tick 内完成
  /**
   * @type {{
      text: string;
      options: TelegramBot.SendMessageOptions;
      _options: TelegramBot.SendMessageOptions;
      resolveCallbacks: ((value: any) => void)[];
      rejectCallbacks: ((reason?: any) => void)[];
    }[]}
   */
  const mergedMessages = [];
  let throttledToMsgCount = 0;
  for(let i = 0; i < currChatMsgIndex.length; i++) {
    const currMessage = messageQueue[currChatMsgIndex[i]];
    if(mergedMessages.length === 0) {
      throttledToMsgCount++;
      mergedMessages.push({
        text: currMessage.text,
        options: currMessage.options,
        _options: currMessage._options,
        resolveCallbacks: [ currMessage.resolve ],
        rejectCallbacks: [ currMessage.reject ],
      });
    } else {
      if(equal(currMessage.options, mergedMessages[mergedMessages.length - 1].options) &&
      mergedMessages[mergedMessages.length - 1].text.length + currMessage.text.length <= 4000) {
        // options match indicates _options match, because _options is generated from options
        // messages with same options can be merged.
        mergedMessages[mergedMessages.length - 1].text += "\n" + currMessage.text;
        mergedMessages[mergedMessages.length - 1].resolveCallbacks.push(currMessage.resolve);
        mergedMessages[mergedMessages.length - 1].rejectCallbacks.push(currMessage.reject);
      } else {
        // messages that don't share the same options (or are too long) cannot be merged,
        // so we'd like to create a new entry.
        throttledToMsgCount++;
        mergedMessages.push({
          text: currMessage.text,
          options: currMessage.options,
          _options: currMessage._options,
          resolveCallbacks: [ currMessage.resolve ],
          rejectCallbacks: [ currMessage.reject ],
        });
      }
    }
  }
  verb(doSendThrottleMessage, "merged", currChatMsgIndex.length, "msgs into", throttledToMsgCount, "msgs");
  for(let i = currChatMsgIndex.length - 1; i >= 0; i--) {
    // remove backward to avoid index shift.
    messageQueue.splice(currChatMsgIndex[i], 1);
  }
  // 到这里就结束 atomic 的部分了，可以开始用 await
  for(let i = 0; i < mergedMessages.length; i++) {
    const mergedMessage = mergedMessages[i];
    function resolveAll() {
      verb(resolveAll, "resolving all callbacks...");
      mergedMessage.resolveCallbacks.forEach((resolve) => resolve());
    }
    function rejectAll() {
      verb(resolveAll, "rejecting all callbacks...");
      // Oh hell no, all promises are rejected!
      mergedMessage.rejectCallbacks.forEach((reject) => reject());
    }
    messageQueue.push({
      chatId: currChatId,
      text: mergedMessage.text,
      options: mergedMessage.options,
      _options: mergedMessage._options,
      timestamp: Date.now(),
      throttle: false,
      resolve: resolveAll,
      reject: rejectAll,
    });
  }
  // Since there're throttled message, it's highly possible that we did not consume them all.
  // So sleep short and re-run, to consume as many messages as possible in a short time.
  // If there's nothing to consume, we will sleep longer in that no-op call.
  setTimeout(() => doSendThrottleMessage(), 20);
}
setTimeout(() => doSendThrottleMessage(), 200);

// push message to queue
/**
 * @param {number | string} chatId
 * @param {string} text
 * @param {TelegramBot.SendMessageOptions} [options]
 * @param {boolean} [throttle]
 * @returns {Promise<TelegramBot.Message>}
 */
function sendMessage(chatId, text, options = {}, throttle = false) {
  options = Object.assign(Object.assign({}, defaultMessageOption), options);
  // Fallback options in case error occurs
  /**
   * @type {TelegramBot.SendMessageOptions}
   */
  const _options = {
    disable_notification: options.disable_notification,
    // Fix Telegram MarkdownV2's strange parsing behavior
    // --> Just use the Markdown parser as a fallback instead of MarkdownV2
    parse_mode: options.parse_mode && options.parse_mode.startsWith("Markdown") ? "Markdown" : void 0,
  };

  if(text.length > 4000) {
    let thisText = text.substring(text.length - 4000, text.length);
    let thatText = text.substring(0, text.length - 4000);
    if(thisText.split("```").length % 2 !== 1) {
      thisText = "```" + thisText;
    }
    if(thatText.split("```").length % 2 !== 1) {
      thatText += "```";
    }
    return sendMessage(chatId, thatText, options).then(() => {
      return sendMessage(chatId, thisText, options);
    });
  }
  return sendMessageWithRateLimit(chatId, text, throttle, _options, options);
}

/**
 * @param {number | string} chatId
 * @param {string | number} msgId
 * @param {string} text
 * @param {TelegramBot.SendMessageOptions} [options]
 */
function replyMessage(chatId, msgId, text, options = {}) {
  const originOptions = Object.assign({}, options);
  options.reply_to_message_id = Number(msgId);

  return sendMessage(chatId, text, options).catch((err) => {
    if (err.name && err.name.includes("reply message not found")) {
      verb(replyMessage, "failed to reply to message", msgId, "in chat", chatId, "because it has been deleted.");
      return sendMessage(chatId, text, originOptions);
    } else {
      verb(replyMessage, err.name);
      return sendMessage(chatId, text, originOptions);
    }
  });
}

/**
 * @param {number | string} chatId
 * @param {string | number} msgId
 * @param {string} newText
 */
function editMessage(chatId, msgId, newText) {
  return bot.editMessageText(newText, {
    chat_id: chatId,
    message_id: Number(msgId),
  }).catch((err) => {
    verb(editMessage, "failed to edit message due to", err.name);
    return sendMessage(chatId, newText, defaultMessageOption);
  });
}


/**
 * @param {string | number} chatId
 * @param {string | number} msgId
 * @param {number} ms
 */
async function deleteAfter(chatId, msgId, ms) {
  await sleep(ms);
  verb("Deleting message", msgId, "of chat", chatId);
  bot.deleteMessage(chatId, String(msgId)).catch(() => {
    verb("Failed to delete message", msgId, "of chat", chatId);
  });
}

/**
 * @param {string | number} chatId
 * @param {string | number} msgId
 * @param {string} text
 * @param {number} ms
 * @param {TelegramBot.SendMessageOptions} [options]
 */
async function replyAndDeleteAfter(chatId, msgId, text, ms, options = {}) {
  const sentMsg = await replyMessage(chatId, msgId, text, options);
  deleteAfter(chatId, sentMsg.message_id, ms);
}


//  --------- TelegramBot related functions end ----------  //


onText(/^\/add\s+(\S+)$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const msgId = msg.message_id;
  const newPackage = match[1];

  verb("trying to add", newPackage);

  if(packageStatus.filter(user => user.packages.some(existingPkg => existingPkg === newPackage)).length) {
    if(findUserIdByPackage(newPackage) === msg.from.id) {
      await replyMessage(chatId, msgId, toSafeMd(`无需重复认领`));
    } else {
      await replyMessage(chatId, msgId, toSafeMd(`认领失败，这个 package 已被其他人认领`));
    }
    return;
  }

  if(packageStatus.some(user => user.userid === msg.from.id)) {
    packageStatus.find(user => user.userid === msg.from.id).packages.push(newPackage);
  } else {
    packageStatus.push({
      userid: msg.from.id,
      username: msg.from.username,
      packages: [ newPackage ],
    });
  }
  storePackageStatus();

  const packageMark = packageMarks.filter(pkg => pkg.name === newPackage)[0];
  if(packageMark && packageMark.marks.filter(mark => mark.name !== "failing").length) {
    const marks = packageMark.marks;
    let markStatusStr = toSafeMd(`认领成功，但请注意该 package 有特殊状态：\n`);
    markStatusStr += marksToStringArr(marks).join("\n");
    markStatusStr += toSafeMd(`\n\n可以用 more 命令查看完整列表`);
    await replyMessage(chatId, msgId, markStatusStr, { parse_mode: "MarkdownV2" });
  } else {
    await replyMessage(chatId, msgId, toSafeMd(`认领成功`));
  }

  if(String(chatId) !== process.env["PLCT_CHAT_ID"]) {
    await sendMessage(process.env["PLCT_CHAT_ID"], toSafeMd(`${newPackage} 已被认领。`));
    await sendMessage(chatId, toSafeMd(`deprecated: 不建议在 PLCT 群以外的地方认领包`));
  }
});

onText(/^\/(?:merge|drop)\s+(\S+)$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const msgId = msg.message_id;
  
  /**
   * @param {boolean} success
   * @param {string} [reason]
   */
  async function mergeCallback(success, reason) {
    if(success) {
      return await replyMessage(chatId, msgId, toSafeMd(`记录释放成功`));
    } else {
      return await replyMessage(chatId, msgId, toSafeMd(reason));
    }
  }

  _merge(match[1], msg.from.id, mergeCallback);
});

/**
 * @param {string} mergedPackage
 * @param {number} userId
 * @param {(success: boolean, reason?: string) => any} callback
 */
function _merge(mergedPackage, userId, callback) {
  verb("trying to merge", mergedPackage);

  if(!packageStatus.filter(user => user.packages.some(existingPkg => existingPkg === mergedPackage)).length) {
    callback(false, `这个 package 不在认领记录中`);
    return;
  }

  if(packageStatus.some(user => user.userid === userId)) {
    if(!packageStatus.find(user => user.userid === userId).packages.includes(mergedPackage)) {
      callback(false, `这个 package 不在你的认领记录中。请联系该包的认领人`);
      return;
    }
    //@ts-ignore
    packageStatus.find(user => user.userid === userId).packages.remove(mergedPackage);
    storePackageStatus().then(() => callback(true)).catch(err => callback(false, String(err)));
    return;
  }

  callback(false, `你还没有认领任何 package`);
}

const MARK_REGEXP = /^\/mark\s+(\S+)\s+(\S+)(\s+[\S\s]+)?$/;

onText(MARK_REGEXP, async (msg, match) => {
  const chatId = msg.chat.id;
  const msgId = msg.message_id;
  const userId = msg.from.id;

  const pkg = match[1];
  const mark = match[2];
  let comment = match[3] ? match[3].trim() : "";
  if(["ready"].includes(mark)) {
    comment += " " + getCurrentTimeStr();
    comment = comment.trim();
  }
  
  verb("trying to mark", pkg, "as", mark);
  if(comment) {
    verb("with comment", comment);
  }

  if(!Object.keys(localUtils.MARK2STR).includes(mark)) {
    return await showMarkHelp(chatId);
  }

  const mentionLink = getMentionLink(msg.from.id, null, msg.from.first_name, msg.from.last_name, false);

  /**
   * @param {boolean} success
   * @param {string} [reason]
   */
  function markCallback(success, reason) {
    if(success) {
      replyMessage(chatId, msgId, toSafeMd(`状态更新成功`));
      if(String(chatId) !== process.env["PLCT_CHAT_ID"]) {
        sendMessage(process.env["PLCT_CHAT_ID"], toSafeMd(`${pkg} 已被标记为 ${mark}：${comment || "无注释"}`), {
          parse_mode: "MarkdownV2"
        });
        sendMessage(chatId, toSafeMd(`deprecated: 不建议在 PLCT 群以外的地方更新包的状态`), {
          parse_mode: "MarkdownV2"
        });
      }
    } else {
      return replyMessage(chatId, msgId, toSafeMd(reason), {
        parse_mode: "MarkdownV2"
      });
    }
  }

  _mark(pkg, mark, comment, userId, mentionLink, markCallback);
});

/**
 * @param {string} pkg
 * @param {string} mark
 * @param {string} comment
 * @param {number} userId
 * @param {string} mentionLink
 * @param {(success: boolean, reason?: string) => any} callback
 */
async function _mark(pkg, mark, comment, userId, mentionLink, callback) {
  verb(_mark, pkg, mark, comment);
  if(packageMarks.filter(obj => obj.name === pkg).length > 0) {
    const target = packageMarks.filter(obj => obj.name === pkg)[0];
    if(!target.marks.some(markObj => markObj.name === mark)) {
      target.marks.push({ name: mark, by: { url: mentionLink, uid: userId, alias: getAlias(userId) }, comment });
      target.marks.sort((a, b) => a.name > b.name ? 1 : a.name === b.name ? 0 : -1);
    } else {
      const markIndex = target.marks.findIndex(markObj => markObj.name === mark);
      target.marks[markIndex] = {
        name: mark,
        by: { url: mentionLink, uid: userId, alias: getAlias(userId) },
        comment
      };
    }
  } else {
    packageMarks.push({
      name: pkg,
      marks: [ { name: mark, by: { url: mentionLink, uid: userId, alias: getAlias(userId) }, comment } ],
    });
    packageMarks.sort((pkg1, pkg2) => strcmp(pkg1.name, pkg2.name));
  }
  storePackageMarks().then(() => callback(true)).catch(err => callback(false, String(err)));
}

onText(/^\/mark/, async (msg) => {
  const chatId = msg.chat.id;
  if(MARK_REGEXP.test(msg.text)) return;
  return await showMarkHelp(chatId);
});

onText(/^\/unmark\s+(\S+)\s+(\S+)$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const msgId = msg.message_id;
  const pkg = match[1];
  const mark = match[2];

  verb("trying to unmark", pkg, "'s", mark, "mark");

  /**
   * @param {boolean} success
   * @param {string} [reason]
   */
  async function unmarkCallback(success, reason) {
    if(success) {
      await replyMessage(chatId, msgId, toSafeMd(`状态更新成功`), {
        parse_mode: "MarkdownV2"
      });
      if(String(chatId) !== process.env["PLCT_CHAT_ID"]) {
        sendMessage(process.env["PLCT_CHAT_ID"], toSafeMd(`${pkg} 不再被标记为 ${mark}`), {
          parse_mode: "MarkdownV2"
        });
        sendMessage(chatId, toSafeMd(`deprecated: 不建议在 PLCT 群以外的地方更新包的状态`), {
          parse_mode: "MarkdownV2"
        });
      }
    } else {
      return await replyMessage(chatId, msgId, toSafeMd(reason), {
        parse_mode: "MarkdownV2"
      });
    }
  }

  _unmark(pkg, mark, unmarkCallback);
});

/**
 * @param {string} pkg
 * @param {string[]} marks
 * @param {(success: boolean, reason?: string) => any} callback
 */
async function _unmarkMultiple(pkg, marks, callback) {
  for(const mark of marks) {
    await _unmark(pkg, mark, callback);
  }
}

/**
 * @param {string} pkg
 * @param {string} mark
 * @param {(success: boolean, reason?: string) => any} callback
 * @description 取消某个包的某个标记。不会等待 callback 执行完毕才返回。
 */
async function _unmark(pkg, mark, callback) {
  verb(_unmark, pkg, mark);
  if(packageMarks.filter(obj => obj.name === pkg).length > 0) {
    const target = packageMarks.filter(obj => obj.name === pkg)[0];
    if(target.marks.some(markObj => markObj.name === mark)) {
      target.marks = target.marks.filter(markObj => markObj.name !== mark);
      target.marks.sort((a, b) => a.name > b.name ? 1 : a.name === b.name ? 0 : -1);
      try {
        await storePackageMarks();
      } catch {
        return callback(false, "未能写入数据库");
      }
      return callback(true, mark);
    } else {
      return callback(false, "该 package 目前未被设定为此状态");
    }
  } else {
    return callback(false, "表中没有该 package");
  }
}

/**
 * @param {number} chatId
 */
async function showMarkHelp(chatId) {
  await sendMessage(chatId, toSafeMd(`/mark 用法：\n/mark pkg status [comment]\n\n可用的 status 包括 ${
    Object.keys(localUtils.MARK2STR).join(", ")
  }`), { parse_mode: "MarkdownV2" });
}

onText(/^\/status@?/, async (msg) => {
  const chatId = msg.chat.id;
  const msgId = msg.message_id;

  verb("trying to show status...");

  let statusStr = "";
  for(const user of packageStatus) {
    if (!user.packages.length) continue;
    statusStr += user.username ? toSafeMd(user.username) : getMentionLink(user.userid, null, "这个没有用户名的人", null);
    statusStr += toSafeMd(" - ");
    statusStr += "`" + user.packages.slice().sort().map(toSafeCode).join("` `") + "`";
    statusStr += "\n\n";
  }

  statusStr = statusStr || toSafeMd("(empty)");
  statusStr += toSafeMd("\n可以通过 add，merge 和 drop 命令来维护此列表；\n使用 more 命令查看需要特殊处理的 package。");

  await replyMessage(chatId, msgId, statusStr, { parse_mode: "MarkdownV2" });
});

onText(/^\/more(?:@[\S]+?)?\s+([\S]+)$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const msgId = msg.message_id;
  const pkgname = match[1];

  verb("trying to show mark status...");

  let statusStr = "";

  if(packageStatus.some(user => user.packages.includes(pkgname))) {
    const user = packageStatus.find(user => user.packages.includes(pkgname));
    statusStr += toSafeMd(`该包已被 ${ getAlias(user.userid) } 认领。\n`);
  }

  for(const packageMark of packageMarks) {
    if(packageMark.name !== pkgname) continue;
    statusStr += marksToStringArr(packageMark.marks).join(" ");
  }

  await replyMessage(chatId, msgId, statusStr || "该包目前不具有任何标记", { parse_mode: "MarkdownV2" });
});

onText(/^\/more(?:@[\S]+?)$/, async (msg) => {
  const chatId = msg.chat.id;
  const msgId = msg.message_id;
  await replyMessage(chatId, msgId, toSafeMd("Usage: /more pkgname"), { parse_mode: "MarkdownV2" });
});

bot.on("message", (msg) => {
  const text = msg.text;
  if(text && text.startsWith("/")) {
    verb("got command from", msg.chat.title || msg.chat.id, msg.text);
  }
});

/**
 * @param {http.IncomingMessage} req 
 * @param {http.ServerResponse} res 
 */
async function routePkgHandler(req, res) {
  verb(routePkgHandler);
  const url = new URL(req.url, `http://${req.headers.host}`);
  if(!url.searchParams.has("mark")) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const data = {
      workList: stripPackageStatus(packageStatus),
      markList: stripPackageMarks(packageMarks),
    };
    res.end(JSON.stringify(data));
  } else {
    const markName = url.searchParams.get("mark");
    const packages = packageMarks.filter(pkg => pkg.marks.some(mark => mark.name === markName)).map(pkg => pkg.name);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(packages));
  }
}

/**
 * @param {http.IncomingMessage} req 
 * @param {http.ServerResponse} res 
 */
async function routeDeleteHandler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const args = url.pathname.slice(1).split("/");
  verb(routeDeleteHandler, args);

  const apiToken = url.searchParams.get("token");
  if(apiToken !== HTTP_API_TOKEN) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end("Forbidden");
    return;
  }
  if(args.length != 3) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end("Bad Request");
    return;
  }
  const pkgname = decodeURIComponent(args[1]), status = args[2];
  if(status !== "ftbfs" && status !== "leaf") {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end("Bad Request");
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });

  const userId = localUtils.findUserIdByPackage(pkgname);
  if(userId === null) {
    res.write("package not found;");
  } else {
    const alias = getAlias(userId);
    const link = getMentionLink(userId, null, alias);
    const msgTypeStr = wrapCode("(auto-merge)");
    sendMessage(CHAT_ID, msgTypeStr + " ping " + link + toSafeMd(`: ${pkgname} 已出包`), {
      parse_mode: "MarkdownV2",
    }, true);

    _merge(pkgname, userId, (success, reason) => {
      if(success) return;
      sendMessage(CHAT_ID, msgTypeStr + toSafeMd(` failed: ${reason}`), {
        parse_mode: "MarkdownV2",
      }, true);
    });
  }

  ;(async function fencedAtomicOps() {
  // 自动出包后，首先把这个包的特定 mark 清掉
  const targetMarks = ["outdated", "stuck", "ready", "outdated_dep", "missing_dep", "unknown", "ignore", "failing"];
  await _unmarkMultiple(pkgname, targetMarks, (success, reason) => {
    if(!success) return;
    // for sucess === true, `reason` is the name of the modified mark
    const mark = reason;
    const msgTypeStr = wrapCode("(auto-unmark)");
    // 需要这个部分在后面的 Ping + defer msg 之前输出，所以这里并不 defer
    sendMessage(CHAT_ID, msgTypeStr + toSafeMd(` ${pkgname} 已出包，不再被标记为 ${mark}`), {
      parse_mode: "MarkdownV2",
    }, true);
  });
  // 到这里，sendMessage 也跑完了（pushQueue 完成）

  // 之后清掉别的包有关这个包的特定 mark
  const refMarks = ["outdated_dep", "missing_dep"];
  const targetPakcages = findPackageMarksByMarkNamesAndComment(refMarks, `[${pkgname}]`);
  for(const pkg of targetPakcages) {
    // 效果上需要先 Ping 后输出内容，但遍历完才能知道需要 Ping 谁，所以把输出手动 defer 到最后
    const deferKey = crypto.randomBytes(16).toString("hex");
    /**
     * @type {Set<string>}
     */
    const mentionLinkSet = new Set();
    for(const mark of pkg.marks.slice()) {
      if(!refMarks.includes(mark.name)) continue;
      let mentionLink = getMentionLink(BOT_ID, null, "null");
      if(mark.by) {
        // we don't use mark.by.url here, because it is based on tg name but we want alias
        mentionLink = getMentionLink(mark.by.uid, null, getAlias(mark.by.uid));
        mentionLinkSet.add(mentionLink);
      }
      const uid = mark.by ? mark.by.uid : BOT_ID;
      if(mark.comment.toLowerCase() === `[${pkgname}]`.toLowerCase()) {
        await _unmark(pkg.name, mark.name, (success, _) => {
          if(!success) return;
          const msgTypeStr = wrapCode("(auto-unmark)");
          // defer 输出
          defer.add(deferKey, () => {
            sendMessage(CHAT_ID, msgTypeStr + toSafeMd(` ${pkg.name} 因 ${pkgname} 出包，不再被标记为 ${mark.name}`), {
              parse_mode: "MarkdownV2",
            }, true);
          });
        });
      } else {
        const safePkgname = escapeRegExp(pkgname);
        const comment = mark.comment.replace(new RegExp("\\[" + safePkgname + "\\]", "i"), "").trim();
        await _mark(pkg.name, mark.name, comment, uid, mentionLink, (success, _) => {
          if(!success) return;
          const msgTypeStr = wrapCode("(auto-mark)");
          // defer 输出
          defer.add(deferKey, () => {
            sendMessage(CHAT_ID, msgTypeStr + toSafeMd(` [${pkgname}] 已从 ${pkg.name} 的 ${mark.name} 状态内移除。`), {
              parse_mode: "MarkdownV2",
            }, true);
          });
        });
      }
    }
    if(mentionLinkSet.size > 0) {
      let pingStr = wrapCode("(auto-cc)") + " ping";
      Array.from(mentionLinkSet).forEach(link => {
        pingStr += " " + link;
      });
      pingStr += toSafeMd(":");
      // 先发送 ping 消息
      sendMessage(CHAT_ID, pingStr, { parse_mode: "MarkdownV2" }, true);
      // 再发送此前被 defer 的输出
      defer.resolve(deferKey);
    }
  }
  })();  // invoke fencedAtomicOps()
  res.end("success");
}

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function routeAddHandler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const args = url.pathname.slice(1).split("/");
  verb(routeAddHandler, args);

  const apiToken = url.searchParams.get("token");
  if(apiToken !== HTTP_API_TOKEN) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end("Forbidden");
    return;
  }
  if(args.length != 3) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end("Bad Request");
    return;
  }
  const pkgname = decodeURIComponent(args[1]), status = args[2];
  if(status !== "ftbfs") {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end("Bad Request");
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });

  const userId = localUtils.findUserIdByPackage(pkgname);
  if(userId === null) {
    res.write("package not found;");
  } else {
    const alias = getAlias(userId);
    const link = getMentionLink(userId, null, alias);
    const msgTypeStr = wrapCode("(auto-mark)");
    // Ping 先输出，剩下的输出全部 defer
    sendMessage(CHAT_ID, msgTypeStr + ` ping ${link}${toSafeMd(": " + pkgname + " is failing")}`, {
      parse_mode: "MarkdownV2",
    }, true);
  }

  const deferKey = crypto.randomBytes(16).toString("hex");

  const mentionLink = getMentionLink(BOT_ID, null, "null");
  let shouldSendMsg = true;
  if(findPackageMarksByMarkName("failing").filter(pkg => pkg.name === pkgname).length > 0) {
    shouldSendMsg = false;
  }
  await _mark(pkgname, "failing", getCurrentTimeStr(), BOT_ID, mentionLink, (success, _) => {
    if(!success) return;
    // 对于已存在 failing 标记的情况，需要更新 comment 内的时间（getCurrentTimeStr()），但不输出
    if(!shouldSendMsg) return;
    const msgTypeStr = wrapCode("(auto-mark)")
    // defer 输出
    defer.add(deferKey, () => {
      sendMessage(CHAT_ID, msgTypeStr + toSafeMd(` ${pkgname} 已被自动标记为 failing`), {
        parse_mode: "MarkdownV2",
      }, true);
    });
  });

  await _unmarkMultiple(pkgname, ["ready"], (success, reason) => {
    if(!success) return;
    // for sucess === true, `reason` is the name of the modified mark
    const mark = reason;
    const msgTypeStr = wrapCode("(auto-unmark)")
    // defer 输出
    defer.add(deferKey, () => {
      sendMessage(CHAT_ID, msgTypeStr + toSafeMd(` ${pkgname} 不再被标记为 ${mark}`), {
        parse_mode: "MarkdownV2",
      }, true);
    });
  });

  res.end("success");
  await defer.resolve(deferKey);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const args = url.pathname.slice(1).split("/");
  const route = args[0];
  switch(route) {
    case "pkg":
      routePkgHandler(req, res);
      break;
    case "delete":
      routeDeleteHandler(req, res);
      break;
    case "add":
      routeAddHandler(req, res);
      break;
    default:
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end("Not Found");
  }
});

server.listen(30644);

})();
