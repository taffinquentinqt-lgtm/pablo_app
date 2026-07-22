import { createVerify } from "node:crypto";

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "pablo-app-f6057";
const FIREBASE_ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
const GOOGLE_CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED_ORIGINS = new Set([
    "https://www.pablocanin.fr",
    "https://pablocanin.fr",
    "https://pablo-app-roan.vercel.app"
]);

let cachedCerts = null;
let certsExpiresAt = 0;
const rateLimitBuckets = new Map();

function enforceRateLimit(uid) {
    const now = Date.now();
    const windowMs = 30 * 60 * 1000;
    const maxCalls = 8;
    const bucket = (rateLimitBuckets.get(uid) || []).filter(ts => now - ts < windowMs);
    if (bucket.length >= maxCalls) {
        const error = new Error("Trop de generations avatar. Reessayez dans quelques minutes.");
        error.statusCode = 429;
        throw error;
    }
    bucket.push(now);
    rateLimitBuckets.set(uid, bucket);

    if (rateLimitBuckets.size > 5000) {
        for (const [key, hits] of rateLimitBuckets.entries()) {
            if (!hits.some(ts => now - ts < windowMs)) rateLimitBuckets.delete(key);
        }
    }
}

function jsonFromBase64Url(value) {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function getBearerToken(req) {
    const header = req.headers?.authorization || req.headers?.Authorization || "";
    const match = /^Bearer\s+(.+)$/i.exec(header);
    return match ? match[1] : "";
}

function normalizeBody(req) {
    if (!req.body) return {};
    if (typeof req.body === "string") {
        try { return JSON.parse(req.body); }
        catch { return {}; }
    }
    return req.body;
}

function resolveAllowedOrigin(origin) {
    if (!origin) return "";
    if (ALLOWED_ORIGINS.has(origin)) return origin;

    try {
        const parsed = new URL(origin);
        if (parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname)) {
            return origin;
        }
    } catch {
        return "";
    }

    return "";
}

async function getGoogleCerts() {
    const now = Date.now();
    if (cachedCerts && certsExpiresAt > now) return cachedCerts;

    const response = await fetch(GOOGLE_CERTS_URL);
    if (!response.ok) throw new Error("Impossible de verifier l'identite Firebase.");

    const cacheControl = response.headers.get("cache-control") || "";
    const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] || 300);
    cachedCerts = await response.json();
    certsExpiresAt = now + maxAge * 1000;
    return cachedCerts;
}

async function verifyFirebaseUser(req) {
    const token = getBearerToken(req);
    if (!token) {
        const error = new Error("Connexion requise.");
        error.statusCode = 401;
        throw error;
    }

    const parts = token.split(".");
    if (parts.length !== 3) {
        const error = new Error("Jeton Firebase invalide.");
        error.statusCode = 401;
        throw error;
    }

    let header;
    let payload;
    try {
        [header, payload] = [jsonFromBase64Url(parts[0]), jsonFromBase64Url(parts[1])];
    } catch {
        const error = new Error("Jeton Firebase illisible.");
        error.statusCode = 401;
        throw error;
    }

    if (header.alg !== "RS256" || !header.kid) {
        const error = new Error("Signature Firebase invalide.");
        error.statusCode = 401;
        throw error;
    }

    const certs = await getGoogleCerts();
    const cert = certs[header.kid];
    if (!cert) {
        const error = new Error("Certificat Firebase inconnu.");
        error.statusCode = 401;
        throw error;
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${encodedHeader}.${encodedPayload}`);
    verifier.end();

    const signatureOk = verifier.verify(cert, Buffer.from(encodedSignature, "base64url"));
    const now = Math.floor(Date.now() / 1000);
    const validPayload = payload.aud === FIREBASE_PROJECT_ID
        && payload.iss === FIREBASE_ISSUER
        && typeof payload.sub === "string"
        && payload.sub.length > 0
        && payload.sub.length <= 128
        && Number(payload.exp) > now
        && Number(payload.iat) <= now + 300;

    if (!signatureOk || !validPayload) {
        const error = new Error("Utilisateur Firebase non autorise.");
        error.statusCode = 401;
        throw error;
    }

    return payload;
}

function parseImageDataUrl(value) {
    const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(String(value || ""));
    if (!match) {
        const error = new Error("Photo invalide. Utilisez une image PNG, JPG ou WebP.");
        error.statusCode = 400;
        throw error;
    }
    const mime = match[1].toLowerCase().replace("image/jpg", "image/jpeg");
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
        const error = new Error("Photo trop lourde pour l'avatar IA.");
        error.statusCode = 413;
        throw error;
    }
    const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
    return { buffer, mime, ext };
}

function cleanText(value, fallback = "") {
    return String(value || fallback).replace(/[^\p{L}\p{N}\s'’.-]/gu, "").trim().slice(0, 80);
}

function buildPrompt({ petName, species, breed, style }) {
    const name = cleanText(petName, "l'animal");
    const animalSpecies = cleanText(species, "animal");
    const animalBreed = cleanText(breed, "race non precisee");
    const styleName = cleanText(style, "portrait premium");

    return [
        `Create a premium illustrated avatar of ${name}, a ${animalSpecies} ${animalBreed}, based on the reference photo.`,
        "Preserve the animal's recognizable coat colors, markings, expression, ear shape and general facial structure.",
        `Style direction: ${styleName}.`,
        "High-end pet brand avatar, polished digital illustration, clean composition, expressive eyes, soft studio lighting, elegant warm background, square profile picture.",
        "Do not add text, logos, watermarks, collars with readable brand names, extra animals, humans, medical objects or distorted anatomy."
    ].join(" ");
}

export default async function handler(req, res) {
    const allowedOrigin = resolveAllowedOrigin(req.headers?.origin || "");
    if (allowedOrigin) res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

    if (req.method === "OPTIONS") {
        return allowedOrigin ? res.status(200).end() : res.status(403).end();
    }

    if (req.headers?.origin && !allowedOrigin) {
        return res.status(403).json({ error: "Origine non autorisee." });
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Methode non autorisee." });
    }

    try {
        const firebaseUser = await verifyFirebaseUser(req);
        enforceRateLimit(firebaseUser.sub);

        if (!process.env.OPENAI_API_KEY) {
            return res.status(500).json({ error: "La variable OPENAI_API_KEY n'est pas configuree cote serveur." });
        }

        const body = normalizeBody(req);
        const { buffer, mime, ext } = parseImageDataUrl(body.imageDataUrl);
        const prompt = buildPrompt(body);

        const form = new FormData();
        form.append("model", OPENAI_IMAGE_MODEL);
        form.append("image", new Blob([buffer], { type: mime }), `pablo-reference.${ext}`);
        form.append("prompt", prompt);
        form.append("size", "1024x1024");
        form.append("quality", "high");
        form.append("output_format", "png");

        const response = await fetch("https://api.openai.com/v1/images/edits", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: form
        });

        const data = await response.json();
        if (!response.ok) {
            const message = data?.error?.message || "Generation avatar impossible.";
            return res.status(response.status).json({ error: message });
        }

        const b64 = data?.data?.[0]?.b64_json;
        if (!b64) return res.status(502).json({ error: "Image IA manquante." });
        return res.status(200).json({ imageDataUrl: `data:image/png;base64,${b64}` });
    } catch (error) {
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({ error: error.message });
    }
}
