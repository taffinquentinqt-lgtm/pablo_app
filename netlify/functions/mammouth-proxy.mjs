// --- IMPORTS FIREBASE & CLOUD FIRESTORE ---
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";

// CONFIGURATION GLOBALE
// ==========================================
const GLOBAL_CONFIG_ID = "pablo_global_config";

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
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);

// Expose auth for landing-page inline script
window._fbAuth = auth;

// ==========================================
// GROQ API CONFIG
// ==========================================
const GROQ_API_KEY = "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";
const GROQ_MODEL   = "llama-3.3-70b-versatile";
const GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions";

async function groqChat(messages, maxTokens = 1000) {
    const response = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
            model: GROQ_MODEL,
            max_tokens: maxTokens,
            messages
        })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    return data.choices[0].message.content.trim();
}

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
    { id: 'assis',          name: "S'asseoir (Assis)",              icon: 'fa-arrow-down' },
    { id: 'coucher',        name: 'Se coucher (Couché)',             icon: 'fa-bed' },
    { id: 'rappel',         name: 'Le Rappel au pied',               icon: 'fa-dog' },
    { id: 'pas-bouger',     name: 'Pas bouger (Statique)',           icon: 'fa-hand' },
    { id: 'proprete',       name: 'La Propreté',                     icon: 'fa-droplet-slash' },
    { id: 'marche-laisse',  name: 'Marche en laisse détendue',       icon: 'fa-bezier-curve' },
    { id: 'solitude',       name: 'Gestion de la solitude',          icon: 'fa-house-chimney-user' }
];

// ==========================================
// AUTHENTIFICATION
// ==========================================
onAuthStateChanged(auth, async (user) => {
    const authPage = document.getElementById('auth-page');
    const mainApp  = document.getElementById('main-app-layout');
    const landing  = document.getElementById('landing-page');

    if (user) {
        console.log("🟢 Connecté :", user.email);
        try {
            const userDocRef = doc(db, "users", user.uid);
            const userDoc    = await getDoc(userDocRef);
            if (userDoc.exists()) {
                const cloudData = userDoc.data();
                Object.keys(cloudData).forEach(key => {
                    localStorage.setItem(key, JSON.stringify(cloudData[key]));
                });
            }
        } catch (e) { console.error("Erreur de restauration Cloud :", e); }

        if (landing)  landing.style.display  = 'none';
        if (authPage) authPage.style.display  = 'none';

        initApp();

        if (mainApp) {
            mainApp.style.display = 'flex';
            setTimeout(() => { if (typeof renderWeightChart === 'function') renderWeightChart(); }, 150);
        }
    } else {
        if (mainApp) mainApp.style.display = 'none';
    }
});

// enterApp is already defined in index.html inline script; we override to keep Firebase awareness
window.enterApp = () => {
    const landing  = document.getElementById('landing-page');
    const authPage = document.getElementById('auth-page');
    if (landing)  landing.style.display = 'none';
    if (!auth.currentUser && authPage) authPage.style.display = 'flex';
};

// toggleAuthMode is defined in index.html; we re-declare to use the local isLoginMode var
let _isLoginMode = true;
window.toggleAuthMode = () => {
    _isLoginMode = !_isLoginMode;
    const btn        = document.getElementById('auth-action-btn');
    const subtitle   = document.getElementById('auth-subtitle');
    const switchText = document.getElementById('auth-switch-text');
    const switchLink = document.getElementById('auth-switch-link');
    const pwInput    = document.getElementById('auth-password');

    if (btn)        btn.textContent        = _isLoginMode ? 'Se connecter' : 'Créer mon compte';
    if (subtitle)   subtitle.textContent   = _isLoginMode ? 'Connectez-vous pour retrouver votre compagnon.' : 'Rejoignez la meute et gérez la santé de votre chien.';
    if (switchText) switchText.textContent = _isLoginMode ? 'Pas encore de compte ?' : 'Déjà un compte ?';
    if (switchLink) switchLink.textContent = _isLoginMode ? 'Créer un compte' : 'Se connecter';
    if (pwInput)    pwInput.autocomplete   = _isLoginMode ? 'current-password' : 'new-password';
};

