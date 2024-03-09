//@ts-check

import { format } from "util";

const EMOJI_REGEX = require("./_emoji").emojiRegex;
const CJK_REGEX =
  /[\u{2E80}-\u{2EFF}\u{2F00}-\u{2FDF}\u{2FF0}-\u{2FFF}\u{3000}-\u{303F}\u{31C0}-\u{31EF}\u{3200}-\u{32FF}\u{3400}-\u{4DBF}\u{4E00}-\u{9FFF}\u{20000}-\u{2A6DF}]/u;
const FULLWIDTH_REGEXS = [EMOJI_REGEX, CJK_REGEX];
const SEPARATOR = "│";

/**
 * @param {string} str
 * @param {RegExp[]} regexs
 */
function matchRegexCharsCount(str: string, regexs: RegExp[]) {
  let counter = 0;
  for (let i = 0; i < str.length; i++) {
    for (let j = 0; j < regexs.length; j++) {
      const regex = regexs[j];
      if (regex.test(str[i])) {
        counter++;
      }
    }
  }
  return counter;
}

/**
 * Formats certain type of values for more readability.
 * @param  {any} value Value to format.
 * @param  {Boolean} isHeaderValue Is this a value in the table header.
 * @return {string} Formatted value.
 */
function getFormattedString(value: any, isHeaderValue: boolean): string {
  // console.log(value);
  if (isHeaderValue) {
  } else if (typeof value === "string") {
    // Wrap strings in inverted commans.
    return '"' + value + '"';
  } else if (typeof value === "function") {
    // Just show `function` for a function.
    return "function";
  } else if (typeof value === "object") {
    return format(value).replace(/\n/g, "");
  }
  return value + "";
}

/**
 * @param {string[][]} rows
 */
function printRows(rows: string[][]) {
  let result = "";

  /**
   * @param {string} str
   */
  function consoleLogHook(str: string) {
    result += str + "\n";
  }

  if (!rows.length) return;
  let row, rowString, padding;
  let tableWidth = 0;
  let numCols = rows[0].length;

  let maxLengthOfFirstColumn = 0;

  // For every column, calculate the maximum width in any row.
  for (let j = 0; j < numCols; j++) {
    let maxLengthForColumn = 0;
    for (let i = 0; i < rows.length; i++) {
      const formattedStr = getFormattedString(rows[i][j], !i || !j);
      const additionalLength = matchRegexCharsCount(formattedStr, FULLWIDTH_REGEXS);
      maxLengthForColumn = Math.max(formattedStr.length + additionalLength, maxLengthForColumn);
    }
    // Give some more padding to biggest string.
    maxLengthForColumn += 4;
    if (j === 0) {
      maxLengthOfFirstColumn = maxLengthForColumn;
    }
    tableWidth += maxLengthForColumn;

    // Give padding to rows for current column.
    for (let i = 0; i < rows.length; i++) {
      const formattedStr = getFormattedString(rows[i][j], !i || !j);
      const additionalLength = matchRegexCharsCount(formattedStr, FULLWIDTH_REGEXS);
      padding = maxLengthForColumn - formattedStr.length - additionalLength;
      // Distribute padding - 1 in starting, rest at the end.
      const offset = j === 0 ? 3 : 2;
      rows[i][j] = " " + formattedStr + " ".repeat(padding - offset);
      if (j === 0) {
        rows[i][j] = "│" + rows[i][j];
      }
    }
  }
  const firstPart = "─".repeat(maxLengthOfFirstColumn - 2);
  const lastPart = "─".repeat(tableWidth - maxLengthOfFirstColumn - 1);

  consoleLogHook("┌" + firstPart + "┬" + lastPart + "┐");
  for (let i = 0; i < rows.length; i++) {
    row = rows[i];
    rowString = "";
    for (let j = 0; j < row.length; j++) {
      rowString += row[j] + SEPARATOR;
    }
    consoleLogHook(rowString);
    // Draw border after table header.
    if (!i) {
      consoleLogHook("├" + firstPart + "┼" + lastPart + "┤");
    }
  }
  consoleLogHook("└" + firstPart + "┴" + lastPart + "┘");
  return result;
}

/**
 * @param {any} data
 */
function printTable(data: any) {
  if (data === null) {
    return "null";
  } else if (data === void 0) {
    return "undefined";
  }

  let result = "";

  /**
   * @param {string} str
   */
  function consoleLogHook(str: string) {
    result += str + "\n";
  }

  /**
   * @type {string[][]}
   */
  const rows: string[][] = [];

  // Simply consoleLogHook if an `object` type wasn't passed.
  if (typeof data !== "object") {
    consoleLogHook(data);
    return result;
  }

  const keys = Object.keys(data).sort();

  // Create header row.
  rows.push([]);
  let row = rows[rows.length - 1];
  row.push("(index)");
  row.push("Values");

  const entry = data;
  for (let i = 0; i < keys.length; i++) {
    rows.push([]);
    row = rows[rows.length - 1];
    row.push(keys[i]);
    row.push(entry[keys[i]]);
  }

  result += printRows(rows);
  return result.trim();
}

export default printTable;
