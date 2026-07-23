const test = require("node:test");
const assert = require("node:assert/strict");
const { encryptSecret, decryptSecret } = require("../services/evaluationCredentials");

test("judge API keys are authenticated-encrypted and decryptable", () => {
  const previous = process.env.EVALUATION_CREDENTIALS_KEY;
  process.env.EVALUATION_CREDENTIALS_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  try {
    const encrypted = encryptSecret("provider-secret");
    assert.notEqual(encrypted, "provider-secret");
    assert.equal(decryptSecret(encrypted), "provider-secret");
    assert.throws(() => decryptSecret(`${encrypted.slice(0, -2)}aa`));
  } finally {
    if (previous === undefined) delete process.env.EVALUATION_CREDENTIALS_KEY;
    else process.env.EVALUATION_CREDENTIALS_KEY = previous;
  }
});
