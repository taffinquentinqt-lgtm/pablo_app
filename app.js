// --- IMPORTS FIREBASE & CLOUD FIRESTORE ---
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, updateDoc } from "firebase/firestore";
import { getMessaging, getToken } from "firebase/messaging";

// CONFIGURATION GLOBALE
// ==========================================
const GLOBAL_CONFIG_ID = "pablo_global_config";
const GROQ_MODEL = "llama-3.3-70b-versatile";

function trackEvent(name) {
    if (typeof window.clarity === 'function') window.clarity('event', name);
}

async function groqChat(messages) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const res = await fetch("/api/pablo-chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: GROQ_MODEL, messages }),
            signal: controller.signal
        });
        if (!res.ok) throw new Error(`Groq ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error.message || 'Erreur Groq');
        return data.choices?.[0]?.message?.content?.trim() || '';
    } finally {
        clearTimeout(timeout);
    }
}

const firebaseConfig = {
    apiKey: "AIzaSyBuz7iwOzeEFsFDU1G5aAe69JCczaduI44",
    authDomain: "pablo-app-f6057.firebaseapp.com",
    projectId: "pablo-app-f6057",
    storageBucket: "pablo-app-f6057.firebasestorage.app",
    messagingSenderId: "764832752787",
    appId: "1:764832752787:web:21948ed789665c531b9966",
    measurementId: "G-RE0F1KKEK3"
};

const app = initializeApp(firebaseConfig);
let analytics;
try {
    analytics = getAnalytics(app);
} catch (e) {
    console.warn("Firebase Analytics bloqué ou non supporté.");
}
const auth = getAuth(app);
const db = getFirestore(app);

// Capture immédiate d'un lien de cession (?cession=...) AVANT que l'auth ne réagisse,
// pour que la récupération se déclenche dès la connexion. Banni des logs Clarity.
try {
    const _cp = new URLSearchParams(window.location.search).get('cession');
    if (_cp) localStorage.setItem('_pendingCession', _cp);
} catch (e) { /* no-op */ }

// 🟢 EXPOSITION INDISPENSABLE POUR LA PAGE INDEX.HTML :
window._fbAuth = auth;

// Variables globales
let petsList = [];
let currentPetId = null;
let petProfile = {};
let weightHistory = [];
let medicalEvents = [];
let dailyTrackers = {};
let chatHistory = [];
let budgetExpenses = [];
let educationData = {};
let proData = {};
let proEvents = [];
let proLitters = [];
let healthExtras = {};
let proHistory = { heats: [], matings: [] };
let memoriesList = [];
let gamification = { streak: 0, lastLogin: null, badges: [] };

let weightChartInstance = null;

const DEFAULT_EDU_EXERCISES = [
    { id: 'assis',          name: "S'asseoir (Assis)",             icon: 'fa-arrow-down' },
    { id: 'coucher',        name: 'Se coucher (Couché)',             icon: 'fa-bed' },
    { id: 'rappel',         name: 'Le Rappel au pied',               icon: 'fa-dog' },
    { id: 'pas-bouger',     name: 'Pas bouger (Statique)',           icon: 'fa-hand' },
    { id: 'proprete',       name: 'La Propreté',                      icon: 'fa-droplet-slash' },
    { id: 'marche-laisse',  name: 'Marche en laisse détendue',       icon: 'fa-bezier-curve' },
    { id: 'solitude',       name: 'Gestion de la solitude',          icon: 'fa-house-chimney-user' }
];

// ==========================================
// AUTHENTIFICATION (FIREBASE)
// ==========================================

function clearAppLocalData() {
    Object.keys(localStorage).forEach(k => {
        if (k.startsWith('firebase')) return;
        if (k.startsWith('clarity') || k.startsWith('_clarity')) return;
        localStorage.removeItem(k);
    });
}

async function migrateLocalToCloud(uid) {
    const payload = {};
    Object.keys(localStorage).forEach(k => {
        if (k.startsWith('firebase') || k.startsWith('clarity') || k.startsWith('_clarity') || k === '_pablo_owner_uid' || k === '_pendingCession') return;
        try { payload[k] = JSON.parse(localStorage.getItem(k)); }
        catch (e) { payload[k] = localStorage.getItem(k); }
    });
    if (Object.keys(payload).length === 0) return;
    try { await setDoc(doc(db, "users", uid), payload, { merge: true }); }
    catch (e) { console.error("Migration cloud échouée :", e); }
}

onAuthStateChanged(auth, async (user) => {
    const authPage = document.getElementById('auth-page');
    const mainApp  = document.getElementById('main-app-layout');
    const landing  = document.getElementById('landing-page');

    if (user) {
        console.log("🟢 Connecté :", user.email);
        try {
            const prevUid    = localStorage.getItem('_pablo_owner_uid');
            const userDocRef = doc(db, "users", user.uid);
            const userDoc    = await getDoc(userDocRef);
            const cloudData  = userDoc.exists() ? userDoc.data() : null;
            const loadCloud  = () => { if (cloudData) Object.keys(cloudData).forEach(key => localStorage.setItem(key, JSON.stringify(cloudData[key]))); };

            if (prevUid === user.uid) {
                loadCloud();
            } else {
                clearAppLocalData();
                const _recp = getCessionParam();
                if (_recp) localStorage.setItem('_pendingCession', _recp);
                loadCloud();
            }
            localStorage.setItem('_pablo_owner_uid', user.uid);
        } catch (e) { console.error("Erreur de restauration Cloud :", e); }

        if (landing)  landing.style.display  = 'none';
        if (authPage) authPage.style.display  = 'none';

        if (typeof window.clarity === 'function')
            window.clarity('identify', user.uid, undefined, undefined, user.displayName || user.email || '');

        initApp();

        if (mainApp) {
            mainApp.style.display = 'flex';
            setTimeout(() => renderWeightChart(), 150);
        }

        const _pending = localStorage.getItem('_pendingCession');
        if (_pending) claimCession(_pending);
    } else {
        if (mainApp) mainApp.style.display = 'none';
        if (landing) landing.style.display = 'block';
    }
});

window.enterApp = () => {
    const landing  = document.getElementById('landing-page');
    const authPage = document.getElementById('auth-page');
    if (landing)  landing.style.display = 'none';
    if (!auth.currentUser && authPage) authPage.style.display = 'flex';
};

window.toggleAuthMode = () => {
    const btn        = document.getElementById('auth-action-btn');
    const subtitle   = document.getElementById('auth-subtitle');
    const switchText = document.getElementById('auth-switch-text');
    const switchLink = document.getElementById('auth-switch-link');
    const pwInput    = document.getElementById('auth-password');

    if (!btn) return;
    const isLoginMode = btn.textContent === 'Se connecter';

    btn.textContent        = isLoginMode ? 'Créer mon compte' : 'Se connecter';
    subtitle.textContent   = isLoginMode ? 'Rejoignez la meute et gérez la santé de votre chien.' : 'Connectez-vous pour retrouver votre compagnon.';
    switchText.textContent = isLoginMode ? 'Déjà un compte ?' : 'Pas encore de compte ?';
    switchLink.textContent = isLoginMode ? 'Se connecter' : 'Créer un compte';
    if (pwInput) pwInput.autocomplete = isLoginMode ? 'new-password' : 'current-password';
};

window.processAuth = async () => {
    const email    = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value.trim();
    if (!email || !password) { window.showAuthMsg("Veuillez remplir tous les champs. 🐾", "error"); return; }
    if (password.length < 6)  { window.showAuthMsg("Le mot de passe doit faire au moins 6 caractères.", "error"); return; }

    const btn          = document.getElementById('auth-action-btn');
    const originalText = btn.textContent;
    const isLoginMode  = originalText === 'Se connecter';

    btn.textContent = "Chargement...";
    btn.disabled = true;
    try {
        if (isLoginMode) {
            await signInWithEmailAndPassword(auth, email, password);
        } else {
            await createUserWithEmailAndPassword(auth, email, password);
            window.showAuthMsg("Compte créé avec succès ! Bienvenue ! 🎉", "success");
        }
    } catch (error) {
        let friendlyMessage = error.message;
        if (error.code === 'auth/email-already-in-use') friendlyMessage = "Cet email est déjà utilisé.";
        if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') friendlyMessage = "Identifiants incorrects.";
        if (error.code === 'auth/user-not-found') friendlyMessage = "Aucun utilisateur trouvé avec cet email.";
        if (error.code === 'auth/invalid-email') friendlyMessage = "Adresse email invalide.";
        window.showAuthMsg(`Erreur : ${friendlyMessage}`, "error");
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
};

window.processGoogleAuth = async () => {
    try {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
    } catch (error) {
        window.showAuthMsg(`Erreur Google : ${error.message}`, "error");
    }
};

window.processResetPassword = async () => {
    const email = document.getElementById('auth-email').value.trim();
    if (!email) { window.showAuthMsg("⚠️ Veuillez entrer une adresse email.", "error"); return; }
    try {
        await sendPasswordResetEmail(auth, email);
        window.showAuthMsg("🐾 Lien envoyé ! Vérifiez votre boîte mail.", "success");
    } catch (error) {
        window.showAuthMsg("❌ Erreur : " + error.message, "error");
    }
};

window.logoutApp = async () => {
    try { 
        await signOut(auth); 
        clearAppLocalData();
        localStorage.removeItem('_pablo_owner_uid');
        location.reload(); 
    } catch (error) { 
        console.error("Erreur déconnexion:", error); 
    }
};

// ==========================================
// INITIALISATION
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initGlobalConfig();

    const _pendingCession = localStorage.getItem('_pendingCession') || getCessionParam();
    if (_pendingCession) showPendingCessionBanner(_pendingCession);

    const chatInput = document.getElementById('chat-input-field');
    if (chatInput) chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

    const weightDate = document.getElementById('weight-date');
    if (weightDate) weightDate.value = new Date().toISOString().split('T')[0];

    const selector = document.getElementById('pet-selector');
    if (selector) selector.addEventListener('change', (e) => switchPet(e.target.value));

    const mobileSelector = document.getElementById('mobile-pet-selector');
    if (mobileSelector) mobileSelector.addEventListener('change', (e) => switchPet(e.target.value));
});

function initGlobalConfig() {
    const saved = localStorage.getItem(GLOBAL_CONFIG_ID);
    if (saved) {
        const config = JSON.parse(saved);
        if (config.lightMode) document.body.classList.add('light-mode');
    }
}

window.toggleTheme = () => {
    document.body.classList.toggle('light-mode');
    const isLight = document.body.classList.contains('light-mode');
    localStorage.setItem(GLOBAL_CONFIG_ID, JSON.stringify({ lightMode: isLight }));
    renderWeightChart();
};

const _cloudSaveTimers = {};
async function saveLocalData(petId, key, data) {
    const storageKey = `${key}_${petId}`;
    localStorage.setItem(storageKey, JSON.stringify(data));
    if (!auth.currentUser) return;
    clearTimeout(_cloudSaveTimers[storageKey]);
    _cloudSaveTimers[storageKey] = setTimeout(async () => {
        try {
            const userDocRef = doc(db, "users", auth.currentUser.uid);
            await setDoc(userDocRef, { [storageKey]: data }, { merge: true });
        } catch (e) { console.error("Erreur sync Cloud :", e); }
    }, 500);
}

function getLocalData(petId, key, defaultValue) {
    const data = localStorage.getItem(`${key}_${petId}`);
    return data ? JSON.parse(data) : defaultValue;
}

function escHtml(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ==========================================
// GESTION MULTI-ANIMAUX
// ==========================================
function initApp() {
    const savedPets = localStorage.getItem('app_pets_list');
    petsList = savedPets ? JSON.parse(savedPets) : [];

    if (petsList.length === 0) {
        currentPetId = null;
        localStorage.removeItem('current_pet_id');
        renderPetSelector();
        if (!localStorage.getItem('_pendingCession') && typeof window.createNewPet === 'function') {
            setTimeout(() => window.createNewPet(), 350);
        }
        return;
    }

    currentPetId = localStorage.getItem('current_pet_id') || petsList[0].id;
    renderPetSelector();
    loadCurrentPetData();
}

function renderPetSelector() {
    const label    = document.getElementById('pet-selector-label');
    const list     = document.getElementById('pet-selector-list');
    const current  = petsList.find(p => p.id === currentPetId);
    if (label) label.textContent = current ? current.name : '—';
    if (list) {
        list.innerHTML = '';
        petsList.forEach(pet => {
            const div = document.createElement('div');
            div.className = 'custom-pet-select__option' + (pet.id === currentPetId ? ' selected' : '');
            div.textContent = pet.name;
            div.onclick = () => { closePetDropdowns(); switchPet(pet.id); };
            list.appendChild(div);
        });
    }

    const mLabel   = document.getElementById('mobile-pet-selector-label');
    const mList    = document.getElementById('mobile-pet-selector-list');
    const mWrap    = document.getElementById('mobile-pet-selector-wrap');
    if (mLabel) mLabel.textContent = current ? current.name : '—';
    if (mWrap)  mWrap.style.display = petsList.length > 0 ? '' : 'none';
    if (mList) {
        mList.innerHTML = '';
        petsList.forEach(pet => {
            const div = document.createElement('div');
            div.className = 'custom-pet-select__option' + (pet.id === currentPetId ? ' selected' : '');
            div.textContent = pet.name;
            div.onclick = () => { closePetDropdowns(); switchPet(pet.id); };
            mList.appendChild(div);
        });
    }
}

window.togglePetDropdown = function(wrapId) {
    const wrap = document.getElementById(wrapId);
    if (!wrap) return;
    const isOpen = wrap.classList.contains('open');
    closePetDropdowns();
    if (!isOpen) wrap.classList.add('open');
};

function closePetDropdowns() {
    document.querySelectorAll('.custom-pet-select.open').forEach(el => el.classList.remove('open'));
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-pet-select')) closePetDropdowns();
});

window.switchPet = function(petId) {
    currentPetId = petId;
    localStorage.setItem('current_pet_id', currentPetId);
    loadCurrentPetData();
    navigateTo('screen-home');
};

window.createNewPet = function() {
    const modal = document.getElementById('add-pet-modal');
    if (modal) {
        modal.classList.add('open');
        const nameInput = document.getElementById('new-pet-name-input');
        if (nameInput) { nameInput.value = ''; nameInput.focus(); }
        const breedInput = document.getElementById('new-pet-breed-input');
        if (breedInput) breedInput.value = '';
    }
};

window.closePetModal = function() {
    const modal = document.getElementById('add-pet-modal');
    if (modal) modal.classList.remove('open');
};

window.confirmCreateNewPet = function() {
    const name    = document.getElementById('new-pet-name-input').value.trim();
    const species = document.getElementById('new-pet-species-input').value;
    const breed   = document.getElementById('new-pet-breed-input').value.trim();
    if (!name) { showToast("Le nom ne peut pas être vide ! 🐾", "⚠️", "error"); return; }

    const newId = 'pet_' + Date.now();
    petsList.push({ id: newId, name });
    localStorage.setItem('app_pets_list', JSON.stringify(petsList));
    if (auth.currentUser) setDoc(doc(db, "users", auth.currentUser.uid), { app_pets_list: petsList }, { merge: true });

    saveLocalData(newId, 'profile',      { name, species, breed, age: 0, size: 0, weight: 0, avatar: "", breedAdvice: "" });
    saveLocalData(newId, 'weight',      []);
    saveLocalData(newId, 'medical',     []);
    saveLocalData(newId, 'education',   {});
    saveLocalData(newId, 'daily',       { water: 0, walk: 0, date: new Date().toISOString().split('T')[0] });
    saveLocalData(newId, 'chat',        [{ sender: 'bot', text: `Wouf ! Je suis l'assistant de ${name}. Comment puis-je aider ?` }]);
    saveLocalData(newId, 'budget',      []);
    saveLocalData(newId, 'proData',     { gender: 'Non spécifié' });
    saveLocalData(newId, 'proEvents',   []);
    saveLocalData(newId, 'proLitters',  []);
    saveLocalData(newId, 'healthExtras', { allergies: '', vetName: '', vetPhone: '', kibbleBag: 0, kibbleRemaining: 0 });
    saveLocalData(newId, 'proHistory',  { heats: [], matings: [] });
    saveLocalData(newId, 'memories',    []);
    saveLocalData(newId, 'gamification', { streak: 0, lastLogin: null, badges: [] });

    trackEvent('pet_created');
    closePetModal();
    switchPet(newId);
}

