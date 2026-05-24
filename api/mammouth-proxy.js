export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    // Récupère la clé d'API configurée dans les variables d'environnement de Vercel
    const apiKey = process.env.GEMINI_API_KEY; 

    if (!apiKey) {
        return res.status(500).json({ error: "La clé API GEMINI_API_KEY n'est pas configurée sur Vercel." });
    }
    
    const { messages, systemInstruction } = req.body;

    if (!messages || messages.length === 0) {
        return res.status(400).json({ error: 'Messages manquants' });
    }

    // Extraction du texte envoyé par l'application
    const userMessage = messages[messages.length - 1].content;

    try {
        // URL stable officielle avec le modèle à jour (v1)
        const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: userMessage }] }],
                // Utilisation de system_instruction (avec le sous-tiret) valide pour l'API v1
                system_instruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 1000
                }
            })
        });

        const data = await response.json();

        if (data.error) {
            return res.status(500).json({ error: data.error });
        }

        // Extraction sécurisée de la réponse textuelle renvoyée par Google
        const botResponse = data.candidates[0].content.parts[0].text;

        // On formate la réponse pour qu'elle reste 100% compatible avec ton app.js actuel
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