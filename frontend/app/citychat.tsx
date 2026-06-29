import React, { useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radius, spacing } from "@/src/game/theme";
import { fetchCityChatHistory, CityChatMessage } from "@/src/game/api";
import { useGame } from "@/src/game/GameContext";
import { useProfile } from "@/src/game/ProfileProvider";
import { haptic } from "@/src/game/haptics";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export default function CityChatScreen() {
  const { state } = useGame();
  const { openProfile } = useProfile();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ cityId?: string; cityName?: string; cityTag?: string }>();
  const cityId = params.cityId ?? "";
  const cityName = params.cityName ?? "City";
  const cityTag = params.cityTag ?? "";

  const [messages, setMessages] = useState<CityChatMessage[]>([]);
  const [text, setText] = useState("");
  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const listRef = useRef<FlatList<CityChatMessage>>(null);

  const deviceIdRef = useRef<string | undefined>(state?.deviceId);
  const playerNameRef = useRef<string | undefined>(state?.playerName);
  useEffect(() => {
    deviceIdRef.current = state?.deviceId;
    playerNameRef.current = state?.playerName;
  }, [state?.deviceId, state?.playerName]);

  // Load recent history
  useEffect(() => {
    if (!cityId) return;
    (async () => {
      const h = await fetchCityChatHistory(cityId, 50);
      setMessages(h);
    })();
  }, [cityId]);

  // Live WebSocket
  useEffect(() => {
    if (!cityId) return;
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      try {
        const wsUrl = (BASE ?? "").replace(/^http/, "ws") + "/api/ws/citychat";
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        ws.onopen = () => {
          setConnected(true);
          try {
            ws.send(
              JSON.stringify({
                type: "hello",
                city_id: cityId,
                device_id: deviceIdRef.current ?? "anon",
                name: playerNameRef.current || "Anonymous Tycoon",
              }),
            );
          } catch {
            // ignore
          }
        };
        ws.onmessage = (e) => {
          try {
            const d = JSON.parse(e.data);
            if (d.type === "message") {
              setMessages((m) => [...m, d as CityChatMessage]);
            } else if (d.type === "presence") {
              setOnline(typeof d.online === "number" ? d.online : null);
            } else if (d.type === "error") {
              setNotice(d.message);
              setTimeout(() => setNotice(null), 2500);
            }
          } catch {
            // ignore
          }
        };
        ws.onclose = () => {
          setConnected(false);
          setOnline(null);
          if (!closed) retry = setTimeout(connect, 2500);
        };
        ws.onerror = () => {
          try {
            ws.close();
          } catch {
            // ignore
          }
        };
      } catch {
        if (!closed) retry = setTimeout(connect, 2500);
      }
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      try {
        wsRef.current?.close();
      } catch {
        // ignore
      }
    };
  }, [cityId]);

  useEffect(() => {
    if (messages.length) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
    }
  }, [messages.length]);

  const send = () => {
    const t = text.trim();
    const ws = wsRef.current;
    if (!t || !ws || ws.readyState !== 1) return;
    haptic("light");
    ws.send(
      JSON.stringify({
        city_id: cityId,
        device_id: state?.deviceId ?? "anon",
        name: state?.playerName || "Anonymous Tycoon",
        text: t,
      }),
    );
    setText("");
  };

  const renderItem = ({ item }: { item: CityChatMessage }) => {
    const mine = item.device_id === state?.deviceId;
    return (
      <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowOther]}>
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
          <Pressable
            testID={`citychat-user-${item.device_id}`}
            onPress={() => openProfile(item.device_id)}
            hitSlop={8}
          >
            <Text style={[styles.author, mine && styles.authorMine]}>
              {item.name}
              {mine ? " (You)" : ""}
            </Text>
          </Pressable>
          <Text style={[styles.msgText, mine && { color: colors.onBrandPrimary }]}>{item.text}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container} testID="citychat-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="citychat-back" onPress={() => router.back()} style={styles.backBtn}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {cityTag ? `[${cityTag}] ` : ""}
            {cityName}
          </Text>
          <View style={styles.statusRow}>
            <View
              style={[styles.dot, { backgroundColor: connected ? colors.brandSecondary : colors.onSurfaceTertiary }]}
            />
            <Text style={styles.status}>{connected ? "City Chat" : "Connecting..."}</Text>
          </View>
        </View>
        {connected && online !== null && (
          <View testID="citychat-online-count" style={styles.onlinePill}>
            <View style={styles.onlinePulse} />
            <Text style={styles.onlineCount}>{online}</Text>
            <Text style={styles.onlineLabel}>online</Text>
          </View>
        )}
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={insets.top + 56}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons name="message-text-outline" size={44} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyText}>Be the first to talk to your City!</Text>
            </View>
          }
        />

        {notice && (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        )}

        <View style={[styles.inputBar, { paddingBottom: insets.bottom + spacing.sm }]}>
          <TextInput
            testID="citychat-input"
            value={text}
            onChangeText={setText}
            placeholder="Message your City..."
            placeholderTextColor={colors.onSurfaceTertiary}
            style={styles.input}
            maxLength={300}
            onSubmitEditing={send}
            returnKeyType="send"
          />
          <Pressable testID="citychat-send" onPress={send} style={styles.sendBtn}>
            <MaterialCommunityIcons name="send" size={20} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
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
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceTertiary,
  },
  title: { color: colors.onSurface, fontSize: 20, fontWeight: "900" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  status: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "700" },
  onlinePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSecondary + "1F",
    borderWidth: 1,
    borderColor: colors.brandSecondary + "55",
  },
  onlinePulse: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.brandSecondary },
  onlineCount: { color: colors.brandSecondary, fontSize: 14, fontWeight: "900" },
  onlineLabel: { color: colors.brandSecondary, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  list: { padding: spacing.lg, gap: spacing.sm, flexGrow: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingTop: spacing.xxxl },
  emptyText: { color: colors.onSurfaceTertiary, fontSize: 15, fontWeight: "700" },
  bubbleRow: { flexDirection: "row" },
  rowMine: { justifyContent: "flex-end" },
  rowOther: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "78%",
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleMine: { backgroundColor: colors.brandPrimary, borderBottomRightRadius: 4 },
  bubbleOther: {
    backgroundColor: colors.surfaceSecondary,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  author: { color: colors.brandSecondary, fontSize: 12, fontWeight: "800", marginBottom: 2 },
  authorMine: { color: "rgba(255,255,255,0.9)" },
  msgText: { color: colors.onSurface, fontSize: 15, fontWeight: "600" },
  notice: {
    alignSelf: "center",
    backgroundColor: colors.error + "26",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    marginBottom: spacing.sm,
  },
  noticeText: { color: colors.error, fontSize: 13, fontWeight: "800" },
  inputBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "600",
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendBtn: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
});