function loadCurrentPetData() {
    if (!currentPetId) return; 
    initPetProfile();
    initWeightHistory();
    initMedicalRecords();
    initEducation();
    initDailyTrackers();
    initChat();
    initBudgetTracker();
    initProData();
    initHealthExtras();
    initProHistory();
    initMemories();
    initGamification();
    initRegistre();
}

window.deleteCurrentPet = function() {
    showConfirm(`Supprimer ${escHtml(petProfile.name)} ?`, () => { _doDeleteCurrentPet(); });
};

function _doDeleteCurrentPet() {
    const keys = ['profile','weight','medical','education','daily','chat','budget','proData','proEvents','proLitters','healthExtras','proHistory','memories','gamification','custom_exercises'];
    keys.forEach(key => localStorage.removeItem(`${key}_${currentPetId}`));
    petsList = petsList.filter(p => p.id !== currentPetId);
    localStorage.setItem('app_pets_list', JSON.stringify(petsList));
    if (auth.currentUser) setDoc(doc(db, "users", auth.currentUser.uid), { app_pets_list: petsList }, { merge: true });

    if (petsList.length === 0) {
        currentPetId = null;
        localStorage.removeItem('current_pet_id');
        initApp();
    } else {
        switchPet(petsList[0].id);
    }
}

// ==========================================
// PROFIL & ENCYCLOPÉDIE (GROQ SECURE ROUTER)
// ==========================================
async function updateBreedAdviceUI() {
    const adviceCard      = document.getElementById('breed-advice-card');
    const adviceBreedName = document.getElementById('advice-breed-name');
    const adviceContent   = document.getElementById('breed-advice-content');
    if (!adviceCard) return;

    if (!petProfile.breed || petProfile.breed.trim() === '') { adviceCard.style.display = 'none'; return; }
    adviceCard.style.display = 'block';
    if (adviceBreedName) adviceBreedName.innerText = petProfile.breed;

    if (petProfile.breedAdvice) { if (adviceContent) adviceContent.innerHTML = petProfile.breedAdvice; return; }
    if (adviceContent) adviceContent.innerHTML = "<div style='text-align:center; padding:20px;'><i class='fa-solid fa-spinner fa-spin' style='font-size:24px; color:var(--gold);'></i><br><br><span style='color:var(--text-muted); font-size:13px;'>Génération de l'encyclopédie via Groq…</span></div>";

    try {
        const prompt = `Tu es un expert canin. Rédige une documentation complète pour un ${petProfile.species || 'animal'} de race ${petProfile.breed}.
Structure ta réponse en HTML propre avec ces sections en balises <h4> (avec emojis pertinents) :
<h4>Comportement & Caractère</h4>
<h4>Besoins en exercice</h4>
<h4>Santé & Toilettage</h4>
<h4>Conseil d'éducation</h4>
Utilise des paragraphes <p> et des listes <ul><li>. Pas d'introduction ni de conclusion, envoie uniquement le HTML propre.`;

        const text  = await groqChat([{ role: "user", content: prompt }]);
        const clean = text.replace(/```html|```/g, '').trim();

        petProfile.breedAdvice = clean;
        saveLocalData(currentPetId, 'profile', petProfile);
        if (adviceContent) adviceContent.innerHTML = clean;
    } catch (error) {
        console.error("Erreur encyclopédie Groq:", error);
        if (adviceContent) adviceContent.innerText = `Documentation indisponible (${error.message}).`;
    }
}

// ==========================================
// NUTRITION EXPERTE (ÂGE + RACE)
// ==========================================
window.updateNutritionUI = async function() {
    const nutritionRationText = document.getElementById('nutrition-ration-text');
    const activitySelector    = document.getElementById('activity-level-selector');

    if (!petProfile.weight || !nutritionRationText || !activitySelector) return;

    const weight = parseFloat(petProfile.weight);
    const ageMonths = parseInt(petProfile.age) || 24; // Par défaut adulte si non renseigné
    const breed = petProfile.breed || 'Inconnue';
    const species = (petProfile.species || 'chien').toLowerCase();
    const activity = activitySelector.value;

    nutritionRationText.style.fontSize = '16px';
    nutritionRationText.innerText      = 'Calcul…';

    try {
        // PROMPT EXPERT : On force l'IA à utiliser la race et l'âge pour le calcul
        const prompt = `Tu es un vétérinaire nutritionniste expert. Calcule la ration QUOTIDIENNE (en grammes) de croquettes pour ce profil strict :
        - Espèce : ${species}
        - Race : ${breed} (très important : adapte le métabolisme selon si c'est une race naine, géante, de travail, ou prédisposée à l'obésité)
        - Âge : ${ageMonths} mois (si c'est un chiot, prends en compte la courbe de croissance propre à sa race)
        - Poids actuel : ${weight} kg
        - Niveau d'activité : ${activity}
        
        Calcule le besoin énergétique (RER/MER) en fonction de sa RACE et de son ÂGE. On estime que des croquettes standard font environ 380 kcal/100g.
        NE FAIS AUCUNE PHRASE. Réponds UNIQUEMENT par le chiffre suivi de la lettre g (ex: 420g).`;

        const aiText = await groqChat([{ role: "user", content: prompt }]);
        nutritionRationText.style.fontSize = '';

        // Extraction du résultat
        const match = aiText.match(/\d+\s*g/i);
        if (match) {
            nutritionRationText.innerText = match[0].toLowerCase().replace(' ', '');
        } else {
            const nums = aiText.match(/\d+/);
            if (nums) nutritionRationText.innerText = nums[0] + 'g';
            else throw new Error("Format IA non reconnu");
        }
    } catch (e) {
        // FALLBACK HORS-LIGNE : Si pas d'internet, on utilise un calcul d'urgence basé sur l'âge et le poids
        console.warn("Calcul IA échoué, utilisation de la formule locale (Poids + Âge).");
        
        const RER = 70 * Math.pow(weight, 0.75);
        let factor = 1.6; // Base adulte
        
        if (species === 'chien') {
            if (ageMonths < 4) factor = 3.0;
            else if (ageMonths < 12) factor = 2.0;
            else if (activity === 'calm') factor = 1.2;
            else if (activity === 'active') factor = 2.0;
        } else {
            if (ageMonths < 6) factor = 2.5;
            else if (ageMonths < 12) factor = 2.0;
            else if (activity === 'calm') factor = 1.0;
            else if (activity === 'active') factor = 1.4;
        }
        
        const MER = RER * factor;
        const baseRation = Math.round(MER / 3.8); // 3.8 kcal/g
        
        nutritionRationText.style.fontSize = '';
        nutritionRationText.innerText = baseRation + 'g';
    }
};

