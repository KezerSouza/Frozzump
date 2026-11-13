import type { CapacitorConfig } from "@capacitor/cli";

// Android app: the same web build (dist/) inside a WebView, locked to landscape and fullscreen
// (see android/app/src/main/AndroidManifest.xml and MainActivity.java). Build with `npm run apk`.
const config: CapacitorConfig = {
  appId: "io.github.kezersouza.snowgo",
  appName: "Snow Go",
  webDir: "dist",
  backgroundColor: "#0c1624",
  android: {
    backgroundColor: "#0c1624",
  },
};

export default config;
