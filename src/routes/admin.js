const express = require("express");
const bcrypt = require("bcrypt");
const { query, withTransaction } = require("../db");

const router = express.Router();

const CATEGORY_NAMES = ["Plumbing", "Electrical", "Cleaning", "Tutoring", "Fitness", "Pet Care", "Photography", "Handyman"];

// Base location the demo providers are scattered around (Toronto, ON).
// Change these two numbers if you'd rather center it on your own city.
const BASE_LAT = 43.6532;
const BASE_LNG = -79.3832;

const DEMO_PROVIDERS = [
  { name: "Marisol Reyes", category: "Plumbing", price: 65, latOffset: 0.01, lngOffset: 0.01 },
  { name: "Delroy Fenton", category: "Electrical", price: 90, latOffset: 0.03, lngOffset: -0.02 },
  { name: "Priya Nadarajah", category: "Cleaning", price: 40, latOffset: -0.02, lngOffset: 0.015 },
  { name: "Owen Baptiste", category: "Tutoring", price: 30, latOffset: 0.045, lngOffset: 0.03 },
  { name: "Fatima Al-Sayed", category: "Fitness", price: 55, latOffset: -0.007, lngOffset: -0.005 },
  { name: "Colton Vasquez", category: "Pet Care", price: 22, latOffset: 0.038, lngOffset: -0.025 },
  { name: "Nina Okonkwo", category: "Photography", price: 150, latOffset: -0.055, lngOffset: 0.04 },
  { name: "Hank Dubois", category: "Handyman", price: 48, latOffset: 0.02, lngOffset: -0.015 },
];

// Visit this URL once (with the correct key) to stock the database with
// starter categories and demo providers. Safe to run more than once —
// it skips anything that already exists instead of duplicating it.
router.get("/seed", async (req, res) => {
  if (req.query.key !== process.env.ADMIN_SEED_KEY) {
    return res.status(403).json({ error: "Invalid seed key" });
  }

  try {
    const result = await withTransaction(async (client) => {
      const categoryIds = {};
      for (const name of CATEGORY_NAMES) {
        const existing = await client.query("SELECT id FROM service_categories WHERE name = $1", [name]);
        if (existing.rows.length > 0) {
          categoryIds[name] = existing.rows[0].id;
        } else {
          const inserted = await client.query(
            "INSERT INTO service_categories (name) VALUES ($1) RETURNING id",
            [name]
          );
          categoryIds[name] = inserted.rows[0].id;
        }
      }

      let created = 0;
      for (const p of DEMO_PROVIDERS) {
        const email = `${p.name.toLowerCase().replace(/\s+/g, ".")}@demo.servconnect`;
        const existingUser = await client.query("SELECT id FROM users WHERE email = $1", [email]);
        if (existingUser.rows.length > 0) continue; // already seeded

        const passwordHash = await bcrypt.hash(`demo-${Date.now()}-${Math.random()}`, 10);
        const userResult = await client.query(
          `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'provider') RETURNING id`,
          [email, passwordHash]
        );
        const userId = userResult.rows[0].id;

        await client.query(
          `INSERT INTO provider_profiles
             (user_id, display_name, verification_status, base_lat, base_lng, live_lat, live_lng, available_now, avg_rating, completed_jobs)
           VALUES ($1, $2, 'verified', $3, $4, $3, $4, true, 4.8, 120)`,
          [userId, p.name, BASE_LAT + p.latOffset, BASE_LNG + p.lngOffset]
        );

        await client.query(
          `INSERT INTO provider_services (provider_id, category_id, price_type, price)
           VALUES ($1, $2, 'fixed', $3)`,
          [userId, categoryIds[p.category], p.price]
        );

        created += 1;
      }

      return { categoriesReady: CATEGORY_NAMES.length, providersCreated: created };
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Seeding failed", detail: err.message });
  }
});

// Handy for the frontend to look up category IDs by name.
router.get("/categories", async (req, res) => {
  const { rows } = await query("SELECT id, name FROM service_categories ORDER BY name");
  res.json({ categories: rows });
});

// One-time: adds the columns email verification needs. Safe to visit more
// than once — "IF NOT EXISTS" means it skips anything already added.
router.get("/migrate-email-verification", async (req, res) => {
  if (req.query.key !== process.env.ADMIN_SEED_KEY) {
    return res.status(403).json({ error: "Invalid seed key" });
  }
  try {
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_token TEXT`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_expires TIMESTAMPTZ`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Visit this URL once (with the correct key) to add the database changes
// needed for email verification codes. Safe to run more than once.
router.get("/apply-otp-schema", async (req, res) => {
  if (req.query.key !== process.env.ADMIN_SEED_KEY) {
    return res.status(403).json({ error: "Invalid seed key" });
  }
  try {
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ`);
    await query(`
      CREATE TABLE IF NOT EXISTS otp_codes (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email TEXT NOT NULL,
        code TEXT NOT NULL,
        purpose TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_otp_email_purpose ON otp_codes (email, purpose)`);
    res.json({ ok: true, message: "Email verification tables are ready." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Schema update failed", detail: err.message });
  }
});
// One-time: adds the columns email verification needs. Safe to visit more
// than once — "IF NOT EXISTS" means it skips anything already added.
router.get("/migrate-email-verification", async (req, res) => {
  if (req.query.key !== process.env.ADMIN_SEED_KEY) {
    return res.status(403).json({ error: "Invalid seed key" });
  }
  try {
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_token TEXT`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_expires TIMESTAMPTZ`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
module.exports = router;