// ==========================================
// CHAT ASSISTANT (GROQ SECURE ROUTER)
window.sendMessage = async function() {
    const input = document.getElementById('chat-input-field');
    const text  = input?.value.trim();
    if (!text) return;

    chatHistory.push({ sender: 'user', text });
    input.value = '';
    trackEvent('chat_sent');

    const loadingId  = Date.now();
    const loadingTxt = `<span class="running-dog">🐶</span> <em style="font-size:13px; color:var(--text-muted); margin-left:8px;">Pablo renifle une piste…</em>`;
    chatHistory.push({ sender: 'bot', text: loadingTxt, _id: loadingId });
    renderChat();

    const systemPrompt = `Tu es l'assistant Pablo, spécialisé en bien-être animal. Tu aides le maître de : ${petProfile.name || 'l\'animal'}, Espèce: ${petProfile.species || 'Chien'}, Race: ${petProfile.breed || 'Inconnue'}, Âge: ${petProfile.age || '?'} mois, Poids: ${petProfile.weight || '?'} kg. Sois concis, bienveillant, ne réponds qu'à des sujets en rapport avec les animaux et finis toujours par un wouf ou un miaou !`;

    const apiMessages = chatHistory
        .filter(m => !m._id)
        .slice(-10)
        .map(m => ({ role: m.sender === 'bot' ? 'assistant' : 'user', content: m.text }));

    try {
        const replyTx = await groqChat([
            { role: "system", content: systemPrompt },
            ...apiMessages
        ]);

        chatHistory = chatHistory.filter(m => m._id !== loadingId);
        chatHistory.push({ sender: 'bot', text: replyTx });
        renderChat();
        await saveLocalData(currentPetId, 'chat', chatHistory);
    } catch (e) {
        chatHistory = chatHistory.filter(m => m._id !== loadingId);
        const errMsg = e.name === 'AbortError'
            ? '⏱️ Pablo met trop de temps à répondre. Réessaie dans un instant !'
            : '❌ Impossible de contacter Pablo. Vérifie ta connexion internet.';
        chatHistory.push({ sender: 'bot', text: errMsg });
        renderChat();
    }
};

// ==========================================
// POIDS & NUTRITION (LOCAL ASSIGNMENTS)
// ==========================================
function initPetProfile() {
    petProfile = getLocalData(currentPetId, 'profile', {});

    const breedEl = document.getElementById('header-pet-breed');
    if (breedEl) breedEl.innerText = petProfile.breed || 'Compagnon santé';

    const topNameEl = document.getElementById('current-pet-display-top');
    if (topNameEl) topNameEl.innerText = petProfile.name || 'Pablo';

    const profileImg         = document.getElementById('profile-pet-image');
    const profilePlaceholder = document.getElementById('profile-avatar-placeholder');
    if (petProfile.avatar) {
        if (profileImg)         { profileImg.src = petProfile.avatar; profileImg.style.display = 'block'; }
        if (profilePlaceholder) profilePlaceholder.style.display = 'none';
    } else {
        if (profileImg)         profileImg.style.display = 'none';
        if (profilePlaceholder) {
            profilePlaceholder.style.display = 'flex';
            profilePlaceholder.innerText     = (petProfile.name || 'P').charAt(0).toUpperCase();
        }
    }

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    setVal('profile-name',    petProfile.name);
    setVal('profile-breed',   petProfile.breed);
    setVal('profile-age',     petProfile.age);
    setVal('profile-size',    petProfile.size);
    setVal('profile-weight',  petProfile.weight);

    const allergyInput = document.getElementById('profile-allergies');
    if (allergyInput) allergyInput.value = (getLocalData(currentPetId, 'healthExtras', {})).allergies || '';

    document.querySelectorAll('.dynamic-pet-name').forEach(el => el.innerText = petProfile.name || 'Pablo');

    updateBreedAdviceUI();
}

window.savePetProfile = function() {
    const name      = document.getElementById('profile-name').value.trim();
    if (!name) { showToast("Le nom est obligatoire.", "⚠️", "error"); return; }
    const weight    = parseFloat(document.getElementById('profile-weight').value);
    const newBreed  = document.getElementById('profile-breed').value.trim();

    if (petProfile.breed !== newBreed) petProfile.breedAdvice = '';
    petProfile.name  = name;
    petProfile.breed = newBreed;
    petProfile.age   = parseInt(document.getElementById('profile-age').value)  || 0;
    petProfile.size  = parseInt(document.getElementById('profile-size').value) || 0;

    if (weight && weight !== petProfile.weight) {
        weightHistory.push({ date: new Date().toISOString().split('T')[0], weight });
        saveLocalData(currentPetId, 'weight', weightHistory);
    }
    petProfile.weight = weight || petProfile.weight;
    saveLocalData(currentPetId, 'profile', petProfile);

    const allergyInput = document.getElementById('profile-allergies');
    if (allergyInput) {
        healthExtras.allergies = allergyInput.value.trim();
        saveLocalData(currentPetId, 'healthExtras', healthExtras);
    }

    const petObj = petsList.find(p => p.id === currentPetId);
    if (petObj) {
        petObj.name = name;
        localStorage.setItem('app_pets_list', JSON.stringify(petsList));
        if (auth.currentUser) setDoc(doc(db, "users", auth.currentUser.uid), { app_pets_list: petsList }, { merge: true });
        renderPetSelector();
    }

    loadCurrentPetData();
    showToast(`Profil de ${name} enregistré ! 🐾`);
    navigateTo('screen-home');
};

window.uploadPetPhoto = function() {
    const file = document.getElementById('file-upload-input').files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
        petProfile.avatar = reader.result;
        const img         = document.getElementById('profile-pet-image');
        const placeholder = document.getElementById('profile-avatar-placeholder');
        if (img)         { img.src = reader.result; img.style.display = 'block'; }
        if (placeholder) placeholder.style.display = 'none';
        saveLocalData(currentPetId, 'profile', petProfile);
    };
    reader.readAsDataURL(file);
};

function initWeightHistory() {
    weightHistory = getLocalData(currentPetId, 'weight', []);
    updateWeightUI();
    renderWeightChart();
}

function updateWeightUI() {
    const nutritionWeightText = document.getElementById('nutrition-weight-text');
    const nutritionRationText = document.getElementById('nutrition-ration-text');
    const waterTargetText     = document.getElementById('water-target-text');

    if (weightHistory.length === 0) {
        if (nutritionWeightText) nutritionWeightText.innerText = '-- kg';
        if (nutritionRationText) nutritionRationText.innerText = '-- g';
        if (waterTargetText)     waterTargetText.innerText     = 'Objectif eau : -- ml';
        return;
    }

    weightHistory.sort((a, b) => new Date(a.date) - new Date(b.date));
    const latest = weightHistory[weightHistory.length - 1].weight;
    petProfile.weight = latest;
    saveLocalData(currentPetId, 'profile', petProfile);

    if (nutritionWeightText) nutritionWeightText.innerText = latest.toFixed(1) + ' kg';
    if (waterTargetText)     waterTargetText.innerText     = `Objectif eau : ${Math.round(latest * 55)} ml`;

    updateNutritionUI();
    generateTransitionPlan();
}

window.addNewWeight = function() {
    const weightVal = parseFloat(document.getElementById('weight-input').value);
    const dateVal   = document.getElementById('weight-date').value;
    if (!weightVal || !dateVal || weightVal <= 0) { showToast("Valeurs invalides.", "⚠️", "error"); return; }
    weightHistory.push({ date: dateVal, weight: weightVal });
    trackEvent('weight_added');
    saveLocalData(currentPetId, 'weight', weightHistory);
    updateWeightUI();
    renderWeightChart();
    document.getElementById('weight-input').value = '';
};

function renderWeightChart() {
    const canvas = document.getElementById('weightChart');
    if (!canvas) return;
    weightHistory.sort((a, b) => new Date(a.date) - new Date(b.date));

    const labels    = weightHistory.map(i => new Date(i.date).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' }));
    const values    = weightHistory.map(i => i.weight);
    const isLight   = document.body.classList.contains('light-mode');
    const lineColor = isLight ? '#a87020' : '#c8922a';
    const bgColor   = isLight ? 'rgba(168,112,32,0.08)' : 'rgba(200,146,42,0.1)';
    const gridColor = isLight ? '#e8dfc8' : '#2a2215';
    const tickColor = isLight ? '#6b5038' : '#b8a88a';

    if (weightChartInstance) weightChartInstance.destroy();
    weightChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Poids (kg)',
                data: values,
                borderColor: lineColor,
                backgroundColor: bgColor,
                borderWidth: 2,
                tension: 0.3,
                fill: true,
                pointBackgroundColor: lineColor,
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { grid: { color: gridColor }, ticks: { color: tickColor } },
                x: { grid: { display: false },   ticks: { color: tickColor } }
            }
        }
    });
}

// ==========================================
// TRACKERS QUOTIDIENS
// ==========================================
function initDailyTrackers() {
    const today = new Date().toISOString().split('T')[0];
    dailyTrackers = getLocalData(currentPetId, 'daily', { water: 0, walk: 0, date: today });
    if (dailyTrackers.date !== today) {
        dailyTrackers = { water: 0, walk: 0, date: today };
        saveLocalData(currentPetId, 'daily', dailyTrackers);
    }
    updateTrackersUI();
}

function updateTrackersUI() {
    const waterEl = document.getElementById('water-current-text');
    const walkEl  = document.getElementById('walk-current-text');
    if (waterEl) waterEl.innerText = `${dailyTrackers.water} ml`;
    if (walkEl)  walkEl.innerText  = `${dailyTrackers.walk} min`;
}

window.addWater = function(delta = 250) { dailyTrackers.water = Math.max(0, dailyTrackers.water + delta); saveLocalData(currentPetId, 'daily', dailyTrackers); updateTrackersUI(); showToast(delta > 0 ? `+${delta} ml 💧` : `${delta} ml 💧`); };
window.addWalk  = function(delta = 15)  { dailyTrackers.walk  = Math.max(0, dailyTrackers.walk  + delta); saveLocalData(currentPetId, 'daily', dailyTrackers); updateTrackersUI(); showToast(delta > 0 ? `+${delta} min 🐾` : `${delta} min 🐾`); };
window.resetDailyTrackers = function() {
    dailyTrackers.water = 0;
    dailyTrackers.walk  = 0;
    saveLocalData(currentPetId, 'daily', dailyTrackers);
    updateTrackersUI();
    showToast('Trackers remis à zéro', '🔄');
};

// ==========================================
// CARNET MÉDICAL & RAPPELS
// ==========================================
function initMedicalRecords() {
    medicalEvents = getLocalData(currentPetId, 'medical', []);
    renderMedicalHistory();
    renderReminders();
}

window.addMedicalEvent = function() {
    const type = document.getElementById('event-type').value;
    const date = document.getElementById('event-date').value;
    if (!date) { showToast("Sélectionnez une date.", "⚠️", "error"); return; }
    medicalEvents.push({ type, date });
    trackEvent('medical_event_added');
    saveLocalData(currentPetId, 'medical', medicalEvents);
    renderMedicalHistory();
    renderReminders();
    document.getElementById('event-date').value = '';
    showToast(`${type} enregistré !`, '✅');
};

function renderMedicalHistory() {
    const list = document.getElementById('medical-history-list');
    if (!list) return;
    list.innerHTML = '';
    const sorted = [...medicalEvents].sort((a, b) => new Date(b.date) - new Date(a.date));
    sorted.forEach(ev => {
        const item      = document.createElement('div');
        item.className  = 'log-item';
        item.innerHTML  = `<span style="color:var(--text-sub);">${ev.type}</span><strong style="color:var(--text-muted); font-size:12.5px;">${new Date(ev.date).toLocaleDateString('fr-FR')}</strong>`;
        list.appendChild(item);
    });
    if (sorted.length === 0) list.innerHTML = '<p style="color:var(--text-muted); font-size:13px; text-align:center; padding:10px 0;">Aucun acte enregistré.</p>';
}

window.clearMedicalHistory = function() {
    showConfirm(`Vider l'historique de ${escHtml(petProfile.name)} ?`, () => {
        medicalEvents = [];
        saveLocalData(currentPetId, 'medical', medicalEvents);
        renderMedicalHistory();
        renderReminders();
    });
};

