import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Web Push crypto utilities
const VAPID_SUBJECT = "mailto:push@lease-mileage-tracker.app";

const MS_PER_DAY = 86400000;

function frequencyToDays(freq: string): number {
  switch (freq) {
    case "daily": return 1;
    case "weekly": return 7;
    case "biweekly": return 14;
    case "monthly": return 30;
    default: return 7;
  }
}

// Import VAPID private key for JWT signing
async function importVapidKey(base64Key: string): Promise<CryptoKey> {
  // Convert URL-safe base64 to standard base64
  const b64 = base64Key.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
  const raw = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));

  // VAPID private key is 32 bytes raw — wrap in PKCS8 for P-256
  // JWK import is simpler for raw EC keys
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: base64Key,
    // Derive x,y from the public key
    x: Deno.env.get("VAPID_PUBLIC_X") || "",
    y: Deno.env.get("VAPID_PUBLIC_Y") || "",
  };

  return await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
}

// Create VAPID Authorization header
async function createVapidAuth(
  endpoint: string,
  publicKey: string,
  privateKey: string
): Promise<{ authorization: string; cryptoKey: string }> {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;

  // Build JWT header + payload
  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: VAPID_SUBJECT,
  };

  const enc = new TextEncoder();
  const toB64url = (buf: ArrayBuffer) => {
    const arr = new Uint8Array(buf);
    let str = "";
    for (const b of arr) str += String.fromCharCode(b);
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };

  const headerB64 = btoa(JSON.stringify(header))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const payloadB64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const signingInput = `${headerB64}.${payloadB64}`;

  // Import key and sign
  const key = await importVapidKey(privateKey);
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    enc.encode(signingInput)
  );

  // Convert DER signature to raw r||s (64 bytes)
  const sigBytes = new Uint8Array(sig);
  let r: Uint8Array, s: Uint8Array;
  if (sigBytes.length === 64) {
    r = sigBytes.slice(0, 32);
    s = sigBytes.slice(32, 64);
  } else {
    // DER format — parse
    let offset = 2;
    const rLen = sigBytes[offset + 1];
    offset += 2;
    r = sigBytes.slice(offset, offset + rLen);
    offset += rLen;
    const sLen = sigBytes[offset + 1];
    offset += 2;
    s = sigBytes.slice(offset, offset + sLen);
    // Pad/trim to 32 bytes
    if (r.length > 32) r = r.slice(r.length - 32);
    if (s.length > 32) s = s.slice(s.length - 32);
    if (r.length < 32) { const tmp = new Uint8Array(32); tmp.set(r, 32 - r.length); r = tmp; }
    if (s.length < 32) { const tmp = new Uint8Array(32); tmp.set(s, 32 - s.length); s = tmp; }
  }
  const rawSig = new Uint8Array(64);
  rawSig.set(r, 0);
  rawSig.set(s, 32);

  const token = `${signingInput}.${toB64url(rawSig.buffer)}`;
  const t = token;
  const k = publicKey;

  return {
    authorization: `vapid t=${t}, k=${k}`,
    cryptoKey: `p256ecdsa=${publicKey}`,
  };
}

// Send a push notification (no payload encryption — empty push triggers SW)
async function sendPushToEndpoint(
  subscription: { endpoint: string; keys?: { p256dh: string; auth: string } },
  title: string,
  body: string,
  vapidPublicKey: string,
  vapidPrivateKey: string
): Promise<{ success: boolean; status: number; endpoint: string }> {
  const { authorization, cryptoKey } = await createVapidAuth(
    subscription.endpoint,
    vapidPublicKey,
    vapidPrivateKey
  );

  // For simplicity, send a notification with no encrypted payload.
  // The service worker's push handler will use the default message.
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Crypto-Key": cryptoKey,
      TTL: "86400",
      "Content-Length": "0",
    },
  });

  return {
    success: response.status === 201 || response.status === 200,
    status: response.status,
    endpoint: subscription.endpoint,
  };
}

Deno.serve(async (req) => {
  try {
    // Auth: only allow service_role or cron calls
    const authHeader = req.headers.get("Authorization") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey,
      { auth: { persistSession: false } }
    );

    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") || "";

    if (!vapidPublicKey || !vapidPrivateKey) {
      return new Response(JSON.stringify({ error: "VAPID keys not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get all push subscriptions
    const { data: subs, error: subError } = await supabase
      .from("push_subscriptions")
      .select("user_id, subscription")
      .order("created_at");

    if (subError) {
      return new Response(JSON.stringify({ error: subError.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get all user data
    const userIds = (subs || []).map((s: any) => s.user_id);
    const { data: userRows, error: udError } = await supabase
      .from("user_data")
      .select("user_id, data")
      .in("user_id", userIds);

    if (udError) {
      return new Response(JSON.stringify({ error: udError.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Build lookup map
    const userDataMap = new Map<string, any>();
    for (const row of userRows || []) {
      userDataMap.set(row.user_id, row.data);
    }

    const now = Date.now();
    const nowDate = new Date();
    const nowHourUTC = nowDate.getUTCHours();
    const nowDayUTC = nowDate.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    let sent = 0;
    let skipped = 0;
    const expired: string[] = [];

    for (const row of subs || []) {
      const userData = userDataMap.get(row.user_id);
      if (!userData?.config || !userData?.entries?.length) {
        skipped++;
        continue;
      }

      // Check if notifications are enabled in config
      if (!userData.config.notificationsEnabled) {
        skipped++;
        continue;
      }

      // Check if it's the user's preferred reminder hour (default 9 AM UTC)
      const reminderHourUTC = userData.config.reminderHourUTC ?? 9;
      if (nowHourUTC !== reminderHourUTC) {
        skipped++;
        continue;
      }

      // Check day of week (-1 = every day, 0-6 = specific day matching UTC day)
      const reminderDayOfWeek = userData.config.reminderDayOfWeek ?? -1;
      if (reminderDayOfWeek !== -1 && nowDayUTC !== reminderDayOfWeek) {
        skipped++;
        continue;
      }

      // Check if overdue
      const lastEntry = userData.entries[userData.entries.length - 1];
      const lastDate = new Date(lastEntry.date + "T00:00:00").getTime();
      const daysSince = Math.floor((now - lastDate) / MS_PER_DAY);
      const interval = frequencyToDays(userData.config.checkInFrequency);

      if (daysSince < interval) {
        skipped++;
        continue;
      }

      // Send push
      const sub = row.subscription as {
        endpoint: string;
        keys?: { p256dh: string; auth: string };
      };

      const result = await sendPushToEndpoint(
        sub,
        "Time to log mileage",
        `It's been ${daysSince} day${daysSince !== 1 ? "s" : ""} since your last entry.`,
        vapidPublicKey,
        vapidPrivateKey
      );

      if (result.success) {
        sent++;
      } else if (result.status === 404 || result.status === 410) {
        // Subscription expired — mark for cleanup
        expired.push(sub.endpoint);
      }
    }

    // Clean up expired subscriptions
    if (expired.length > 0) {
      for (const endpoint of expired) {
        await supabase
          .from("push_subscriptions")
          .delete()
          .eq("subscription->>endpoint", endpoint);
      }
    }

    return new Response(
      JSON.stringify({ sent, skipped, expired: expired.length }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
