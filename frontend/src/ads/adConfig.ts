// Central AdMob unit-ID config.
//
// Values come from the environment (frontend/.env, written by backend/api_keys.py),
// so this file holds CODE ONLY — no IDs are stored here and GitHub can override
// it freely.
//
// We deliberately serve Google's official TEST ad units while developing
// (__DEV__ === true) and only use the REAL units in production release builds.
// This prevents "invalid traffic" / self-click bans on your AdMob account.
// If a REAL unit id is empty we also fall back to the TEST unit.

const REAL = {
  banner: process.env.EXPO_PUBLIC_ADMOB_BANNER_ID ?? "",
  rewarded: process.env.EXPO_PUBLIC_ADMOB_REWARDED_ID ?? "",
  interstitial: process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_ID ?? "",
};

export function bannerUnitId(TestIds: any): string {
  return __DEV__ || !REAL.banner ? TestIds.BANNER : REAL.banner;
}

export function rewardedUnitId(TestIds: any): string {
  return __DEV__ || !REAL.rewarded ? TestIds.REWARDED : REAL.rewarded;
}

export function interstitialUnitId(TestIds: any): string {
  return __DEV__ || !REAL.interstitial ? TestIds.INTERSTITIAL : REAL.interstitial;
}
