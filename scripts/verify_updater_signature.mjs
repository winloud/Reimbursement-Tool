// Tauri wraps minisign public keys and signatures in another base64 layer.
// Format: https://jedisct1.github.io/minisign/#signature-format
// Crypto: https://nodejs.org/api/crypto.html#cryptoverifyalgorithm-data-key-signature-callback
import { createHash, createPublicKey, verify } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function decode(text) {
  const value = text.trim();
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new Error("Invalid base64 encoding.");
  return bytes;
}

export async function verifyUpdaterSignature(file, signaturePath, configPath) {
  const config = JSON.parse(readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
  const publicLines = decode(config.plugins.updater.pubkey).toString("utf8").trimEnd().split(/\r?\n/);
  const signatureLines = decode(readFileSync(signaturePath, "utf8")).toString("utf8").trimEnd().split(/\r?\n/);
  if (publicLines.length !== 2 || signatureLines.length !== 4 ||
      !publicLines[0].startsWith("untrusted comment:") ||
      !signatureLines[0].startsWith("untrusted comment:") ||
      !signatureLines[2].startsWith("trusted comment: ")) {
    throw new Error("Invalid minisign envelope.");
  }
  const publicPacket = decode(publicLines[1]);
  const signaturePacket = decode(signatureLines[1]);
  const commentSignature = decode(signatureLines[3]);
  if (publicPacket.length !== 42 || signaturePacket.length !== 74 || commentSignature.length !== 64 ||
      publicPacket.subarray(0, 2).toString() !== "Ed" || signaturePacket.subarray(0, 2).toString() !== "ED") {
    throw new Error("Expected a prehashed Ed25519 minisign signature.");
  }
  if (!publicPacket.subarray(2, 10).equals(signaturePacket.subarray(2, 10))) {
    throw new Error("Signature key does not match the embedded updater public key.");
  }
  const publicKey = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicPacket.subarray(10)]),
    format: "der", type: "spki",
  });
  const hash = createHash("blake2b512");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const signature = signaturePacket.subarray(10);
  if (!verify(null, hash.digest(), publicKey, signature)) throw new Error("Installer signature verification failed.");
  const trustedComment = Buffer.from(signatureLines[2].slice("trusted comment: ".length), "utf8");
  if (!verify(null, Buffer.concat([signature, trustedComment]), publicKey, commentSignature)) {
    throw new Error("Trusted comment signature verification failed.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 5) throw new Error("Usage: node verify_updater_signature.mjs FILE SIGNATURE TAURI_CONFIG");
    await verifyUpdaterSignature(...process.argv.slice(2));
    console.log("Updater signature verified against the embedded public key.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
