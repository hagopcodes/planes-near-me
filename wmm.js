// Tiny WMM-inspired declination model (low-order terms from WMM2025, good enough for UI heading correction).
// Returns declination in degrees for latitude/longitude in decimal degrees.

const COEFF = {
  g10: -29351.8,
  g11: -1410.8,
  h11: 4545.4,
  g20: -2556.6,
  g21: 2950.9,
  h21: -3133.6,
  g22: 1648.3,
  h22: -815.1,
};

const R2D = 180 / Math.PI;
const D2R = Math.PI / 180;

export function declination(latDeg, lonDeg) {
  const lat = latDeg * D2R;
  const lon = lonDeg * D2R;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);

  const X =
    -COEFF.g10 * cosLat +
    (COEFF.g11 * cosLon + COEFF.h11 * sinLon) * sinLat +
    (COEFF.g20 * (1.5 * sinLat * cosLat) +
      COEFF.g21 * (Math.cos(2 * lat) * cosLon) +
      COEFF.h21 * (Math.cos(2 * lat) * sinLon) +
      COEFF.g22 * (sinLat * cosLat * Math.cos(2 * lon)) +
      COEFF.h22 * (sinLat * cosLat * Math.sin(2 * lon))) *
      0.1;

  const Y =
    COEFF.g11 * sinLon -
    COEFF.h11 * cosLon +
    (COEFF.g21 * cosLat * sinLon -
      COEFF.h21 * cosLat * cosLon +
      2 * (COEFF.g22 * cosLat * Math.sin(2 * lon) - COEFF.h22 * cosLat * Math.cos(2 * lon))) *
      0.1;

  return Math.atan2(Y, X) * R2D;
}
