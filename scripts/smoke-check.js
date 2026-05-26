const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

process.env.WORK_LOGIN_PASS ||= "smoke";
process.env.PRIVATE_GALLERY_PASS ||= "smoke";

const root = path.resolve(__dirname, "..");
const {
  normalizeContent,
  getTestBlocks,
  specimenGroupForBlockV25,
  testResultsForBlockV25
} = require("../server");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8").replace(/^\uFEFF/, ""));
}

function hashAsset(relativePath) {
  const data = fs.readFileSync(path.join(root, relativePath));
  return crypto.createHash("sha256").update(data).digest("hex").slice(0, 8);
}

const packageJson = readJson("package.json");
assert.match(String(packageJson.version || ""), /^\d+\.\d+\.\d+$/, "package.json version must be readable");

const cssHash = hashAsset("assets/workspace.css");
const jsHash = hashAsset("assets/workspace.js");
assert.strictEqual(cssHash.length, 8, "workspace.css hash must be 8 chars");
assert.strictEqual(jsHash.length, 8, "workspace.js hash must be 8 chars");

const content = normalizeContent(readJson("data/content.json"));
assert.ok(Array.isArray(content.testBlocks), "content.testBlocks must normalize to an array");
assert.ok(Array.isArray(content.specimenGroups), "content.specimenGroups must normalize to an array");
assert.ok(Array.isArray(content.testResults), "content.testResults must normalize to an array");

const blocks = getTestBlocks(content);
const specimenGroups = content.specimenGroups.length ? content.specimenGroups : blocks.map(specimenGroupForBlockV25);
const testResults = content.testResults.length ? content.testResults : blocks.flatMap(testResultsForBlockV25);
const groupIds = new Set(specimenGroups.map((item) => String(item.id || "")));
const blockIds = new Set(blocks.map((item) => String(item.id || "")));

for (const block of blocks) {
  assert.ok(block.id, `block is missing id: ${block.name || "(unnamed)"}`);
  assert.ok(blockIds.has(block.id), `block id not indexed: ${block.id}`);
  assert.ok(groupIds.has(block.specimenGroupId || block.id), `block specimenGroupId is not present in specimenGroups: ${block.id}`);
}

for (const result of testResults) {
  assert.ok(result.id, "test result is missing id");
  assert.ok(groupIds.has(String(result.specimenGroupId || "")), `test result has broken specimenGroupId: ${result.id}`);
}

console.log(`smoke ok: version=${packageJson.version}, css=${cssHash}, js=${jsHash}, blocks=${blocks.length}, groups=${specimenGroups.length}, results=${testResults.length}`);