window.processAuth = async () => {
    const email    = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value.trim();
    if (!email || !password) { showAuthMsg("Veuillez remplir tous les champs. 🐾", "error"); return; }
    if (password.length < 6)  { showAuthMsg("Le mot de passe doit faire au moins 6 caractères.", "error"); return; }

    const btn          = document.getElementById('auth-action-btn');
    const originalText = btn.textContent;
    btn.textContent    = "Chargement...";
    try {
        if (_isLoginMode) {
            await signInWithEmailAndPassword(auth, email, password);
        } else {
            await createUserWithEmailAndPassword(auth, email, password);
            showAuthMsg("Compte créé avec succès ! Bienvenue ! 🎉", "success");
        }
    } catch (error) {
        showAuthMsg(`Erreur : ${error.message}`, "error");
    } finally {
        btn.textContent = originalText;
    }
};

window.processGoogleAuth = async () => {
    try {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
    } catch (error) {
        showAuthMsg(`Erreur Google : ${error.message}`, "error");
    }
};

window.processResetPassword = async () => {
    const email = document.getElementById('auth-email').value.trim();
    if (!email) { showAuthMsg("⚠️ Veuillez entrer une adresse email.", "error"); return; }
    try {
        await sendPasswordResetEmail(auth, email);
        showAuthMsg("🐾 Lien envoyé ! Vérifiez votre boîte mail (et vos spams).", "success");
    } catch (error) {
        if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-email') {
            showAuthMsg("❌ Aucun compte valide ne correspond à cet email.", "error");
        } else {
            showAuthMsg("❌ Erreur : " + error.message, "error");
        }
    }
};

// showAuthMsg is declared in index.html inline but we redefine robustly here
window.showAuthMsg = (text, type) => {
    const box = document.getElementById('auth-msg-box');
    if (!box) return;
    if (!text) { box.style.display = 'none'; return; }
    box.className       = `auth-msg ${type}`;
    box.textContent     = text;
    box.style.display   = 'block';
};

window.logoutApp = async () => {
    try { await signOut(auth); location.reload(); }
    catch (error) { console.error("Erreur déconnexion:", error); }
};

// ==========================================
// INITIALISATION
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initGlobalConfig();

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
    // Theme: index.html uses .light-mode on body (default is dark)
    const saved = localStorage.getItem(GLOBAL_CONFIG_ID);
    if (saved) {
        const config = JSON.parse(saved);
        if (config.lightMode) document.body.classList.add('light-mode');
    }
}

// toggleTheme is declared in index.html inline — we hook into it from here
// The inline version already toggles .light-mode on body, so we just persist
const _originalToggleTheme = window.toggleTheme;
window.toggleTheme = () => {
    if (typeof _originalToggleTheme === 'function') _originalToggleTheme();
    const isLight = document.body.classList.contains('light-mode');
    localStorage.setItem(GLOBAL_CONFIG_ID, JSON.stringify({ lightMode: isLight }));
    if (typeof renderWeightChart === 'function') renderWeightChart();
};

async function saveLocalData(petId, key, data) {
    localStorage.setItem(`${key}_${petId}`, JSON.stringify(data));
    if (auth.currentUser) {
        try {
            const userDocRef = doc(db, "users", auth.currentUser.uid);
            await setDoc(userDocRef, { [`${key}_${petId}`]: data }, { merge: true });
        } catch (e) { console.error("Erreur sync Cloud :", e); }
    }
}

function getLocalData(petId, key, defaultValue) {
    const data = localStorage.getItem(`${key}_${petId}`);
    return data ? JSON.parse(data) : defaultValue;
}

// ==========================================
// GESTION MULTI-ANIMAUX
// ==========================================
function initApp() {
    const savedPets = localStorage.getItem('app_pets_list');
    petsList = savedPets ? JSON.parse(savedPets) : [];

    if (petsList.length === 0) {
        const defaultId = 'pet_' + Date.now();
        petsList.push({ id: defaultId, name: 'Pablo' });
        localStorage.setItem('app_pets_list', JSON.stringify(petsList));

        const defaultProfile = { name: "Pablo", species: "Chien", breed: "Berger Allemand", age: 14, size: 65, weight: 31.5, avatar: "", breedAdvice: "" };
        saveLocalData(defaultId, 'profile', defaultProfile);
        saveLocalData(defaultId, 'weight', [{ date: new Date().toISOString().split('T')[0], weight: 31.5 }]);
        saveLocalData(defaultId, 'education', {});

        currentPetId = defaultId;
        localStorage.setItem('current_pet_id', currentPetId);

        if (auth.currentUser) setDoc(doc(db, "users", auth.currentUser.uid), { app_pets_list: petsList }, { merge: true });
    } else {
        currentPetId = localStorage.getItem('current_pet_id') || petsList[0].id;
    }

    renderPetSelector();
    loadCurrentPetData();
}

