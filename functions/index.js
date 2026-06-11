const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();

// Tourne chaque jour à 9h00 (Europe/Paris)
exports.sendRappelsPablo = onSchedule({
    schedule: "0 9 * * *",
    timeZone: "Europe/Paris",
    region: "europe-west1"
}, async () => {
    const now = new Date();
    const usersSnap = await db.collection("users").get();

    const sends = [];

    for (const userDoc of usersSnap.docs) {
        const data = userDoc.data();
        const token = data.fcmToken;
        if (!token) continue;

        // Récupère tous les animaux de l'utilisateur
        const petsList = data.app_pets_list || [];

        for (const pet of petsList) {
            const petId = pet.id;
            const petName = pet.name || "Votre animal";

            // Rappels manuels (dates saisies par l'utilisateur)
            const reminders = data[`medical_${petId}`] || [];
            for (const r of reminders) {
                if (!r.date || !r.title) continue;
                const daysUntil = Math.round((new Date(r.date) - now) / 86400000);
                if (daysUntil === 7 || daysUntil === 3 || daysUntil === 1 || daysUntil === 0) {
                    const label = daysUntil === 0 ? "aujourd'hui"
                        : daysUntil === 1 ? "demain"
                        : `dans ${daysUntil} jours`;
                    sends.push(sendNotif(token, {
                        title: `🐾 Rappel ${petName}`,
                        body: `${r.title} — ${label}.`
                    }));
                }
            }

            // Rappels automatiques (vermifuge tous les 3 mois, vaccin annuel)
            const proData = data[`proData_${petId}`] || {};

            if (proData.lastDeworm) {
                const nextDeworm = new Date(proData.lastDeworm);
                nextDeworm.setMonth(nextDeworm.getMonth() + 3);
                const days = Math.round((nextDeworm - now) / 86400000);
                if (days === 7 || days === 3 || days === 1) {
                    sends.push(sendNotif(token, {
                        title: `🐾 Vermifuge ${petName}`,
                        body: `Le vermifuge est à renouveler dans ${days} jour(s).`
                    }));
                }
            }

            if (proData.lastVaccine) {
                const nextVaccin = new Date(proData.lastVaccine);
                nextVaccin.setFullYear(nextVaccin.getFullYear() + 1);
                const days = Math.round((nextVaccin - now) / 86400000);
                if (days === 30 || days === 7 || days === 1) {
                    sends.push(sendNotif(token, {
                        title: `🐾 Vaccin ${petName}`,
                        body: `Le rappel vaccinal est dans ${days} jour(s).`
                    }));
                }
            }
        }
    }

    await Promise.allSettled(sends);
    console.log(`Pablo rappels : ${sends.length} notifications envoyées.`);
});

async function sendNotif(token, { title, body }) {
    return getMessaging().send({
        token,
        notification: { title, body, imageUrl: "https://pablo-app-roan.vercel.app/pablo.jpg" },
        webpush: {
            notification: {
                icon: "https://pablo-app-roan.vercel.app/pablo.jpg",
                badge: "https://pablo-app-roan.vercel.app/pablo.jpg",
                requireInteraction: false
            },
            fcmOptions: { link: "https://pablo-app-roan.vercel.app/" }
        }
    });
}