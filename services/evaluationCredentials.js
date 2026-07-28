const crypto = require("node:crypto");

function encryptionKey() {
  const configured = process.env.EVALUATION_CREDENTIALS_KEY;
  if (!configured) throw new Error("EVALUATION_CREDENTIALS_KEY is required to store judge API keys");
  const key = /^[a-f0-9]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (key.length !== 32) throw new Error("EVALUATION_CREDENTIALS_KEY must be 32 bytes (64 hex characters or base64)");
  return key;
}

function encryptSecret(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}

function decryptSecret(value) {
  if (!value) return null;
  const [version, iv, tag, encrypted] = String(value).split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Unsupported encrypted credential format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]).toString("utf8");
}

module.exports = { encryptSecret, decryptSecret };
