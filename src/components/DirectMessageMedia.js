import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
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

// Photos, videos, and voice messages for private chats: the bubble contents,
// the Messenger-style recording bar, and a full-screen photo preview.

export const MAX_VOICE_MS = 2 * 60 * 1000;
const WAVE_BARS = 28;
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

function VideoContent({ uri }) {
  const player = useVideoPlayer(uri, (videoPlayer) => { videoPlayer.loop = false; });
  return <VideoView player={player} nativeControls contentFit="contain" style={styles.video} />;
}

function VoiceContent({ message, colors }) {
  const player = useAudioPlayer(message.mediaUrl ? { uri: message.mediaUrl } : null);
  const status = useAudioPlayerStatus(player);
  const bars = useMemo(() => waveformFor(message.id), [message.id]);
  const duration = (status.duration ? status.duration * 1000 : 0) || message.mediaDurationMs || 0;
  const position = (status.currentTime || 0) * 1000;
  const progress = duration ? Math.min(1, position / duration) : 0;
  const tint = message.mine ? '#FFFFFF' : colors.teal;
  const muted = message.mine ? 'rgba(255,255,255,.4)' : colors.line;
  // Replaying a finished note starts from the beginning.
  const toggle = () => {
    if (status.playing) { player.pause(); return; }
    if (status.didJustFinish || (duration && position >= duration - 150)) player.seekTo(0);
    player.play();
  };
  return (
    <View style={styles.voiceRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={status.playing ? 'Pause voice message' : 'Play voice message'}
        disabled={!message.mediaUrl}
        onPress={toggle}
        hitSlop={6}
        style={[styles.voiceButton, { backgroundColor: message.mine ? '#FFFFFF' : colors.teal }]}
      >
        {message.uploading ? <ActivityIndicator size="small" color={message.mine ? colors.teal : '#FFFFFF'} /> : <AppIcon name={status.playing ? 'pause' : 'play'} size={16} color={message.mine ? colors.teal : '#FFFFFF'} />}
      </Pressable>
      <View style={styles.wave} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {bars.map((height, index) => <View key={index} style={[styles.waveBar, { height: 4 + height * 22, backgroundColor: index / bars.length < progress ? tint : muted }]} />)}
      </View>
      <Text style={[styles.voiceTime, { color: message.mine ? 'rgba(255,255,255,.85)' : colors.ink70 || colors.ink }]}>{formatClock(status.playing || position ? duration - position : duration)}</Text>
    </View>
  );
}

// The body of a media bubble. Photos open the preview; videos use native
// controls; voice notes play inline.
export function DirectMediaContent({ message, colors, onPreview }) {
  if (message.mediaType === 'audio') return <VoiceContent message={message} colors={colors} />;
  const uploading = message.uploading ? <View style={styles.uploading}><ActivityIndicator color="#FFFFFF" /></View> : null;
  if (message.mediaType === 'video') {
    return <View style={styles.media}>{message.mediaUrl ? <VideoContent uri={message.mediaUrl} /> : <MediaUnavailable colors={colors} />}{uploading}</View>;
  }
  return (
    <Pressable accessibilityRole="imagebutton" accessibilityLabel="Open photo" disabled={!message.mediaUrl || message.uploading} onPress={() => onPreview?.(message)} style={styles.media}>
      {message.mediaUrl ? <ExpoImage source={{ uri: message.mediaUrl }} contentFit="cover" transition={120} style={StyleSheet.absoluteFillObject} /> : <MediaUnavailable colors={colors} />}
      {uploading}
    </Pressable>
  );
}

function MediaUnavailable({ colors }) {
  return <View style={[styles.unavailable, { backgroundColor: colors.paper }]}><AppIcon name="image-outline" size={22} color={colors.ink40} /><Text style={[styles.unavailableText, { color: colors.ink40 }]}>Media unavailable</Text></View>;
}

export function MediaPreviewModal({ message, onClose }) {
  return (
    <Modal visible={Boolean(message)} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.previewBackdrop}>
        <Pressable accessibilityLabel="Close photo" onPress={onClose} style={StyleSheet.absoluteFillObject} />
        {message?.mediaUrl ? <ExpoImage source={{ uri: message.mediaUrl }} contentFit="contain" style={styles.previewImage} /> : null}
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
    onSend({
      uri: recorder.uri,
      duration: recordedMs,
      mimeType: Platform.OS === 'web' ? 'audio/webm' : undefined,
      fileName: `voice-message.${Platform.OS === 'web' ? 'webm' : 'm4a'}`,
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
  uploading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(14,35,33,.45)' },
  unavailable: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  unavailableText: { fontSize: 12, fontWeight: '700' },
  voiceRow: { minWidth: 210, flexDirection: 'row', alignItems: 'center', gap: 10 },
  voiceButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
  wave: { flex: 1, height: 28, flexDirection: 'row', alignItems: 'center', gap: 2 },
  waveBar: { flex: 1, maxWidth: 3, borderRadius: 2 },
  voiceTime: { minWidth: 34, textAlign: 'right', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  previewBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5,14,13,.94)' },
  previewImage: { width: '100%', height: '82%' },
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
