/** solidity-coverage: measure the production contracts only. */
module.exports = {
  skipFiles: ["interfaces/", "mocks/"],
  istanbulReporter: ["text", "text-summary", "json-summary", "html"],
};
