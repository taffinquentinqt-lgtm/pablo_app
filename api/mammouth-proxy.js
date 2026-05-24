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

    const userMessage = messages[messages.length - 1].content;

    try {
        // Route stable v1
        const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

        // Construction du payload selon la documentation stricte de Google v1
        const payload = {
            contents: [{ parts: [{ text: userMessage }] }],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 1000
            }
        };

        // Si une consigne système est présente, on l'ajoute au bon format attendu par la v1
        if (systemInstruction) {
            payload.system_instruction = {
                parts: [{ text: systemInstruction }]
            };
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.error) {
            return res.status(500).json({ error: data.error });
        }

        // Extraction sécurisée de la réponse
        if (!data.candidates || !data.candidates[0].content.parts[0].text) {
            throw new Error("Format de réponse Gemini inattendu");
        }

        const botResponse = data.candidates[0].content.parts[0].text;

        return res.status(200).json({
            choices: [{
                message: { content: botResponse }
            }]
        });

    } catch (error) {
        console.error("Erreur Proxy Gemini:", error);
        return res.status(500).json({ error: error.message });
    }
}