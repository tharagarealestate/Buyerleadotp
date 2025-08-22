// netlify/functions/buyerMatch.js
const { randomUUID } = require('crypto');

/**
 * Configuration
 * - Prefer setting SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Netlify env vars.
 * - If you only have an anon key you can provide it in SUPABASE_ANON_KEY (limited permissions).
 */
const EXPECTED_DIM = parseInt(process.env.EXPECTED_DIM || '384', 10);
const CACHE_TTL_MS = parseInt(process.env.CACHE_TTL_MS || `${1000 * 60 * 60}`, 10); // default 1 hour

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://wedevtjjmdvngyshqdro.supabase.co';

const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || null;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

function parseBudget(band) {
  if (!band) return { min: null, max: null };
  const s = String(band).replace(/\s/g, '');
  if (s.includes('₹50L') && s.includes('₹1Cr')) return { min: 50_00_000, max: 1_00_00_000 };
  if (s.includes('₹1Cr') && s.includes('₹2Cr')) return { min: 1_00_00_000, max: 2_00_00_000 };
  if (s.includes('₹2Cr') && s.includes('₹3Cr')) return { min: 2_00_00_000, max: 3_00_00_000 };
  if (s.includes('₹3Cr')) return { min: 3_00_00_000, max: null };
  return { min: null, max: null };
}

function toCard(r) {
  return {
    id: r.id,
    title: r.title || r.name || 'Property',
    image: (r.images && r.images[0]) || r.image || null,
    city: r.city || null,
    locality: r.locality || null,
    price_inr: r.price_inr == null ? null : Number(r.price_inr),
    bedrooms: r.bedrooms ?? null,
    bathrooms: r.bathrooms ?? null,
    sem_sim: r.sem_sim ?? r.similarity ?? r.score ?? 0,
    nearest_metro: r.nearest_metro ?? null,
    km_to_metro: r.km_to_metro ?? null
  };
}

exports.handler = async function (event) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Method not allowed' };
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY');
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Server misconfigured: missing Supabase credentials' })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const payload = body.payload || {};
    const q_vec_text = body.q_vec_text;

    if (!q_vec_text) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing q_vec_text' }) };
    }

    // Validate vector is JSON array string and length matches EXPECTED_DIM
    let vec;
    try {
      vec = JSON.parse(q_vec_text);
    } catch (e) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'q_vec_text must be a valid JSON array string' }) };
    }
    if (!Array.isArray(vec) || vec.length !== EXPECTED_DIM) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: `Bad embedding length: ${vec?.length}. Expected ${EXPECTED_DIM}` }) };
    }

    // derive simple filters for RPC
    const { min: _budget_min = null, max: _budget_max = null } = parseBudget(payload.budget);
    const _city = (payload.location || '').split(',')[0].trim() || null;
    const _ptype = payload.property_type || null;

    // Call RPC match_candidates_hybrid
    const rpcUrl = `${SUPABASE_URL}/rest/v1/rpc/match_candidates_hybrid`;
    const rpcBody = {
      q_vec_text,
      _city,
      _ptype,
      _budget_min,
      _budget_max,
      _bedrooms_min: null,
      _bathrooms_min: null,
      _verified_only: false,
      _want_metro: true,
      _k: 50
    };

    const rpcRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(rpcBody)
    });

    if (!rpcRes.ok) {
      const text = await rpcRes.text();
      console.error('RPC error', rpcRes.status, text);

      // Fallback to simpler RPC name if 404
      if (rpcRes.status === 404) {
        console.warn('RPC match_candidates_hybrid not found — attempting fallback rpc match_candidates');
        const fbRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_candidates`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(rpcBody)
        });
        if (!fbRes.ok) {
          const t = await fbRes.text();
          console.error('Fallback RPC failed', fbRes.status, t);
          return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Supabase RPC failed', details: t }) };
        }
        const fbRows = await fbRes.json();
        // continue with fbRows
        return await handleAndCacheResults(payload, fbRows, SUPABASE_URL, SUPABASE_KEY);
      }

      return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Supabase RPC failed', details: text }) };
    }

    const rows = await rpcRes.json();
    return await handleAndCacheResults(payload, rows, SUPABASE_URL, SUPABASE_KEY);

  } catch (err) {
    console.error('buyerMatch error', err);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message || String(err) }) };
  }
};

/**
 * Compact results, cache into cached_matches and return match_id
 */
async function handleAndCacheResults(payload, rows, SUPABASE_URL, SUPABASE_KEY) {
  const minimal = (rows || []).map(r => toCard(r));

  // Insert into cached_matches table
  const id = randomUUID();
  const expires_at = new Date(Date.now() + CACHE_TTL_MS).toISOString();
  const insertUrl = `${SUPABASE_URL}/rest/v1/cached_matches`;

  try {
    const insertRes = await fetch(insertUrl, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        id,
        meta: {
          search: {
            location: payload.location || '',
            property_type: payload.property_type || '',
            budget: payload.budget || ''
          },
          created_at: new Date().toISOString()
        },
        results: minimal,
        expires_at
      })
    });

    if (!insertRes.ok) {
      const t = await insertRes.text();
      console.warn('Could not insert cache:', insertRes.status, t);
      // still return results (no caching)
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ match_id: id, results_count: minimal.length, cached: false })
      };
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ match_id: id, results_count: minimal.length, cached: true })
    };

  } catch (err) {
    console.error('Cache insert error', err);
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ match_id: id, results_count: minimal.length, cached: false })
    };
  }
}
