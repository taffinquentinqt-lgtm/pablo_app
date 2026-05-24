export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    const apiKey = process.env.GEMINI_API_KEY; 

    if (!apiKey) {
        return res.status(500).json({ error: "La clé API GEMINI_API_KEY n'est pas configurée sur Vercel." });
    }
    
    const { messages, systemInstruction } = req.body;

    if (!messages || messages.length === 0) {
        return res.status(400).json({ error: 'Messages manquants' });
    }

    const userText = messages[messages.length - 1].content;

    // Concaténation ultra-robuste de l'instruction système et du message utilisateur
    const fullPrompt = systemInstruction 
        ? `${systemInstruction}\n\nDemande de l'utilisateur :\n${userText}`
        : userText;

    try {
        // LE FIX EST LÀ : Utilisation officielle de Gemini 2.0 Flash
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: fullPrompt }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 1000
                }
            })
        });

        const data = await response.json();

        // Interception propre si Google renvoie quand même une erreur
        if (data.error) {
            return res.status(500).json({ error: data.error });
        }

        const botResponse = data.candidates[0].content.parts[0].text;

        // Renvoi sous le format attendu par app.js
        return res.status(200).json({
            choices: [{
                message: { content: botResponse }
            }]
        });

    } catch (error) {
        console.error("Erreur Proxy Gemini 2.0:", error);
        return res.status(500).json({ error: error.message });
    }
}