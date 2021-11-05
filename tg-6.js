/* eslint-disable no-case-declarations */
"use strict";

require('dotenv').config();

const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const assert = require("assert");
const { inspect } = require("util");

console.log("[INFO]", "PID", process.pid);  // eslint-disable-line
const verb = require("./_verbose");

const localUtils = require("./utils");
const PRNG = require("./_rand");
const shuffle = require("./_shuffle");
const printTable = require('./_obj2table');

const {
  registerFunction,
  registerObject,
  marksToStringArr,
  getMsgLink,
  getMentionLink,
  toSafeMd,
  toSafeCode,
  sleep,
  kwd2regexp,
  fullKwd2regexp,
  packageStatus,
  storePackageStatus,
  packageMarks,
  storePackageMarks,
} = localUtils;

// replace the value below with the Telegram token you receive from @BotFather
let token = process.env["MELON_BOT_TOKEN"];

/**
 * @template T
 * @param {T} value
 * @method
 * @returns {T[]}
 */
// @ts-ignore
Array.prototype.remove = function(value) {
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
const ADMIN_ID = Number(process.env["MELON_BOT_ADMIN_USERID"]);
const BOT_ID = 0;  // @TODO:

//  --------- initialize cache ends ----------- //

/**
 * @type {TelegramBot.SendMessageOptions}
 */
const defaultMessageOption = Object.freeze({
  disable_notification: true,
});
registerObject(defaultMessageOption, "defaultMessageOption");
const defaultPollOption = Object.freeze({
  is_anonymous: false,
});
registerObject(defaultPollOption, "defaultPollOption");

verb("defaultMessageOption", defaultMessageOption);
verb("defaultPollOption", defaultPollOption);


/**
 * @param {string[]} keywords
 * @param {(msg: TelegramBot.Message, match: RegExpExecArray | null) => void} cb
 */
function onKwds(keywords, cb) {
  return onText(kwd2regexp(keywords), cb);
}
registerFunction(onKwds);

/**
 * @param {string[]} keywords
 * @param {(msg: TelegramBot.Message, match: RegExpExecArray | null) => void} cb
 */
 function onFullKwds(keywords, cb) {
  return onText(fullKwd2regexp(keywords), cb);
}
registerFunction(onFullKwds);

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
    if(/^\/[a-zA-Z0-9_]+?@[^\s]/.test(msg.text)) {
      let botName = msg.text.replace(/^\/[a-zA-Z0-9_]+?@/, "").toLowerCase();
      if(/^[a-zA-Z0-9_]+? /.test(botName)) {
        botName = botName.split(" ", 2)[0];
      }
      if(botName !== process.env["MELON_BOT_NAME"]) {
        verb("Not my command: expecting", process.env["MELON_BOT_NAME"], "but got", botName)
        return;
      }
    }

    return cb(msg, match);
  }

  registerFunction(cb, regexp.toString());

  return bot.onText(regexp, wrappedCallback);
}
registerFunction(onText);


//  ---------- TelegramBot related functions ----------- //

/**
 * @type {{
   chatId: number | string;
   text: string;
   options: TelegramBot.SendMessageOptions;
   _options: TelegramBot.SendMessageOptions;
   resolve: (value: any) => void;
   reject: (reason?: any) => void;
  }[]}
 */
const messageQueue = [];

/**
 * @param {number | string} chatId
 * @param {string} text
 * @param {TelegramBot.SendMessageOptions} _options
 * @param {TelegramBot.SendMessageOptions} [options]
 * @returns {Promise<void>}
 */
function sendMessageWithRateLimit(chatId, text, _options, options = {}) {
  return new Promise((resolve, reject) => {
    messageQueue.push({
      chatId,
      text,
      options,
      _options,
      resolve,
      reject,
    });
  });
}

async function doSendMessage() {
  if(messageQueue.length === 0) {
    await sleep(500);
    setTimeout(() => doSendMessage(), 0);
    return;
  }
  const { chatId, text, options, _options, resolve, reject } = messageQueue.shift();
  
  const slimText = (text.length > 20 ? text.substring(0, 20) + "..." : text).replace(/\n/g, "\\n");
  verb("Sending message", slimText, "to chat", chatId);
  verb("with options", options);

  bot.sendMessage(chatId, text, options).then(resolve).catch((err) => {
    verb(sendMessage, err.name, inspect(err), options);
    if(inspect(err).includes("429 Too Many Requests")) {
      const sleepTime = parseInt(inspect(err).match(/ETELEGRAM: 429 Too Many Requests: retry after (\d+)/)[1], 10) * 1000 || 5000;
      verb(sendMessage, "waiting for", sleepTime, "ms before retrying...");
      sleep(sleepTime).then(() => bot.sendMessage(chatId, text, Object.assign(Object.assign({}, defaultMessageOption), _options)).then(resolve).catch(reject));
    } else {
      bot.sendMessage(chatId, text, Object.assign(Object.assign({}, defaultMessageOption), _options)).then(resolve).catch(reject);
    }
  });
  await sleep(2000);
  setTimeout(() => doSendMessage(), 0);
  return;
}

setTimeout(() => doSendMessage(), 1000);

