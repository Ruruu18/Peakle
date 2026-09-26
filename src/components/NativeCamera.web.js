// See NativeCamera.js. ChatCamera renders WebCameraView in the browser and
// never mounts these.
const noPermission = () => [null, async () => null];

export const CameraView = () => null;
export const useCameraPermissions = noPermission;
export const useMicrophonePermissions = noPermission;
