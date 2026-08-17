const { query } = require("../db");

/**
 * Ownership check pattern: never trust a client-supplied :id alone.
 * Load the resource scoped to the requesting user in the query itself,
 * so a customer can never fetch/modify another customer's request by
 * guessing an ID, and likewise for providers.
 */
function requireRequestAccess() {
  return async (req, res, next) => {
    const { id } = req.params;
    const userId = req.user.id;
    const role = req.user.role;

    const column = role === "provider" ? "provider_id" : "customer_id";
    const { rows } = await query(
      `SELECT * FROM requests WHERE id = $1 AND ${column} = $2`,
      [id, userId]
    );

    if (rows.length === 0) {
      // Same response whether the request doesn't exist or belongs to
      // someone else — don't leak which case it is.
      return res.status(404).json({ error: "Request not found" });
    }

    req.requestRecord = rows[0];
    next();
  };
}

module.exports = { requireRequestAccess };
