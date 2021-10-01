// @ts-check

const { inspect } = require("util");
const verbose = require("./_verbose");

/**
 * @type {Map<string | number, { value: any; ttl: number; timer: NodeJS.Timeout; }>}
 */
const cacheMap = new Map();

/**
 * @param {string | number} name
 * @param {any} value
 * @param {number} ttl
 * @returns {void}
 */
function add(name, value, ttl) {
  if(has(name)) {
    verbose(`add(...): has("${name}") is true. Calling upd(...) ...`);
    return upd(name, value, ttl);
  }

  const id = Number.isFinite(ttl) ? setTimeout(() => {
    del(name);
  }, ttl) : setTimeout(() => {}, 0);

  cacheMap.set(name, { value: value, ttl: ttl, timer: id });
  verbose(`add(...): "${name}" was successfully added to cache.`);
}

/**
 * @param {string | number} name
 * @returns {void}
 */
function del(name) {
  if(!has(name)) {
    verbose(`del(...): "${name}" was already deleted.`);
    return;
  }

  const data = cacheMap.get(name);

  clearTimeout(data.timer);
  cacheMap.delete(name);

  verbose(`del(...): "${name}" was successfully deleted from cache.`);
}

/**
 * @param {string | number} name
 * @returns {any}
 */
function get(name) {
  if(!has(name)) {
    verbose(`get(...): "${name}" doesn't exist.`);
    return;
  }

  const data = cacheMap.get(name);
  return data.value;
}

/**
 * @param {string | number} name
 * @returns {boolean}
 */
function has(name) {
  return cacheMap.has(name);
}

function keys() {
  return Array.from(cacheMap.keys());
}

/**
 * @param {string | number} name
 * @param {any} value
 * @param {number} ttl
 * @returns {void}
 */
function upd(name, value, ttl) {
  if(!has(name)) {
    verbose(`upd(...): has("${name}") is false. Calling add(...) ...`);
    return add(name, value, ttl);
  }

  const data = cacheMap.get(name);

  clearTimeout(data.timer);
  const id = Number.isFinite(ttl) ? setTimeout(() => {
    del(name);
  }, ttl) : setTimeout(() => {}, 0);
  cacheMap.set(name, { value: value, ttl: ttl, timer: id });
  verbose(`upd(...): "${name}" was successfully updated.`);
}


/**
 * @returns {string}
 */
function stringify() {
  const stored = Array.from(cacheMap.entries());
  return inspect(stored, {
    // higher depth might cause the generated message to exceeds
    // length limit of TG
    depth: 2,
  });
}

module.exports = { add, del, get, has, keys, upd, stringify };