/**
 * @param {number | string} chatId
 * @param {string} text
 * @param {TelegramBot.SendMessageOptions} [options]
 * @returns {Promise<TelegramBot.Message>}
 */
function sendMessage(chatId, text, options = {}) {
  options = Object.assign(Object.assign({}, defaultMessageOption), options);
  // Fallback options in case error occurs
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
  // @ts-ignore
  return sendMessageWithRateLimit(chatId, text, _options, options);
}
registerFunction(sendMessage);

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
registerFunction(replyMessage);

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
registerFunction(editMessage);


/**
 * @param {string | number} chatId
 * @param {string | number} msgId
 * @param {number} ms
 */
async function deleteAfter(chatId, msgId, ms) {
  const settings = localUtils.CHAT_SETTINGS[String(chatId)];
  if(settings && settings.delete === false) {
    return;
  }
  await sleep(ms);
  verb("Deleting message", msgId, "of chat", chatId);
  bot.deleteMessage(chatId, String(msgId)).catch(() => {
    verb("Failed to delete message", msgId, "of chat", chatId);
  });
}
registerFunction(deleteAfter);

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
registerFunction(replyAndDeleteAfter);

/**
 * @param {string} text
 * @param {string} callbackData
 * @returns {TelegramBot.InlineKeyboardButton}
 */
 function makeInlineKbdButton(text, callbackData) {
  return {
    text,
    callback_data: callbackData,
  };
}
registerFunction(makeInlineKbdButton);

/**
 * @param {string[][]} buttons
 * @param {string[][]} callbackDataArr
 * @returns {TelegramBot.InlineKeyboardMarkup}
 */
function makeInlineKbdMarkup(buttons, callbackDataArr) {
  const buttonsSize = localUtils.getArrayXYSize(buttons);
  const callbackSize = localUtils.getArrayXYSize(callbackDataArr);
  if(buttonsSize[0] !== callbackSize[0] || buttonsSize[1] !== callbackSize[1]) {
    verb(makeInlineKbdMarkup, `failed to make: buttons and callbackDataArr are of different size (${buttonsSize}), (${callbackSize})`);
    return {
      inline_keyboard: [[]],
    };
  }
  /**
   * @type {TelegramBot.InlineKeyboardButton[][]}
   */
  const keyboard = Array.from(new Array(buttonsSize[0]), () => {
    return new Array(buttonsSize[1]);
  });
  for(let i = 0; i < buttonsSize[0]; i++) {
    for(let j = 0; j < buttonsSize[1]; j++) {
      keyboard[i][j] = makeInlineKbdButton(buttons[i][j], callbackDataArr[i][j]);
    }
  }
  return {
    inline_keyboard: keyboard
  };
}
registerFunction(makeInlineKbdMarkup);

/**
 * @param {string} callbackQueryId
 * @param {string} text
 * @see https://core.telegram.org/bots/api#answercallbackquery
 */
async function sendAlertBox(callbackQueryId, text) {
  return await bot.answerCallbackQuery(callbackQueryId, {
    text,
    show_alert: true,
    cache_time: 0,
  });
}
registerFunction(sendAlertBox);

/**
 * @param {string} callbackQueryId
 * @param {string} text
 * @see https://core.telegram.org/bots/api#answercallbackquery
 */
async function sendBanner(callbackQueryId, text) {
  return await bot.answerCallbackQuery(callbackQueryId, {
    text,
    show_alert: false,
    cache_time: 0,
  });
}
registerFunction(sendBanner);

//  --------- TelegramBot related functions end ----------  //


/**
 * @param {string | number} chatId
 * @returns {Promise<TelegramBot.ChatMember[]>}
 */
async function getAdminsByChatId(chatId) {
  /**
   * @type {TelegramBot.ChatMember[]}
   */
  const admins = await bot.getChatAdministrators(chatId).catch(() => []);
  return admins;
}

/**
 * @param {string | number} chatId
 * @returns {Promise<number[]>}
 */
async function getAdminIdsByChatId(chatId) {
  return (await getAdminsByChatId(chatId)).map(admin => admin.user.id);
}

/**
 * @param {string | number} chatId
 * @param {string} userId
 * @returns {Promise<TelegramBot.ChatMember?>}
 */
async function getChatUserByUserId(chatId, userId) {
  return await bot.getChatMember(chatId, userId).catch(() => null);
}

onText(/^\/add\s+(\S+)$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const msgId = msg.message_id;
  const newPackage = match[1];

  verb("trying to add", newPackage);

  if(packageStatus.filter(user => user.packages.some(existingPkg => existingPkg === newPackage)).length) {
    await replyMessage(chatId, msgId, toSafeMd(`这个 package 已被认领`));
    return;
  }

  if(packageStatus.some(user => user.userid === msg.from.id)) {
    packageStatus.find(user => user.userid === msg.from.id).packages.push(newPackage);
    storePackageStatus();
    await replyMessage(chatId, msgId, toSafeMd(`认领成功`));
    return;
  }

  packageStatus.push({
    userid: msg.from.id,
    username: msg.from.username,
    packages: [ newPackage ],
  });
  storePackageStatus();
  await replyMessage(chatId, msgId, toSafeMd(`认领成功`));
});