function renderReminders() {
    const container = document.getElementById('dynamic-reminders-list');
    if (!container) return;
    container.innerHTML = '';
    const today = new Date();
    let hasReminders = false;

    const rules = { 'Vaccin': 365, 'Vermifuge': 90, 'Anti-puces': 30, 'Toilettage': 90, 'Dents': 7, 'Oreilles': 30, 'Griffes': 60 };
    Object.keys(rules).forEach(type => {
        const eventsOfType = medicalEvents.filter(e => e.type === type);
        const sorted       = eventsOfType.sort((a, b) => new Date(b.date) - new Date(a.date));
        const lastDate     = sorted.length > 0 ? new Date(sorted[0].date) : null;
        const daysPass     = lastDate ? Math.ceil(Math.abs(today - lastDate) / 86400000) : 999;
        if (!lastDate || daysPass > rules[type]) {
            hasReminders = true;
            container.innerHTML += `
                <div class="reminder-item">
                    <div><h4>${type} requis</h4><span>Dernier : ${lastDate ? lastDate.toLocaleDateString('fr-FR') : 'Jamais'}</span></div>
                    <span class="badge badge-danger">À FAIRE</span>
                </div>`;
        }
    });

    if (proData.gender !== 'Mâle' && proData.expectedBirth && !proData.actualBirth) {
        const birthDate   = new Date(proData.expectedBirth);
        const daysToBirth = Math.ceil((birthDate - today) / 86400000);
        if (daysToBirth >= -5 && daysToBirth <= 30) {
            hasReminders = true;
            container.innerHTML += `
                <div class="reminder-item">
                    <div><h4>Mise à bas prévue</h4><span>${birthDate.toLocaleDateString('fr-FR')}</span></div>
                    <span class="badge badge-warning">J-${daysToBirth}</span>
                </div>`;
        }
    }

    if (proData.gender !== 'Mâle' && proData.heatReminder && proHistory.heats.length > 0) {
        const sorted   = [...proHistory.heats].sort((a, b) => new Date(b.date) - new Date(a.date));
        const lastHeat = new Date(sorted[0].date);
        const nextHeat = new Date(lastHeat);
        nextHeat.setMonth(nextHeat.getMonth() + 6);
        const daysToHeat = Math.ceil((nextHeat - today) / 86400000);
        if (daysToHeat >= 0 && daysToHeat <= 30) {
            hasReminders = true;
            container.innerHTML += `
                <div class="reminder-item">
                    <div><h4>Prochaines chaleurs</h4><span>Estimées le ${nextHeat.toLocaleDateString('fr-FR')}</span></div>
                    <span class="badge badge-danger">ATTENTION</span>
                </div>`;
        }
    }

    const upcoming = proEvents.filter(e => new Date(e.date) > today).sort((a, b) => new Date(a.date) - new Date(b.date));
    if (upcoming.length > 0) {
        hasReminders = true;
        const next    = upcoming[0];
        const daysTo  = Math.ceil((new Date(next.date) - today) / 86400000);
        container.innerHTML += `
            <div class="reminder-item">
                <div><h4>Concours : ${next.type}</h4><span>${new Date(next.date).toLocaleDateString('fr-FR')}</span></div>
                <span class="badge badge-gold">J-${daysTo}</span>
            </div>`;
    }

    if (!hasReminders) container.innerHTML = '<p style="color:var(--text-muted); font-size:13px; text-align:center; padding:16px 0;">Tout est à jour ! ✨</p>';
}

// ==========================================
// ÉDUCATION
// ==========================================
function initEducation() {
    educationData = getLocalData(currentPetId, 'education', {});
    renderEducation();
}

function renderEducation() {
    const container = document.getElementById('edu-container');
    if (!container) return;
    container.innerHTML = '';
    const customExercises = getLocalData(currentPetId, 'custom_exercises', []);
    const allExercises    = [...DEFAULT_EDU_EXERCISES, ...customExercises];

    if (allExercises.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted); font-size:13px; text-align:center;">Aucun exercice disponible.</p>';
        return;
    }

    allExercises.forEach(ex => {
        const currentLevel = educationData[ex.id] || 0;
        const card         = document.createElement('div');
        card.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:12px 15px; border-radius:var(--radius-sm); background:var(--bg-elevated); border:1px solid var(--card-border);';
        card.innerHTML = `
            <div style="display:flex; align-items:center; gap:12px; flex:1;">
                <div style="width:34px; height:34px; border-radius:50%; background:var(--gold-dim); border:1px solid var(--gold-border); display:flex; align-items:center; justify-content:center; color:var(--gold); flex-shrink:0;">
                    <i class="fa-solid ${ex.icon || 'fa-star'}"></i>
                </div>
                <span style="font-size:13.5px; color:var(--text); font-weight:500;">${ex.name}</span>
            </div>
            <select onchange="updateEduLevel('${ex.id}', this.value)"
                style="padding:6px 10px; border-radius:var(--radius-xs); border:1px solid var(--card-border); font-size:12.5px; background:var(--bg-elevated); color:var(--text); font-weight:500; cursor:pointer;">
                <option value="0" ${currentLevel === 0 ? 'selected' : ''}>⚪ À commencer</option>
                <option value="1" ${currentLevel === 1 ? 'selected' : ''}>🟡 En cours</option>
                <option value="2" ${currentLevel === 2 ? 'selected' : ''}>🟢 Acquis</option>
                <option value="3" ${currentLevel === 3 ? 'selected' : ''}>🏆 Maîtrisé</option>
            </select>`;
        container.appendChild(card);
    });
}

window.updateEduLevel = async function(exerciseId, levelValue) {
    educationData[exerciseId] = parseInt(levelValue);
    await saveLocalData(currentPetId, 'education', educationData);
};

window.addCustomExercise = async function() {
    const input = document.getElementById('new-custom-exercise-input');
    if (!input) return;
    const name = input.value.trim();
    if (!name) { showToast("Entrez le nom d'un exercice. 🐾", "⚠️", "error"); return; }
    const id              = 'custom_' + Date.now();
    const customExercises = getLocalData(currentPetId, 'custom_exercises', []);
    customExercises.push({ id, name, icon: 'fa-star' });
    await saveLocalData(currentPetId, 'custom_exercises', customExercises);
    input.value = '';
    renderEducation();
    showToast(`Exercice « ${name} » ajouté !`, '✅');
};

// ==========================================
// BUDGET
// ==========================================
function initBudgetTracker() {
    budgetExpenses = getLocalData(currentPetId, 'budget', []);
    updateBudgetUI();
}

