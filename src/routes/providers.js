const express = require("express");
const { z } = require("zod");
const { query } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { haversineKm, scoreProvider } = require("../utils/matching");

const router = express.Router();

const searchSchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  category_id: z.string().uuid().optional(),
  radius_km: z.coerce.number().min(1).max(100).default(15),
  w_distance: z.coerce.number().min(0).max(10).default(5),
  w_price: z.coerce.number().min(0).max(10).default(5),
  w_availability: z.coerce.number().min(0).max(10).default(5),
});

// GET /providers/search?lat=&lng=&category_id=&radius_km=&w_distance=&w_price=&w_availability=
router.get("/search", requireAuth, async (req, res) => {
  const parsed = searchSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { lat, lng, category_id, radius_km, w_distance, w_price, w_availability } = parsed.data;

  // Coarse bounding-box prefilter before exact Haversine — avoids scanning
  // every provider row. ~1 degree latitude ≈ 111km; longitude scaled by cos(lat).
  const latDelta = radius_km / 111;
  const lngDelta = radius_km / (111 * Math.cos((lat * Math.PI) / 180) || 1);

  const params = [lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta];
  let categoryFilter = "";
  if (category_id) {
    params.push(category_id);
    categoryFilter = `AND ps.category_id = $${params.length}`;
  }

  const { rows } = await query(
    `SELECT pp.user_id, pp.display_name, pp.live_lat, pp.live_lng, pp.base_lat, pp.base_lng,
            pp.available_now, pp.avg_rating, pp.reliability_score, pp.completed_jobs,
            ps.category_id, ps.price
     FROM provider_profiles pp
     JOIN provider_services ps ON ps.provider_id = pp.user_id
     WHERE pp.verification_status = 'verified'
       AND COALESCE(pp.live_lat, pp.base_lat) BETWEEN $1 AND $2
       AND COALESCE(pp.live_lng, pp.base_lng) BETWEEN $3 AND $4
       ${categoryFilter}`,
    params
  );

  if (rows.length === 0) return res.json({ results: [] });

  const withDistance = rows
    .map((p) => {
      const lat2 = p.live_lat ?? p.base_lat;
      const lng2 = p.live_lng ?? p.base_lng;
      const distanceKm = haversineKm(lat, lng, lat2, lng2);
      return { ...p, distanceKm };
    })
    .filter((p) => p.distanceKm <= radius_km);

  const prices = withDistance.map((p) => Number(p.price));
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  const ranked = withDistance
    .map((p) => {
      const score = scoreProvider({
        distanceKm: p.distanceKm,
        price: Number(p.price),
        minPrice,
        maxPrice,
        availableNow: p.available_now,
        etaMinutes: p.available_now ? 0 : 45, // placeholder until real ETA/routing is wired in
        rating: p.avg_rating,
        reliabilityScore: p.reliability_score,
        maxRadiusKm: radius_km,
        weights: { distance: w_distance, price: w_price, availability: w_availability },
      });
      return {
        providerId: p.user_id,
        name: p.display_name,
        distanceKm: Math.round(p.distanceKm * 10) / 10,
        price: Number(p.price),
        availableNow: p.available_now,
        rating: p.avg_rating,
        completedJobs: p.completed_jobs,
        matchScore: Math.round(score),
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore);

  res.json({ results: ranked });
});

// GET /providers/:id — full profile (no exact live location exposed to customers)
router.get("/:id", requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT pp.user_id, pp.display_name, pp.bio, pp.avg_rating, pp.completed_jobs,
            u.email
     FROM provider_profiles pp
     JOIN users u ON u.id = pp.user_id
     WHERE pp.user_id = $1 AND pp.verification_status = 'verified'`,
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: "Provider not found" });
  res.json({ provider: rows[0] });
});

module.exports = router;
