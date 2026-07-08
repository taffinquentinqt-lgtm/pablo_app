// api/pablo-chat.js
import { createVerify } from "node:crypto";

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "pablo-app-f6057";
const FIREBASE_ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
const GOOGLE_CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

let cachedCerts = null;
let certsExpiresAt = 0;

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

async function getGoogleCerts() {
    const now = Date.now();
    if (cachedCerts && certsExpiresAt > now) return cachedCerts;

    const response = await fetch(GOOGLE_CERTS_URL);
    if (!response.ok) {
        throw new Error("Impossible de verifier l'identite Firebase.");
    }

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

    const [encodedHeader, encodedPayload, encodedSignature] = parts;

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

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Methode non autorisee." });
    }

    try {
        await verifyFirebaseUser(req);

        if (!process.env.OPENAI_API_KEY) {
            return res.status(500).json({ error: "La variable OPENAI_API_KEY n'est pas configuree cote serveur." });
        }

        const body = normalizeBody(req);
        if (!Array.isArray(body.messages) || body.messages.length === 0) {
            return res.status(400).json({ error: "Messages manquants." });
        }

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
                messages: body.messages
            })
        });

        const data = await response.json();
        return res.status(response.status).json(data);
    } catch (error) {
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({ error: error.message });
    }
}
