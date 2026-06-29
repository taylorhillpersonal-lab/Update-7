// Dynamic Expo config.
//
// The static config lives in app.json; this file layers the per-deploy values
// on top of it, read from the environment (frontend/.env, written by
// backend/api_keys.py). That keeps app.json + this file as CODE/STATIC only —
// no per-deploy data is committed, so GitHub can override the core files
// safely. Expo automatically loads .env before evaluating this file.
//
// Env vars used (all optional; sensible fallbacks below):
//   EXPO_PUBLIC_ANDROID_PACKAGE
//   EXPO_PUBLIC_ADMOB_ANDROID_APP_ID
//   EXPO_PUBLIC_ADMOB_IOS_APP_ID

module.exports = ({ config }) => {
  // `config` is the contents of app.json's "expo" object.
  const androidPackage =
    process.env.EXPO_PUBLIC_ANDROID_PACKAGE ||
    (config.android && config.android.package) ||
    "com.tycoonempire.app";

  const androidAppId = process.env.EXPO_PUBLIC_ADMOB_ANDROID_APP_ID || "";
  const iosAppId = process.env.EXPO_PUBLIC_ADMOB_IOS_APP_ID || "";

  const plugins = (config.plugins || []).map((plugin) => {
    if (
      Array.isArray(plugin) &&
      plugin[0] === "react-native-google-mobile-ads"
    ) {
      const opts = { ...(plugin[1] || {}) };
      // Only set the App IDs when provided; the AdMob plugin rejects empty
      // strings at prebuild, so omit them until you add real IDs.
      if (androidAppId) opts.androidAppId = androidAppId;
      if (iosAppId) opts.iosAppId = iosAppId;
      return ["react-native-google-mobile-ads", opts];
    }
    return plugin;
  });

  return {
    ...config,
    android: { ...(config.android || {}), package: androidPackage },
    plugins,
  };
};