function renderPetSelector() {
    const selector       = document.getElementById('pet-selector');
    const mobileSelector = document.getElementById('mobile-pet-selector');

    if (selector)       selector.innerHTML       = '';
    if (mobileSelector) mobileSelector.innerHTML = '';

    petsList.forEach(pet => {
        const option      = document.createElement('option');
        option.value      = pet.id;
        option.textContent = pet.name;
        if (pet.id === currentPetId) option.selected = true;

        if (selector)       selector.appendChild(option);
        if (mobileSelector) mobileSelector.appendChild(option.cloneNode(true));
    });
}

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

    saveLocalData(newId, 'profile',     { name, species, breed, age: 0, size: 0, weight: 0, avatar: "", breedAdvice: "" });
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

    closePetModal();
    switchPet(newId);
};

function loadCurrentPetData() {
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
}

window.deleteCurrentPet = function() {
    if (!confirm(`⚠️ Êtes-vous sûr de vouloir supprimer ${petProfile.name} ?`)) return;
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
};

// ==========================================
// PROFIL & ENCYCLOPÉDIE
// ==========================================
function initPetProfile() {
    petProfile = getLocalData(currentPetId, 'profile', {});

    // Sidebar brand tagline (breed)
    const breedEl = document.getElementById('header-pet-breed');
    if (breedEl) breedEl.innerText = petProfile.breed || 'Compagnon santé';

    // Sidebar footer name & pet selector label
    const topNameEl = document.getElementById('current-pet-display-top');
    if (topNameEl) topNameEl.innerText = petProfile.name || 'Pablo';

    // Avatar — profile screen
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

    // Profile form fields
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    setVal('profile-name',    petProfile.name);
    setVal('profile-breed',   petProfile.breed);
    setVal('profile-age',     petProfile.age);
    setVal('profile-size',    petProfile.size);
    setVal('profile-weight',  petProfile.weight);

    // Allergies (healthExtras loaded separately, but we sync here if already loaded)
    const allergyInput = document.getElementById('profile-allergies');
    if (allergyInput) allergyInput.value = (getLocalData(currentPetId, 'healthExtras', {})).allergies || '';

    // Dynamic pet name spans
    document.querySelectorAll('.dynamic-pet-name').forEach(el => el.innerText = petProfile.name || 'Pablo');

    updateBreedAdviceUI();
}

