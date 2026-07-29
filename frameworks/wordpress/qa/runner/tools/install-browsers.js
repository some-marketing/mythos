#!/usr/bin/env node
import os from "os";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

function computeHostPlatformOverride() {
  if (process.platform !== "darwin") return null;
  if (process.arch !== "arm64") return null;
  try {
    if (os.cpus().some((cpu) => String(cpu?.model || "").includes("Apple"))) return null;
  } catch {}
  const major = parseInt(String(os.release()).split(".")[0] || "", 10);
  if (!Number.isFinite(major)) return null;
  if (major < 20) return null;
  const lastStableMacMajor = 15;
  const macMajor = Math.min(major - 9, lastStableMacMajor);
  return `mac${macMajor}-arm64`;
}

const env = { ...process.env };
{
  const tmpDir = env.PW_TMPDIR || path.join(process.cwd(), ".tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  env.TMPDIR = tmpDir;
}
if (!env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE) {
  const override = computeHostPlatformOverride();
  if (override) env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE = override;
}

const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(npxCmd, ["playwright", "install"], { stdio: "inherit", env });
process.exit(result.status ?? 1);
