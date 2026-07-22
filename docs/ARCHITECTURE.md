# Architecture Pablo

## Objectif

Pablo reste une PWA Vite simple a deployer, mais le code critique doit sortir progressivement de `app.js`.
Le but est de garder une app rapide, fiable, testable et facile a faire evoluer.

## Etat actuel

Pablo est une application Vite/PWA avec une interface principale dans `index.html`, une logique applicative centrale dans `app.js`, des fonctions serveur Vercel dans `api/`, et Firebase pour l'authentification, Firestore et les notifications.

Le choix actuel reste volontairement simple : une app front statique, deployable sur Vercel, avec une API serveur minimale pour proteger les appels IA.

## Structure actuelle

- `index.html` : structure de l'interface et styles principaux.
- `app.js` : orchestration de l'app, etat global, navigation, ecrans metier.
- `api/pablo-chat.js` : proxy serveur Hey Pablo, cle OpenAI cote serveur, verification Firebase.
- `src/services/pabloChatClient.mjs` : appel client Hey Pablo avec jeton Firebase et timeout.
- `src/utils/heyPabloFormatting.mjs` : nettoyage et rendu des reponses Hey Pablo.
- `scripts/quality-check.mjs` : controles automatiques de securite, SEO, PWA et formatage.
- `public/` : pages statiques SEO, PWA, sitemap, service worker public.

## Fonctions produit critiques

- Profil sante premium : `profile`, `healthExtras`, score de completude et champs veterinaire, alimentation, alertes, traitements, notes d'urgence.
- Rappels intelligents : `CARE_RULES` calcule les soins en retard ou bientot dus, puis ajoute les alertes dossier, croquettes, elevage et evenements.
- Mode urgence : `EMERGENCY_GUIDES` affiche des reflexes de triage prudents et met en avant l'appel veterinaire.
- Hey Pablo vers carnet : une reponse peut etre sauvegardee en souvenir ou ajoutee au carnet medical comme note datee.
- Avatar magique : generation IA via `api/pablo-avatar.js`, reservee aux utilisateurs connectes. La photo est compressee cote client, envoyee a OpenAI uniquement au clic, et la cle reste cote serveur.

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

## Regle de refactor

Ne pas tout casser en une seule fois. A chaque evolution importante :

1. Extraire une fonction autonome vers `src/services`, `src/utils` ou `src/modules`.
2. Garder les fonctions globales `window.*` comme facade temporaire si l'HTML en depend encore.
3. Ajouter un controle dans `scripts/quality-check.mjs`.
4. Lancer `npm test` puis `npm run build`.
5. Pousser seulement si les deux passent.

## Modules cibles

`app.js` est encore trop volumineux. La decomposition cible doit se faire progressivement :

- `src/auth/` : connexion, deconnexion, restauration session, garde d'acces.
- `src/services/pabloStorage.mjs` : localStorage, file d'attente cloud, migration, suppression.
- `src/modules/pets.mjs` : creation, selection, suppression, profil animal.
- `src/modules/medical.mjs` : carnet, poids, nutrition, rappels et historique.
- `src/modules/emergency.mjs` : guides d'urgence, contacts veterinaire, notes de triage.
- `src/modules/breeder.mjs` : elevage, portees, chiots, cessions et registre.
- `src/modules/export.mjs` : PDF, JSON et fiches publiques.
- `src/assistant/` : contexte Hey Pablo, prompts, erreurs IA.
- `src/pwa/` : installation, service worker, etat offline.
- `src/ui/` : navigation, toasts, modales, petits composants.

## Prochaine refonte conseillee

La prochaine etape technique doit rester une extraction sans changement fonctionnel :

1. Deplacer les helpers purs en premier.
2. Isoler le stockage local + cloud.
3. Isoler les ecrans metier un par un.
4. Verifier le build et les parcours demo/auth apres chaque extraction.
5. Supprimer les doublons une fois les modules stabilises.