function updateBudgetUI() {
    const now          = new Date();
    const monthExp     = budgetExpenses.filter(e => {
        const d = new Date(e.date);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    const total        = monthExp.reduce((sum, e) => sum + e.amount, 0);
    const formatted    = total.toFixed(2).replace('.', ',') + ' €';

    const totalEl      = document.getElementById('budget-screen-total');
    if (totalEl) totalEl.innerText = formatted;

    renderBudgetHistory(monthExp);
}

function renderBudgetHistory(expenses) {
    const list = document.getElementById('budget-history-list');
    if (!list) return;
    list.innerHTML = '';
    [...expenses].sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(expense => {
        const item       = document.createElement('div');
        item.className   = 'log-item';
        item.innerHTML   = `
            <span style="color:var(--text-sub);">${escHtml(expense.title)}</span>
            <div style="display:flex; align-items:center; gap:10px;">
                <strong style="color:var(--gold);">${expense.amount.toFixed(2)} €</strong>
                <span style="color:var(--text-muted); font-size:12px;">${new Date(expense.date).toLocaleDateString('fr-FR', { day:'numeric', month:'short' })}</span>
            </div>`;
        list.appendChild(item);
    });
    if (expenses.length === 0) list.innerHTML = '<p style="color:var(--text-muted); font-size:13px; text-align:center; padding:10px 0;">Aucune dépense ce mois.</p>';
}

window.addBudgetExpense = function() {
    const title  = document.getElementById('budget-title').value.trim();
    const amount = parseFloat(document.getElementById('budget-amount').value);
    if (!title || !amount || amount <= 0) { showToast("Valeurs invalides.", "⚠️", "error"); return; }
    budgetExpenses.push({ id: Date.now(), title, amount, date: new Date().toISOString().split('T')[0] });
    trackEvent('expense_added');
    saveLocalData(currentPetId, 'budget', budgetExpenses);
    updateBudgetUI();
    document.getElementById('budget-title').value  = '';
    document.getElementById('budget-amount').value = '';
    showToast(`${title} — ${amount.toFixed(2)} € enregistré !`, '💰');
};

window.exportToPDF = () => window.print();

function initChat() {
    chatHistory = getLocalData(currentPetId, 'chat', [{
        sender: 'bot',
        text: `Wouf ! Je suis l'assistant de ${petProfile.name || 'votre compagnon'}. Comment puis-je aider ?`
    }]);
    renderChat();
}

function renderChat() {
    const container = document.getElementById('chat-messages-container');
    if (!container) return;
    container.innerHTML = '';

    chatHistory.forEach(msg => {
        const msgDiv       = document.createElement('div');
        const initial      = (petProfile.name || 'P').charAt(0).toUpperCase();

        if (msg.sender === 'bot') {
            msgDiv.className = 'msg msg-bot';
            msgDiv.innerHTML = `
                <div class="msg-avatar">${initial}</div>
                <div class="msg-bubble">${msg.text}</div>`;
        } else {
            msgDiv.className = 'msg msg-user';
            msgDiv.innerHTML = `<div class="msg-bubble">${escHtml(msg.text)}</div>`;
        }
        container.appendChild(msgDiv);
    });
    container.scrollTop = container.scrollHeight;
}

window.askPreset = function(questionText) {
    const input = document.getElementById('chat-input-field');
    if (input) input.value = questionText;
    sendMessage();
};

// ==========================================
// NAVIGATION
// ==========================================
window.navigateTo = function(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (target) target.classList.add('active');
    trackEvent('screen_' + screenId.replace('screen-', ''));

    document.querySelectorAll('.sidebar-nav li').forEach(li => li.classList.remove('active'));
    document.querySelectorAll(`.sidebar-nav li[onclick="navigateTo('${screenId}')"]`).forEach(li => li.classList.add('active'));

    document.querySelectorAll('.nav-item').forEach(ni => ni.classList.remove('active'));
    document.querySelectorAll(`.nav-item[onclick="navigateTo('${screenId}')"]`).forEach(ni => ni.classList.add('active'));

    const titles = {
        'screen-home':   "Vue d'ensemble",
        'screen-carnet':  "Carnet de Santé & Suivi",
        'screen-chat':   "Hey Pablo",
        'screen-pro':     "Officiel & Élevage",
        'screen-tools':   "Outils & Souvenirs",
        'screen-profile': "Configuration du Profil"
    };
    const titleEl = document.getElementById('page-title');
    if (titleEl && titles[screenId]) titleEl.innerText = titles[screenId];

    if (screenId === 'screen-carnet') setTimeout(() => renderWeightChart(), 60);
};

// ==========================================
// SANTÉ, URGENCES & CROQUETTES
// ==========================================
function initHealthExtras() {
    healthExtras = getLocalData(currentPetId, 'healthExtras', { allergies: '', vetName: '', vetPhone: '', kibbleBag: 0, kibbleRemaining: 0 });

    const vetNameEl  = document.getElementById('vet-name');
    const vetPhoneEl = document.getElementById('vet-phone');
    if (vetNameEl)  vetNameEl.value  = healthExtras.vetName  || '';
    if (vetPhoneEl) vetPhoneEl.value = healthExtras.vetPhone || '';

    const alertsBanner = document.getElementById('health-alerts-banner');
    const alertsText   = document.getElementById('health-alerts-text');
    if (alertsBanner && alertsText) {
        if (healthExtras.allergies && healthExtras.allergies.trim() !== '') {
            alertsBanner.style.display = 'block';
            alertsText.innerText       = healthExtras.allergies;
        } else {
            alertsBanner.style.display = 'none';
        }
    }

    updateKibbleUI();
    generateTransitionPlan();
}

window.callVet = function() {
    const vetPhoneEl = document.getElementById('vet-phone');
    const vetNameEl  = document.getElementById('vet-name');
    if (vetPhoneEl?.value) {
        healthExtras.vetPhone = vetPhoneEl.value;
        healthExtras.vetName  = vetNameEl?.value || '';
        saveLocalData(currentPetId, 'healthExtras', healthExtras);
        window.open(`tel:${vetPhoneEl.value}`);
    } else {
        showToast("Entrez un numéro de téléphone.", "⚠️", "error");
    }
};

window.callPoisonControl = () => window.open('tel:0468315555');

window.refillKibbleBag = function() {
    const size = parseFloat(document.getElementById('kibble-bag-size').value);
    if (size > 0) {
        healthExtras.kibbleBag       = size;
        healthExtras.kibbleRemaining = size;
        saveLocalData(currentPetId, 'healthExtras', healthExtras);
        updateKibbleUI();
        showToast("Nouveau sac entamé ! 🍖");
        document.getElementById('kibble-bag-size').value = '';
    }
};

function updateKibbleUI() {
    const textEl    = document.getElementById('kibble-remaining-text');
    if (!textEl) return;
    const remaining = healthExtras.kibbleRemaining || 0;
    if (remaining <= 0) {
        textEl.innerText   = '-- kg';
        textEl.style.color = 'var(--text-muted)';
        return;
    }
    textEl.innerText = `${remaining.toFixed(2)} kg / ${healthExtras.kibbleBag} kg`;
    if (remaining < 3) {
        textEl.style.color = 'var(--danger)';
        showToast(`⚠️ Seulement ${remaining.toFixed(1)} kg de croquettes restantes !`, '🍖', 'error');
    } else {
        textEl.style.color = 'var(--success)';
    }
}

function generateTransitionPlan() {
    const planEl = document.getElementById('transition-plan');
    if (!planEl || !petProfile.weight) return;
    const ration = Math.round(petProfile.weight * 13.5);
    planEl.innerHTML = `
        <div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px dashed var(--card-border);"><span style="color:var(--text-muted);">Jours 1 & 2</span><strong>75% ancien (${Math.round(ration*0.75)}g) / 25% nouveau (${Math.round(ration*0.25)}g)</strong></div>
        <div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px dashed var(--card-border);"><span style="color:var(--text-muted);">Jours 3 & 4</span><strong>50% / 50% (${Math.round(ration*0.5)}g chacun)</strong></div>
        <div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px dashed var(--card-border);"><span style="color:var(--text-muted);">Jours 5 & 6</span><strong>25% ancien (${Math.round(ration*0.25)}g) / 75% nouveau (${Math.round(ration*0.75)}g)</strong></div>
        <div style="display:flex; justify-content:space-between; padding:4px 0;"><span style="color:var(--text-muted);">Jour 7</span><strong style="color:var(--success);">100% nouvelles croquettes !</strong></div>`;
}

// ==========================================
// GAMIFICATION
// ==========================================
function initGamification() {
    gamification = getLocalData(currentPetId, 'gamification', { streak: 0, lastLogin: null, badges: [] });
    const today     = new Date().toISOString().split('T')[0];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().split('T')[0];

    if (gamification.lastLogin !== today) {
        if (gamification.lastLogin === yStr) { gamification.streak += 1; }
        else if (gamification.lastLogin !== null) { gamification.streak = 0; }
        gamification.lastLogin = today;
        saveLocalData(currentPetId, 'gamification', gamification);
    }

    const streakEl = document.getElementById('streak-counter');
    if (streakEl) streakEl.innerText = `${gamification.streak} Jours`;
    updateBadges();
}

function updateBadges() {
    const container = document.getElementById('badges-container');
    if (!container) return;
    container.innerHTML = '';
    const earned = [];
    if (gamification.streak  >= 7)  earned.push({ icon: '🔥', title: 'On Fire (7j)' });
    if (weightHistory.length >= 5)  earned.push({ icon: '⚖️', title: 'Suivi Parfait' });
    if (medicalEvents.length >= 3)  earned.push({ icon: '🩺', title: 'Santé de fer' });
    if (memoriesList.length  >= 5)  earned.push({ icon: '📸', title: 'Photographe' });
    earned.forEach(b => { container.innerHTML += `<span title="${b.title}" style="font-size:22px; cursor:default;">${b.icon}</span>`; });
}

// ==========================================
// MODULE OFFICIEL & ÉLEVAGE
// ==========================================
function initProData() {
    proData    = getLocalData(currentPetId, 'proData',    { gender: 'Non spécifié' });
    proEvents  = getLocalData(currentPetId, 'proEvents',  []);
    proLitters = getLocalData(currentPetId, 'proLitters', []);

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    setVal('pro-gender',    proData.gender);
    setVal('pro-chip',      proData.chip);
    setVal('pro-lof',       proData.lof);
    setVal('pro-pedigree',  proData.pedigree);
    setVal('pro-dna',       proData.dna || 'Non fait');
    setVal('pro-xrays',     proData.xrays);
    setVal('pro-club-name', proData.clubName);
    setVal('pro-club-date', proData.clubDate);

    setVal('pro-optimal-date',  proData.optimalDate);
    setVal('pro-expected-birth', proData.expectedBirth);
    setVal('pro-actual-birth',   proData.actualBirth);

    const heatCb = document.getElementById('pro-heat-reminder');
    if (heatCb) heatCb.checked = proData.heatReminder || false;

    toggleBreederFields();
    renderProEvents();
    renderLitters();
}

window.toggleBreederFields = function() {
    const gender = document.getElementById('pro-gender')?.value;
    const femaleFields = ['field-chaleurs-history', 'field-fec-opti', 'field-naissance-prevue', 'field-mise-a-bas', 'field-rappel-chaleurs'];
    femaleFields.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = (gender === 'Mâle') ? 'none' : 'block';
    });
};

window.saveProData = function() {
    proData = {
        gender:         document.getElementById('pro-gender')?.value,
        chip:           document.getElementById('pro-chip')?.value,
        lof:            document.getElementById('pro-lof')?.value,
        pedigree:       document.getElementById('pro-pedigree')?.value,
        dna:            document.getElementById('pro-dna')?.value,
        xrays:          document.getElementById('pro-xrays')?.value,
        clubName:       document.getElementById('pro-club-name')?.value,
        clubDate:       document.getElementById('pro-club-date')?.value,
        optimalDate:    document.getElementById('pro-optimal-date')?.value,
        expectedBirth:  document.getElementById('pro-expected-birth')?.value,
        actualBirth:    document.getElementById('pro-actual-birth')?.value,
        heatReminder:   document.getElementById('pro-heat-reminder')?.checked || false
    };
    saveLocalData(currentPetId, 'proData', proData);
    renderReminders();
    showToast('Profil Officiel & Élevage mis à jour ! 🐾');
};

window.addLitter = function() {
    const date    = document.getElementById('litter-date')?.value;
    const partner = document.getElementById('litter-partner')?.value;
    const count   = document.getElementById('litter-count')?.value;
    if (!date) { showToast("Sélectionnez une date.", "⚠️", "error"); return; }
    const damName = (getLocalData(currentPetId, 'profile', {})?.name) || 'Mère inconnue';
    proLitters.push({ id: Date.now(), date, partner, count, dam: damName, sire: partner || '', puppies: [] });
    saveLocalData(currentPetId, 'proLitters', proLitters);
    if (document.getElementById('litter-date'))    document.getElementById('litter-date').value    = '';
    if (document.getElementById('litter-partner')) document.getElementById('litter-partner').value = '';
    if (document.getElementById('litter-count'))   document.getElementById('litter-count').value   = '';
    renderLitters();
    showToast('Portée enregistrée ! 🐶', '✅');
};

// Ajoute un chiot (fiche individuelle) à une portée donnée.
window.addPuppy = function(litterId) {
    const litter = proLitters.find(l => String(l.id) === String(litterId));
    if (!litter) return;
    if (!Array.isArray(litter.puppies)) litter.puppies = [];

    const name  = document.getElementById(`pup-name-${litterId}`)?.value?.trim();
    const sex   = document.getElementById(`pup-sex-${litterId}`)?.value || 'Femelle';
    const color = document.getElementById(`pup-color-${litterId}`)?.value?.trim();
    const chip  = document.getElementById(`pup-chip-${litterId}`)?.value?.trim();
    if (!name) { showToast("Donnez un nom (ou un identifiant) au chiot.", "⚠️", "error"); return; }

    litter.puppies.push({
        id: 'pup_' + Date.now(),
        name, sex, color: color || '', chip: chip || '',
        birthDate: litter.date,
        dam: litter.dam || '',
        sire: litter.sire || litter.partner || '',
        status: 'En élevage',
        createdAt: Date.now()
    });
    saveLocalData(currentPetId, 'proLitters', proLitters);
    renderLitters();
    showToast(`${name} ajouté à la portée ! 🐶`, '✅');
};

// Retire un chiot d'une portée.
window.removePuppy = function(litterId, puppyId) {
    const litter = proLitters.find(l => String(l.id) === String(litterId));
    if (!litter || !Array.isArray(litter.puppies)) return;
    litter.puppies = litter.puppies.filter(p => String(p.id) !== String(puppyId));
    saveLocalData(currentPetId, 'proLitters', proLitters);
    renderLitters();
    showToast('Chiot retiré.', '🗑️');
};

// --- Passeport de cession (brique 2a) ---------------------------------------
let _QRCodeLib = undefined;
async function ensureQRCode() {
    if (_QRCodeLib !== undefined) return _QRCodeLib;
    try { _QRCodeLib = (await import(/* @vite-ignore */ 'https://esm.sh/qrcode@1.5.4')).default; }
    catch (e) { console.warn('Lib QR indisponible :', e); _QRCodeLib = null; }
    return _QRCodeLib;
}

function cessionLink(cessionId) {
    return `${window.location.origin}/?cession=${cessionId}`;
}

// Génère le passeport partageable d'un chiot et bascule son statut en "Cédé".
window.cederChiot = async function(litterId, puppyId) {
    if (!auth.currentUser) { showToast("Connecte-toi pour générer un passeport.", "⚠️", "error"); return; }
    const litter = proLitters.find(l => String(l.id) === String(litterId));
    if (!litter) return;
    const puppy = (litter.puppies || []).find(p => String(p.id) === String(puppyId));
    if (!puppy) return;

    if (puppy.status === 'Cédé' && puppy.cessionId) { renderLitters(); return; }

    const profile = getLocalData(currentPetId, 'profile', {}) || {};
    const affixe  = (proData && proData.clubName) ? proData.clubName
                  : (auth.currentUser.displayName || 'Élevage');

    const cessionId = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'cess_' + Date.now() + '_' + Math.random().toString(36).slice(2);

    const passport = {
        v: 1,
        species: 'Chien',
        breed: profile.breed || '',
        puppy: {
            name: puppy.name || '',
            sex: puppy.sex || '',
            color: puppy.color || '',
            chip: puppy.chip || '',
            birthDate: puppy.birthDate || litter.date || '',
            dam: puppy.dam || litter.dam || '',
            sire: puppy.sire || litter.sire || litter.partner || '',
            weights: puppy.weights || [], 
            acts: puppy.acts || []
        },
        breeder: { affixe: affixe, uid: auth.currentUser.uid },
        createdAt: Date.now(),
        claimed: false,
        claimedBy: null,
        claimedAt: null
    };

    try {
        await setDoc(doc(db, 'cessions', cessionId), passport);
    } catch (e) {
        console.error('Erreur création cession :', e);
        showToast("Échec de la génération (règles Firestore ?).", "⚠️", "error");
        return;
    }

    puppy.status = 'Cédé';
    puppy.cessionId = cessionId;
    saveLocalData(currentPetId, 'proLitters', proLitters);
    renderLitters();
    showToast(`Passeport de ${puppy.name} généré ! 🎫`, '✅');
};

