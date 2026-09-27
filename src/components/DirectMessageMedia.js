import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Image as ExpoImage } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import * as MediaLibrary from 'expo-media-library';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import Modal from './ResponsiveModal';
import AppIcon from './AppIcon';
import { webLongPress } from '../utils/webLongPress';

// Photos, videos, and voice messages for private chats: the bubble contents,
// the Messenger-style recording bar, and a full-screen photo or video preview.

export const MAX_VOICE_MS = 2 * 60 * 1000;
const WAVE_BARS = 28;
// Browsers record in their own format: Chrome and Firefox make WebM or Ogg,
// Safari makes MP4. Read the real type from the recording so it is uploaded
// and played back as what it is. Phones always record M4A.
const WEB_VOICE_EXTENSIONS = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'video/webm': 'webm', 'video/mp4': 'm4a' };
async function recordedVoiceFormat(uri) {
  if (Platform.OS !== 'web') return { mimeType: undefined, extension: 'm4a' };
  let type = '';
  try {
    type = (await (await fetch(uri)).blob()).type || '';
  } catch {}
  const base = type.split(';')[0].trim().toLowerCase();
  const extension = WEB_VOICE_EXTENSIONS[base];
  if (!extension) return { mimeType: 'audio/webm', extension: 'webm' };
  return { mimeType: base.startsWith('video/') ? base.replace('video/', 'audio/') : base, extension };
}

const RECORDING_OPTIONS = { ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, isMeteringEnabled: true };

