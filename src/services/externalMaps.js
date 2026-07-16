import { ActionSheetIOS, Alert, Linking, Platform } from 'react-native';

function destinationValue(destination) {
  const latitude = Number(destination?.latitude);
  const longitude = Number(destination?.longitude);
  const hasCoordinates = Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180
    && !(latitude === 0 && longitude === 0);
  if (hasCoordinates) return `${latitude},${longitude}`;
  const address = [destination?.address, destination?.area].filter(Boolean).join(', ').trim();
  return address || destination?.name?.trim() || '';
}

function mapUrl(provider, destination) {
  const value = destinationValue(destination);
  const encodedDestination = encodeURIComponent(value);
  const encodedName = encodeURIComponent(destination?.name?.trim() || 'Venue');
  if (provider === 'apple') return `https://maps.apple.com/?daddr=${encodedDestination}&q=${encodedName}&dirflg=d`;
  if (provider === 'google') return `https://www.google.com/maps/dir/?api=1&destination=${encodedDestination}&travelmode=driving`;
  const latitude = Number(destination?.latitude);
  const longitude = Number(destination?.longitude);
  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude) && !(latitude === 0 && longitude === 0);
  return `https://waze.com/ul?${hasCoordinates ? `ll=${latitude},${longitude}` : `q=${encodedDestination}`}&navigate=yes&utm_source=peakle`;
}

export async function openMapProvider(provider, destination) {
  if (!destinationValue(destination)) {
    Alert.alert('Map location unavailable', 'This venue does not have a usable address or precise map coordinates yet.');
    return;
  }
  try {
    await Linking.openURL(mapUrl(provider, destination));
  } catch {
    Alert.alert('Could not open maps', 'The selected map service could not be opened on this device.');
  }
}

export function showExternalMapOptions(destination) {
  const title = destination?.name ? `Directions to ${destination.name}` : 'Open directions';
  if (Platform.OS === 'ios') {
    const options = ['Apple Maps', 'Google Maps', 'Waze', 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ title, options, cancelButtonIndex: 3 }, (index) => {
      if (index === 0) openMapProvider('apple', destination);
      if (index === 1) openMapProvider('google', destination);
      if (index === 2) openMapProvider('waze', destination);
    });
    return;
  }
  Alert.alert(title, 'Choose your navigation app.', [
    { text: 'Google Maps', onPress: () => openMapProvider('google', destination) },
    { text: 'Waze', onPress: () => openMapProvider('waze', destination) },
    { text: 'Cancel', style: 'cancel' },
  ]);
}
