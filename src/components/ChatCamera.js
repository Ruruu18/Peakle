import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Image as ExpoImage } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import AppIcon from './AppIcon';

// Messenger-style chat camera: tap the shutter for a photo, hold it to record
// a video of up to a minute. The capture is reviewed before it is sent.

export const MAX_CAMERA_VIDEO_SECONDS = 60;
// Chat videos are capped at 15 MB, so a full minute is recorded at 720p with
// a bitrate that keeps it under the limit.
const VIDEO_BITRATE = 1_600_000;
const MAX_VIDEO_BYTES = 14.5 * 1024 * 1024;
const HOLD_DELAY_MS = 250;
const SHUTTER_SIZE = 78;
const RING_STROKE = 5;
const RING_RADIUS = (SHUTTER_SIZE - RING_STROKE) / 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
// iOS keeps a photo output in video mode, so one session serves both. Android
// (CameraX) binds either photo or video, so it switches when a hold begins.
const SINGLE_SESSION = Platform.OS === 'ios';

const formatSeconds = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function ReviewVideo({ uri }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
    instance.play();
  });
  return <VideoView player={player} nativeControls={false} contentFit="cover" style={StyleSheet.absoluteFill} />;
}

export default function ChatCamera({ visible, onClose, onCapture, onLibrary }) {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [facing, setFacing] = useState('back');
  const [flash, setFlash] = useState('off');
  const [mode, setMode] = useState(SINGLE_SESSION ? 'video' : 'picture');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [captured, setCaptured] = useState(null);
  const holdingRef = useRef(false);
  const recordingRef = useRef(false);
  const readyWaiterRef = useRef(null);

  // Ask for the camera (and the microphone, for video sound) as it opens.
  useEffect(() => {
    if (!visible) return;
    setCaptured(null);
    setReady(false);
    setElapsed(0);
    (async () => {
      const camera = cameraPermission?.granted ? cameraPermission : await requestCameraPermission();
      if (!camera.granted) return;
      if (!micPermission?.granted && micPermission?.canAskAgain !== false) await requestMicPermission();
    })().catch(() => {});
    // Permissions are requested once each time the camera opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!recording) return undefined;
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed(Math.min(MAX_CAMERA_VIDEO_SECONDS, (Date.now() - startedAt) / 1000)), 100);
    return () => clearInterval(timer);
  }, [recording]);

  const handleReady = () => {
    setReady(true);
    readyWaiterRef.current?.();
    readyWaiterRef.current = null;
  };

  const close = () => {
    if (recordingRef.current) {
      holdingRef.current = false;
      cameraRef.current?.stopRecording();
    }
    onClose();
  };

  const takePhoto = async () => {
    if (!ready || busy || recordingRef.current) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 1, exif: false, shutterSound: false });
      if (photo?.uri) setCaptured({ type: 'image', asset: { uri: photo.uri, width: photo.width, height: photo.height, mimeType: 'image/jpeg', fileName: 'photo.jpg' } });
    } catch (error) {
      Alert.alert('Photo not taken', error.message);
    } finally {
      setBusy(false);
    }
  };

  const startRecording = async () => {
    if (!ready || busy || recordingRef.current) return;
    holdingRef.current = true;
    setBusy(true);
    try {
      if (!SINGLE_SESSION && mode !== 'video') {
        // The preview restarts in video mode; wait for it, or a moment at most.
        const switched = new Promise((resolve) => { readyWaiterRef.current = resolve; });
        setReady(false);
        setMode('video');
        await Promise.race([switched, wait(1500)]);
        await wait(150);
      }
      if (!holdingRef.current) return;
      recordingRef.current = true;
      setRecording(true);
      setElapsed(0);
      const startedAt = Date.now();
      const video = await cameraRef.current?.recordAsync({ maxDuration: MAX_CAMERA_VIDEO_SECONDS, maxFileSize: MAX_VIDEO_BYTES });
      const duration = Math.min(MAX_CAMERA_VIDEO_SECONDS * 1000, Date.now() - startedAt);
      if (video?.uri && duration >= 500) {
        const fileName = video.uri.toLowerCase().endsWith('.mov') ? 'video.mov' : 'video.mp4';
        setCaptured({ type: 'video', asset: { uri: video.uri, duration, fileName, mimeType: fileName.endsWith('.mov') ? 'video/quicktime' : 'video/mp4' } });
      }
    } catch (error) {
      if (holdingRef.current || recordingRef.current) Alert.alert('Video not recorded', error.message);
    } finally {
      holdingRef.current = false;
      recordingRef.current = false;
      setRecording(false);
      setBusy(false);
      if (!SINGLE_SESSION) setMode('picture');
    }
  };

  const stopRecording = () => {
    holdingRef.current = false;
    if (recordingRef.current) cameraRef.current?.stopRecording();
  };

  // The preview remounts after a review, so wait for it to be ready again.
  const retake = () => {
    setReady(false);
    setCaptured(null);
  };
  const send = () => {
    if (!captured) return;
    onCapture(captured.asset, captured.type);
  };

  const denied = cameraPermission && !cameraPermission.granted;
  const progress = elapsed / MAX_CAMERA_VIDEO_SECONDS;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" statusBarTranslucent onRequestClose={captured ? retake : close}>
      <View style={[styles.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.preview}>
          {captured ? (
            captured.type === 'video'
              ? <ReviewVideo uri={captured.asset.uri} />
              : <ExpoImage source={{ uri: captured.asset.uri }} contentFit="cover" style={StyleSheet.absoluteFill} />
          ) : cameraPermission?.granted && visible ? (
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing={facing}
              flash={flash}
              mode={mode}
              mute={!micPermission?.granted}
              videoQuality="720p"
              videoBitrate={VIDEO_BITRATE}
              mirror={facing === 'front'}
              onCameraReady={handleReady}
              onMountError={(event) => Alert.alert('Camera unavailable', event.message)}
            />
          ) : denied ? (
            <View style={styles.permission}>
              <AppIcon name="camera-outline" size={38} color="#FFFFFF" />
              <Text style={styles.permissionTitle}>Camera access is off</Text>
              <Text style={styles.permissionBody}>Allow Peakle to use your camera to take photos and videos for your chats.</Text>
              <Pressable accessibilityRole="button" onPress={cameraPermission.canAskAgain ? requestCameraPermission : () => Linking.openSettings()} style={styles.permissionButton}>
                <Text style={styles.permissionButtonText}>{cameraPermission.canAskAgain ? 'Allow camera' : 'Open Settings'}</Text>
              </Pressable>
            </View>
          ) : <ActivityIndicator color="#FFFFFF" style={styles.loading} />}

          <View style={styles.topBar}>
            <Pressable accessibilityRole="button" accessibilityLabel={captured ? 'Retake' : 'Close camera'} onPress={captured ? retake : close} hitSlop={10} style={styles.topButton}>
              <AppIcon name={captured ? 'arrow-back' : 'close'} size={28} color="#FFFFFF" />
            </Pressable>
            {recording ? (
              <View style={styles.timerPill}>
                <View style={styles.timerDot} />
                <Text style={styles.timerText}>{formatSeconds(elapsed)} / {formatSeconds(MAX_CAMERA_VIDEO_SECONDS)}</Text>
              </View>
            ) : !captured ? (
              <View style={styles.topCenter}>
                <Pressable accessibilityRole="button" accessibilityLabel="Switch camera" disabled={busy} onPress={() => setFacing((current) => (current === 'back' ? 'front' : 'back'))} hitSlop={10} style={styles.topButton}>
                  <AppIcon name="camera-reverse-outline" size={28} color="#FFFFFF" />
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={flash === 'on' ? 'Turn flash off' : 'Turn flash on'} onPress={() => setFlash((current) => (current === 'on' ? 'off' : 'on'))} hitSlop={10} style={styles.topButton}>
                  <AppIcon name={flash === 'on' ? 'flash' : 'flash-off'} size={25} color="#FFFFFF" />
                </Pressable>
              </View>
            ) : null}
            <View style={styles.topButton} />
          </View>

          {!captured ? (
            <View style={styles.bottomBar}>
              <View style={styles.sideSlot}>
                {!recording && onLibrary ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Choose from library" onPress={onLibrary} hitSlop={8} style={styles.libraryButton}>
                    <AppIcon name="images-outline" size={24} color="#FFFFFF" />
                  </Pressable>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Shutter"
                accessibilityHint="Tap to take a photo, hold to record a video"
                disabled={!cameraPermission?.granted}
                onPress={takePhoto}
                onLongPress={startRecording}
                onPressOut={stopRecording}
                delayLongPress={HOLD_DELAY_MS}
                style={styles.shutter}
              >
                <Svg width={SHUTTER_SIZE} height={SHUTTER_SIZE} style={StyleSheet.absoluteFill}>
                  <Circle cx={SHUTTER_SIZE / 2} cy={SHUTTER_SIZE / 2} r={RING_RADIUS} stroke="rgba(255,255,255,.55)" strokeWidth={RING_STROKE} fill="none" />
                  {recording ? (
                    <Circle
                      cx={SHUTTER_SIZE / 2}
                      cy={SHUTTER_SIZE / 2}
                      r={RING_RADIUS}
                      stroke="#FF3B30"
                      strokeWidth={RING_STROKE}
                      fill="none"
                      strokeLinecap="round"
                      strokeDasharray={`${RING_LENGTH} ${RING_LENGTH}`}
                      strokeDashoffset={RING_LENGTH * (1 - progress)}
                      transform={`rotate(-90 ${SHUTTER_SIZE / 2} ${SHUTTER_SIZE / 2})`}
                    />
                  ) : null}
                </Svg>
                <View style={[styles.shutterInner, recording && styles.shutterInnerRecording]} />
              </Pressable>
              <View style={styles.sideSlot} />
            </View>
          ) : null}
        </View>

        {captured ? (
          <View style={styles.reviewBar}>
            <Pressable accessibilityRole="button" onPress={retake} style={styles.retakeButton}>
              <Text style={styles.retakeText}>Retake</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={captured.type === 'video' ? 'Send video' : 'Send photo'} onPress={send} style={styles.sendButton}>
              <Text style={styles.sendText}>Send</Text>
              <AppIcon name="send" size={18} color="#0E2321" />
            </Pressable>
          </View>
        ) : (
          <Text style={styles.hint}>{recording ? 'Release to stop' : 'Tap for photo, hold for video'}</Text>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  preview: { flex: 1, overflow: 'hidden', borderRadius: 22, backgroundColor: '#111111' },
  loading: { flex: 1 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 18, paddingTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topCenter: { flexDirection: 'row', alignItems: 'center', gap: 28 },
  topButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  timerPill: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, backgroundColor: 'rgba(0,0,0,.5)' },
  timerDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#FF3B30' },
  timerText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 26, paddingHorizontal: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sideSlot: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  libraryButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: 'rgba(0,0,0,.4)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,.8)' },
  shutter: { width: SHUTTER_SIZE, height: SHUTTER_SIZE, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: SHUTTER_SIZE - 20, height: SHUTTER_SIZE - 20, borderRadius: (SHUTTER_SIZE - 20) / 2, backgroundColor: '#FFFFFF' },
  shutterInnerRecording: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#FF3B30' },
  hint: { marginTop: 16, textAlign: 'center', color: 'rgba(255,255,255,.75)', fontSize: 14, fontWeight: '600' },
  reviewBar: { marginTop: 14, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  retakeButton: { paddingHorizontal: 18, paddingVertical: 12 },
  retakeText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  sendButton: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 24, backgroundColor: '#D6E94A' },
  sendText: { color: '#0E2321', fontSize: 16, fontWeight: '800' },
  permission: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 36 },
  permissionTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  permissionBody: { color: 'rgba(255,255,255,.75)', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  permissionButton: { marginTop: 8, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 24, backgroundColor: '#D6E94A' },
  permissionButtonText: { color: '#0E2321', fontSize: 15, fontWeight: '800' },
});
