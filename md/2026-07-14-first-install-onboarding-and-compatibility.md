# First-Install Onboarding and Device Compatibility

**Project:** Peakle  
**Date completed:** July 14, 2026  
**Status:** Superseded on July 15, 2026

> This document records the original device-level implementation. Peakle now opens Login for every logged-out launch and shows the feature overview only after a newly authenticated account enters account setup. See the current README and startup routing for active behavior.

## Objective

Make the feature onboarding appear once when Peakle is newly installed on a device, prevent it from repeating after normal app launches or updates, and improve compatibility across supported Android and iOS devices.

## Resulting behavior

- A fresh installation shows the feature onboarding before authentication.
- Completing or skipping the overview saves the completion state on the device.
- Closing and reopening the app does not repeat onboarding.
- Signing out does not repeat onboarding.
- Updating the installed app does not repeat onboarding.
- Uninstalling Peakle or clearing its application data resets the marker, so onboarding appears on the next installation.
- Password-recovery links take priority and open the password-reset flow directly.
- An authenticated user upgrading from a build without the device marker skips the new-install tour.
- Account profile personalization remains account-specific and is separate from the device feature tour.

## Implementation details

### Device onboarding storage

Created `src/context/DeviceOnboardingContext.js`.

It uses React Native AsyncStorage with the stable key:

```text
@peakle/device-onboarding
```

The stored completion value is:

```text
completed-v1
```

The key should remain unchanged during ordinary app updates. Changing the value intentionally would make existing installations go through a future onboarding version again.

If device storage cannot be read, Peakle fails safely by continuing into the app instead of trapping the user on a loading or onboarding screen.

### Startup routing

Updated `App.js` so startup waits for both authentication and device-onboarding state to load.

The startup order is:

1. Show the Peakle loading screen while local state and authentication hydrate.
2. Open password recovery when a recovery link is active.
3. Show device onboarding when no user is authenticated and the installation has no completion marker.
4. Show login and account creation when onboarding is already complete.
5. Show profile completion for authenticated accounts that have not finished their profile.
6. Open the main Peakle navigation for fully configured users.

Existing authenticated users automatically receive the device completion marker during an upgrade, preventing an unexpected first-install tour.

### Onboarding and account setup separation

Updated `src/screens/AuthFlowScreen.js`.

- Renamed and adapted the feature overview as device-level onboarding.
- Removed its dependency on a newly entered account name.
- The final action now says **Continue to Peakle**.
- Both completing and skipping save the installation marker.
- Storage errors display a retryable message.
- Account creation now proceeds from credentials directly into profile personalization without repeating the feature overview.

### Small-screen compatibility

The feature overview is now vertically scrollable. This keeps its content and actions reachable on compact and older phones instead of allowing content to be clipped.

Android now uses `softwareKeyboardLayoutMode: "resize"`, keeping authentication and profile fields visible when the on-screen keyboard opens.

### Release and installation configuration

Updated `app.json` with:

```json
{
  "ios": {
    "buildNumber": "1"
  },
  "android": {
    "versionCode": 1,
    "allowBackup": false,
    "softwareKeyboardLayoutMode": "resize"
  }
}
```

Android cloud backup is disabled so local authentication and onboarding data are not restored into an installation that should behave as new.

For each store release, update:

- `expo.version` for the public release number;
- `expo.android.versionCode` for every Google Play build;
- `expo.ios.buildNumber` for every App Store or TestFlight build.

## Supported operating systems

Peakle currently uses Expo SDK 54 and React Native 0.81. The supported operating-system range for this build is:

- Android 7 or newer;
- iOS 15.1 or newer.

Devices below these framework minimums require a separately maintained legacy application and cannot safely run the current build.

## Files changed

- `App.js`
- `app.json`
- `README.md`
- `src/context/DeviceOnboardingContext.js` — new file
- `src/screens/AuthFlowScreen.js`

The password reveal-eye improvement completed immediately before this work remains in `src/screens/AuthFlowScreen.js` and applies to login, registration, and password-reset fields.

## Validation performed

- Compiled all changed JavaScript files with the Expo Babel preset.
- Resolved and inspected the public Expo configuration.
- Generated a production iOS JavaScript bundle successfully.
- Generated a production Android JavaScript bundle successfully.
- Confirmed the onboarding storage key and routing references are consistent across the project.

## Manual verification checklist

1. Uninstall the Peakle development build or clear its application data.
2. Install and launch Peakle.
3. Confirm the three-page feature overview appears before login or account creation.
4. Complete the overview or select **Skip overview**.
5. Close and reopen Peakle; confirm the overview does not return.
6. Sign in and then sign out; confirm the overview does not return.
7. Install a newer build without uninstalling; confirm the overview remains completed.
8. Uninstall and reinstall; confirm onboarding appears again.
9. Test on one compact Android device and one compact iPhone simulator to verify scrolling and keyboard behavior.

## Migration note

An older Peakle installation that is logged out and predates the device marker cannot be reliably distinguished from a genuinely fresh installation. It may see the overview once after its first update to this implementation. After that marker is saved, future updates will not repeat onboarding.
