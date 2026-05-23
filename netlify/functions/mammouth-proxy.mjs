export default async (request, context) => {
    // Netlify récupère la clé secrète directement depuis ses serveurs
    const apiKey = Netlify.env.get('MAMMOUTH_API_KEY');

    if (!apiKey) {
        return new Response(JSON.stringify({ error: "Clé API serveur manquante." }), { status: 500 });
    }

    // On récupère le message envoyé par ton app.js
    const requestBody = await request.text();

    try {
        // Le serveur Netlify fait la demande à Mammouth AI en secret
        const response = await fetch("https://api.mammouth.ai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: requestBody
        });

        const data = await response.json();
        
        // On renvoie la réponse de l'IA à ton site web
        return new Response(JSON.stringify(data), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
};