window.copierLienCession = function(cessionId) {
    const url = cessionLink(cessionId);
    if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(
            () => showToast('Lien copié ! 📋', '✅'),
            () => showToast('Copie impossible, copie le lien à la main.', '⚠️', 'error')
        );
    } else {
        showToast('Copie le lien manuellement : ' + url, '📋');
    }
};

// Après le rendu, dessine les QR codes pour chaque chiot cédé.
async function populateCessionQRs() {
    const Q = await ensureQRCode();
    if (!Q) return;
    proLitters.forEach(l => (l.puppies || []).forEach(async p => {
        if (p.status === 'Cédé' && p.cessionId) {
            const img = document.getElementById(`qrimg-${p.id}`);
            if (!img) return;
            try { img.src = await Q.toDataURL(cessionLink(p.cessionId), { width: 150, margin: 1 }); }
            catch (e) { /* QR non bloquant */ }
        }
    }));
}

// --- Récupération d'un passeport côté acheteur (brique 2b) -------------------
function getCessionParam() {
    try { return new URLSearchParams(window.location.search).get('cession'); }
    catch (e) { return null; }
}

function cleanCessionUrl() {
    try { history.replaceState({}, '', window.location.origin + window.location.pathname); }
    catch (e) { /* no-op */ }
}

// Affiche une bannière d'invitation tant que l'acheteur n'est pas connecté.
async function showPendingCessionBanner(cessionId) {
    if (!cessionId || document.getElementById('cession-banner')) return;
    try {
        const snap = await getDoc(doc(db, 'cessions', cessionId));
        if (!snap.exists()) return;
        const d = snap.data() || {};
        const name   = escHtml(d.puppy?.name || 'un chiot');
        const affixe = escHtml(d.breeder?.affixe || 'Un éleveur');

        const host = document.getElementById('landing-page') || document.body;
        const div = document.createElement('div');
        div.id = 'cession-banner';
        div.style.cssText = 'position:relative;z-index:50;padding:14px 18px;background:#1f6f54;color:#fff;text-align:center;font-size:14px;line-height:1.45;';
        div.innerHTML = d.claimed
            ? `<i class="fa-solid fa-ticket"></i> Le carnet de <strong>${name}</strong> (${affixe}) a déjà été récupéré.`
            : `<i class="fa-solid fa-ticket"></i> <strong>${affixe}</strong> vous transmet le carnet de <strong>${name}</strong>.<br>Connectez-vous ou créez un compte pour le récupérer dans votre espace.`;
        host.prepend(div);
    } catch (e) { console.warn('Bannière cession :', e); }
}

// Importe le chiot comme animal de l'acheteur et marque la cession récupérée.
async function claimCession(cessionId) {
    if (!cessionId || !auth.currentUser) return;
    try {
        const ref  = doc(db, 'cessions', cessionId);
        const snap = await getDoc(ref);
        if (!snap.exists()) { localStorage.removeItem('_pendingCession'); cleanCessionUrl(); return; }
        const d = snap.data() || {};

        if (d.claimed) {
            showToast("Ce carnet a déjà été récupéré.", "⚠️", "error");
            localStorage.removeItem('_pendingCession'); cleanCessionUrl();
            return;
        }

        const p = d.puppy || {};
        const petName = p.name || 'Mon chien';

        const newId = 'pet_' + Date.now();
        petsList.push({ id: newId, name: petName });
        localStorage.setItem('app_pets_list', JSON.stringify(petsList));
        if (auth.currentUser) setDoc(doc(db, "users", auth.currentUser.uid), { app_pets_list: petsList }, { merge: true });

        let age = 0;
        if (p.birthDate) {
            const diff = Date.now() - new Date(p.birthDate).getTime();
            if (diff > 0) age = +(diff / (365.25 * 86400000)).toFixed(1);
        }

        let latestWeight = 0;
        if (p.weights && p.weights.length > 0) {
            const sortedWeights = [...p.weights].sort((a, b) => new Date(a.date) - new Date(b.date));
            latestWeight = sortedWeights[sortedWeights.length - 1].weight;
        }

        // --- IMPORTATION DES DONNÉES RÉCUPÉRÉES ---
        saveLocalData(newId, 'profile',      { name: petName, species: d.species || 'Chien', breed: d.breed || '', age, size: 0, weight: latestWeight, avatar: '', breedAdvice: '' });
        saveLocalData(newId, 'weight',       p.weights || []);
        
        const importedActs = (p.acts || []).map(act => ({ type: act.type, date: act.date }));
        saveLocalData(newId, 'medical',      importedActs);

        saveLocalData(newId, 'education',    {});
        saveLocalData(newId, 'daily',        { water: 0, walk: 0, date: new Date().toISOString().split('T')[0] });
        saveLocalData(newId, 'chat',         [{ sender: 'bot', text: `Wouf ! Je suis l'assistant de ${petName}. Comment puis-je aider ?` }]);
        saveLocalData(newId, 'budget',       []);
        saveLocalData(newId, 'proData',      { gender: p.sex || 'Non spécifié', chip: p.chip || '', lof: '', pedigree: '', breederAffixe: d.breeder?.affixe || '', sire: p.sire || '', dam: p.dam || '' });
        saveLocalData(newId, 'proEvents',    []);
        saveLocalData(newId, 'proLitters',   []);
        saveLocalData(newId, 'healthExtras', { allergies: '', vetName: '', vetPhone: '', kibbleBag: 0, kibbleRemaining: 0 });
        saveLocalData(newId, 'proHistory',   { heats: [], matings: [] });
        saveLocalData(newId, 'memories',     []);
        saveLocalData(newId, 'gamification', { streak: 0, lastLogin: null, badges: [] });

        try {
            await updateDoc(ref, { claimed: true, claimedBy: auth.currentUser.uid, claimedAt: Date.now() });
        } catch (e) { console.warn('Maj claim (non bloquant) :', e); }

        localStorage.removeItem('_pendingCession');
        cleanCessionUrl();
        if (typeof trackEvent === 'function') trackEvent('cession_claimed');

        const banner = document.getElementById('cession-banner');
        if (banner) banner.remove();

        switchPet(newId);
        showToast(`Carnet de ${petName} récupéré ! 🐶`, '✅');
    } catch (e) {
        console.error('Erreur récupération cession :', e);
        showToast("Impossible de récupérer ce carnet.", "⚠️", "error");
    }
}

function renderLitters() {
    const list = document.getElementById('litters-list');
    if (!list) return;
    list.innerHTML = '';
    const sorted = [...proLitters].sort((a, b) => new Date(b.date) - new Date(a.date));
    if (sorted.length === 0) { list.innerHTML = '<p style="color:var(--text-muted); font-size:13px; text-align:center;">Aucune portée enregistrée.</p>'; return; }

    sorted.forEach(l => {
        const puppies = Array.isArray(l.puppies) ? l.puppies : [];
        const nbDisplay = puppies.length > 0 ? puppies.length : (escHtml(l.count) || '?');

        let puppiesHtml = '';
        if (puppies.length === 0) {
            puppiesHtml = '<p style="color:var(--text-muted); font-size:12.5px; margin:8px 0;">Aucun chiot enregistré dans cette portée.</p>';
        } else {
            puppies.forEach(p => {
                const sexIcon = (p.sex === 'Mâle') ? '♂' : '♀';
                const isCeded = p.status === 'Cédé';
                const cederBtn = isCeded ? '' : `
                            <button class="btn-secondary btn-sm" title="Générer le passeport de cession" onclick="cederChiot('${l.id}','${p.id}')">
                                <i class="fa-solid fa-share-nodes"></i> Céder
                            </button>`;
                const cessionPanel = (isCeded && p.cessionId) ? `
                        <div style="margin:4px 0 10px; padding:10px; border:1px dashed var(--gold, #c8a24a); border-radius:10px;">
                            <div style="font-size:12.5px; color:var(--text-muted); margin-bottom:6px;">
                                <i class="fa-solid fa-ticket"></i> Passeport à transmettre au nouveau propriétaire :
                            </div>
                            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                <img id="qrimg-${p.id}" alt="QR du passeport" width="110" height="110" style="border-radius:8px; background:#fff;">
                                <div style="flex:1; min-width:160px;">
                                    <input type="text" readonly value="${cessionLink(p.cessionId)}" onclick="this.select()" style="width:100%; font-size:12px;">
                                    <button class="btn-gold btn-sm btn-full" style="margin-top:6px;" onclick="copierLienCession('${p.cessionId}')">
                                        <i class="fa-solid fa-copy"></i> Copier le lien
                                    </button>
                                </div>
                            </div>
                        </div>` : '';
                puppiesHtml += `
                    <div class="log-item" style="justify-content:space-between;">
                        <div>
                            <strong>${sexIcon} ${escHtml(p.name)}</strong>
                            <span style="color:var(--text-muted); font-size:12.5px;">
                                ${escHtml(p.color) || 'Robe n.c.'}${p.chip ? ' · Puce : ' + escHtml(p.chip) : ''}
                            </span>
                            <span style="color:var(--text-muted); font-size:11px; display:block;">⚖️ ${Array.isArray(p.weights) ? p.weights.length : 0} pesée(s) · 💉 ${Array.isArray(p.acts) ? p.acts.length : 0} soin(s)</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                            <span class="badge ${isCeded ? 'badge-success' : 'badge-gold'}">${escHtml(p.status || 'En élevage')}</span>
                            <button class="btn btn-outline btn-sm" onclick="openPuppyTracking('${l.id}','${p.id}')" title="Suivi poids & soins"><i class="fa-solid fa-chart-line"></i> Suivi</button>
                            ${cederBtn}
                            <button class="btn-danger-outline btn-sm" title="Retirer" onclick="removePuppy('${l.id}','${p.id}')">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                    </div>
                    ${cessionPanel}`;
            });
        }

        const addFormHtml = `
            <div class="g2" style="margin-top:10px; gap:8px;">
                <input type="text"   id="pup-name-${l.id}"  placeholder="Nom / identifiant">
                <select id="pup-sex-${l.id}">
                    <option value="Femelle">Femelle ♀</option>
                    <option value="Mâle">Mâle ♂</option>
                </select>
                <input type="text" id="pup-color-${l.id}" placeholder="Robe / couleur">
                <input type="text" id="pup-chip-${l.id}"  placeholder="N° puce (optionnel)">
            </div>
            <button class="btn-secondary btn-sm btn-full" style="margin-top:8px;" onclick="addPuppy('${l.id}')">
                <i class="fa-solid fa-plus"></i> Ajouter un chiot
            </button>`;

        list.innerHTML += `
            <div class="card" style="margin-bottom:12px; padding:14px;">
                <div class="reminder-item" style="margin:0;">
                    <div>
                        <h4>Portée du ${new Date(l.date).toLocaleDateString('fr-FR')}</h4>
                        <span>Mère : ${escHtml(l.dam) || 'n.c.'} · Père : ${escHtml(l.sire || l.partner) || 'Non précisé'}</span>
                    </div>
                    <span class="badge badge-gold">${nbDisplay} chiot(s)</span>
                </div>
                <div style="margin-top:10px;">${puppiesHtml}</div>
                ${addFormHtml}
            </div>`;
    });
    populateCessionQRs();
}

window.addProEvent = function() {
    const type    = document.getElementById('pro-event-type')?.value;
    const date    = document.getElementById('pro-event-date')?.value;
    const details = document.getElementById('pro-event-details')?.value;
    if (!date) { showToast("Sélectionnez une date.", "⚠️", "error"); return; }
    proEvents.push({ id: Date.now(), type, date, details });
    saveLocalData(currentPetId, 'proEvents', proEvents);
    if (document.getElementById('pro-event-date'))    document.getElementById('pro-event-date').value    = '';
    if (document.getElementById('pro-event-details')) document.getElementById('pro-event-details').value = '';
    renderProEvents();
    renderReminders();
    showToast('Événement ajouté !', '🏆');
};

