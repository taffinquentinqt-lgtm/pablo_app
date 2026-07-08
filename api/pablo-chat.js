// api/pablo-chat.js
export default async function handler(req, res) {
    // Evite les blocages CORS locaux.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Methode non autorisee." });
    }

    if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ error: "La variable OPENAI_API_KEY n'est pas configuree cote serveur." });
    }

    try {
        const body = req.body || {};
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: process.env.OPENAI_MODEL || body.model || "gpt-5.4-mini",
                messages: Array.isArray(body.messages) ? body.messages : []
            })
        });

        const data = await response.json();
        return res.status(response.status).json(data);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