onText(/^\/merge\s+(\S+)$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const msgId = msg.message_id;
  const mergedPackage = match[1];

  verb("trying to merge", mergedPackage);

  if(!packageStatus.filter(user => user.packages.some(existingPkg => existingPkg === mergedPackage)).length) {
    await replyMessage(chatId, msgId, toSafeMd(`这个 package 不在认领记录中`));
    return;
  }

  if(packageStatus.some(user => user.userid === msg.from.id)) {
    if(!packageStatus.find(user => user.userid === msg.from.id).packages.includes(mergedPackage)) {
      await replyMessage(chatId, msgId, toSafeMd(`这个 package 不在你的认领记录中。请联系该包的认领人`));
      return;
    }
    //@ts-ignore
    packageStatus.find(user => user.userid === msg.from.id).packages.remove(mergedPackage);
    storePackageStatus();
    await replyMessage(chatId, msgId, toSafeMd(`记录释放成功`));
    return;
  }

  await replyMessage(chatId, msgId, toSafeMd(`你还没有认领任何 package`));
});

onText(/^\/mark\s+(\S+)\s+(\S+)$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const msgId = msg.message_id;
  const pkg = match[1];
  const mark = match[2];

  verb("trying to mark", pkg, "as", mark);

  if(!Object.keys(localUtils.MARK2STR).includes(mark)) {
    return await showMarkHelp(chatId);
  }

  if(packageMarks.filter(obj => obj.name === pkg).length > 0) {
    const target = packageMarks.filter(obj => obj.name === pkg)[0];
    if(!target.marks.includes(mark)) {
      target.marks.push(mark);
      target.marks.sort();
    }
  } else {
    packageMarks.push({
      name: pkg,
      marks: [ mark ],
    });
  }
  storePackageMarks();
  await replyMessage(chatId, msgId, toSafeMd(`状态更新成功`));
});

onText(/^\/mark/, async (msg) => {
  const chatId = msg.chat.id;
  if(/^\/mark\s+(\S+)\s+(\S+)$/.test(msg.text)) return;
  return await showMarkHelp(chatId);
});

onText(/^\/unmark\s+(\S+)\s+(\S+)$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const msgId = msg.message_id;
  const pkg = match[1];
  const mark = match[2];

  verb("trying to unmark", pkg, "'s", mark, "mark");

  if(packageMarks.filter(obj => obj.name === pkg).length > 0) {
    const target = packageMarks.filter(obj => obj.name === pkg)[0];
    if(target.marks.includes(mark)) {
      target.marks = target.marks.filter(str => str !== mark).sort();
      storePackageMarks();
      return await replyMessage(chatId, msgId, toSafeMd(`状态更新成功`));
    } else {
      return await replyMessage(chatId, msgId, toSafeMd(`该 package 目前未被设定为此状态`));
    }
  } else {
    return await replyMessage(chatId, msgId, toSafeMd(`表中没有该 package`));
  }
});

/**
 * @param {number} chatId
 */
async function showMarkHelp(chatId) {
  await sendMessage(chatId, toSafeMd(`/mark 用法：\n/mark pkg status\n\n可用的 status 包括 ${
    Object.keys(localUtils.MARK2STR).join(", ")
  }`));
}

onText(/^\/status@?/, async (msg) => {
  const chatId = msg.chat.id;
  const msgId = msg.message_id;

  verb("trying to show status...");

  let statusStr = "";
  for(const user of packageStatus) {
    statusStr += user.username ? toSafeMd(user.username) : getMentionLink(user.userid, null, "这个没有用户名的人", null);
    statusStr += toSafeMd(" - ");
    statusStr += user.packages.length ? "`" + user.packages.map(toSafeCode).join("` `") + "`" : toSafeMd("(empty)");
    statusStr += "\n\n";
  }

  statusStr = statusStr || toSafeMd("(empty)");
  statusStr += "\n可以通过 add 和 merge 命令来维护此列表；\n使用 more 命令查看需要特殊处理的 package。";

  await replyMessage(chatId, msgId, statusStr, { parse_mode: "MarkdownV2" });
});

onText(/^\/more@?/, async (msg) => {
  const chatId = msg.chat.id;
  const msgId = msg.message_id;

  verb("trying to show mark status...");

  let statusStr = "";
  for(const pkg of packageMarks) {
    if(pkg.marks.length === 0) continue;
    statusStr += "`" + toSafeCode(pkg.name) + "`";
    statusStr += toSafeMd(":\n");
    statusStr += "`" + marksToStringArr(pkg.marks).map(toSafeCode).join("`\n`") + "`";
    statusStr += "\n\n";
  }

  statusStr = statusStr || toSafeMd("(empty)");
  statusStr += "\n可以使用 mark 和 unmark 命令来维护此列表。";

  await replyMessage(chatId, msgId, statusStr, { parse_mode: "MarkdownV2" });
});

bot.on("message", (msg) => {
  const text = msg.text;
  if(text && text.startsWith("/")) {
    verb("got command from", msg.chat.title || msg.chat.id, msg.text);
  }
});
