import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radius, spacing } from "@/src/game/theme";
import { money, abbreviate } from "@/src/game/format";
import { useGame } from "@/src/game/GameContext";
import { useProfile } from "@/src/game/ProfileProvider";
import { haptic } from "@/src/game/haptics";
import {
  City,
  CitySummary,
  CITY_FOUND_COST,
  approveCityRequest,
  cancelJoinRequest,
  createCity,
  fetchCities,
  fetchMyCity,
  joinCity,
  kickCityMember,
  leaveCity,
  rejectCityRequest,
  setCityPolicy,
  upgradeCity,
} from "@/src/game/api";

export default function CitiesScreen() {
  const { state, setCity, adjustGems, showToast } = useGame();
  const { openProfile } = useProfile();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const deviceId = state?.deviceId ?? "";
  const gems = state?.gems ?? 0;

  const [mine, setMine] = useState<City | null>(null);
  const [cities, setCities] = useState<CitySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const isMayor = !!mine && mine.mayor_device_id === deviceId;

  const load = useCallback(async () => {
    if (!deviceId) return;
    try {
      const me = await fetchMyCity(deviceId);
      setMine(me);
      setCity(me?.id ?? null, me?.boost ?? 1);
      const data = await fetchCities(deviceId);
      setCities(data.cities);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [deviceId, setCity]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load]),
  );

  const onCreate = async () => {
    if (!name.trim() || busy) return;
    if (gems < CITY_FOUND_COST) {
      showToast(`Need ${CITY_FOUND_COST.toLocaleString()} gems to found a City`);
      return;
    }
    setBusy(true);
    try {
      await createCity(deviceId, name.trim(), tag.trim());
      adjustGems(-CITY_FOUND_COST);
      haptic("success");
      showToast("City founded — you're the Mayor!");
      setName("");
      setTag("");
      await load();
    } catch (e: any) {
      showToast(e?.message || "Couldn't create City");
    } finally {
      setBusy(false);
    }
  };

  const onUpgrade = async () => {
    if (!mine || busy) return;
    const cost = mine.next_upgrade_cost;
    if (cost == null) return;
    if (gems < cost) {
      showToast(`Need ${cost.toLocaleString()} gems for this upgrade`);
      return;
    }
    setBusy(true);
    try {
      const updated = await upgradeCity(mine.id, deviceId);
      adjustGems(-cost);
      setMine(updated);
      setCity(updated.id, updated.boost);
      haptic("success");
      showToast(`City upgraded — +${Math.round(updated.upgrade_boost * 100)}% income for all citizens!`);
    } catch (e: any) {
      showToast(e?.message || "Couldn't upgrade");
    } finally {
      setBusy(false);
    }
  };

  const onJoin = async (id: string) => {
    setBusy(true);
    try {
      const res = await joinCity(id, deviceId);
      haptic("success");
      if (res.status === "requested") {
        showToast("Request sent — waiting for the Mayor to approve");
      } else {
        showToast("Joined the City!");
      }
      await load();
    } catch {
      showToast("Couldn't join");
    } finally {
      setBusy(false);
    }
  };

  const onCancelRequest = async (id: string) => {
    setBusy(true);
    try {
      await cancelJoinRequest(id, deviceId);
      haptic("light");
      showToast("Join request cancelled");
      await load();
    } catch {
      showToast("Couldn't cancel request");
    } finally {
      setBusy(false);
    }
  };

  const onKick = async (targetId: string) => {
    if (!mine || busy) return;
    setBusy(true);
    try {
      const updated = await kickCityMember(mine.id, deviceId, targetId);
      setMine(updated);
      haptic("medium");
      showToast("Member removed");
    } catch (e: any) {
      showToast(e?.message || "Couldn't remove member");
    } finally {
      setBusy(false);
    }
  };

  const onApprove = async (targetId: string) => {
    if (!mine || busy) return;
    setBusy(true);
    try {
      const updated = await approveCityRequest(mine.id, deviceId, targetId);
      setMine(updated);
      haptic("success");
      showToast("Member approved!");
    } catch (e: any) {
      showToast(e?.message || "Couldn't approve");
    } finally {
      setBusy(false);
    }
  };

  const onReject = async (targetId: string) => {
    if (!mine || busy) return;
    setBusy(true);
    try {
      const updated = await rejectCityRequest(mine.id, deviceId, targetId);
      setMine(updated);
      haptic("light");
      showToast("Request declined");
    } catch (e: any) {
      showToast(e?.message || "Couldn't decline");
    } finally {
      setBusy(false);
    }
  };

  const onTogglePolicy = async () => {
    if (!mine || busy) return;
    const next = mine.join_policy === "open" ? "manual" : "open";
    setBusy(true);
    try {
      const updated = await setCityPolicy(mine.id, deviceId, next);
      setMine(updated);
      haptic("medium");
      showToast(next === "open" ? "City is now Open to everyone" : "Joining now needs your approval");
    } catch (e: any) {
      showToast(e?.message || "Couldn't update policy");
    } finally {
      setBusy(false);
    }
  };

  const openCityChat = () => {
    if (!mine) return;
    haptic("light");
    router.push({
      pathname: "/citychat",
      params: { cityId: mine.id, cityName: mine.name, cityTag: mine.tag },
    });
  };

  const onLeave = async () => {
    if (!mine || busy) return;
    setBusy(true);
    try {
      await leaveCity(mine.id, deviceId);
      setCity(null, 1);
      haptic("medium");
      showToast("You left the City");
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container} testID="cities-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.headerIcon}>
          <MaterialCommunityIcons name="city-variant" size={24} color={colors.brandTertiary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Cities</Text>
          <Text style={styles.subtitle}>Team up for shared boosters</Text>
        </View>
        <View style={styles.gemPill}>
          <MaterialCommunityIcons name="diamond-stone" size={16} color={colors.brandTertiary} />
          <Text style={styles.gemText}>{abbreviate(gems)}</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
          showsVerticalScrollIndicator={false}
        >
          {mine ? (
            <View style={styles.myCity}>
              <LinearGradient
                colors={[colors.brandPrimary, "#FF8F00"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.myCityHead}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.myCityName}>
                    {mine.tag ? `[${mine.tag}] ` : ""}
                    {mine.name}
                  </Text>
                  <Text style={styles.myCitySub}>{mine.member_count} members</Text>
                </View>
                <View style={styles.boostBadge}>
                  <MaterialCommunityIcons name="rocket-launch" size={16} color={colors.onBrandPrimary} />
                  <Text style={styles.boostText}>+{Math.round((mine.boost - 1) * 100)}% income</Text>
                </View>
              </LinearGradient>

              {/* Shared City upgrade — boosts every citizen's income */}
              <View style={styles.upgradeCard} testID="city-upgrade-card">
                <View style={styles.upgradeIcon}>
                  <MaterialCommunityIcons name="office-building-marker" size={24} color={colors.brandTertiary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.upgradeTitle}>City Upgrades · Lv {mine.upgrade_level}</Text>
                  <Text style={styles.upgradeSub}>
                    +{Math.round(mine.upgrade_boost * 100)}% income for all citizens
                  </Text>
                </View>
                {mine.upgrade_maxed ? (
                  <View style={styles.upgradeMaxed}>
                    <Text style={styles.upgradeMaxedText}>MAX</Text>
                  </View>
                ) : (
                  <Pressable
                    testID="upgrade-city-button"
                    onPress={onUpgrade}
                    disabled={busy || gems < (mine.next_upgrade_cost ?? 0)}
                    style={[styles.upgradeBtn, gems < (mine.next_upgrade_cost ?? 0) && styles.upgradeBtnDisabled]}
                  >
                    <MaterialCommunityIcons name="diamond-stone" size={14} color={colors.onBrandTertiary} />
                    <Text style={styles.upgradeBtnText}>{(mine.next_upgrade_cost ?? 0).toLocaleString()}</Text>
                  </Pressable>
                )}
              </View>

              {/* City Chat */}
              <Pressable testID="city-chat-button" onPress={openCityChat} style={styles.cityChatBtn}>
                <MaterialCommunityIcons name="chat" size={18} color={colors.onBrandPrimary} />
                <Text style={styles.cityChatText}>Open City Chat</Text>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onBrandPrimary} />
              </Pressable>

              {/* Mayor: join policy */}
              {isMayor && (
                <Pressable testID="city-policy-toggle" onPress={onTogglePolicy} disabled={busy} style={styles.policyRow}>
                  <MaterialCommunityIcons
                    name={mine.join_policy === "open" ? "lock-open-variant" : "shield-account"}
                    size={20}
                    color={colors.brandTertiary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.policyTitle}>
                      {mine.join_policy === "open" ? "Open to everyone" : "Approval required"}
                    </Text>
                    <Text style={styles.policySub}>
                      {mine.join_policy === "open"
                        ? "Anyone can join instantly. Tap to require approval."
                        : "You approve each new member. Tap to open to all."}
                    </Text>
                  </View>
                  <View style={[styles.toggle, mine.join_policy === "open" && styles.toggleOn]}>
                    <View style={[styles.toggleKnob, mine.join_policy === "open" && styles.toggleKnobOn]} />
                  </View>
                </Pressable>
              )}

              {/* Mayor: pending join requests */}
              {isMayor && mine.pending_requests.length > 0 && (
                <View style={styles.requestsBox} testID="city-requests">
                  <Text style={styles.requestsTitle}>
                    Join Requests ({mine.pending_requests.length})
                  </Text>
                  {mine.pending_requests.map((r) => (
                    <View key={r.device_id} style={styles.requestRow} testID={`city-request-${r.device_id}`}>
                      <Pressable onPress={() => openProfile(r.device_id)} style={{ flex: 1 }} hitSlop={6}>
                        <Text style={styles.memberName}>{r.name}</Text>
                        <Text style={styles.memberRole}>{money(r.net_worth)} · {r.prestige_points} investors</Text>
                      </Pressable>
                      <Pressable
                        testID={`city-approve-${r.device_id}`}
                        onPress={() => onApprove(r.device_id)}
                        disabled={busy}
                        style={styles.approveBtn}
                      >
                        <MaterialCommunityIcons name="check" size={18} color={colors.onBrandSecondary} />
                      </Pressable>
                      <Pressable
                        testID={`city-reject-${r.device_id}`}
                        onPress={() => onReject(r.device_id)}
                        disabled={busy}
                        style={styles.rejectBtn}
                      >
                        <MaterialCommunityIcons name="close" size={18} color={colors.error} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}

              {mine.members.map((m) => (
                <View key={m.device_id} style={styles.memberRow}>
                  <Pressable
                    testID={`city-member-${m.device_id}`}
                    onPress={() => openProfile(m.device_id)}
                    style={styles.memberTap}
                    hitSlop={6}
                  >
                    <MaterialCommunityIcons
                      name={m.is_mayor ? "crown" : "account"}
                      size={20}
                      color={m.is_mayor ? "#FFD700" : colors.onSurfaceTertiary}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>
                        {m.name}
                        {m.device_id === deviceId ? " (You)" : ""}
                      </Text>
                      <Text style={styles.memberRole}>{m.is_mayor ? "Mayor" : "Citizen"}</Text>
                    </View>
                    <Text style={styles.memberWorth}>{money(m.net_worth)}</Text>
                  </Pressable>
                  {isMayor && m.device_id !== deviceId && (
                    <Pressable
                      testID={`city-kick-${m.device_id}`}
                      onPress={() => onKick(m.device_id)}
                      disabled={busy}
                      hitSlop={8}
                      style={styles.kickBtn}
                    >
                      <MaterialCommunityIcons name="account-remove" size={18} color={colors.error} />
                    </Pressable>
                  )}
                </View>
              ))}

              <Pressable testID="leave-city-button" onPress={onLeave} disabled={busy} style={styles.leaveBtn}>
                <MaterialCommunityIcons name="exit-run" size={16} color={colors.error} />
                <Text style={styles.leaveText}>Leave City</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.createCard}>
              <Text style={styles.sectionTitle}>Found a New City</Text>
              <Text style={styles.foundCost}>
                Costs {CITY_FOUND_COST.toLocaleString()} gems · you become the Mayor
              </Text>
              <TextInput
                testID="city-name-input"
                value={name}
                onChangeText={setName}
                placeholder="City name"
                placeholderTextColor={colors.onSurfaceTertiary}
                maxLength={24}
                style={styles.input}
              />
              <TextInput
                testID="city-tag-input"
                value={tag}
                onChangeText={(t) => setTag(t.toUpperCase())}
                placeholder="TAG (max 5)"
                placeholderTextColor={colors.onSurfaceTertiary}
                maxLength={5}
                autoCapitalize="characters"
                style={styles.input}
              />
              <Pressable testID="create-city-button" onPress={onCreate} disabled={busy || !name.trim()} style={styles.createBtn}>
                <LinearGradient
                  colors={[colors.brandSecondary, "#00C853"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.createGrad}
                >
                  <Text style={styles.createBtnText}>Found City (be the Mayor)</Text>
                </LinearGradient>
              </Pressable>
            </View>
          )}

          {/* City vs City leaderboard */}
          <View style={styles.boardHead}>
            <Text style={styles.sectionTitle}>City Leaderboard</Text>
          </View>

          {cities.length === 0 && <Text style={styles.empty}>No Cities yet — found the first one!</Text>}
          {cities.map((c) => {
            const isMine = mine?.id === c.id;
            return (
              <View key={c.id} testID={`city-row-${c.id}`} style={[styles.cityRow, isMine && styles.cityRowMine]}>
                <Text style={styles.cityRank}>#{c.rank}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cityName} numberOfLines={1}>
                    {c.tag ? `[${c.tag}] ` : ""}
                    {c.name}
                  </Text>
                  <Text style={styles.cityMeta}>
                    {c.member_count} members · {money(c.total_net_worth)}
                  </Text>
                </View>
                {!mine && (
                  c.requested ? (
                    <Pressable testID={`cancel-request-${c.id}`} onPress={() => onCancelRequest(c.id)} disabled={busy} style={styles.cancelBtn}>
                      <Text style={styles.cancelText}>Cancel</Text>
                    </Pressable>
                  ) : (
                    <Pressable testID={`join-city-${c.id}`} onPress={() => onJoin(c.id)} disabled={busy} style={styles.joinBtn}>
                      <Text style={styles.joinText}>{c.join_policy === "manual" ? "Request" : "Join"}</Text>
                    </Pressable>
                  )
                )}
                {isMine && (
                  <View style={styles.youTag}>
                    <Text style={styles.youText}>Yours</Text>
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandTertiary + "1F",
  },
  title: { color: colors.onSurface, fontSize: 24, fontWeight: "900" },
  subtitle: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "600", marginTop: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.lg, gap: spacing.sm },
  myCity: { gap: spacing.xs },
  myCityHead: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  myCityName: { color: colors.onBrandPrimary, fontSize: 20, fontWeight: "900" },
  myCitySub: { color: colors.onBrandPrimary, fontSize: 13, fontWeight: "700", opacity: 0.9 },
  boostBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(0,0,0,0.2)",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  boostText: { color: colors.onBrandPrimary, fontSize: 12, fontWeight: "900" },
  gemPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.brandTertiary + "1F",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  gemText: { color: colors.brandTertiary, fontSize: 15, fontWeight: "900" },
  upgradeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.brandTertiary,
  },
  upgradeIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandTertiary + "22",
  },
  upgradeTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "900" },
  upgradeSub: { color: colors.brandTertiary, fontSize: 12, fontWeight: "700", marginTop: 2 },
  upgradeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    minWidth: 70,
    justifyContent: "center",
  },
  upgradeBtnDisabled: { opacity: 0.5 },
  upgradeBtnText: { color: colors.onBrandTertiary, fontSize: 14, fontWeight: "900" },
  upgradeMaxed: {
    backgroundColor: colors.brandSecondary + "22",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  upgradeMaxedText: { color: colors.brandSecondary, fontSize: 13, fontWeight: "900" },
  foundCost: { color: colors.brandTertiary, fontSize: 13, fontWeight: "700", marginBottom: spacing.sm },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  memberName: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  memberRole: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "600" },
  memberWorth: { color: colors.brandSecondary, fontSize: 14, fontWeight: "900" },
  memberReport: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  memberTap: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md },
  kickBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.error + "1A",
  },
  cityChatBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  cityChatText: { flex: 1, color: colors.onBrandPrimary, fontSize: 15, fontWeight: "900" },
  policyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  policyTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "900" },
  policySub: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "600", marginTop: 2 },
  toggle: {
    width: 46,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.surfaceTertiary,
    padding: 3,
    justifyContent: "center",
  },
  toggleOn: { backgroundColor: colors.brandSecondary },
  toggleKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" },
  toggleKnobOn: { alignSelf: "flex-end" },
  requestsBox: {
    backgroundColor: colors.brandTertiary + "12",
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.brandTertiary + "55",
    gap: spacing.sm,
  },
  requestsTitle: { color: colors.brandTertiary, fontSize: 13, fontWeight: "900" },
  requestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  approveBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  rejectBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.error + "1A",
    alignItems: "center",
    justifyContent: "center",
  },
  leaveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.error,
  },
  leaveText: { color: colors.error, fontSize: 14, fontWeight: "900" },
  createCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: { color: colors.onSurface, fontSize: 17, fontWeight: "900", marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "700",
    borderWidth: 1,
    borderColor: colors.border,
  },
  createBtn: { borderRadius: radius.pill, overflow: "hidden", marginTop: spacing.xs },
  createGrad: { paddingVertical: spacing.lg, alignItems: "center" },
  createBtnText: { color: colors.onBrandSecondary, fontSize: 15, fontWeight: "900" },
  boardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.lg,
  },
  prizePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  prizeText: { color: colors.onBrandTertiary, fontSize: 12, fontWeight: "900" },
  empty: { color: colors.onSurfaceTertiary, fontSize: 14, fontWeight: "700", textAlign: "center", paddingVertical: spacing.lg },
  cityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cityRowMine: { borderColor: colors.brandPrimary },
  cityRank: { color: colors.onSurfaceTertiary, fontSize: 16, fontWeight: "900", width: 34 },
  cityName: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  cityMeta: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "600" },
  joinBtn: {
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  joinText: { color: colors.onBrandPrimary, fontSize: 13, fontWeight: "900" },
  cancelBtn: {
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.error,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  cancelText: { color: colors.error, fontSize: 13, fontWeight: "900" },
  youTag: { backgroundColor: colors.brandPrimary + "22", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm },
  youText: { color: colors.brandPrimary, fontSize: 12, fontWeight: "900" },
});