async function updateBreedAdviceUI() {
    const adviceCard      = document.getElementById('breed-advice-card');
    const adviceBreedName = document.getElementById('advice-breed-name');
    const adviceContent   = document.getElementById('breed-advice-content');
    if (!adviceCard) return;

    if (!petProfile.breed || petProfile.breed.trim() === '') { adviceCard.style.display = 'none'; return; }
    adviceCard.style.display = 'block';
    if (adviceBreedName) adviceBreedName.innerText = petProfile.breed;

    if (petProfile.breedAdvice) { if (adviceContent) adviceContent.innerHTML = petProfile.breedAdvice; return; }
    if (adviceContent) adviceContent.innerHTML = "<div style='text-align:center; padding:20px;'><i class='fa-solid fa-spinner fa-spin' style='font-size:24px; color:var(--gold);'></i><br><br><span style='color:var(--text-muted); font-size:13px;'>Génération de l'encyclopédie…</span></div>";

    try {
        const prompt = `Tu es un expert canin. Rédige une documentation complète pour un ${petProfile.species || 'animal'} de race ${petProfile.breed}.
Structure ta réponse en HTML propre avec ces sections en balises <h4> (avec emojis pertinents) :
<h4>Comportement & Caractère</h4>
<h4>Besoins en exercice</h4>
<h4>Santé & Toilettage</h4>
<h4>Conseil d'éducation</h4>
Utilise des paragraphes <p> et des listes <ul><li>. Pas d'introduction ni de conclusion, envoie uniquement le HTML propre.`;

        const clean = (await groqChat([{ role: "user", content: prompt }], 1200)).replace(/```html|```/g, '').trim();

        petProfile.breedAdvice = clean;
        saveLocalData(currentPetId, 'profile', petProfile);
        if (adviceContent) adviceContent.innerHTML = clean;
    } catch (error) {
        console.error("Erreur encyclopédie:", error);
        if (adviceContent) adviceContent.innerText = "Documentation non disponible. Demandez à l'assistant dans l'onglet dédié !";
    }
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

// ==========================================
// POIDS & NUTRITION
// ==========================================
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

window.updateNutritionUI = async function() {
    const nutritionRationText = document.getElementById('nutrition-ration-text');
    const activitySelector    = document.getElementById('activity-level-selector');
    if (!petProfile.weight || !nutritionRationText || !activitySelector) return;

    // Local fallback first
    let baseRation = petProfile.weight * 13.5;
    if (activitySelector.value === 'calm')   baseRation *= 0.85;
    if (activitySelector.value === 'active') baseRation *= 1.15;

    nutritionRationText.style.fontSize = '16px';
    nutritionRationText.innerText      = 'Calcul…';

    try {
        const prompt = `Calcule la ration de croquettes idéale pour un ${petProfile.species || 'chien'} de race ${petProfile.breed || 'Inconnue'}, pesant ${petProfile.weight} kg, activité ${activitySelector.value}. Réponds UNIQUEMENT par le chiffre suivi de la lettre g. Exemple : 420g`;
        const aiText = await groqChat([{ role: "user", content: prompt }], 20);
        nutritionRationText.style.fontSize = '';

        const match = aiText.match(/\d+\s*g/i);
        if (match) {
            nutritionRationText.innerText = match[0].toLowerCase().replace(' ', '');
        } else {
            const nums = aiText.match(/\d+/);
            nutritionRationText.innerText = nums ? nums[0] + 'g' : Math.round(baseRation) + 'g';
        }
    } catch (e) {
        nutritionRationText.style.fontSize = '';
        nutritionRationText.innerText      = Math.round(baseRation) + 'g';
    }
};

window.addNewWeight = function() {
    const weightVal = parseFloat(document.getElementById('weight-input').value);
    const dateVal   = document.getElementById('weight-date').value;
    if (!weightVal || !dateVal || weightVal <= 0) { showToast("Valeurs invalides.", "⚠️", "error"); return; }
    weightHistory.push({ date: dateVal, weight: weightVal });
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

window.addWater = function()          { dailyTrackers.water += 250; saveLocalData(currentPetId, 'daily', dailyTrackers); updateTrackersUI(); showToast('+250 ml 💧'); };
window.addWalk  = function()          { dailyTrackers.walk  += 15;  saveLocalData(currentPetId, 'daily', dailyTrackers); updateTrackersUI(); showToast('+15 min 🐾'); };
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
    if (!confirm(`Vider l'historique de ${petProfile.name} ?`)) return;
    medicalEvents = [];
    saveLocalData(currentPetId, 'medical', medicalEvents);
    renderMedicalHistory();
    renderReminders();
};

function renderReminders() {
    const container = document.getElementById('dynamic-reminders-list');
    if (!container) return;
    container.innerHTML = '';
    const today = new Date();
    let hasReminders = false;

    // 1. Rappels médicaux
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

    // 2. Rappels élevage — naissance prévue
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

    // 3. Rappel chaleurs
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

    // 4. Concours à venir
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
            <span style="color:var(--text-sub);">${expense.title}</span>
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
    budgetExpenses.push({ id: Date.now(), title, amount, date: new Date().toISOString() });
    saveLocalData(currentPetId, 'budget', budgetExpenses);
    updateBudgetUI();
    document.getElementById('budget-title').value  = '';
    document.getElementById('budget-amount').value = '';
    showToast(`${title} — ${amount.toFixed(2)} € enregistré !`, '💰');
};

window.exportToPDF = () => window.print();

// ==========================================
// CHAT — Assistant IA via Anthropic API
// ==========================================
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
            msgDiv.innerHTML = `<div class="msg-bubble">${msg.text}</div>`;
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

window.sendMessage = async function() {
    const input = document.getElementById('chat-input-field');
    const text  = input?.value.trim();
    if (!text) return;

    chatHistory.push({ sender: 'user', text });
    input.value = '';

    // Loading indicator
    const loadingId  = Date.now();
    const loadingTxt = `<span class="running-dog">🐶</span> <em style="font-size:13px; color:var(--text-muted); margin-left:8px;">Pablo renifle une piste…</em>`;
    chatHistory.push({ sender: 'bot', text: loadingTxt, _id: loadingId });
    renderChat();

    const systemPrompt = `Tu es l'assistant Pablo, spécialisé en bien-être animal. Tu aides le maître de : ${petProfile.name || 'l\'animal'}, Espèce: ${petProfile.species || 'Chien'}, Race: ${petProfile.breed || 'Inconnue'}, Âge: ${petProfile.age || '?'} mois, Poids: ${petProfile.weight || '?'} kg. Sois concis, bienveillant et finis toujours par un wouf ou un miaou !`;

    const apiMessages = [
        { role: "system", content: systemPrompt },
        ...chatHistory
            .filter(m => !m._id)
            .slice(-10)
            .map(m => ({ role: m.sender === 'bot' ? 'assistant' : 'user', content: m.text }))
    ];

    // Ensure last message is user
    if (apiMessages[apiMessages.length - 1].role !== 'user') {
        apiMessages.push({ role: 'user', content: text });
    }

    try {
        const replyTx = await groqChat(apiMessages);
        chatHistory = chatHistory.filter(m => m._id !== loadingId);
        chatHistory.push({ sender: 'bot', text: replyTx });
        renderChat();
        saveLocalData(currentPetId, 'chat', chatHistory);
    } catch (e) {
        chatHistory = chatHistory.filter(m => m._id !== loadingId);
        chatHistory.push({ sender: 'bot', text: `Wouf… Erreur de connexion. (${e.message})` });
        renderChat();
    }
};

// ==========================================
// NAVIGATION
// ==========================================
window.navigateTo = function(screenId) {
    // Screens
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (target) target.classList.add('active');

    // Sidebar nav items
    document.querySelectorAll('.sidebar-nav li').forEach(li => li.classList.remove('active'));
    document.querySelectorAll(`.sidebar-nav li[onclick="navigateTo('${screenId}')"]`).forEach(li => li.classList.add('active'));

    // Mobile nav items
    document.querySelectorAll('.nav-item').forEach(ni => ni.classList.remove('active'));
    document.querySelectorAll(`.nav-item[onclick="navigateTo('${screenId}')"]`).forEach(ni => ni.classList.add('active'));

    // Page title
    const titles = {
        'screen-home':    "Vue d'ensemble",
        'screen-carnet':  "Carnet de Santé & Suivi",
        'screen-chat':    "Hey Pablo",
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

    // Reproduction fields (index.html IDs)
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
    // These IDs match index.html exactly
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

// PORTÉES — IDs from index.html: litter-date, litter-partner, litter-count
window.addLitter = function() {
    const date    = document.getElementById('litter-date')?.value;
    const partner = document.getElementById('litter-partner')?.value;
    const count   = document.getElementById('litter-count')?.value;
    if (!date) { showToast("Sélectionnez une date.", "⚠️", "error"); return; }
    proLitters.push({ id: Date.now(), date, partner, count });
    saveLocalData(currentPetId, 'proLitters', proLitters);
    if (document.getElementById('litter-date'))    document.getElementById('litter-date').value    = '';
    if (document.getElementById('litter-partner')) document.getElementById('litter-partner').value = '';
    if (document.getElementById('litter-count'))   document.getElementById('litter-count').value   = '';
    renderLitters();
    showToast('Portée enregistrée ! 🐶', '✅');
};

function renderLitters() {
    const list = document.getElementById('litters-list');
    if (!list) return;
    list.innerHTML = '';
    const sorted = [...proLitters].sort((a, b) => new Date(b.date) - new Date(a.date));
    if (sorted.length === 0) { list.innerHTML = '<p style="color:var(--text-muted); font-size:13px; text-align:center;">Aucune portée enregistrée.</p>'; return; }
    sorted.forEach(l => {
        list.innerHTML += `
            <div class="reminder-item">
                <div>
                    <h4>Portée du ${new Date(l.date).toLocaleDateString('fr-FR')}</h4>
                    <span>Partenaire : ${l.partner || 'Non précisé'}</span>
                </div>
                <span class="badge badge-gold">${l.count || '?'} chiot(s)</span>
            </div>`;
    });
}

// ÉVÉNEMENTS & CONCOURS — IDs from index.html: pro-event-type, pro-event-date, pro-event-details
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
                    <h4>${ev.type}</h4>
                    <span>${new Date(ev.date).toLocaleDateString('fr-FR')}${ev.details ? ' — ' + ev.details : ''}</span>
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

// IDs from index.html: new-heat-date, heat-history-list, heat-average
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

// IDs from index.html: mating-date, mating-partner, mating-coi, mating-history-list
window.addMatingRecord = function() {
    const date    = document.getElementById('mating-date')?.value;
    const partner = document.getElementById('mating-partner')?.value;
    const coi     = document.getElementById('mating-coi')?.value;
    if (!date) return;
    proHistory.matings.push({ id: Date.now(), date, partner, coi });
    saveLocalData(currentPetId, 'proHistory', proHistory);
    if (document.getElementById('mating-date'))    document.getElementById('mating-date').value    = '';
    if (document.getElementById('mating-partner')) document.getElementById('mating-partner').value = '';
    if (document.getElementById('mating-coi'))     document.getElementById('mating-coi').value     = '';
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
                    <span class="badge badge-gold">COI: ${m.coi || '?'}%</span>
                </div>
                <span style="color:var(--text-muted); font-size:12.5px;">Partenaire : ${m.partner || 'Inconnu'}</span>
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

// IDs from index.html: memory-date, memory-title, memories-timeline
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
                <div style="font-weight:600; color:var(--text); font-size:13.5px;">${m.title}</div>
            </div>`;
    });
}

window.generateAvatar = function() {
    showToast(`Avatar de ${petProfile.name || 'votre compagnon'} bientôt disponible ! 🪄`, '🎨');
};

// ==========================================
// NOTIFICATIONS
// ==========================================
window.requestNotificationPermission = function() {
    if (!('Notification' in window)) { showToast("Votre navigateur ne supporte pas les notifications.", "⚠️", "error"); return; }
    Notification.requestPermission().then(permission => {
        const btn = document.getElementById('btn-enable-notifications');
        if (permission === 'granted') {
            if (btn) { btn.innerHTML = '<i class="fa-solid fa-check"></i> Notifications activées !'; btn.style.color = 'var(--success)'; btn.style.borderColor = 'rgba(82,201,122,0.4)'; btn.disabled = true; }
            new Notification('Félicitations !', { body: 'Les rappels Pablo sont actifs.', icon: '/pablo.jpg' });
        } else {
            showToast("Notifications refusées.", "⚠️", "error");
        }
    });
};

// ==========================================
// EXPORTS WINDOW
// ==========================================
window.switchPet                  = switchPet;
window.createNewPet               = window.createNewPet;
window.closePetModal              = window.closePetModal;
window.confirmCreateNewPet        = window.confirmCreateNewPet;
window.updateNutritionUI          = window.updateNutritionUI;
window.addWater                   = window.addWater;
window.addWalk                    = window.addWalk;
window.resetDailyTrackers         = window.resetDailyTrackers;
window.addNewWeight               = window.addNewWeight;
window.addMedicalEvent            = window.addMedicalEvent;
window.clearMedicalHistory        = window.clearMedicalHistory;
window.addBudgetExpense           = window.addBudgetExpense;
window.uploadPetPhoto             = window.uploadPetPhoto;
window.savePetProfile             = window.savePetProfile;
window.deleteCurrentPet           = window.deleteCurrentPet;
window.navigateTo                 = window.navigateTo;
window.saveProData                = window.saveProData;
window.addProEvent                = window.addProEvent;
window.addLitter                  = window.addLitter;
window.toggleBreederFields        = window.toggleBreederFields;
window.callVet                    = window.callVet;
window.callPoisonControl          = window.callPoisonControl;
window.refillKibbleBag            = window.refillKibbleBag;
window.addHeatRecord              = window.addHeatRecord;
window.addMatingRecord            = window.addMatingRecord;
window.addMemory                  = window.addMemory;
window.generateAvatar             = window.generateAvatar;
window.updateEduLevel             = window.updateEduLevel;
window.addCustomExercise          = window.addCustomExercise;
window.exportToPDF                = window.exportToPDF;
window.requestNotificationPermission = window.requestNotificationPermission;
window.renderWeightChart          = renderWeightChart;