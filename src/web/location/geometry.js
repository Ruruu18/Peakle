export function distanceMeters(from, to) {
  const radians = (value) => value * Math.PI / 180;
  const lat = radians(to.latitude - from.latitude);
  const lng = radians(to.longitude - from.longitude);
  const h = Math.sin(lat / 2) ** 2 + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(lng / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

export function containsPoint(area, coordinates) {
  const { longitude: x, latitude: y } = coordinates;
  const [west, south, east, north] = area.bounds;
  if (x < west || x > east || y < south || y > north) return false;
  return area.polygons.some((polygon) => inRing([x, y], polygon[0]) && !polygon.slice(1).some((hole) => inRing([x, y], hole)));
}

export function distanceToBoundary(area, { latitude, longitude }) {
  const xScale = 111195 * Math.cos(latitude * Math.PI / 180);
  const yScale = 111195;
  let nearest = Infinity;
  for (const polygon of area.polygons) {
    for (const ring of polygon) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const ax = (ring[j][0] - longitude) * xScale;
        const ay = (ring[j][1] - latitude) * yScale;
        const bx = (ring[i][0] - longitude) * xScale;
        const by = (ring[i][1] - latitude) * yScale;
        const dx = bx - ax;
        const dy = by - ay;
        const length = dx * dx + dy * dy;
        const t = length ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0;
        nearest = Math.min(nearest, Math.hypot(ax + t * dx, ay + t * dy));
      }
    }
  }
  return nearest;
}

export function resolveContainingArea(areas, coordinates, boundaryBuffer = 150) {
  const candidates = areas.filter((area) => containsPoint(area, coordinates));
  // Never replace a reported position with the nearest city's center, and do
  // not assert a city where overlapping boundaries or accuracy make it unclear.
  if (candidates.length !== 1) return null;
  const area = candidates[0];
  return distanceToBoundary(area, coordinates) > coordinates.accuracy + boundaryBuffer ? area : null;
}
