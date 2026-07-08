# Architecture Pablo

## Etat actuel

Pablo est une application Vite/PWA avec une interface principale dans `index.html`, une logique applicative centrale dans `app.js`, des fonctions serveur Vercel dans `api/`, et Firebase pour l'authentification, Firestore et les notifications.

Le choix actuel reste volontairement simple : une app front statique, deployable sur Vercel, avec une API serveur minimale pour proteger les appels IA.

## Regles d'acces

- La demo est accessible sans compte et reste locale.
- La vraie application demande une connexion Firebase.
- L'API IA `/api/pablo-chat` exige un jeton Firebase valide.
- La cle OpenAI reste uniquement cote serveur dans Vercel.
- Les appels API ne sont jamais caches par le service worker.

## Flux de donnees

1. L'utilisateur se connecte avec Firebase Auth.
2. Les donnees Firestore du document `users/{uid}` sont restaurees dans le stockage local.
3. L'app lit et ecrit vite depuis `localStorage` pour garder une experience fluide.
4. Les changements sont synchronises vers Firestore avec debounce.
5. En cas de perte de connexion, les ecritures sont mises en attente puis rejouees au retour du reseau.
6. Les donnees de demo ne sont pas poussees vers Firestore.

## Modules cibles

`app.js` est encore trop volumineux. La decomposition cible doit se faire progressivement :

- `src/auth/` : connexion, deconnexion, restauration session, garde d'acces.
- `src/storage/` : localStorage, file d'attente cloud, migration, suppression.
- `src/pets/` : creation, selection, suppression, profil animal.
- `src/health/` : poids, medical, nutrition, rappels.
- `src/breeding/` : elevage, portees, cessions, fiche publique.
- `src/assistant/` : contexte Hey Pablo, prompts, erreurs IA.
- `src/pwa/` : installation, service worker, etat offline.
- `src/ui/` : navigation, toasts, modales, petits composants.

## Prochaine refonte conseillee

La prochaine etape technique doit etre une extraction sans changement fonctionnel :

1. Creer un dossier `src/`.
2. Deplacer uniquement les helpers purs en premier.
3. Garder les fonctions globales `window.*` comme facade temporaire.
4. Verifier le build et les parcours demo/auth apres chaque extraction.
5. Supprimer les doublons une fois les modules stabilises.

Cette approche evite de casser l'app tout en rendant le code maintenable.
