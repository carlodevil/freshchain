#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const [distDirArg, zipName] = process.argv.slice(2);

if (!distDirArg || !zipName) {
  console.error("Usage: node scripts/zip-html5-app.js <dist-dir> <zip-name>");
  process.exit(2);
}

const distDir = path.resolve(process.cwd(), distDirArg);
const zipPath = path.join(distDir, zipName);

if (!fs.existsSync(path.join(distDir, "manifest.json"))) {
  console.error(`Missing manifest.json in ${distDir}`);
  process.exit(2);
}

const componentPath = path.join(distDir, "Component.js");
const preloadPath = path.join(distDir, "Component-preload.js");
if (fs.existsSync(componentPath) && !fs.existsSync(preloadPath)) {
  const manifest = JSON.parse(fs.readFileSync(path.join(distDir, "manifest.json"), "utf8"));
  const namespace = String(manifest?.["sap.app"]?.id || "").replace(/\./g, "/");
  if (!namespace) {
    console.error(`Cannot create Component-preload.js without sap.app/id in ${distDir}`);
    process.exit(2);
  }
  const componentSource = fs.readFileSync(componentPath, "utf8");
  const preloadSource = componentSource.replace(
    "sap.ui.define(",
    `sap.ui.predefine("${namespace}/Component", `
  );
  if (preloadSource === componentSource) {
    console.error(`Cannot create Component-preload.js from ${componentPath}`);
    process.exit(2);
  }
  fs.writeFileSync(preloadPath, preloadSource);
}

fs.rmSync(zipPath, { force: true });

const entries = fs
  .readdirSync(distDir)
  .filter((entry) => entry !== zipName)
  .sort();

const bestzipCli = require.resolve("bestzip/bin/cli.js");
const result = spawnSync(process.execPath, [bestzipCli, zipName, ...entries], {
  cwd: distDir,
  stdio: "inherit"
});

process.exit(result.status ?? 1);
