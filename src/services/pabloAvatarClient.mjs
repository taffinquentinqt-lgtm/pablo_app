export async function callPabloAvatar({
    auth,
    apiUrl,
    imageDataUrl,
    petName,
    species,
    breed,
    style,
    timeoutMs = 90000
}) {
    if (!auth?.currentUser) {
        throw new Error("Connectez-vous pour générer un avatar IA.");
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
            body: JSON.stringify({ imageDataUrl, petName, species, breed, style }),
            signal: controller.signal
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.error) {
            throw new Error(data.error || `Avatar IA ${response.status}`);
        }
        if (!data.imageDataUrl) {
            throw new Error("Image IA manquante.");
        }
        return data.imageDataUrl;
    } finally {
        clearTimeout(timeout);
    }
}
