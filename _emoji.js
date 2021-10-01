const fs = require("fs");
const path = require("path");

const rawEmojiData = fs.readFileSync(path.join(__dirname, "_emoji.txt")).toString("utf8").trim();

const emojiDataNoComment = rawEmojiData
  .replace(/^#[\s\S]+?$|\s*;[\s\S]+?$/mg, "")
  .replace(/\n{2,}/g, "\n")
  .trim();

const lines = emojiDataNoComment.split("\n").map(s => s.trim());

let regexText = "";

for(let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if(!line) continue;

  if(line.includes("..")) {
    // code range
    const [startHex, endHex] = line.split("..");
    const startHexCode = parseInt(startHex, 16);
    const endHexCode = parseInt(endHex, 16);

    if(endHexCode < 128) continue;

    if(endHexCode - startHexCode === 1) {
      regexText += `${toRegexHex(startHex)}|${toRegexHex(endHex)}`;
    } else {
      regexText += `[${toRegexHex(startHex)}-${toRegexHex(endHex)}]`;
    }
  } else {
    const hex = line;

    if(parseInt(hex, 16) < 128) continue;

    regexText += `${toRegexHex(hex)}`;
  }

  if(i !== lines.length - 1) {
    regexText += "|";
  }
}

const regex = new RegExp(regexText, "gu");

/**
 * @param {string} hex hex str
 * @returns {string} its regexp representation
 */
function toRegexHex(hex) {
  const hexCode = parseInt(hex, 16);
  if(hexCode <= 0xefff) {
    return String.fromCharCode(hexCode);
  }
  return "\\u" + (hex.length === 4 ? hex : `{${hex}}`);
}

/**
 * @param {string} text text
 * @returns {string} stripped text
 */
function emojiStrip(text) {
  return text.replace(regex, "");
}

emojiStrip.emojiRegex = regex;

module.exports = emojiStrip;
