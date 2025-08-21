import { createClient } from "@supabase/supabase-js";

// --- Supabase setup ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Service role for server-side ops
const supabase = createClient(supabaseUrl, supabaseKey);

export async function handler(event, context) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const body = JSON.parse(event.body);

    // --- OTP check ---
    if (body.otp_verified !== "true") {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "OTP not verified" }),
      };
    }

    // --- Validate required fields ---
    const requiredFields = ["name", "email", "phone", "location", "budget", "property_type", "timeline", "financing"];
    for (const field of requiredFields) {
      if (!body[field] || body[field].trim() === "") {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: `Missing field: ${field}` }),
        };
      }
    }

    // --- Insert buyer into Supabase ---
    const { data: buyer, error: insertError } = await supabase
      .from("buyers")
      .insert([{
        name: body.name.trim(),
        email: body.email.trim(),
        phone: body.phone.trim(),
        location: body.location.trim(),
        budget: body.budget,
        property_type: body.property_type,
        timeline: body.timeline,
        financing: body.financing,
        notes: body.notes || "",
        utm_source: body.utm_source || "",
        utm_medium: body.utm_medium || "",
        utm_campaign: body.utm_campaign || "",
        referrer: body.referrer || "",
        otp_verified: true,
        created_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (insertError) {
      console.error("Insert buyer error:", insertError);
      return { statusCode: 500, body: JSON.stringify({ error: "Failed to insert buyer" }) };
    }

    const buyerId = buyer.id;

    // --- Call AI property matching function ---
    const { data: matches, error: matchError } = await supabase.rpc(
      "match_buyer_to_properties",
      { buyer_uuid: buyerId }
    );

    if (matchError) {
      console.error("AI match error:", matchError);
      return { statusCode: 500, body: JSON.stringify({ error: "Failed to match properties" }) };
    }

    // --- Return top properties ---
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Buyer registered and properties matched successfully",
        buyer,
        matches
      }),
    };
  } catch (err) {
    console.error("Serverless function error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Internal server error" }) };
  }
}
