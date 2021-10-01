"use strict";

// modified from github: sindresorhus/array-shuffle (the original repo is under the MIT licnese)

/**
 * @template T
 * @param {T[]} array
 * @returns {T[]}
 */
module.exports = function arrayShuffle(array) {
	if (!Array.isArray(array)) {
		throw new TypeError(`Expected an array, got ${typeof array}`);
	}

	array = [...array];

	for (let index = array.length - 1; index > 0; index--) {
		const newIndex = Math.floor(Math.random() * (index + 1));
		[array[index], array[newIndex]] = [array[newIndex], array[index]];
	}

	return array;
}
