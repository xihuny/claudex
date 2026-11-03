// Minimal Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) using only Node crypto - // no third-party dependency, to honour the project's no-bloat constraint.
import crypto from "crypto";
import https from "https";
import fs from "fs";

// Reuse TLS connections to the push services (Apple/FCM/Mozilla). Node pools per host, so
// repeat pushes and multi-device fan-out skip a fresh TLS handshake - shaving the send-side
// latency before the push even reaches the provider. (Device-side delivery is provider-paced;
// Urgency: high below is the lever there.)
const pushAgent = new https.Agent({ keepAlive: true, maxSockets: 20 });

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");

// VAPID JWT `sub` - a contact URI for this push server. MUST be a valid mailto: with a
// real FQDN or an https: URL: Apple's push service (web.push.apple.com, used by every
// iOS/Safari PWA) returns 403 BadJwtToken for a malformed sub (e.g. "localhost"), so
// iOS pushes silently never arrive. Set PUSH_CONTACT (mailto:you@example.com or an
// https URL) to identify your own deployment; the default points at the project.
const CONTACT = (() => {
  const c = process.env.PUSH_CONTACT;
  if (c && (c.startsWith("mailto:") || c.startsWith("https://"))) return c;
  return "https://github.com/xihuny/claudex";
})();

// Load (or generate + persist) the VAPID P-256 keypair. Returns the private key,
// and the public key as a b64url uncompressed point (used by the browser as the
// applicationServerKey and in the VAPID `k=` parameter).
export function loadVapid(file) {
  let priv, pub;
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    priv = crypto.createPrivateKey(j.private);
    pub = crypto.createPublicKey(j.public);
  } catch {
    const kp = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    priv = kp.privateKey; pub = kp.publicKey;
    try { fs.writeFileSync(file, JSON.stringify({ private: priv.export({ format: "pem", type: "pkcs8" }), public: pub.export({ format: "pem", type: "spki" }) }), { mode: 0o600 }); } catch {}
  }
  try { fs.chmodSync(file, 0o600); } catch {}   // the private key is owner-only, even if an older install wrote it wider
  const jwk = pub.export({ format: "jwk" });
  const publicKey = b64url(Buffer.concat([Buffer.from([4]), unb64url(jwk.x), unb64url(jwk.y)]));
  return { priv, publicKey };
}

function vapidAuth(vapid, endpoint) {
  const u = new URL(endpoint);
  const head = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const body = b64url(JSON.stringify({ aud: `${u.protocol}//${u.host}`, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: CONTACT }));
  const signingInput = `${head}.${body}`;
  const sig = crypto.sign("sha256", Buffer.from(signingInput), { key: vapid.priv, dsaEncoding: "ieee-p1363" });
  return `vapid t=${signingInput}.${b64url(sig)}, k=${vapid.publicKey}`;
}

// RFC 8291 §3.4 + RFC 8188 single-record aes128gcm encryption.
export function encryptPayload(sub, payload) {
  const uaPublic = unb64url(sub.keys.p256dh);    // browser's public key (65 bytes)
  const auth = unb64url(sub.keys.auth);          // 16-byte auth secret
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();          // our ephemeral public key (65 bytes)
  const ecdhSecret = ecdh.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", ecdhSecret, auth, keyInfo, 32));

  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));

  const plaintext = Buffer.concat([Buffer.from(payload), Buffer.from([2])]); // 0x02 = final-record delimiter
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096, 0);
  const header = Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic]);
  return Buffer.concat([header, ct]);
}

export function sendPush(vapid, sub, payloadObj) {
  return new Promise((resolve) => {
    let body;
    try { body = encryptPayload(sub, JSON.stringify(payloadObj)); }
    catch (e) { return resolve({ ok: false, error: String(e) }); }
    const u = new URL(sub.endpoint);
    const req = https.request({
      method: "POST", hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search,
      agent: pushAgent,
      headers: {
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "Content-Length": body.length,
        TTL: "86400",
        Urgency: "high",
        Authorization: vapidAuth(vapid, sub.endpoint),
      },
    }, (res) => {
      let d = ""; res.on("data", (c) => (d += c));
      res.on("end", () => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        resolve({ ok, status: res.statusCode, gone: res.statusCode === 404 || res.statusCode === 410, detail: ok ? "" : String(d || "").slice(0, 200) });
      });
    });
    req.on("error", (e) => resolve({ ok: false, error: String(e) }));
    req.end(body);
  });
}
