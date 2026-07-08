# Checklist lancement Pablo

## Vercel

- `OPENAI_API_KEY` configuree uniquement dans les variables d'environnement.
- `OPENAI_MODEL` optionnel, sinon l'app utilise le modele par defaut du proxy.
- `FIREBASE_PROJECT_ID=pablo-app-f6057` configure pour verrouiller la verification des jetons.
- Verifier que le dernier commit est bien deploye en production.

## Firebase

- Authentification email/mot de passe activee.
- Authentification Google activee si le bouton Google reste visible.
- Regles Firestore : chaque utilisateur ne lit/ecrit que `users/{uid}`.
- Collections publiques (`fiches_publiques`, `shared_profiles`, `cessions`) revues avec des regles adaptees.

## Produit

- Parcours demo sans compte teste.
- Parcours creation de compte + onboarding teste.
- Creation, changement et suppression d'animal testes.
- Hey Pablo teste avec un compte connecte.
- Mode hors ligne teste sur mobile.
- Installation PWA testee sur Android/Chrome et iOS/Safari.

## Legal et confiance

- Mentions legales publiees.
- Limite veterinaire affichee dans Hey Pablo.
- Contact de suppression de compte disponible.
- Aucune cle secrete presente dans le code source.
