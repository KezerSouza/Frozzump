import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

// Relative base so the build works under any GitHub Pages path
// (https://<user>.github.io/<repo>/) without hardcoding the repo name.
export default defineConfig({
  base: "./",
  // game version (package.json), shown in the multiplayer lobby
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
});
