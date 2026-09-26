// expo-camera is phone-only here: its web module starts a QR-scanner worker
// that downloads jsQR from a CDN on import. The browser uses WebCameraView.
export { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
