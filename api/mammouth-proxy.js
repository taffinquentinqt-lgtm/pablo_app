export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    const apiKey = process.env.GROQ_API_KEY; 

    if (!apiKey) {
        return res.status(500).json({ error: "La clé API GROQ_API_KEY n'est pas configurée sur Vercel." });
    }
    
    const { messages, systemInstruction } = req.body;

    if (!messages || messages.length === 0) {
        return res.status(400).json({ error: 'Messages manquants' });
    }

    const userText = messages[messages.length - 1].content;

    const formattedMessages = [];
    if (systemInstruction) {
        formattedMessages.push({ role: "system", content: systemInstruction });
    }
    formattedMessages.push({ role: "user", content: userText });

    try {
        const url = "https://api.groq.com/openai/v1/chat/completions";

        const response = await fetch(url, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: formattedMessages,
                temperature: 0.7,
                max_tokens: 1000
            })
        });

        const data = await response.json();

        if (data.error) {
            return res.status(500).json({ error: data.error.message || data.error });
        }

        const botResponse = data.choices[0].message.content;

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