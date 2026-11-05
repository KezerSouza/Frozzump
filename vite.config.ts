import { defineConfig } from "vite";

// Relative base so the build works under any GitHub Pages path
// (https://<user>.github.io/<repo>/) without hardcoding the repo name.
export default defineConfig({
  base: "./",
});