export const formatClock = (ms) => {
  const total = Math.max(0, Math.round((ms || 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

// A stable, message-specific waveform shape so every voice note looks distinct.
function waveformFor(seed = '') {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619);
  return Array.from({ length: WAVE_BARS }, (_, index) => {
    hash = Math.imul(hash ^ (index + 1), 16777619);
    const wave = Math.sin(index / 3) * 0.2 + 0.5;
    return Math.min(1, Math.max(0.18, wave + ((hash >>> 0) % 100) / 250 - 0.2));
  });
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// A ring that fills as the upload goes, easing between progress reports so it
// moves steadily instead of spinning. The label shows the percentage sent.
export function UploadProgressRing({ progress = 0, size = 56, strokeWidth = 4, color = '#FFFFFF', trackColor = 'rgba(255,255,255,.3)', showLabel = true }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const animated = useRef(new Animated.Value(0)).current;
  const [percent, setPercent] = useState(0);
  useEffect(() => {
    const animation = Animated.timing(animated, { toValue: progress, duration: 400, easing: Easing.out(Easing.quad), useNativeDriver: false });
    animation.start();
    return () => animation.stop();
  }, [animated, progress]);
  useEffect(() => {
    const id = animated.addListener(({ value }) => setPercent(Math.round(value * 100)));
    return () => animated.removeListener(id);
  }, [animated]);
  const dashOffset = animated.interpolate({ inputRange: [0, 1], outputRange: [circumference, 0], extrapolate: 'clamp' });
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Uploading" accessibilityValue={{ min: 0, max: 100, now: percent }} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={[StyleSheet.absoluteFillObject, { transform: [{ rotate: '-90deg' }] }]}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
        <AnimatedCircle cx={size / 2} cy={size / 2} r={radius} stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={dashOffset} />
      </Svg>
      {showLabel ? <Text style={[styles.uploadPercent, { color }]}>{percent}%</Text> : null}
    </View>
  );
}

function VideoContent({ uri, style }) {
  const player = useVideoPlayer(uri, (videoPlayer) => { videoPlayer.loop = false; });
  return <VideoView player={player} nativeControls contentFit="contain" style={[styles.video, style]} />;
}

// Voice notes are downloaded before they play so a slow connection cannot
// make them stutter mid-sentence. The copy is kept per message, so replaying
// or reopening the chat does not download it again. If the download fails
// the note streams as before.
const voiceCache = new Map();
const isRemote = (uri) => /^https?:/i.test(uri || '');
const voiceExtension = (uri) => (uri.split('?')[0].match(/\.(m4a|mp4|aac|mp3|webm|ogg|wav)$/i)?.[1] || 'm4a').toLowerCase();

function downloadVoice(key, uri) {
  if (!voiceCache.has(key)) {
    const download = (async () => {
      if (Platform.OS === 'web') {
        const response = await fetch(uri);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return URL.createObjectURL(await response.blob());
      }
      const file = new File(Paths.cache, `peakle-voice-${String(key).replace(/[^\w-]/g, '')}.${voiceExtension(uri)}`);
      if (!file.exists) await File.downloadFileAsync(uri, file, { idempotent: true });
      return file.uri;
    })();
    voiceCache.set(key, download);
    download.catch(() => voiceCache.delete(key));
  }
  return voiceCache.get(key);
}

function usePlayableVoice(message) {
  const uri = message.mediaUrl;
  const remote = isRemote(uri) && !message.uploading;
  const [local, setLocal] = useState(null);
  useEffect(() => {
    if (!remote) { setLocal(null); return undefined; }
    let cancelled = false;
    setLocal(null);
    downloadVoice(message.id, uri)
      .then((result) => { if (!cancelled) setLocal(result); })
      .catch(() => { if (!cancelled) setLocal(uri); });
    return () => { cancelled = true; };
  }, [message.id, remote, uri]);
  return remote ? local : uri || null;
}

function Waveform({ bars, color }) {
  return bars.map((height, index) => <View key={index} style={[styles.waveBar, { height: 4 + height * 22, backgroundColor: color }]} />);
}

function VoiceContent({ message, colors }) {
  const playableUri = usePlayableVoice(message);
  const player = useAudioPlayer(playableUri ? { uri: playableUri } : null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const bars = useMemo(() => waveformFor(message.id), [message.id]);
  const duration = (status.duration ? status.duration * 1000 : 0) || message.mediaDurationMs || 0;
  const position = (status.currentTime || 0) * 1000;
  const tint = message.mine ? '#FFFFFF' : colors.teal;
  const muted = message.mine ? 'rgba(255,255,255,.4)' : colors.line;
  const [waveWidth, setWaveWidth] = useState(0);
  // Players briefly report "not playing" while audio warms up after play(),
  // which made the icon and waveform flicker. A pressed play counts as
  // playing until the audio clock starts moving (or a second passes).
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    if (!starting) return undefined;
    if (status.didJustFinish || (status.playing && position > 0)) { setStarting(false); return undefined; }
    const timer = setTimeout(() => setStarting(false), 1000);
    return () => clearTimeout(timer);
  }, [position, starting, status.didJustFinish, status.playing]);
  const playing = status.playing || starting;
  // The played part of the waveform sweeps continuously toward the end at
  // playback speed. Status updates only re-anchor it when playback starts,
  // stops, seeks, or drifts noticeably, so the sweep never stutters.
  const progress = useRef(new Animated.Value(0)).current;
  const sweep = useRef(null);
  const rate = status.playbackRate || 1;
  useEffect(() => {
    const current = duration ? Math.min(1, position / duration) : 0;
    const running = sweep.current;
    if (playing && duration && current < 1) {
      const expected = running ? running.position + (Date.now() - running.startedAt) * running.rate : null;
      const drift = running ? Math.abs(expected - position) : Infinity;
      if (running && (starting || (running.duration === duration && running.rate === rate && drift < 200))) return;
      running?.animation.stop();
      // Small drift is absorbed by gliding from where the sweep is at a
      // slightly adjusted speed, so it never jumps backward; a seek snaps.
      if (drift > 1000) progress.setValue(current);
      const animation = Animated.timing(progress, { toValue: 1, duration: (duration - position) / rate, easing: Easing.linear, useNativeDriver: true });
      sweep.current = { animation, position, startedAt: Date.now(), rate, duration };
      animation.start();
      return;
    }
    running?.animation.stop();
    sweep.current = null;
    progress.setValue(current);
  }, [duration, playing, position, progress, rate, starting]);
  useEffect(() => () => sweep.current?.animation.stop(), []);
  // Slide a clipping window right while sliding its contents left by the
  // same amount, so tinted bars are revealed in place (native-driver safe).
  const hidden = progress.interpolate({ inputRange: [0, 1], outputRange: [-waveWidth, 0], extrapolate: 'clamp' });
  const reveal = progress.interpolate({ inputRange: [0, 1], outputRange: [waveWidth, 0], extrapolate: 'clamp' });
  // Replaying a finished note starts from the beginning.
  const toggle = () => {
    if (playing) { setStarting(false); player.pause(); return; }
    if (status.didJustFinish || (duration && position >= duration - 150)) player.seekTo(0);
    setStarting(true);
    player.play();
  };
  const loading = Boolean(message.mediaUrl) && !message.uploading && !playableUri;
  return (
    <View style={styles.voiceRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Pause voice message' : 'Play voice message'}
        disabled={!message.mediaUrl || loading}
        onPress={toggle}
        hitSlop={6}
        style={[styles.voiceButton, { backgroundColor: message.mine ? '#FFFFFF' : colors.teal }]}
      >
        {message.uploading
          ? <UploadProgressRing progress={message.uploadProgress || 0} size={26} strokeWidth={3} showLabel={false} color={message.mine ? colors.teal : '#FFFFFF'} trackColor={message.mine ? 'rgba(28,107,102,.25)' : 'rgba(255,255,255,.35)'} />
          : loading
            ? <ActivityIndicator size="small" color={message.mine ? colors.teal : '#FFFFFF'} />
            : <AppIcon name={playing ? 'pause' : 'play'} size={16} color={message.mine ? colors.teal : '#FFFFFF'} />}
      </Pressable>
      <View style={styles.wave} onLayout={(event) => setWaveWidth(event.nativeEvent.layout.width)} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Waveform bars={bars} color={muted} />
        {waveWidth ? (
          <Animated.View style={[styles.wavePlayed, { width: waveWidth, transform: [{ translateX: hidden }] }, { pointerEvents: 'none' }]}>
            <Animated.View style={[styles.wave, { width: waveWidth, transform: [{ translateX: reveal }] }]}>
              <Waveform bars={bars} color={tint} />
            </Animated.View>
          </Animated.View>
        ) : null}
      </View>
      <Text style={[styles.voiceTime, { color: message.mine ? 'rgba(255,255,255,.85)' : colors.ink70 || colors.ink }]}>{formatClock(playing || position ? duration - position : duration)}</Text>
    </View>
  );
}

// Browsers let an <img> be dragged out of the page or long-pressed into their
// own image menu, which swallows the bubble's long press. Photos stay put.
const webStill = Platform.OS === 'web' ? { userSelect: 'none', WebkitUserSelect: 'none', WebkitUserDrag: 'none', WebkitTouchCallout: 'none' } : null;
const blockWebImageMenu = Platform.OS === 'web' ? { onContextMenu: (event) => event.preventDefault(), onDragStart: (event) => event.preventDefault() } : null;

function StillImage({ uri, contentFit, style }) {
  return (
    <View style={[style, webStill, { pointerEvents: 'none' }]}>
      <ExpoImage source={{ uri }} contentFit={contentFit} transition={120} draggable={false} style={[StyleSheet.absoluteFillObject, webStill]} />
    </View>
  );
}

const mediaExtension = (message) => {
  const match = /\.([a-z0-9]{2,5})(?:$|\?)/i.exec(message.mediaPath || message.mediaUrl || '');
  return (match?.[1] || (message.mediaType === 'video' ? 'mp4' : 'jpg')).toLowerCase();
};

// Saves a chat photo or video: a download on web, the photo library on phones.
export async function saveDirectMedia(message) {
  if (!message?.mediaUrl) return;
  const noun = message.mediaType === 'video' ? 'Video' : 'Photo';
  const fileName = `peakle-${message.id || Date.now()}.${mediaExtension(message)}`;
  try {
    if (Platform.OS === 'web') {
      let blob = null;
      try {
        const response = await fetch(message.mediaUrl);
        if (response.ok) blob = await response.blob();
      } catch {}
      if (!blob) {
        // The browser couldn't read the file itself (network or CORS), and Alert
        // is silent on web. Hand the URL to the browser instead; Supabase Storage
        // serves it as an attachment when `download` is set.
        const link = new URL(message.mediaUrl);
        if (link.pathname.includes('/storage/v1/object/')) link.searchParams.set('download', fileName);
        window.open(link.toString(), '_blank', 'noopener');
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    const permission = await MediaLibrary.requestPermissionsAsync(true, [message.mediaType === 'video' ? 'video' : 'photo']);
    if (!permission.granted) {
      Alert.alert('Photo access needed', 'Allow Peakle to add to your photos, then try again.');
      return;
    }
    let file = null;
    try {
      let uri = message.mediaUrl;
      if (!uri.startsWith('file:')) {
        // Each save owns its temporary file, including partially downloaded files.
        file = new File(Paths.cache, `peakle-${randomUUID()}.${mediaExtension(message)}`);
        await File.downloadFileAsync(uri, file);
        uri = file.uri;
      }
      await MediaLibrary.saveToLibraryAsync(uri);
    } finally {
      try { file?.delete(); } catch {}
    }
    Alert.alert(`${noun} saved`, `The ${noun.toLowerCase()} is in your photos.`);
  } catch (error) {
    Alert.alert(`Couldn’t save ${noun.toLowerCase()}`, error.message || 'Please try again in a moment.');
  }
}

// The body of a media bubble. Photos open the preview; videos use native
// controls; voice notes play inline.
export function DirectMediaContent({ message, colors, onPreview, onLongPress }) {
  if (message.mediaType === 'audio') return <VoiceContent message={message} colors={colors} />;
  const uploading = message.uploading ? <View style={styles.uploading}><UploadProgressRing progress={message.uploadProgress || 0} /></View> : null;
  if (message.mediaType === 'video') {
    return <View style={styles.media}>{message.mediaUrl ? <VideoContent uri={message.mediaUrl} /> : <MediaUnavailable colors={colors} />}{uploading}</View>;
  }
  return (
    <Pressable accessibilityRole="imagebutton" accessibilityLabel="Open photo" disabled={!message.mediaUrl || message.uploading} onPress={() => onPreview?.(message)} onLongPress={onLongPress} delayLongPress={240} accessibilityHint={onLongPress ? 'Long press for reactions and message options.' : undefined} {...blockWebImageMenu} {...webLongPress(onLongPress)} style={[styles.media, webStill]}>
      {message.mediaUrl ? <StillImage uri={message.mediaUrl} contentFit="cover" style={StyleSheet.absoluteFillObject} /> : <MediaUnavailable colors={colors} />}
      {uploading}
    </Pressable>
  );
}

function MediaUnavailable({ colors }) {
  return <View style={[styles.unavailable, { backgroundColor: colors.paper }]}><AppIcon name="image-outline" size={22} color={colors.ink40} /><Text style={[styles.unavailableText, { color: colors.ink40 }]}>Media unavailable</Text></View>;
}

// A small still copy of a photo for the long-press message sheet.
export function MediaThumbnail({ message, style }) {
  const { height } = useWindowDimensions();
  const thumbnailHeight = Math.max(80, Math.min(210, height - 430));
  if (!message?.mediaUrl) return null;
  return <View {...blockWebImageMenu} style={[styles.thumbnail, { height: thumbnailHeight, width: thumbnailHeight * 6 / 7 }, style, webStill]}><StillImage uri={message.mediaUrl} contentFit="cover" style={StyleSheet.absoluteFillObject} /></View>;
}

export function MediaPreviewModal({ message, onClose }) {
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { await saveDirectMedia(message); } finally { setSaving(false); }
  };
  return (
    <Modal visible={Boolean(message)} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.previewBackdrop} {...blockWebImageMenu}>
        <Pressable accessibilityLabel="Close photo" onPress={onClose} style={StyleSheet.absoluteFillObject} />
        {message?.mediaUrl ? (message.mediaType === 'video' ? <VideoContent uri={message.mediaUrl} style={styles.previewImage} /> : <StillImage uri={message.mediaUrl} contentFit="contain" style={styles.previewImage} />) : null}
        {message?.mediaUrl ? <Pressable accessibilityRole="button" accessibilityLabel={message.mediaType === 'video' ? 'Save video' : 'Save photo'} disabled={saving} onPress={save} style={[styles.previewClose, styles.previewSave]}>{saving ? <ActivityIndicator color="#FFFFFF" /> : <AppIcon name="download-outline" size={22} color="#FFFFFF" />}</Pressable> : null}
        <Pressable accessibilityLabel="Close photo" onPress={onClose} style={styles.previewClose}><AppIcon name="close" size={22} color="#FFFFFF" /></Pressable>
      </View>
    </Modal>
  );
}

// Recording starts as soon as the bar appears. Trash discards, the round
// button pauses or resumes, and the arrow sends what was recorded.
export function VoiceRecorderBar({ colors, onCancel, onSend }) {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const state = useAudioRecorderState(recorder, 100);
  const [ready, setReady] = useState(false);
  const [levels, setLevels] = useState(() => Array(WAVE_BARS).fill(0));
  const finishedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) throw new Error('Allow microphone access to send voice messages.');
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        if (cancelled) return;
        recorder.record();
        setReady(true);
      } catch (error) {
        if (!cancelled) {
          Alert.alert('Microphone unavailable', error.message);
          onCancel();
        }
      }
    })();
    return () => {
      cancelled = true;
      if (!finishedRef.current) recorder.stop().catch(() => {});
      // Leaving recording mode sends playback back to the speaker on iOS.
      setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    };
    // The recorder is created once for this bar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Native recorders report real levels (dB); the web recorder does not, so
  // it gets a gentle animated wave while recording.
  useEffect(() => {
    if (!state.isRecording) return;
    const level = typeof state.metering === 'number'
      ? Math.min(1, Math.max(0.08, (state.metering + 60) / 60))
      : 0.25 + Math.random() * 0.55;
    setLevels((current) => [...current.slice(1), level]);
  }, [state.durationMillis, state.isRecording, state.metering]);

  const duration = state.durationMillis || 0;
  useEffect(() => {
    if (state.isRecording && duration >= MAX_VOICE_MS) recorder.pause();
  }, [duration, recorder, state.isRecording]);

  const togglePause = () => {
    if (state.isRecording) recorder.pause();
    else if (duration < MAX_VOICE_MS) recorder.record();
  };
  const send = async () => {
    if (!ready || finishedRef.current) return;
    finishedRef.current = true;
    const recordedMs = duration;
    try {
      await recorder.stop();
    } catch (error) {
      finishedRef.current = false;
      Alert.alert('Voice message not saved', error.message);
      return;
    }
    if (!recorder.uri || recordedMs < 500) {
      Alert.alert('Voice message too short', 'Hold on a little longer before sending.');
      onCancel();
      return;
    }
    const { mimeType, extension } = await recordedVoiceFormat(recorder.uri);
    onSend({
      uri: recorder.uri,
      duration: recordedMs,
      mimeType,
      fileName: `voice-message.${extension}`,
    });
  };

  return (
    <View style={styles.recorderRow}>
      <Pressable accessibilityRole="button" accessibilityLabel="Delete voice message" onPress={onCancel} hitSlop={6} style={styles.recorderIcon}><AppIcon name="trash" size={24} color={colors.teal} /></Pressable>
      <View style={[styles.recorderPill, { backgroundColor: colors.teal }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={state.isRecording ? 'Pause recording' : 'Resume recording'} disabled={!ready} onPress={togglePause} style={styles.recorderPause}>
          {ready ? <AppIcon name={state.isRecording ? 'pause' : 'mic'} size={16} color={colors.teal} /> : <ActivityIndicator size="small" color={colors.teal} />}
        </Pressable>
        <View style={styles.recorderWave} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {levels.map((level, index) => <View key={index} style={[styles.recorderBar, { height: level ? 4 + level * 22 : 4, opacity: level ? 1 : 0.5 }]} />)}
        </View>
        <Text accessibilityLabel={`Recorded ${formatClock(duration)}`} style={styles.recorderTime}>{formatClock(duration)}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Send voice message" disabled={!ready || duration < 500} onPress={send} hitSlop={6} style={[styles.recorderIcon, (!ready || duration < 500) && styles.disabled]}><AppIcon name="send" size={24} color={colors.teal} /></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  media: { width: 220, height: 260, maxWidth: '100%', overflow: 'hidden', borderRadius: 18, backgroundColor: '#0E2321' },
  video: { width: '100%', height: '100%' },
  uploadPercent: { fontSize: 13, fontWeight: '800' },
  uploading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(14,35,33,.45)' },
  unavailable: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  unavailableText: { fontSize: 12, fontWeight: '700' },
  voiceRow: { minWidth: 210, flexDirection: 'row', alignItems: 'center', gap: 10 },
  voiceButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
  wave: { flex: 1, height: 28, flexDirection: 'row', alignItems: 'center', gap: 2 },
  waveBar: { flex: 1, maxWidth: 3, borderRadius: 2 },
  wavePlayed: { position: 'absolute', top: 0, bottom: 0, left: 0, overflow: 'hidden' },
  voiceTime: { minWidth: 34, textAlign: 'right', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  previewBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5,14,13,.94)' },
  previewImage: { width: '100%', height: '82%' },
  thumbnail: { width: 180, height: 210, overflow: 'hidden', borderRadius: 18, backgroundColor: '#0E2321' },
  previewSave: { right: 76 },
  previewClose: { position: 'absolute', top: 24, right: 20, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: 'rgba(255,255,255,.14)' },
  recorderRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10 },
  recorderIcon: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  recorderPill: { flex: 1, minHeight: 48, paddingLeft: 7, paddingRight: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 24 },
  recorderPause: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: '#FFFFFF' },
  recorderWave: { flex: 1, height: 28, flexDirection: 'row', alignItems: 'center', gap: 3, overflow: 'hidden' },
  recorderBar: { width: 3, borderRadius: 2, backgroundColor: '#FFFFFF' },
  recorderTime: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  disabled: { opacity: 0.35 },
});
