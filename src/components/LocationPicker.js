import React, { useEffect } from 'react';
import { useUserLocation } from '../context/LocationContext';
import { formatLocation } from '../data/phLocations';
import LocationSearchSheet from './LocationSearchSheet';

/** Search-area picker for Home, Book and Team; writes to LocationContext. */
export default function LocationPicker({ visible, onClose }) {
  const { userLocation, loading, error, useCurrentLocation, setManualLocation, clearError } = useUserLocation();

  useEffect(() => {
    if (visible) clearError();
  }, [visible, clearError]);

  const pick = (choice) => (
    typeof choice === 'string'
      ? setManualLocation(choice)
      : setManualLocation(formatLocation(choice), formatLocation(choice))
  );

  return (
    <LocationSearchSheet
      visible={visible}
      onClose={onClose}
      currentLabel={userLocation.source === 'default' ? '' : userLocation.label}
      live={userLocation.source === 'gps'}
      busy={loading}
      error={error}
      onUseGps={() => useCurrentLocation()}
      onPick={pick}
    />
  );
}