function renderProEvents() {
    const list = document.getElementById('pro-events-list');
    if (!list) return;
    list.innerHTML = '';
    const sorted = [...proEvents].sort((a, b) => new Date(b.date) - new Date(a.date));
    if (sorted.length === 0) { list.innerHTML = '<p style="color:var(--text-muted); font-size:13px; text-align:center;">Aucun événement.</p>'; return; }
    const today = new Date();
    sorted.forEach(ev => {
        const isFuture = new Date(ev.date) > today;
        list.innerHTML += `
            <div class="reminder-item">
                <div>
                    <h4>${escHtml(ev.type)}</h4>
                    <span>${new Date(ev.date).toLocaleDateString('fr-FR')}${ev.details ? ' — ' + escHtml(ev.details) : ''}</span>
                </div>
                ${isFuture ? '<span class="badge badge-gold">À VENIR</span>' : '<span class="badge badge-success">Passé</span>'}
            </div>`;
    });
}

// ==========================================
// HISTORIQUE PRO — Chaleurs & Saillies
// ==========================================
function initProHistory() {
    proHistory = getLocalData(currentPetId, 'proHistory', { heats: [], matings: [] });
    renderHeatHistory();
    renderMatingHistory();
}

window.addHeatRecord = function() {
    const date = document.getElementById('new-heat-date')?.value;
    if (!date) return;
    proHistory.heats.push({ id: Date.now(), date });
    saveLocalData(currentPetId, 'proHistory', proHistory);
    document.getElementById('new-heat-date').value = '';
    renderHeatHistory();
    showToast('Chaleurs enregistrées !', '🩸');
};

function renderHeatHistory() {
    const list  = document.getElementById('heat-history-list');
    const avgEl = document.getElementById('heat-average');
    if (!list) return;
    list.innerHTML = '';

    const sorted = [...proHistory.heats].sort((a, b) => new Date(b.date) - new Date(a.date));

    if (sorted.length >= 2 && avgEl) {
        let totalDays = 0;
        for (let i = 0; i < sorted.length - 1; i++) {
            totalDays += (new Date(sorted[i].date) - new Date(sorted[i + 1].date)) / 86400000;
        }
        avgEl.innerText = `${((totalDays / (sorted.length - 1)) / 30.44).toFixed(1)} mois`;
    } else if (avgEl) {
        avgEl.innerText = '-- mois';
    }

    sorted.forEach(h => {
        list.innerHTML += `<div class="log-item"><span>🩸 Chaleurs</span><strong style="color:var(--text-muted); font-size:12.5px;">${new Date(h.date).toLocaleDateString('fr-FR')}</strong></div>`;
    });
    if (sorted.length === 0) list.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Aucune chaleur enregistrée.</p>';
}

window.addMatingRecord = function() {
    const date    = document.getElementById('mating-date')?.value;
    const partner = document.getElementById('mating-partner')?.value;
    if (!date) return;
    proHistory.matings.push({ id: Date.now(), date, partner });
    saveLocalData(currentPetId, 'proHistory', proHistory);
    if (document.getElementById('mating-date'))    document.getElementById('mating-date').value    = '';
    if (document.getElementById('mating-partner')) document.getElementById('mating-partner').value = '';
    renderMatingHistory();
    showToast('Saillie enregistrée !', '❤️');
};

function renderMatingHistory() {
    const list = document.getElementById('mating-history-list');
    if (!list) return;
    list.innerHTML = '';
    const sorted = [...proHistory.matings].sort((a, b) => new Date(b.date) - new Date(a.date));
    sorted.forEach(m => {
        list.innerHTML += `
            <div class="log-item" style="flex-direction:column; align-items:flex-start; gap:2px;">
                <div style="display:flex; justify-content:space-between; width:100%;">
                    <strong>Saillie du ${new Date(m.date).toLocaleDateString('fr-FR')}</strong>
                </div>
                <span style="color:var(--text-muted); font-size:12.5px;">Partenaire : ${escHtml(m.partner) || 'Inconnu'}</span>
            </div>`;
    });
    if (sorted.length === 0) list.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Aucune saillie enregistrée.</p>';
}

// ==========================================
// JOURNAL DES PREMIÈRES FOIS
// ==========================================
function initMemories() {
    memoriesList = getLocalData(currentPetId, 'memories', []);
    renderMemories();
    document.querySelectorAll('.dynamic-pet-name').forEach(el => el.innerText = petProfile.name || 'Pablo');
}

window.addMemory = function() {
    const date  = document.getElementById('memory-date')?.value;
    const title = document.getElementById('memory-title')?.value.trim();
    if (!date || !title) { showToast("Remplissez la date et le souvenir.", "⚠️", "error"); return; }
    memoriesList.push({ id: Date.now(), date, title });
    saveLocalData(currentPetId, 'memories', memoriesList);
    if (document.getElementById('memory-title')) document.getElementById('memory-title').value = '';
    renderMemories();
    showToast(`Souvenir « ${title} » ajouté !`, '📸');
};

function renderMemories() {
    const timeline = document.getElementById('memories-timeline');
    if (!timeline) return;
    timeline.innerHTML = '';
    const sorted = [...memoriesList].sort((a, b) => new Date(b.date) - new Date(a.date));
    if (sorted.length === 0) { timeline.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Aucun souvenir encore. Ajoutez la première ! ✨</p>'; return; }
    sorted.forEach(m => {
        timeline.innerHTML += `
            <div style="position:relative; margin-bottom:16px;">
                <div style="position:absolute; left:-22px; top:4px; width:10px; height:10px; border-radius:50%; background:var(--gold); border:2px solid var(--bg);"></div>
                <div style="font-size:11.5px; color:var(--text-muted);">${new Date(m.date).toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' })}</div>
                <div style="font-weight:600; color:var(--text); font-size:13.5px;">${escHtml(m.title)}</div>
            </div>`;
    });
}

window.generateAvatar = function() {
    showToast(`Avatar de ${petProfile.name || 'votre compagnon'} bientôt disponible ! 🪄`, '🎨');
};

// ==========================================
// MODALE DE CONFIRMATION
// ==========================================
window.showConfirm = function(message, onConfirm) {
    const modal = document.getElementById('confirm-modal');
    const msgEl = document.getElementById('confirm-modal-message');
    if (!modal || !msgEl) { if (confirm(message)) onConfirm(); return; }
    msgEl.textContent = message;
    modal.classList.add('open');
    window._confirmCallback = onConfirm;
};

window.closeConfirmModal = function() {
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.classList.remove('open');
    window._confirmCallback = null;
};

window.acceptConfirmModal = function() {
    closeConfirmModal();
    if (typeof window._confirmCallback === 'function') window._confirmCallback();
};

// ==========================================
// ==========================================
// NOTIFICATIONS FCM
// ==========================================

const VAPID_KEY = 'BEz6BhtY1kDVqbgEaRTIJKMzqSS7c-Zvva7XnxTqPml5OXEhWYAgPlkFH8ZBsd3EqUruAbS57IxFICYoMUwR_WY';

async function getFCMToken() {
    try {
        let swReg;
        try {
            swReg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
            await Promise.race([
                navigator.serviceWorker.ready,
                new Promise((_, reject) => setTimeout(() => reject(new Error('SW timeout')), 5000))
            ]);
        } catch (e) {
            console.warn('SW non prêt, tentative sans SW explicite :', e);
            swReg = undefined;
        }

        const messaging = getMessaging(app);
        const tokenOptions = { vapidKey: VAPID_KEY };
        if (swReg) tokenOptions.serviceWorkerRegistration = swReg;

        const token = await getToken(messaging, tokenOptions);
        return token;
    } catch (e) {
        console.warn('Erreur récupération token FCM :', e);
        return null;
    }
}

window.requestNotificationPermission = async function() {
    if (!('Notification' in window)) {
        showToast("Votre navigateur ne supporte pas les notifications.", "⚠️", "error");
        return;
    }
    const btn = document.getElementById('btn-enable-notifications');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Activation…'; }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        showToast("Notifications refusées.", "⚠️", "error");
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-bell"></i> Activer les rappels'; }
        return;
    }

    const token = await getFCMToken();
    if (!token) {
        showToast("Impossible d'activer les notifications (token FCM manquant).", "⚠️", "error");
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-bell"></i> Activer les rappels'; }
        return;
    }

    if (auth.currentUser) {
        try {
            await setDoc(doc(db, 'users', auth.currentUser.uid), { fcmToken: token }, { merge: true });
        } catch (e) { console.warn('Erreur sauvegarde token FCM :', e); }
    }

    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Notifications activées !';
        btn.style.color = 'var(--success)';
        btn.style.borderColor = 'rgba(82,201,122,0.4)';
        btn.disabled = true;
    }
    showToast('Rappels Pablo activés ! 🔔', '✅');
    trackEvent('notifications_enabled');
};

// ==========================================
// SUIVI INDIVIDUEL CHIOTS
// ==========================================
let _currentPuppyRef = null;
let _puppyWeightChart = null;

window.openPuppyTracking = function(litterId, puppyId) {
    const litter = proLitters.find(l => String(l.id) === String(litterId));
    if (!litter) return;
    const puppy = (litter.puppies || []).find(p => String(p.id) === String(puppyId));
    if (!puppy) return;
    _currentPuppyRef = { litterId, puppyId };

    const nameEl = document.getElementById('puppy-modal-name');
    if (nameEl) nameEl.textContent = puppy.name;

    const infosEl = document.getElementById('puppy-modal-infos');
    if (infosEl) {
        const sexIcon = puppy.sex === 'Mâle' ? '♂' : '♀';
        infosEl.innerHTML = `
            <span class="badge badge-gold">${sexIcon} ${escHtml(puppy.sex || '')}</span>
            ${puppy.color ? `<span class="badge badge-warning">${escHtml(puppy.color)}</span>` : ''}
            ${puppy.chip  ? `<span class="badge badge-success">Puce : ${escHtml(puppy.chip)}</span>` : ''}
            ${puppy.birthDate ? `<span class="badge" style="background:var(--bg-elevated); color:var(--text-muted); border:1px solid var(--card-border);">Né le ${new Date(puppy.birthDate).toLocaleDateString('fr-FR')}</span>` : ''}
        `;
    }

    const dateInput = document.getElementById('puppy-weight-date');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
    const actDate = document.getElementById('puppy-act-date');
    if (actDate) actDate.value = new Date().toISOString().split('T')[0];
    const statusSel = document.getElementById('puppy-status-select');
    if (statusSel) statusSel.value = puppy.status || 'En élevage';

    renderPuppyWeights(puppy);
    renderPuppyActs(puppy);

    const modal = document.getElementById('puppy-tracking-modal');
    if (modal) modal.classList.add('open');
};

window.closePuppyModal = function() {
    const modal = document.getElementById('puppy-tracking-modal');
    if (modal) modal.classList.remove('open');
    _currentPuppyRef = null;
    if (_puppyWeightChart) { _puppyWeightChart.destroy(); _puppyWeightChart = null; }
};

function getCurrentPuppy() {
    if (!_currentPuppyRef) return null;
    const litter = proLitters.find(l => String(l.id) === String(_currentPuppyRef.litterId));
    if (!litter) return null;
    return (litter.puppies || []).find(p => String(p.id) === String(_currentPuppyRef.puppyId));
}

function savePuppyData() {
    saveLocalData(currentPetId, 'proLitters', proLitters);
}

