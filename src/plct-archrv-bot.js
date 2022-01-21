/* eslint-disable no-case-declarations */
"use strict";

require("dotenv").config({
  path: "./config/.env",
});

const TelegramBot = require("node-telegram-bot-api");
const { inspect } = require("util");

console.log("[INFO]", "PID", process.pid);  // eslint-disable-line
const verb = require("./_verbose");

const localUtils = require("./utils");

const {
  addIndent,
  forceResplitLines,
  getAlias,
  marksToStringArr,
  markToString,
  getMentionLink,
  toSafeMd,
  toSafeCode,
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
   resolve: (value: any) => void;
   reject: (reason?: any) => void;
  }[]}
 */
const messageQueue = [];

// wrapper: push message to queue
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

// consume message from queue with rate limit
// messages are added to queue by `sendMessage()`
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

// push message to queue
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
    await replyMessage(chatId, msgId, toSafeMd(`认领失败，这个 package 已被其他人认领`));
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
  if(packageMark && packageMark.marks.length) {
    const marks = packageMark.marks;
    let markStatusStr = toSafeMd(`认领成功，但请注意该 package 有特殊状态：\n`);
    markStatusStr += marksToStringArr(marks).join("\n");
    markStatusStr += toSafeMd(`\n\n可以用 more 命令查看完整列表`);
    await replyMessage(chatId, msgId, markStatusStr, { parse_mode: "MarkdownV2" });
  } else {
    await replyMessage(chatId, msgId, toSafeMd(`认领成功`));
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

  merge(match[1], msg.from.id, mergeCallback);
});

/**
 * @param {string} mergedPackage
 * @param {number} userId
 * @param {(success: boolean, reason?: string) => any} callback
 */
function merge(mergedPackage, userId, callback) {
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
    storePackageStatus();
    callback(true);
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
  const comment = match[3] ? match[3].trim() : "";
  
  verb("trying to mark", pkg, "as", mark);
  
  if(!Object.keys(localUtils.MARK2STR).includes(mark)) {
    return await showMarkHelp(chatId);
  }
  
  const mentionLink = getMentionLink(msg.from.id, null, msg.from.first_name, msg.from.last_name, false);

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
  storePackageMarks();
  await replyMessage(chatId, msgId, toSafeMd(`状态更新成功`));
});

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
      return await replyMessage(chatId, msgId, toSafeMd(`状态更新成功`));
    } else {
      return await replyMessage(chatId, msgId, toSafeMd(reason));
    }
  }

  unmark(pkg, mark, unmarkCallback);
});

/**
 * 
 * @param {string} pkg
 * @param {string} mark
 * @param {(success: boolean, reason?: string) => any} callback
 */
async function unmark(pkg, mark, callback) {
  if(packageMarks.filter(obj => obj.name === pkg).length > 0) {
    const target = packageMarks.filter(obj => obj.name === pkg)[0];
    if(target.marks.some(markObj => markObj.name === mark)) {
      target.marks = target.marks.filter(markObj => markObj.name !== mark);
      target.marks.sort((a, b) => a.name > b.name ? 1 : a.name === b.name ? 0 : -1);
      try {
        await storePackageMarks();
      } catch(_) {
        return callback(false, "未能写入数据库");
      }
      return callback(true);
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
    statusStr += "`" + user.packages.map(toSafeCode).join("` `") + "`";
    statusStr += "\n\n";
  }

  statusStr = statusStr || toSafeMd("(empty)");
  statusStr += toSafeMd("\n可以通过 add，merge 和 drop 命令来维护此列表；\n使用 more 命令查看需要特殊处理的 package。");

  await replyMessage(chatId, msgId, statusStr, { parse_mode: "MarkdownV2" });
});

onText(/^\/more(?:@[\S]+?)\s+([\S]+)$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const msgId = msg.message_id;
  const pkgname = match[1];

  verb("trying to show mark status...");

  let statusStr = "";

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

const http = require("http");

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const args = url.pathname.slice(1).split("/");
  const route = args[0];
  switch(route) {
    case "pkg":
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const data = {
        workList: stripPackageStatus(packageStatus),
        markList: stripPackageMarks(packageMarks),
      };
      res.end(JSON.stringify(data));
      break;
    case "delete":
      const apiToken = url.searchParams.get("token");
      if(apiToken !== HTTP_API_TOKEN) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end("Forbidden");
        break;
      }
      if(args.length != 3) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end("Bad Request");
        break;
      }
      const pkgname = args[1], status = args[2];
      if(status !== "ftbfs" && status !== "leaf") {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end("Bad Request");
        break;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      if(status === "ftbfs") {
        const userId = localUtils.findUserIdByPackage(pkgname);
        if(userId === null) return;
        const link = getMentionLink(userId);
        sendMessage(CHAT_ID, `ping ${link}${toSafeMd(": " + pkgname + "已出包")}`);
        merge(pkgname, userId, async (success, reason) => {
          if(!success) {
            await sendMessage(CHAT_ID, toSafeMd(`自动 merge 失败：${reason}`));
          }
        });
      }
      res.end("success");
      break;
    default:
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end("Not Found");
  }
});

server.listen(30644);
