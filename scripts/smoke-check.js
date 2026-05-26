const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");

function checkSyntax(relativePath) {
  const absolutePath = path.join(root, relativePath);
  const result = spawnSync(process.execPath, ["--check", absolutePath], {
    encoding: "utf8"
  });
  assert.strictEqual(result.status, 0, `${relativePath} syntax check failed:\n${result.stderr || result.stdout}`);
}

function readJson(relativePath) {
  const absolutePath = path.join(root, relativePath);
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function checkExperimentReferences(content) {
  const blocks = asArray(content.testBlocks);
  const groups = asArray(content.specimenGroups);
  const results = asArray(content.testResults);
  const gangues = asArray(content.coalGangueDb);

  const blockIds = new Set(blocks.map((item) => item && item.id).filter(Boolean));
  const groupIds = new Set(groups.map((item) => item && item.id).filter(Boolean));
  const legacyBlockIds = new Set(groups.map((item) => item && item.legacyBlockId).filter(Boolean));
  const gangueIds = new Set(gangues.map((item) => item && item.id).filter(Boolean));

  for (const group of groups) {
    if (group.legacyBlockId) {
      assert(blockIds.has(group.legacyBlockId), `specimenGroups ${group.id || "(missing id)"} legacyBlockId is broken: ${group.legacyBlockId}`);
    }
    if (group.coalGangueBatchId) {
      assert(gangueIds.has(group.coalGangueBatchId), `specimenGroups ${group.id || "(missing id)"} coalGangueBatchId is broken: ${group.coalGangueBatchId}`);
    }
  }

  for (const result of results) {
    const specimenGroupId = result && result.specimenGroupId;
    if (!specimenGroupId) continue;
    assert(
      groupIds.has(specimenGroupId) || blockIds.has(specimenGroupId) || legacyBlockIds.has(specimenGroupId),
      `testResults ${result.id || "(missing id)"} specimenGroupId is broken: ${specimenGroupId}`
    );
  }
}

checkSyntax("server.js");
checkSyntax(path.join("assets", "workspace.js"));

const packageJson = readJson("package.json");
assert(packageJson.version, "package.json version is missing");

readJson(path.join("data", "reminder-state.json"));
const content = readJson(path.join("data", "content.json"));
checkExperimentReferences(content);

console.log("smoke check ok");
