require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { pool } = require("./db");

const IGNORABLE_CODES = new Set([
  "42710", // already exists
  "42P07", // already exists
  "42P06", // already exists
]);

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  const statements = sql
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const statement of statements) {
    try {
      await pool.query(statement);
    } catch (err) {
      if (IGNORABLE_CODES.has(err.code)) {
        console.log(`Already set up, skipping: ${statement.slice(0, 40)}...`);
        continue;
      }
      throw err;
    }
  }
  console.log("Schema applied.");
  await pool.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
