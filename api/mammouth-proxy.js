export default async function handler(req, res) {
    // Vercel lit la clé secrète via process.env
    const apiKey = process.env.MAMMOUTH_API_KEY;

    if (!apiKey) {
        return res.status(500).json({ error: "Clé API serveur manquante." });
    }

    try {
        const response = await fetch("https://api.mammouth.ai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            // Vercel parse automatiquement le body en JSON
            body: JSON.stringify(req.body)
        });

        const data = await response.json();
        
        // On renvoie la réponse au site
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}