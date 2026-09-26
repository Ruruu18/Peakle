import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import createElement from 'react-native-web/dist/exports/createElement';

// Browser camera for chats. expo-camera's web preview takes photos but cannot
// record video, so this one owns the MediaStream: photos come from the
// camera's full-resolution photo pipeline where the browser has one
// (ImageCapture), otherwise from a frame of the preview, and videos from
// MediaRecorder. It exposes the same takePictureAsync / recordAsync /
// stopRecording calls ChatCamera uses on phones, plus setTorch.

const VideoElement = (props) => createElement('video', props);
const VIDEO_TYPES = ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
// Ask for the sharpest preview the camera offers; browsers settle on the
// closest mode the camera supports.
const RESOLUTION = { width: { ideal: 3840 }, height: { ideal: 2160 } };

const stopStream = (stream) => stream?.getTracks().forEach((track) => track.stop());

async function requestStream(video, withAudio) {
  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: Boolean(withAudio) });
  } catch (error) {
    // A denied or missing microphone should not block the camera.
    if (!withAudio || error?.name === 'OverconstrainedError') throw error;
    return navigator.mediaDevices.getUserMedia({ video, audio: false });
  }
}

async function openStream(facing, withAudio) {
  const facingMode = facing === 'front' ? 'user' : 'environment';
  // "exact" makes phones really switch lenses; a plain facingMode is only a
  // hint that browsers may ignore. Laptops with one webcam fall through to it.
  try {
    return await requestStream({ facingMode: { exact: facingMode }, ...RESOLUTION }, withAudio);
  } catch (error) {
    if (error?.name !== 'OverconstrainedError' && error?.name !== 'NotFoundError') throw error;
    return requestStream({ facingMode, ...RESOLUTION }, withAudio);
  }
}

const WebCameraView = forwardRef(function WebCameraView({ facing, withAudio, videoBitrate, style, onCameraReady, onMountError, onTorchAvailable }, ref) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  // Mirror only a camera that faces the player. Laptop webcams do not report
  // a facing mode and face the player too.
  const [mirrored, setMirrored] = useState(facing === 'front');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stream = await openStream(facing, withAudio);
      if (cancelled) { stopStream(stream); return; }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      const actualFacing = track?.getSettings?.().facingMode;
      setMirrored(actualFacing ? actualFacing === 'user' : true);
      onTorchAvailable?.(Boolean(track?.getCapabilities?.().torch));
      const element = videoRef.current;
      element.srcObject = stream;
      await element.play().catch(() => {});
      if (!cancelled) onCameraReady?.();
    })().catch((error) => { if (!cancelled) onMountError?.({ message: error?.message || 'Camera unavailable', name: error?.name }); });
    return () => {
      cancelled = true;
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      // Phones cannot open a second camera while one is still running.
      stopStream(streamRef.current);
      streamRef.current = null;
    };
    // The stream restarts only when the camera or microphone choice changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing, withAudio]);

  useImperativeHandle(ref, () => ({
    async takePictureAsync({ flash } = {}) {
      const video = videoRef.current;
      if (!video?.videoWidth) throw new Error('The camera is still starting.');
      let source = video;
      let width = video.videoWidth;
      let height = video.videoHeight;
      const track = streamRef.current?.getVideoTracks()[0];
      // Full sensor resolution where the browser supports it (Chrome on
      // Android), with the real flash when asked for.
      if (track && typeof ImageCapture !== 'undefined') {
        try {
          const capture = new ImageCapture(track);
          const settings = flash ? { fillLightMode: 'flash' } : undefined;
          const blob = await capture.takePhoto(settings).catch(() => capture.takePhoto());
          if (!mirrored) {
            const bitmap = await createImageBitmap(blob);
            const photo = { uri: URL.createObjectURL(blob), width: bitmap.width, height: bitmap.height, mimeType: blob.type || 'image/jpeg' };
            bitmap.close?.();
            return photo;
          }
          source = await createImageBitmap(blob);
          ({ width, height } = source);
        } catch {
          source = video;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      // Match the mirrored selfie preview.
      if (mirrored) { context.translate(width, 0); context.scale(-1, 1); }
      context.drawImage(source, 0, 0, width, height);
      source.close?.();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.98));
      if (!blob) throw new Error('Could not capture the photo.');
      return { uri: URL.createObjectURL(blob), width, height, mimeType: 'image/jpeg' };
    },
    async setTorch(on) {
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track?.getCapabilities?.().torch) return false;
      await track.applyConstraints({ advanced: [{ torch: Boolean(on) }] }).catch(() => {});
      return true;
    },
    recordAsync({ maxDuration, maxFileSize } = {}) {
      const stream = streamRef.current;
      if (!stream || typeof MediaRecorder === 'undefined') return Promise.reject(new Error('This browser cannot record video.'));
      const mimeType = VIDEO_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || '';
      const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : null), videoBitsPerSecond: videoBitrate });
      recorderRef.current = recorder;
      const chunks = [];
      let size = 0;
      return new Promise((resolve, reject) => {
        const timer = maxDuration ? setTimeout(() => recorder.state === 'recording' && recorder.stop(), maxDuration * 1000) : null;
        recorder.ondataavailable = (event) => {
          if (!event.data?.size) return;
          chunks.push(event.data);
          size += event.data.size;
          if (maxFileSize && size >= maxFileSize && recorder.state === 'recording') recorder.stop();
        };
        recorder.onerror = (event) => { clearTimeout(timer); reject(event.error || new Error('Recording failed.')); };
        recorder.onstop = () => {
          clearTimeout(timer);
          recorderRef.current = null;
          const type = (recorder.mimeType || mimeType || 'video/webm').split(';')[0];
          const blob = new Blob(chunks, { type });
          resolve(blob.size ? { uri: URL.createObjectURL(blob), mimeType: type } : null);
        };
        recorder.start(250);
      });
    },
    stopRecording() {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    },
  }), [mirrored, videoBitrate]);

  return (
    <View style={[styles.wrapper, style]}>
      <VideoElement ref={videoRef} autoPlay playsInline muted style={[styles.video, mirrored && styles.mirrored]} />
    </View>
  );
});

export default WebCameraView;

const styles = StyleSheet.create({
  wrapper: { overflow: 'hidden', backgroundColor: '#111111' },
  video: { width: '100%', height: '100%', objectFit: 'cover' },
  mirrored: { transform: [{ scaleX: -1 }] },
});
