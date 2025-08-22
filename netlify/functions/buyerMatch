// netlify/functions/buyerMatch.js

// ─────────────── Supabase config ───────────────
// Prefer environment variables if you can (they're available on Netlify Free).
// If you truly cannot use env, TEMPORARILY fill the inline fallbacks below.
// ⚠️ Never commit service-role keys. Use the ANON public key or a SECURITY DEFINER RPC.
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://wedevtjjmdvngyshqdro.supabase.co"; // ← replace if not using env

const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndlZGV2dGpqbWR2bmd5c2hxZHJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NzYwMzgsImV4cCI6MjA3MTA1MjAzOH0.Ex2c_sx358dFdygUGMVBohyTVto6fdEQ5nydDRh9m6M"; // ← replace if not using env (public anon key only!)

/**
 * Minimal REST helper against Supabase PostgREST.
 */
async function sb(path, { method = "GET", json, headers = {} } = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: json ? JSON.stringify(json) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

/**
 * Generate a 384-dim zero vector as "[0,0,0,...]".
 * Useful when you don’t yet have a client embedder.
 */
function zeroVector384() {
  return `[${Array(384).fill(0).join(",")}]`;
}

/**
 * Parse human budget bands into numeric INR min/max.
 */
function parseBudget(band) {
  if (!band) return { min: null, max: null };
  const s = band.replace(/\s/g, "");
  if (s.includes("₹50L–₹1Cr") || s.includes("₹50L–₹1Cr")) {
    return { min: 50_00_000, max: 1_00_00_000 };
  }
  if (s.includes("₹1Cr–₹2Cr")) {
    return { min: 1_00_00_000, max: 2_00_00_000 };
  }
  if (s.includes("₹2Cr–₹3Cr")) {
    return { min: 2_00_00_000, max: 3_00_00_000 };
  }
  if (s.includes("₹3Cr+")) {
    return { min: 3_00_00_000, max: null };
  }
  // fallback: try to parse numbers in crores/lakhs
  return { min: null, max: null };
}

/**
 * Map DB property row to the lightweight card your front-end renders.
 */
function toCard(p) {
  return {
    name: p.title || "Property",
    location: [p.locality, p.city].filter(Boolean).join(", "),
    bhk: p.bedrooms ?? "",
    carpet_area: p.sqft ?? "",
    price: p.price_inr ?? "",
    url: p.id ? `https://example.com/property/${p.id}` : "#",
  };
}

exports.handler = async (event) => {
  // CORS (Durable embed or other origins)
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // Basic guardrails
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes("YOUR-PROJECT-REF")) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error:
          "Supabase not configured. Set SUPABASE_URL & SUPABASE_ANON_KEY (or inline fallbacks).",
      }),
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");

    // OTP must be verified by your Firebase flow on the client
    if (body.otp_verified !== "true") {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "OTP not verified" }),
      };
    }

    // Required fields
    const required = [
      "name",
      "email",
      "phone",
      "location",
      "budget",
      "property_type",
      "timeline",
      "financing",
    ];
    for (const f of required) {
      if (!body[f] || String(body[f]).trim() === "") {
        return {
          statusCode: 400,
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ error: `Missing field: ${f}` }),
        };
      }
    }

    // 1) (Optional) Insert buyer lead
    //    This assumes you have a "buyers" table with RLS allowing anon INSERT of safe columns
    //    or a SECURITY DEFINER RPC. If not present, we swallow the 404 and continue.
    let buyer = null;
    {
      const { ok, status, data } = await sb("/rest/v1/buyers", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        json: [
          {
            name: String(body.name || "").trim(),
            email: String(body.email || "").trim(),
            phone: String(body.phone || "").trim(),
            location: String(body.location || "").trim(),
            budget: String(body.budget || "").trim(),
            property_type: String(body.property_type || "").trim(),
            timeline: String(body.timeline || "").trim(),
            financing: String(body.financing || "").trim(),
            notes: String(body.notes || ""),
            utm_source: String(body.utm_source || ""),
            utm_medium: String(body.utm_medium || ""),
            utm_campaign: String(body.utm_campaign || ""),
            referrer: String(body.referrer || ""),
            otp_verified: true,
            created_at: new Date().toISOString(),
          },
        ],
      });

      if (ok && Array.isArray(data) && data.length) {
        buyer = data[0];
      } else if (status === 404) {
        // buyers table not found — continue without failing the request
        console.warn("buyers table not found — skipping insert");
      } else if (!ok) {
        console.warn("Insert buyer failed:", data);
        // do not hard fail — still try to match properties
      }
    }

    // 2) Call your AI / hybrid match RPC.
    // Uses your consolidated function:
    //   public.match_candidates_hybrid(q_vec_text text, _city text, _ptype text,
    //     _budget_min numeric, _budget_max numeric, _bedrooms_min int, _bathrooms_min int,
    //     _verified_only boolean, _want_metro boolean, _k int)
    //
    // If you *don’t* have this function, we’ll try the simpler "match_candidates" as a fallback.
    const { min: budgetMin, max: budgetMax } = parseBudget(body.budget);
    const qVecText = zeroVector384(); // until you add a client embedder

    // Primary: match_candidates_hybrid
    let matchesRows = [];
    {
      const { ok, status, data } = await sb("/rest/v1/rpc/match_candidates_hybrid", {
        method: "POST",
        json: {
          q_vec_text: qVecText,
          _city: body.location || null, // you can simplify to the city name if needed
          _ptype: body.property_type || null,
          _budget_min: budgetMin,
          _budget_max: budgetMax,
          _bedrooms_min: null,
          _bathrooms_min: null,
          _verified_only: true,
          _want_metro: false,
          _k: 10,
        },
      });

      if (ok && Array.isArray(data)) {
        matchesRows = data;
      } else if (status === 404) {
        console.warn("RPC match_candidates_hybrid not found — trying match_candidates");
        // Fallback: match_candidates(q_vec_text, _city, _ptype, _budget_min, _budget_max, _bedrooms_min, _bathrooms_min, _verified_only, _k)
        const fb = await sb("/rest/v1/rpc/match_candidates", {
          method: "POST",
          json: {
            q_vec_text: qVecText,
            _city: body.location || null,
            _ptype: body.property_type || null,
            _budget_min: budgetMin,
            _budget_max: budgetMax,
            _bedrooms_min: null,
            _bathrooms_min: null,
            _verified_only: true,
            _k: 10,
          },
        });
        if (fb.ok && Array.isArray(fb.data)) {
          matchesRows = fb.data;
        } else {
          console.warn("Fallback match_candidates failed:", fb.data);
        }
      } else if (!ok) {
        console.warn("match_candidates_hybrid failed:", data);
      }
    }

    const matches = Array.isArray(matchesRows) ? matchesRows.map(toCard) : [];

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        message: "OK",
        buyer,
        matches,
      }),
    };
  } catch (err) {
    console.error("buyerMatch error:", err);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};
