import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { rewardedUnitId, interstitialUnitId } from "@/src/ads/adConfig";

// AdMob native module only exists in a Dev/Production build — NOT in Expo Go
// (StoreClient) and NOT on web. Guard so we never require() it elsewhere.
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
export const admobAvailable = Platform.OS !== "web" && !isExpoGo;

let mod: any = null;
export function getAdmob(): any {
  if (!admobAvailable) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native module is intentionally lazy-loaded; only exists in dev/prod builds (not Expo Go / web).
  if (!mod) mod = require("react-native-google-mobile-ads");
  return mod;
}

export async function showRewardedAdmob(unitId?: string): Promise<boolean> {
  const m = getAdmob();
  if (!m) return false;
  const { RewardedAd, RewardedAdEventType, AdEventType, TestIds } = m;
  const id = unitId || rewardedUnitId(TestIds);
  return new Promise<boolean>((resolve) => {
    const ad = RewardedAd.createForAdRequest(id, { requestNonPersonalizedAdsOnly: true });
    let earned = false;
    let settled = false;
    const finish = (v: boolean) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    ad.addAdEventListener(RewardedAdEventType.LOADED, () => ad.show());
    ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
      earned = true;
    });
    ad.addAdEventListener(AdEventType.CLOSED, () => finish(earned));
    ad.addAdEventListener(AdEventType.ERROR, () => finish(false));
    try {
      ad.load();
    } catch {
      finish(false);
    }
  });
}


export async function showInterstitialAdmob(unitId?: string): Promise<boolean> {
  const m = getAdmob();
  if (!m) return false;
  const { InterstitialAd, AdEventType, TestIds } = m;
  const id = unitId || interstitialUnitId(TestIds);
  return new Promise<boolean>((resolve) => {
    const ad = InterstitialAd.createForAdRequest(id, { requestNonPersonalizedAdsOnly: true });
    let settled = false;
    const finish = (v: boolean) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    ad.addAdEventListener(AdEventType.LOADED, () => ad.show());
    ad.addAdEventListener(AdEventType.CLOSED, () => finish(true));
    ad.addAdEventListener(AdEventType.ERROR, () => finish(false));
    try {
      ad.load();
    } catch {
      finish(false);
    }
  });
}
