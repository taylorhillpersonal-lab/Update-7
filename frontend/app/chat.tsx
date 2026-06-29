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
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radius, spacing } from "@/src/game/theme";
import { useGame } from "@/src/game/GameContext";
import { useProfile } from "@/src/game/ProfileProvider";
import { haptic } from "@/src/game/haptics";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

type Msg = {
  id: string;
  device_id: string;
  name: string;
  text: string;
  created_at: string;
};

export default function ChatScreen() {
  const { state } = useGame();
  const { openProfile } = useProfile();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const listRef = useRef<FlatList<Msg>>(null);

  // Load recent history first
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/chat/history?limit=50`);
        if (res.ok) setMessages(await res.json());
      } catch {
        // ignore
      }
    })();
  }, []);

  // Live WebSocket with auto-reconnect
  const deviceIdRef = useRef<string | undefined>(state?.deviceId);
  const playerNameRef = useRef<string | undefined>(state?.playerName);
  useEffect(() => {
    deviceIdRef.current = state?.deviceId;
    playerNameRef.current = state?.playerName;
  }, [state?.deviceId, state?.playerName]);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      try {
        const wsUrl = (BASE ?? "").replace(/^http/, "ws") + "/api/ws/chat";
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        ws.onopen = () => {
          setConnected(true);
          // Announce presence so the server can count us as a unique device.
          try {
            ws.send(
              JSON.stringify({
                type: "hello",
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
              setMessages((m) => [...m, d as Msg]);
            } else if (d.type === "presence") {
              setOnline(typeof d.online === "number" ? d.online : null);
            } else if (d.type === "error") {
              setNotice(d.message);
              setTimeout(() => setNotice(null), 2500);
            }
          } catch {
            // ignore malformed
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
  }, []);

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
        device_id: state?.deviceId ?? "anon",
        name: state?.playerName || "Anonymous Tycoon",
        text: t,
      }),
    );
    setText("");
  };

  const renderItem = ({ item }: { item: Msg }) => {
    const mine = item.device_id === state?.deviceId;
    return (
      <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowOther]}>
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
          <Pressable
            testID={`chat-user-${item.device_id}`}
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
    <View style={styles.container} testID="chat-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="chat-back" onPress={() => router.back()} style={styles.backBtn}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Global Chat</Text>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.dot,
                { backgroundColor: connected ? colors.brandSecondary : colors.onSurfaceTertiary },
              ]}
            />
            <Text style={styles.status}>{connected ? "Connected" : "Connecting..."}</Text>
          </View>
        </View>
        {connected && online !== null && (
          <View
            testID="chat-online-count"
            accessibilityLabel={`${online} ${online === 1 ? "tycoon" : "tycoons"} online`}
            style={styles.onlinePill}
          >
            <View style={styles.onlinePulse} />
            <Text style={styles.onlineCount}>{online}</Text>
            <Text style={styles.onlineLabel}>{online === 1 ? "online" : "online"}</Text>
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
              <MaterialCommunityIcons name="chat-outline" size={44} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyText}>Say hi to fellow tycoons!</Text>
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
            testID="chat-input"
            value={text}
            onChangeText={setText}
            placeholder="Type a message..."
            placeholderTextColor={colors.onSurfaceTertiary}
            style={styles.input}
            maxLength={300}
            onSubmitEditing={send}
            returnKeyType="send"
          />
          <Pressable testID="chat-send" onPress={send} style={styles.sendBtn}>
            <MaterialCommunityIcons name="send" size={20} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  profileBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.8)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  profileCard: {
    width: "100%",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  profileAvatar: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary + "22",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  profileName: { color: colors.onSurface, fontSize: 20, fontWeight: "900" },
  profileCity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: spacing.xs,
    backgroundColor: colors.brandPrimary + "1A",
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  profileCityText: { color: colors.brandPrimary, fontSize: 12, fontWeight: "800" },
  uuidRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: "100%",
  },
  uuidLabel: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "900" },
  uuidValue: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "600" },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.lg, width: "100%" },
  statBox: {
    flexGrow: 1,
    width: "45%",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
  },
  statLabel: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "700" },
  statValue: { color: colors.onSurface, fontSize: 17, fontWeight: "900", marginTop: 2 },
  profileClose: {
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
  },
  profileCloseText: { color: colors.onSurface, fontSize: 14, fontWeight: "800" },
  reportBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.error,
  },
  reportText: { color: colors.error, fontSize: 14, fontWeight: "900" },
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
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "900" },
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
  onlinePulse: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.brandSecondary,
  },
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
