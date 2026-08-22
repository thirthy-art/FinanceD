import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ENVELOPE_VERSION = "v1";

export type AiSecretKind = "mimo" | "openrouter";

export class AiSettingsCryptoError extends Error {
  constructor() {
    super("AI settings encryption is unavailable.");
    this.name = "AiSettingsCryptoError";
  }
}

function masterKey(): Buffer {
  const encoded = process.env.AI_SETTINGS_ENCRYPTION_KEY?.trim();
  if (!encoded) throw new AiSettingsCryptoError();

  try {
    const decoded = Buffer.from(encoded, "base64");
    if (decoded.length !== 32 || decoded.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) {
      throw new AiSettingsCryptoError();
    }
    return decoded;
  } catch {
    throw new AiSettingsCryptoError();
  }
}

function additionalData(kind: AiSecretKind): Buffer {
  return Buffer.from(`FinanceD:ai-settings:${kind}:${ENVELOPE_VERSION}`, "utf8");
}

export function encryptAiSecret(plaintext: string, kind: AiSecretKind): string {
  try {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, masterKey(), iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(additionalData(kind));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [ENVELOPE_VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
  } catch {
    throw new AiSettingsCryptoError();
  }
}

export function decryptAiSecret(envelope: string, kind: AiSecretKind): string {
  try {
    const [version, ivValue, tagValue, ciphertextValue, extra] = envelope.split(".");
    if (version !== ENVELOPE_VERSION || !ivValue || !tagValue || !ciphertextValue || extra !== undefined) {
      throw new AiSettingsCryptoError();
    }
    const iv = Buffer.from(ivValue, "base64url");
    const tag = Buffer.from(tagValue, "base64url");
    const ciphertext = Buffer.from(ciphertextValue, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || ciphertext.length === 0) {
      throw new AiSettingsCryptoError();
    }
    const decipher = createDecipheriv(ALGORITHM, masterKey(), iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(additionalData(kind));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new AiSettingsCryptoError();
  }
}
