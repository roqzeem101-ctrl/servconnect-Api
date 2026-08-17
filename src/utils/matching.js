const EARTH_RADIUS_KM = 6371;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two lat/lng points, in km. */
function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Score a single provider against a customer's location and weighting.
 * All *_score values are normalized 0..1 before weighting.
 */
function scoreProvider({
  distanceKm,
  price,
  minPrice,
  maxPrice,
  availableNow,
  etaMinutes,
  rating,
  reliabilityScore,
  maxRadiusKm,
  weights, // { distance, price, availability } each 0..10
}) {
  const distanceScore = 1 - Math.min(distanceKm / maxRadiusKm, 1);

  const priceRange = maxPrice - minPrice;
  const priceScore = priceRange > 0 ? 1 - (price - minPrice) / priceRange : 1;

  const availabilityScore = availableNow ? 1 : Math.max(0, 1 - etaMinutes / 120);

  const totalWeight = weights.distance + weights.price + weights.availability || 1;
  let score =
    ((distanceScore * weights.distance +
      priceScore * weights.price +
      availabilityScore * weights.availability) /
      totalWeight) *
    100;

  // Rating as a modifier, not a raw weighted input — a strong rating can
  // nudge score up/down by up to 10%, without letting it dominate distance/price/availability.
  score *= 0.9 + 0.1 * (rating / 5);

  // Reliability penalty (e.g. recent no-shows/cancellations) decays score.
  score *= reliabilityScore;

  return Math.max(0, Math.min(100, score));
}

module.exports = { haversineKm, scoreProvider };
