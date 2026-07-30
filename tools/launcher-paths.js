"use strict";

const os = require("node:os");
const path = require("node:path");

function resolveAppPaths({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const paths = platform === "win32" ? path.win32 : path;
  const root = env.YELLOW_BEAST_DATA_DIR || (platform === "darwin"
    ? paths.join(home, "Library", "Application Support", "Yellow Beast")
    : platform === "win32"
      ? paths.join(env.APPDATA || paths.join(home, "AppData", "Roaming"), "Yellow Beast")
      : paths.join(env.XDG_DATA_HOME || paths.join(home, ".local", "share"), "yellow-beast"));
  return { root, saves: paths.join(root, "saves"), worlds: paths.join(root, "worlds"), config: paths.join(root, "config.json"), logs: paths.join(root, "logs"), log: paths.join(root, "logs", "launcher.log") };
}
module.exports = { resolveAppPaths };
