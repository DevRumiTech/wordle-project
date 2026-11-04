// Load the English and French dictionaries.
const english = require("an-array-of-english-words");
const french = require("an-array-of-french-words");

// Keep only five-letter words without accents.
const validWord = (word) => /^[a-z]{5}$/.test(word);

// Create separate lists for both languages.
const englishWords = english.filter(validWord);
const frenchWords = french.filter(validWord);

// Display the number of valid words.
console.log("English:", englishWords.length);
console.log("French:", frenchWords.length);