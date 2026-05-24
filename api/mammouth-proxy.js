export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    // On récupère la clé Groq sur Vercel
    const apiKey = process.env.GROQ_API_KEY; 

    if (!apiKey) {
        return res.status(500).json({ error: "La clé API GROQ_API_KEY n'est pas configurée sur Vercel." });
    }
    
    const { messages, systemInstruction } = req.body;

    if (!messages || messages.length === 0) {
        return res.status(400).json({ error: 'Messages manquants' });
    }

    const userText = messages[messages.length - 1].content;

    // Préparation du format attendu par Groq
    const formattedMessages = [];
    if (systemInstruction) {
        formattedMessages.push({ role: "system", content: systemInstruction });
    }
    formattedMessages.push({ role: "user", content: userText });

    try {
        // Point d'accès officiel de Groq
        const url = "https://api.groq.com/openai/v1/chat/completions";

        const response = await fetch(url, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "llama3-8b-8192", // Modèle ultra-rapide et gratuit de Meta
                messages: formattedMessages,
                temperature: 0.7,
                max_tokens: 1000
            })
        });

        const data = await response.json();

        // Gestion des erreurs renvoyées par Groq
        if (data.error) {
            return res.status(500).json({ error: data.error.message || data.error });
        }

        // Extraction de la réponse
        const botResponse = data.choices[0].message.content;

        // Renvoi au format attendu par ton app.js (sans que tu aies besoin de le modifier)
        return res.status(200).json({
            choices: [{
                message: { content: botResponse }
            }]
        });

    } catch (error) {
        console.error("Erreur Proxy Groq:", error);
        return res.status(500).json({ error: error.message });
    }
}