window.addPuppyWeight = function() {
    const puppy = getCurrentPuppy();
    if (!puppy) return;
    const w = parseFloat(document.getElementById('puppy-weight-input')?.value);
    const d = document.getElementById('puppy-weight-date')?.value;
    if (!w || w <= 0 || !d) { showToast('Poids ou date invalide.', '⚠️', 'error'); return; }
    if (!Array.isArray(puppy.weights)) puppy.weights = [];
    puppy.weights.push({ date: d, weight: w });
    savePuppyData();
    document.getElementById('puppy-weight-input').value = '';
    renderPuppyWeights(puppy);
    showToast(`${w} kg enregistré pour ${puppy.name} !`, '⚖️');
};

function renderPuppyWeights(puppy) {
    const list   = document.getElementById('puppy-weight-list');
    const canvas = document.getElementById('puppyWeightChart');
    const weights = Array.isArray(puppy.weights) ? [...puppy.weights].sort((a, b) => new Date(a.date) - new Date(b.date)) : [];

    if (list) {
        list.innerHTML = '';
        if (weights.length === 0) {
            list.innerHTML = '<p style="color:var(--text-muted); font-size:12.5px;">Aucune pesée enregistrée.</p>';
        } else {
            [...weights].reverse().slice(0, 5).forEach(w => {
                list.innerHTML += `<div class="log-item"><span style="color:var(--text-sub);">${new Date(w.date).toLocaleDateString('fr-FR')}</span><strong style="color:var(--gold);">${w.weight} kg</strong></div>`;
            });
        }
    }

    if (!canvas) return;
    if (_puppyWeightChart) { _puppyWeightChart.destroy(); _puppyWeightChart = null; }
    if (weights.length < 2) return;

    const isLight = document.body.classList.contains('light-mode');
    const lc = isLight ? '#a87020' : '#c8922a';
    const bc = isLight ? 'rgba(168,112,32,0.08)' : 'rgba(200,146,42,0.1)';
    const gc = isLight ? '#e8dfc8' : '#2a2215';
    const tc = isLight ? '#6b5038' : '#b8a88a';

    _puppyWeightChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: weights.map(w => new Date(w.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })),
            datasets: [{ label: 'Poids (kg)', data: weights.map(w => w.weight), borderColor: lc, backgroundColor: bc, borderWidth: 2, tension: 0.3, fill: true, pointBackgroundColor: lc, pointRadius: 4 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { grid: { color: gc }, ticks: { color: tc } },
                x: { grid: { display: false }, ticks: { color: tc } }
            }
        }
    });
}

window.addPuppyAct = function() {
    const puppy = getCurrentPuppy();
    if (!puppy) return;
    const type = document.getElementById('puppy-act-type')?.value;
    const date = document.getElementById('puppy-act-date')?.value;
    if (!date) { showToast('Sélectionnez une date.', '⚠️', 'error'); return; }
    if (!Array.isArray(puppy.acts)) puppy.acts = [];
    puppy.acts.push({ id: Date.now(), type, date });
    savePuppyData();
    renderPuppyActs(puppy);
    showToast(`${type} enregistré !`, '✅');
};

function renderPuppyActs(puppy) {
    const list = document.getElementById('puppy-acts-list');
    if (!list) return;
    const acts = Array.isArray(puppy.acts) ? [...puppy.acts].sort((a, b) => new Date(b.date) - new Date(a.date)) : [];
    list.innerHTML = acts.length === 0
        ? '<p style="color:var(--text-muted); font-size:12.5px;">Aucun soin enregistré.</p>'
        : acts.map(a => `<div class="log-item"><span style="color:var(--text-sub);">${escHtml(a.type)}</span><strong style="color:var(--text-muted); font-size:12px;">${new Date(a.date).toLocaleDateString('fr-FR')}</strong></div>`).join('');
}

window.updatePuppyStatus = function() {
    const puppy = getCurrentPuppy();
    if (!puppy) return;
    puppy.status = document.getElementById('puppy-status-select')?.value || 'En élevage';
    savePuppyData();
    renderLitters();
    showToast(`Statut : ${puppy.status}`, '✅');
};

// ==========================================
// REGISTRE ENTRÉES / SORTIES
// ==========================================
let registreEntries = [];

function initRegistre() {
    registreEntries = getLocalData(currentPetId, 'registre', []);
    renderRegistre();
    // Pré-remplir la date du jour
    const dateEl = document.getElementById('reg-date');
    if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
}

window.addRegistreEntry = function() {
    const type   = document.getElementById('reg-type')?.value;
    const date   = document.getElementById('reg-date')?.value;
    const animal = document.getElementById('reg-animal')?.value.trim();
    const chip   = document.getElementById('reg-chip')?.value.trim();
    const person = document.getElementById('reg-person')?.value.trim();

    if (!date)   { showToast('Sélectionnez une date.', '⚠️', 'error'); return; }
    if (!animal) { showToast("Renseignez le nom de l'animal.", '⚠️', 'error'); return; }

    registreEntries.push({
        id: Date.now(),
        type, date, animal,
        chip: chip || '—',
        person: person || '—',
        createdAt: Date.now()
    });

    saveLocalData(currentPetId, 'registre', registreEntries);
    renderRegistre();

    // Reset formulaire
    ['reg-animal', 'reg-chip', 'reg-person'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    document.getElementById('reg-date').value = new Date().toISOString().split('T')[0];

    showToast('Entrée ajoutée au registre !', '📋');
    trackEvent('registre_entry_added');
};

function renderRegistre() {
    const list = document.getElementById('registre-list');
    if (!list) return;

    if (registreEntries.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted); font-size:13px; text-align:center; padding:10px 0;">Aucune entrée dans le registre.</p>';
        return;
    }

    const sorted = [...registreEntries].sort((a, b) => new Date(b.date) - new Date(a.date));

    list.innerHTML = `
        <div style="overflow-x:auto;">
            <table style="width:100%; border-collapse:collapse; font-size:12.5px;">
                <thead>
                    <tr style="background:var(--bg-elevated);">
                        <th style="padding:8px 10px; text-align:left; border:1px solid var(--card-border); color:var(--text-muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.05em;">Date</th>
                        <th style="padding:8px 10px; text-align:left; border:1px solid var(--card-border); color:var(--text-muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.05em;">Mouvement</th>
                        <th style="padding:8px 10px; text-align:left; border:1px solid var(--card-border); color:var(--text-muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.05em;">Animal</th>
                        <th style="padding:8px 10px; text-align:left; border:1px solid var(--card-border); color:var(--text-muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.05em;">Identification</th>
                        <th style="padding:8px 10px; text-align:left; border:1px solid var(--card-border); color:var(--text-muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.05em;">Personne</th>
                        <th style="padding:8px 10px; text-align:center; border:1px solid var(--card-border); color:var(--text-muted); font-weight:600; font-size:11px;">Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${sorted.map((e, i) => {
                        const isEntree = e.type.startsWith('Entrée');
                        const badgeColor = isEntree ? 'var(--success)' : 'var(--danger)';
                        const badgeBg   = isEntree ? 'var(--success-dim)' : 'var(--danger-dim)';
                        return `<tr style="background:${i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)'}">
                            <td style="padding:9px 10px; border:1px solid var(--card-border); color:var(--text-sub); white-space:nowrap;">${new Date(e.date).toLocaleDateString('fr-FR')}</td>
                            <td style="padding:9px 10px; border:1px solid var(--card-border);">
                                <span style="background:${badgeBg}; color:${badgeColor}; border:1px solid ${badgeColor}33; padding:2px 8px; border-radius:100px; font-size:11px; font-weight:700; white-space:nowrap;">${escHtml(e.type)}</span>
                            </td>
                            <td style="padding:9px 10px; border:1px solid var(--card-border); color:var(--text); font-weight:600;">${escHtml(e.animal)}</td>
                            <td style="padding:9px 10px; border:1px solid var(--card-border); color:var(--text-muted); font-family:monospace; font-size:11.5px;">${escHtml(e.chip)}</td>
                            <td style="padding:9px 10px; border:1px solid var(--card-border); color:var(--text-sub);">${escHtml(e.person)}</td>
                            <td style="padding:9px 10px; border:1px solid var(--card-border); text-align:center;">
                                <button onclick="deleteRegistreEntry(${e.id})" style="background:var(--danger-dim); border:1px solid rgba(224,82,82,0.2); color:var(--danger); border-radius:6px; padding:4px 8px; cursor:pointer; font-size:11px;">
                                    <i class="fa-solid fa-xmark"></i>
                                </button>
                            </td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>
        <p style="font-size:11px; color:var(--text-muted); margin-top:8px; text-align:right;">
            ${registreEntries.length} entrée${registreEntries.length > 1 ? 's' : ''} au total
        </p>`;
}

window.deleteRegistreEntry = function(id) {
    showConfirm('Supprimer cette entrée du registre ?', () => {
        registreEntries = registreEntries.filter(e => e.id !== id);
        saveLocalData(currentPetId, 'registre', registreEntries);
        renderRegistre();
        showToast('Entrée supprimée.', '🗑️');
    });
};

window.clearRegistre = function() {
    showConfirm('Vider tout le registre ? Cette action est irréversible.', () => {
        registreEntries = [];
        saveLocalData(currentPetId, 'registre', registreEntries);
        renderRegistre();
        showToast('Registre vidé.', '🗑️');
    });
};

window.exportRegistrePDF = function() {
    const animal = petProfile.name || 'Animal';
    const rows = [...registreEntries].sort((a, b) => new Date(a.date) - new Date(b.date));

    const printWin = window.open('', '_blank');
    printWin.document.write(`
        <!DOCTYPE html>
        <html lang="fr">
        <head>
            <meta charset="UTF-8">
            <title>Registre Entrées/Sorties — ${animal}</title>
            <style>
                body { font-family: Arial, sans-serif; font-size: 12px; color: #1a1a1a; margin: 30px; }
                h1 { font-size: 18px; margin-bottom: 4px; }
                .meta { color: #888; font-size: 11px; margin-bottom: 20px; }
                table { width: 100%; border-collapse: collapse; }
                th { background: #2d2d2d; color: #fff; padding: 8px 10px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
                td { padding: 8px 10px; border-bottom: 1px solid #e0e0e0; vertical-align: top; }
                tr:nth-child(even) td { background: #f8f8f8; }
                .entree { color: #2d7a4f; font-weight: 700; }
                .sortie { color: #c0392b; font-weight: 700; }
                .footer { margin-top: 30px; font-size: 10px; color: #aaa; text-align: center; border-top: 1px solid #eee; padding-top: 10px; }
            </style>
        </head>
        <body>
            <h1>Registre Entrées / Sorties</h1>
            <div class="meta">
                Animal : <strong>${animal}</strong> &nbsp;|&nbsp;
                Race : <strong>${petProfile.breed || 'Non renseignée'}</strong> &nbsp;|&nbsp;
                Édité le : <strong>${new Date().toLocaleDateString('fr-FR')}</strong>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Mouvement</th>
                        <th>Animal</th>
                        <th>Identification</th>
                        <th>Vendeur / Acheteur / Éleveur</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.length === 0
                        ? '<tr><td colspan="5" style="text-align:center; color:#aaa; padding:20px;">Aucune entrée.</td></tr>'
                        : rows.map(e => {
                            const isEntree = e.type.startsWith('Entrée');
                            return `<tr>
                                <td>${new Date(e.date).toLocaleDateString('fr-FR')}</td>
                                <td class="${isEntree ? 'entree' : 'sortie'}">${e.type}</td>
                                <td><strong>${e.animal}</strong></td>
                                <td style="font-family:monospace;">${e.chip}</td>
                                <td>${e.person}</td>
                            </tr>`;
                        }).join('')}
                </tbody>
            </table>
            <div class="footer">Pablo — pablocanin.fr &nbsp;|&nbsp; Registre généré automatiquement &nbsp;|&nbsp; ${rows.length} mouvement(s)</div>
        </body>
        </html>
    `);
    printWin.document.close();
    printWin.focus();
    setTimeout(() => { printWin.print(); }, 400);
};