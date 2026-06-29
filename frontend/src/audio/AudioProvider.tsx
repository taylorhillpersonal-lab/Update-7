/**
 * Tycoon Empire — Audio system
 *
 * - Background music: copyright-free upbeat loop streamed from Pixabay CDN
 *   (Pixabay content license allows commercial reuse without attribution).
 *   Swap MUSIC_URL below to use a different track.
 * - SFX: small WAV files we *generate ourselves* with a Python script
 *   (assets/audio/*.wav) — no third-party samples, zero copyright risk.
 *
 * Users can mute Music / SFX / both from the gear icon (Settings sheet).
 * Their choice is persisted with `storage` and survives reloads.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, Platform } from "react-native";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

import { storage } from "@/src/utils/storage";
import { bindSfx } from "@/src/game/haptics";

// ------- Configurable music source ----------------------------------------
// "Fluffing a Duck" by Kevin MacLeod (incompetech.com) — licensed under
// Creative Commons Attribution 4.0 (CC-BY 4.0). Bundled locally so it
// plays instantly without network. To use a different track, swap the
// require() below for any audio file you drop into assets/audio/.
export const MUSIC_SOURCE = require("../../assets/audio/music_loop.mp3");

// SFX assets (require() so Metro bundles them). Each in-game action gets a
// distinct sonic signature.
const SFX_SOURCES = {
  tap: require("../../assets/audio/tap.wav"),
  business_tap: require("../../assets/audio/business_tap.wav"),
  purchase: require("../../assets/audio/purchase.wav"),
  hire: require("../../assets/audio/hire.wav"),
  level_up: require("../../assets/audio/level_up.wav"),
  win: require("../../assets/audio/win.wav"),
  error: require("../../assets/audio/error.wav"),
  coin: require("../../assets/audio/coin.wav"),
  prestige: require("../../assets/audio/prestige.wav"),
  spin: require("../../assets/audio/spin.wav"),
};
export type SfxName = keyof typeof SFX_SOURCES;

// --------------------------------------------------------------------------
const SETTINGS_KEY = "tycoon_audio_settings_v1";

type AudioSettings = {
  musicOn: boolean;
  sfxOn: boolean;
  musicVolume: number; // 0..1
  sfxVolume: number;   // 0..1
};

const DEFAULTS: AudioSettings = {
  musicOn: true,
  sfxOn: true,
  musicVolume: 0.45,
  sfxVolume: 0.85,
};

type AudioContextValue = AudioSettings & {
  setMusicOn: (v: boolean) => void;
  setSfxOn: (v: boolean) => void;
  setMuteAll: (muted: boolean) => void;
  setMusicVolume: (v: number) => void;
  setSfxVolume: (v: number) => void;
  playSfx: (name: SfxName) => void;
};

const AudioContext = createContext<AudioContextValue | null>(null);

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AudioSettings>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);

  // expo-audio uses a single player object per sound. Music is a single
  // looping player; SFX get one short-lived player per fire (re-created so
  // overlapping taps don't cut each other off).
  const musicRef = useRef<AudioPlayer | null>(null);
  const sfxPoolRef = useRef<AudioPlayer[]>([]);

  // ---- Load persisted settings ----
  useEffect(() => {
    (async () => {
      try {
        const raw = await storage.getItem<string>(SETTINGS_KEY, "");
        if (raw) {
          const parsed = JSON.parse(String(raw));
          setSettings({ ...DEFAULTS, ...parsed });
        }
      } catch {
        // ignore — fall back to defaults
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  const persist = useCallback((next: AudioSettings) => {
    setSettings(next);
    storage.setItem(SETTINGS_KEY, JSON.stringify(next));
  }, []);

  // ---- Configure global audio mode (one-time) ----
  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: "mixWithOthers",
      interruptionModeAndroid: "duckOthers",
    }).catch(() => {});
  }, []);

  // ---- Music: create / dispose lazily based on musicOn ----
  useEffect(() => {
    if (!hydrated) return;
    const shouldPlay = settings.musicOn;
    if (shouldPlay && !musicRef.current) {
      try {
        const p = createAudioPlayer(MUSIC_SOURCE);
        p.loop = true;
        p.volume = settings.musicVolume;
        p.play();
        musicRef.current = p;
      } catch {
        // ignore — asset missing or platform unsupported
      }
    } else if (!shouldPlay && musicRef.current) {
      try {
        musicRef.current.pause();
        musicRef.current.remove();
      } catch {}
      musicRef.current = null;
    }
  }, [settings.musicOn, hydrated, settings.musicVolume]);

  // Keep music volume in sync without re-creating the player.
  useEffect(() => {
    if (musicRef.current) {
      try {
        musicRef.current.volume = settings.musicVolume;
      } catch {}
    }
  }, [settings.musicVolume]);

  // ---- Pause music on background, resume on foreground ----
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      const p = musicRef.current;
      if (!p) return;
      try {
        if (next === "active" && settings.musicOn) p.play();
        else p.pause();
      } catch {}
    });
    return () => sub.remove();
  }, [settings.musicOn]);

  // ---- SFX firing ----
  const playSfx = useCallback(
    (name: SfxName) => {
      if (!settings.sfxOn) return;
      const src = SFX_SOURCES[name];
      if (!src) return;
      try {
        const p = createAudioPlayer(src);
        p.volume = settings.sfxVolume;
        p.play();
        sfxPoolRef.current.push(p);
        // Auto-clean up shortly after playback — synthesised SFX are <=1s.
        setTimeout(() => {
          try {
            p.remove();
          } catch {}
          sfxPoolRef.current = sfxPoolRef.current.filter((x) => x !== p);
        }, 2000);
      } catch {
        // ignore — web fallback / unsupported codec
      }
    },
    [settings.sfxOn, settings.sfxVolume],
  );

  // ---- Clean up on unmount ----
  useEffect(() => {
    return () => {
      try {
        musicRef.current?.remove();
      } catch {}
      sfxPoolRef.current.forEach((p) => {
        try {
          p.remove();
        } catch {}
      });
      sfxPoolRef.current = [];
    };
  }, []);

  // Bind `haptic()` so every existing call site (taps, purchases, wins,
  // errors throughout the game) automatically also fires the right SFX.
  useEffect(() => {
    bindSfx(playSfx);
    return () => bindSfx(null);
  }, [playSfx]);

  const value = useMemo<AudioContextValue>(
    () => ({
      ...settings,
      setMusicOn: (v) => persist({ ...settings, musicOn: v }),
      setSfxOn: (v) => persist({ ...settings, sfxOn: v }),
      setMuteAll: (muted) => persist({ ...settings, musicOn: !muted, sfxOn: !muted }),
      setMusicVolume: (v) =>
        persist({ ...settings, musicVolume: Math.max(0, Math.min(1, v)) }),
      setSfxVolume: (v) =>
        persist({ ...settings, sfxVolume: Math.max(0, Math.min(1, v)) }),
      playSfx,
    }),
    [settings, persist, playSfx],
  );

  return <AudioContext.Provider value={value}>{children}</AudioContext.Provider>;
}

export function useAudio(): AudioContextValue {
  const ctx = useContext(AudioContext);
  if (!ctx) {
    // Silent no-op fallback so importers can use playSfx unconditionally
    // even before the provider mounts (e.g. during SSR / first render).
    return {
      ...DEFAULTS,
      setMusicOn: () => {},
      setSfxOn: () => {},
      setMuteAll: () => {},
      setMusicVolume: () => {},
      setSfxVolume: () => {},
      playSfx: () => {},
    };
  }
  return ctx;
}

// Compile-time helper so Platform-specific code can opt out of audio.
export const audioAvailable = Platform.OS !== "web" || typeof window !== "undefined";
