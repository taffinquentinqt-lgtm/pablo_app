export async function callPabloChat({ auth, apiUrl, model, messages, timeoutMs = 15000 }) {
    if (!auth?.currentUser) {
        throw new Error("Connectez-vous pour utiliser Hey Pablo.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const idToken = await auth.currentUser.getIdToken();
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${idToken}`
            },
            body: JSON.stringify({ model, messages }),
            signal: controller.signal
        });

        if (!response.ok) throw new Error(`OpenAI ${response.status}`);
        const data = await response.json();
        if (data.error) throw new Error(data.error.message || data.error || "Erreur OpenAI");
        return data.choices?.[0]?.message?.content?.trim() || "";
    } finally {
        clearTimeout(timeout);
    }
}

