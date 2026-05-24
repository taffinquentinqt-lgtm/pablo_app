// --- IMPORTS FIREBASE & CLOUD FIRESTORE ---
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";

// ==========================================
// CONFIGURATION GLOBALE
// ==========================================
const GLOBAL_CONFIG_ID = "pablo_global_config";

// Configuration Firebase
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

// Variables d'état globales
let petsList = [];
let currentPetId = null;
let petProfile = {};
let weightHistory = [];
let medicalEvents = [];
let dailyTrackers = {};
let chatHistory = [];
let budgetExpenses = [];
let educationData = {}; 

let weightChartInstance = null;
let darkModeActive = false;
let isLoginMode = true;

// LISTE DES COMPÉTENCES D'ÉDUCATION PAR DÉFAUT
const DEFAULT_EDU_EXERCISES = [
    { id: 'assis', name: "S'asseoir (Assis)", icon: 'fa-arrow-down' },
    { id: 'coucher', name: 'Se coucher (Couché)', icon: 'fa-bed' },
    { id: 'rappel', name: 'Le Rappel au pied', icon: 'fa-dog' },
    { id: 'pas-bouger', name: 'Pas bouger (Statique)', icon: 'fa-hand' },
    { id: 'proprete', name: 'La Propreté', icon: 'fa-droplet-slash' },
    { id: 'marche-laisse', name: 'Marche en laisse détendue', icon: 'fa-bezier-curve' },
    { id: 'solitude', name: 'Gestion de la solitude', icon: 'fa-house-chimney-user' }
];

// ==========================================
// AUTHENTIFICATION & SYNCHRONISATION CLOUD
// ==========================================
onAuthStateChanged(auth, async (user) => {
    const authPage = document.getElementById('auth-page');
    const mainApp = document.getElementById('main-app-layout');
    const landing = document.getElementById('landing-page');
    
    if (user) {
        console.log("🟢 Connecté :", user.email);
        
        try {
            const userDocRef = doc(db, "users", user.uid);
            const userDoc = await getDoc(userDocRef);
            
            if (userDoc.exists()) {
                const cloudData = userDoc.data();
                Object.keys(cloudData).forEach(key => {
                    localStorage.setItem(key, JSON.stringify(cloudData[key]));
                });
                console.log("☁️ Données Cloud restaurées avec succès dans le navigateur !");
            }
        } catch (e) {
            console.error("Erreur de restauration Cloud :", e);
        }

        if(landing) landing.style.display = 'none';
        if(authPage) authPage.style.display = 'none';
        
        initApp();

        if(mainApp) {
            mainApp.style.display = 'flex';
            setTimeout(() => { if (typeof renderWeightChart === 'function') renderWeightChart(); }, 150);
        }
    } else {
        console.log("🔴 Déconnecté.");
        if(mainApp) mainApp.style.display = 'none';
    }
});

window.enterApp = () => {
    const landing = document.getElementById('landing-page');
    const authPage = document.getElementById('auth-page');
    if (landing) landing.style.display = 'none';
    if (!auth.currentUser && authPage) authPage.style.display = 'flex';
};

window.toggleAuthMode = () => {
    isLoginMode = !isLoginMode;
    const btn = document.getElementById('auth-action-btn');
    const subtitle = document.getElementById('auth-subtitle');
    const switchText = document.getElementById('auth-switch-text');
    const switchLink = document.querySelector('.auth-switch a');

    btn.innerText = isLoginMode ? "Se connecter" : "Créer mon compte";
    subtitle.innerText = isLoginMode ? "Connectez-vous pour retrouver votre compagnon." : "Rejoignez la meute et gérez la santé de votre chien.";
    switchText.innerText = isLoginMode ? "Pas encore de compte ?" : "Déjà un compte ?";
    switchLink.innerText = isLoginMode ? "Créer un compte" : "Se connecter";
};

window.processAuth = async () => {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value.trim();

    if (!email || !password) return alert("Veuillez remplir tous les champs. 🐾");
    if (password.length < 6) return alert("Le mot de passe doit faire au moins 6 caractères.");

    const btn = document.getElementById('auth-action-btn');
    const originalText = btn.innerText;
    btn.innerText = "Chargement...";

    try {
        if (isLoginMode) {
            await signInWithEmailAndPassword(auth, email, password);
        } else {
            await createUserWithEmailAndPassword(auth, email, password);
            alert("Compte créé avec succès ! Bienvenue ! 🎉");
        }
    } catch (error) {
        alert(`Erreur : ${error.message}`);
        console.error(error);
    } finally {
        btn.innerText = originalText;
    }
};

window.processGoogleAuth = async () => {
    try {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
    } catch (error) {
        alert(`Erreur avec Google : ${error.message}`);
        console.error(error);
    }
};

window.logoutApp = async () => {
    try {
        await signOut(auth);
        location.reload();
    } catch (error) {
        console.error("Erreur déconnexion:", error);
    }
};

// ==========================================
// INITIALISATION & THÈME
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initGlobalConfig();
    initApp();

    const chatInput = document.getElementById('chat-input-field');
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendMessage();
        });
    }

    const weightDate = document.getElementById('weight-date');
    if (weightDate) weightDate.value = new Date().toISOString().split('T')[0];

    const selector = document.getElementById('pet-selector');
    if (selector) {
        selector.addEventListener('change', (e) => switchPet(e.target.value));
    }

    const mobileSelector = document.getElementById('mobile-pet-selector');
    if (mobileSelector) {
        mobileSelector.addEventListener('change', (e) => switchPet(e.target.value));
    }
});

function initGlobalConfig() {
    const config = localStorage.getItem(GLOBAL_CONFIG_ID);
    if (config) {
        darkModeActive = JSON.parse(config).darkMode || false;
    }
    applyTheme();
}

function applyTheme() {
    const elements = [document.querySelector('.app-container'), document.getElementById('main-app-layout'), document.body];
    elements.forEach(el => {
        if (el) darkModeActive ? el.classList.add('dark-mode') : el.classList.remove('dark-mode');
    });
    if (typeof renderWeightChart === 'function') renderWeightChart();
}

function toggleDarkMode() {
    darkModeActive = !darkModeActive;
    localStorage.setItem(GLOBAL_CONFIG_ID, JSON.stringify({ darkMode: darkModeActive }));
    applyTheme();
}

// ==========================================
// SAUVEGARDE HYBRIDE EN ARRIÈRE-PLAN
// ==========================================
async function saveLocalData(petId, key, data) {
    localStorage.setItem(`${key}_${petId}`, JSON.stringify(data));
    
    if (auth.currentUser) {
        try {
            const userDocRef = doc(db, "users", auth.currentUser.uid);
            await setDoc(userDocRef, {
                [`${key}_${petId}`]: data
            }, { merge: true });
        } catch (e) {
            console.error("Erreur de synchronisation Cloud :", e);
        }
    }
}

function getLocalData(petId, key, defaultValue) {
    const data = localStorage.getItem(`${key}_${petId}`);
    return data ? JSON.parse(data) : defaultValue;
}

// ==========================================
// GESTION MULTI-CHIENS (SYNCHRONISÉ)
// ==========================================
function initApp() {
    const savedPets = localStorage.getItem('app_pets_list');
    petsList = savedPets ? JSON.parse(savedPets) : [];

    if (petsList.length === 0) {
        const defaultId = 'pet_' + Date.now();
        petsList.push({ id: defaultId, name: 'Pablo' });
        localStorage.setItem('app_pets_list', JSON.stringify(petsList));
        
        petProfile = { name: "Pablo", species: "Chien", breed: "Berger Allemand", age: 14, size: 65, weight: 31.5, avatar: "", breedAdvice: "" };
        saveLocalData(defaultId, 'profile', petProfile);
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
    const selector = document.getElementById('pet-selector');
    const mobileSelector = document.getElementById('mobile-pet-selector');
    
    if(selector) selector.innerHTML = '';
    if(mobileSelector) mobileSelector.innerHTML = '';
    
    petsList.forEach(pet => {
        const option = document.createElement('option');
        option.value = pet.id;
        option.textContent = pet.name;
        if(pet.id === currentPetId) option.selected = true;
        
        if(selector) selector.appendChild(option);
        
        if(mobileSelector) {
            const mobileOption = option.cloneNode(true);
            mobileSelector.appendChild(mobileOption);
        }
    });
}

function switchPet(petId) {
    currentPetId = petId;
    localStorage.setItem('current_pet_id', currentPetId);
    loadCurrentPetData();
    navigateTo('screen-home');
}

function createNewPet() {
    const modal = document.getElementById('add-pet-modal');
    const input = document.getElementById('new-pet-name-input');
    const breedInput = document.getElementById('new-pet-breed-input');
    if (modal) {
        modal.style.display = 'flex';
        if (input) {
            input.value = '';
            if(breedInput) breedInput.value = '';
            input.focus();
        }
    }
}

function closePetModal() {
    const modal = document.getElementById('add-pet-modal');
    if (modal) modal.style.display = 'none';
}

function confirmCreateNewPet() {
    const inputName = document.getElementById('new-pet-name-input');
    const inputSpecies = document.getElementById('new-pet-species-input');
    const inputBreed = document.getElementById('new-pet-breed-input');

    if (!inputName) return;
    const name = inputName.value.trim();
    const species = inputSpecies ? inputSpecies.value : "Chien";
    const breed = inputBreed ? inputBreed.value.trim() : "";
    
    if (!name) return alert("Le nom ne peut pas être vide ! 🐾");
    
    const newId = 'pet_' + Date.now();
    petsList.push({ id: newId, name: name });
    localStorage.setItem('app_pets_list', JSON.stringify(petsList));
    
    if (auth.currentUser) setDoc(doc(db, "users", auth.currentUser.uid), { app_pets_list: petsList }, { merge: true });
    
    const newProfile = { name: name, species: species, breed: breed, age: 0, size: 0, weight: 0, avatar: "", breedAdvice: "" };
    
    saveLocalData(newId, 'profile', newProfile);
    saveLocalData(newId, 'weight', []);
    saveLocalData(newId, 'medical', []);
    saveLocalData(newId, 'education', {});
    saveLocalData(newId, 'custom_exercises', []);
    saveLocalData(newId, 'daily', {water: 0, walk: 0, date: new Date().toISOString().split('T')[0]});
    saveLocalData(newId, 'chat', [{sender: 'bot', text: `Wouf ! Je suis l'assistant de ${name}.`}]);
    saveLocalData(newId, 'budget', []);

    closePetModal();
    switchPet(newId);
}

function loadCurrentPetData() {
    initPetProfile();
    initWeightHistory();
    initMedicalRecords();
    initEducation();
    initDailyTrackers();
    initChat();
    initBudgetTracker();
}

function deleteCurrentPet() {
    if (!confirm(`⚠️ Êtes-vous sûr de vouloir supprimer ${petProfile.name} ?`)) return;

    const keys = ['profile', 'weight', 'medical', 'education', 'custom_exercises', 'daily', 'chat', 'budget'];
    keys.forEach(key => localStorage.removeItem(`${key}_${currentPetId}`));

    petsList = petsList.filter(pet => pet.id !== currentPetId);
    localStorage.setItem('app_pets_list', JSON.stringify(petsList));

    if (auth.currentUser) setDoc(doc(db, "users", auth.currentUser.uid), { app_pets_list: petsList }, { merge: true });

    if(petsList.length === 0) {
        currentPetId = null;
        localStorage.removeItem('current_pet_id');
        initApp();
    } else {
        switchPet(petsList[0].id);
    }
}

// ==========================================
// PROFIL ET ENCYCLOPÉDIE ADVISOR (GEMINI 1.5)
// ==========================================
function initPetProfile() {
    petProfile = getLocalData(currentPetId, 'profile', {});

    const updateText = (id, text) => { const el = document.getElementById(id); if (el) el.innerText = text; };
    const updateHTML = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
    
    updateHTML('header-pet-name', `${petProfile.name || 'PABLO'}<span>.</span>`);
    updateText('header-pet-breed', petProfile.breed || "Race non définie");
    updateText('welcome-pet-name', petProfile.name);
    updateText('current-pet-display-top', petProfile.name);

    const toggleDisplay = (imgId, placeholderId, src) => {
        const img = document.getElementById(imgId);
        const placeholder = document.getElementById(placeholderId);
        if (src) {
            if (img) { img.src = src; img.style.display = 'block'; }
            if (placeholder) placeholder.style.display = 'none';
        } else {
            if (img) img.style.display = 'none';
            if (placeholder) { placeholder.style.display = 'flex'; placeholder.innerText = petProfile.name?.charAt(0).toUpperCase() || 'A'; }
        }
    };

    toggleDisplay('sidebar-pet-image', 'sidebar-placeholder', petProfile.avatar);
    toggleDisplay('profile-pet-image', 'profile-avatar-placeholder', petProfile.avatar);

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ""; };
    setVal('profile-name', petProfile.name);
    setVal('profile-breed', petProfile.breed);
    setVal('profile-age', petProfile.age);
    setVal('profile-size', petProfile.size);
    setVal('profile-weight', petProfile.weight);

    // GESTION DYNAMIQUE DE L'ONGLET ÉDUCATION (CHIEN UNIQUEMENT)
    const mobileEduBtn = document.querySelector('.mobile-nav .nav-item[onclick*="screen-edu"]');
    const sidebarEduBtn = document.getElementById('sidebar-nav-edu');
    const isChien = (petProfile.species === "Chien");

    if (isChien) {
        if (mobileEduBtn) mobileEduBtn.style.display = 'flex';
        if (sidebarEduBtn) sidebarEduBtn.style.display = 'flex';
    } else {
        if (mobileEduBtn) mobileEduBtn.style.display = 'none';
        if (sidebarEduBtn) sidebarEduBtn.style.display = 'none';
        const currentScreen = document.querySelector('.screen.active');
        if (currentScreen && currentScreen.id === 'screen-edu') {
            navigateTo('screen-home');
        }
    }

    updateBreedAdviceUI();
}

async function updateBreedAdviceUI() {
    const adviceCard = document.getElementById('breed-advice-card');
    const adviceBreedName = document.getElementById('advice-breed-name');
    const adviceContent = document.getElementById('breed-advice-content');

    if (!adviceCard) return;

    if (!petProfile.breed || petProfile.breed.trim() === "") {
        adviceCard.style.display = 'none';
        return;
    }

    adviceCard.style.display = 'block';
    adviceBreedName.innerText = petProfile.breed;

    if (petProfile.breedAdvice && petProfile.breedAdvice !== "") {
        adviceContent.innerHTML = petProfile.breedAdvice;
        return;
    }

    adviceContent.innerHTML = "<div style='text-align:center; padding: 20px;'><i class='fa-solid fa-spinner fa-spin' style='font-size: 24px; color: var(--accent);'></i><br><br>Génération de l'encyclopédie via Gemini...</div>";

    try {
        const prompt = `Tu es un expert en comportement animal. Rédige une documentation complète et détaillée pour un ${petProfile.species || 'animal'} de race ${petProfile.breed}. 
        Structure ta réponse directement en HTML propre avec ces balises <h4> (et ajoute des emojis pertinents) : 
        <h4>Comportement & Caractère</h4>
        <h4>Besoins en exercice</h4>
        <h4>Santé & Toilettage</h4>
        <h4>Conseil d'éducation</h4>
        Utilise des paragraphes <p> et des listes <ul><li> pour rendre la lecture agréable. Envoie uniquement le code HTML, sans balises markdown de bloc de code.`;
        
        const response = await fetch("/api/mammouth-proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                systemInstruction: "Tu es un rédacteur d'encyclopédie canine et féline expert. Tu écris directement en HTML.",
                messages: [{ content: prompt }]
            })
        });
        
        const data = await response.json();
        if (data.error) throw new Error(data.error);

        petProfile.breedAdvice = data.choices[0].message.content.trim();
        saveLocalData(currentPetId, 'profile', petProfile);
        
        adviceContent.innerHTML = petProfile.breedAdvice;
    } catch (error) {
        console.error("Erreur génération conseils:", error);
        adviceContent.innerText = "Documentation non disponible temporairement.";
    }
}

function savePetProfile() {
    const name = document.getElementById('profile-name').value.trim();
    if (!name) return alert("Le nom est obligatoire.");

    const weight = parseFloat(document.getElementById('profile-weight').value);
    const newBreed = document.getElementById('profile-breed').value.trim();
    
    if (petProfile.breed !== newBreed) {
        petProfile.breedAdvice = "";
    }

    petProfile.name = name;
    petProfile.breed = newBreed;
    petProfile.age = parseInt(document.getElementById('profile-age').value) || 0;
    petProfile.size = parseInt(document.getElementById('profile-size').value) || 0;
    
    if(weight && weight !== petProfile.weight) {
        weightHistory.push({ date: new Date().toISOString().split('T')[0], weight: weight });
        saveLocalData(currentPetId, 'weight', weightHistory);
    }
    petProfile.weight = weight || petProfile.weight;

    saveLocalData(currentPetId, 'profile', petProfile);
    
    const petObj = petsList.find(p => p.id === currentPetId);
    if(petObj) {
        petObj.name = name;
        localStorage.setItem('app_pets_list', JSON.stringify(petsList));
        if (auth.currentUser) setDoc(doc(db, "users", auth.currentUser.uid), { app_pets_list: petsList }, { merge: true });
        renderPetSelector();
    }

    loadCurrentPetData();
    alert(`Profil de ${name} enregistré ! 🐾`);
    navigateTo('screen-home');
}

function uploadPetPhoto() {
    const file = document.getElementById('file-upload-input').files[0];
    if (file) {
        const reader = new FileReader();
        reader.onloadend = () => {
            petProfile.avatar = reader.result;
            const img = document.getElementById('profile-pet-image');
            const placeholder = document.getElementById('profile-avatar-placeholder');
            if(img) { img.src = reader.result; img.style.display = 'block'; }
            if(placeholder) placeholder.style.display = 'none';
            saveLocalData(currentPetId, 'profile', petProfile);
        };
        reader.readAsDataURL(file);
    }
}

// ==========================================
// POIDS ET NUTRITION (GEMINI 1.5)
// ==========================================
function initWeightHistory() {
    weightHistory = getLocalData(currentPetId, 'weight', []);
    updateWeightUI();
}

function updateWeightUI() {
    const nutritionWeightText = document.getElementById('nutrition-weight-text');
    const nutritionRationText = document.getElementById('nutrition-ration-text');
    const waterTargetText = document.getElementById('water-target-text');

    if(weightHistory.length === 0) {
        if (nutritionWeightText) nutritionWeightText.innerText = "-- kg";
        if (nutritionRationText) nutritionRationText.innerText = "-- g";
        if (waterTargetText) waterTargetText.innerText = `Objectif : -- ml`;
        return;
    }
    
    weightHistory.sort((a,b) => new Date(a.date) - new Date(b.date));
    const latestPesee = weightHistory[weightHistory.length - 1].weight;

    petProfile.weight = latestPesee;
    saveLocalData(currentPetId, 'profile', petProfile);

    if (nutritionWeightText) nutritionWeightText.innerText = latestPesee.toFixed(1) + " kg";
    updateNutritionUI();

    if (waterTargetText) waterTargetText.innerText = `Objectif : ${Math.round(latestPesee * 55)} ml`;
}

async function updateNutritionUI() {
    const nutritionRationText = document.getElementById('nutrition-ration-text');
    const activityLevel = document.getElementById('activity-level-selector');
    
    if (!petProfile.weight || !nutritionRationText || !activityLevel) return;

    nutritionRationText.style.fontSize = "14px";
    nutritionRationText.innerText = "Calcul Gemini...";

    let baseRation = petProfile.weight * 13.5; 
    if (activityLevel.value === 'calm') baseRation *= 0.85;
    if (activityLevel.value === 'active') baseRation *= 1.15;

    const promptNutrition = `Calcule la ration quotidienne de croquettes idéale pour un ${petProfile.species || 'chien'} de race ${petProfile.breed || 'Inconnue'}, pesant ${petProfile.weight} kg, âgé de ${petProfile.age || 0} mois, avec un niveau d'activité ${activityLevel.value}. Réponds UNIQUEMENT par le nombre de grammes suivi de 'g'. Exemple : 420g`;

    try {
        const response = await fetch("/api/mammouth-proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                systemInstruction: "Tu es un outil automatique de calcul vétérinaire. Tu réponds strictement par un chiffre suivi de la lettre g, sans aucune phrase autour.",
                messages: [{ content: promptNutrition }]
            })
        });
        const data = await response.json();
        
        if (data.error) throw new Error(data.error);

        nutritionRationText.style.fontSize = ""; 
        nutritionRationText.innerText = data.choices[0].message.content.trim();
    } catch (e) {
        console.error("❌ Erreur nutrition:", e);
        nutritionRationText.style.fontSize = "";
        nutritionRationText.innerText = Math.round(baseRation) + " g";
    }
}

function addNewWeight() {
    const weightVal = parseFloat(document.getElementById('weight-input').value);
    const dateVal = document.getElementById('weight-date').value;

    if(!weightVal || !dateVal || weightVal <= 0) return alert("Valeurs invalides.");

    weightHistory.push({ date: dateVal, weight: weightVal });
    saveLocalData(currentPetId, 'weight', weightHistory);
    
    updateWeightUI();
    renderWeightChart();
    
    document.getElementById('weight-input').value = '';
    alert("Pesée enregistrée ! 📈");
}

function renderWeightChart() {
    const canvas = document.getElementById('weightChart');
    if(!canvas) return;
    
    weightHistory.sort((a,b) => new Date(a.date) - new Date(b.date));
    const labels = weightHistory.map(item => new Date(item.date).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' }));
    const data = weightHistory.map(item => item.weight);

    if (weightChartInstance) weightChartInstance.destroy();

    const lineColor = darkModeActive ? '#D4A373' : '#2C2520';
    const bgColor = darkModeActive ? 'rgba(212, 163, 115, 0.1)' : 'rgba(44, 37, 32, 0.05)';

    weightChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Poids (kg)',
                data: data,
                borderColor: lineColor,
                backgroundColor: bgColor,
                borderWidth: 2,
                tension: 0.25,
                fill: true,
                pointBackgroundColor: lineColor
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { grid: { color: darkModeActive ? '#333' : '#EADFC9' }, ticks: { color: darkModeActive ? '#AAA' : '#666' } },
                x: { grid: { display: false }, ticks: { color: darkModeActive ? '#AAA' : '#666' } }
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
    const walkEl = document.getElementById('walk-current-text');
    if(waterEl) waterEl.innerText = `${dailyTrackers.water} ml`;
    if(walkEl) walkEl.innerText = `${dailyTrackers.walk} min`;
}

window.addWater = function() { dailyTrackers.water += 250; saveLocalData(currentPetId, 'daily', dailyTrackers); updateTrackersUI(); };
window.addWalk = function() { dailyTrackers.walk += 15; saveLocalData(currentPetId, 'daily', dailyTrackers); updateTrackersUI(); };
window.resetDailyTrackers = function() { dailyTrackers.water = 0; dailyTrackers.walk = 0; saveLocalData(currentPetId, 'daily', dailyTrackers); updateTrackersUI(); };

// ==========================================
// CARNET & RAPPELS
// ==========================================
function initMedicalRecords() {
    medicalEvents = getLocalData(currentPetId, 'medical', []);
    renderMedicalHistory();
    renderReminders();
}

window.addMedicalEvent = function() {
    const type = document.getElementById('event-type').value;
    const date = document.getElementById('event-date').value;
    if (!date) return alert("Sélectionnez une date.");
    medicalEvents.push({ type, date });
    saveLocalData(currentPetId, 'medical', medicalEvents);
    renderMedicalHistory(); renderReminders();
    document.getElementById('event-date').value = '';
};

function renderMedicalHistory() {
    const list = document.getElementById('medical-history-list');
    if(!list) return; list.innerHTML = '';
    const sorted = [...medicalEvents].sort((a,b) => new Date(b.date) - new Date(a.date));
    sorted.forEach(ev => {
        const item = document.createElement('div'); item.className = 'health-log-item';
        item.innerHTML = `<span>${ev.type}</span><strong>${new Date(ev.date).toLocaleDateString()}</strong>`;
        list.appendChild(item);
    });
}

window.clearMedicalHistory = function() {
    if(confirm(`Vider l'historique de ${petProfile.name} ?`)) { 
        medicalEvents = []; 
        saveLocalData(currentPetId, 'medical', medicalEvents); 
        renderMedicalHistory(); renderReminders(); 
    }
};

function renderReminders() {
    const container = document.getElementById('dynamic-reminders-list');
    if(!container) return; container.innerHTML = '';
    const rules = { 'Vaccin': 365, 'Vermifuge': 90, 'Anti-puces': 30 };
    
    Object.keys(rules).forEach(type => {
        const eventsOfType = medicalEvents.filter(e => e.type === type);
        let lastDate = eventsOfType.length > 0 ? new Date(eventsOfType.sort((a,b) => new Date(b.date) - new Date(a.date))[0].date) : null;
        let daysPass = lastDate ? Math.ceil(Math.abs(new Date() - lastDate) / 86400000) : 999;
        
        if (!lastDate || daysPass > rules[type]) {
            const reminderDiv = document.createElement('div'); reminderDiv.className = 'reminder-item main-card';
            reminderDiv.innerHTML = `<div class="reminder-info"><h4>${type} requis</h4><span>Dernier : ${lastDate ? lastDate.toLocaleDateString() : 'Jamais'}</span></div><span class="alert-badge danger">À FAIRE</span>`;
            container.appendChild(reminderDiv);
        }
    });
    if(container.innerHTML === '') container.innerHTML = `<p style="color: #777; font-size: 14px; text-align:center;">Tout est à jour ! ✨</p>`;
}

// ==========================================
// 🔥 MODULE : CARNET D'ÉDUCATION COMPLET
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
    const allExercises = [...DEFAULT_EDU_EXERCISES, ...customExercises];
    
    allExercises.forEach(ex => {
        const currentLevel = educationData[ex.id] || 0; 
        
        const card = document.createElement('div');
        card.style.display = 'flex';
        card.style.justifyContent = 'space-between';
        card.style.alignItems = 'center';
        card.style.padding = '12px 15px';
        card.style.borderRadius = '12px';
        card.style.backgroundColor = 'var(--main-card-bg)';
        card.style.border = '1px solid var(--border-color)';
        
        card.innerHTML = `
            <div style="display:flex; align-items:center; gap:12px; flex:1;">
                <div style="width:35px; height:35px; border-radius:50%; background:var(--accent-light); display:flex; justify-content:center; align-items:center; color:var(--accent);">
                    <i class="fa-solid ${ex.icon || 'fa-star'}"></i>
                </div>
                <h4 style="margin:0; font-size:14px; color:var(--text-color); font-weight:600;">${ex.name}</h4>
            </div>
            <div>
                <select onchange="updateEduLevel('${ex.id}', this.value)" style="padding:6px 10px; border-radius:8px; border:1px solid var(--border-color); font-size:13px; background:var(--main-card-bg); color:var(--text-color); font-weight:500; cursor:pointer;">
                    <option value="0" ${currentLevel === 0 ? 'selected' : ''}>⚪ À commencer</option>
                    <option value="1" ${currentLevel === 1 ? 'selected' : ''}>🟡 En cours</option>
                    <option value="2" ${currentLevel === 2 ? 'selected' : ''}>🟢 Acquis</option>
                    <option value="3" ${currentLevel === 3 ? 'selected' : ''}>🏆 Maîtrisé</option>
                </select>
            </div>
        `;
        container.appendChild(card);
    });
}

window.updateEduLevel = async function(exerciseId, levelValue) {
    educationData[exerciseId] = parseInt(levelValue);
    await saveLocalData(currentPetId, 'education', educationData);
    console.log(`Exercice ${exerciseId} synchronisé au niveau ${levelValue}`);
};

window.addCustomExercise = async function() {
    const input = document.getElementById('new-custom-exercise-input');
    if (!input) return;
    
    const exerciseName = input.value.trim();
    if (!exerciseName) return alert("Veuillez entrer le nom d'un exercice. 🐾");
    
    const exerciseId = 'custom_' + Date.now();
    const customExercises = getLocalData(currentPetId, 'custom_exercises', []);
    
    customExercises.push({
        id: exerciseId,
        name: exerciseName,
        icon: 'fa-star' 
    });
    
    await saveLocalData(currentPetId, 'custom_exercises', customExercises);
    input.value = '';
    renderEducation();
};

// ==========================================
// SUIVI DE BUDGET
// ==========================================
function initBudgetTracker() {
    budgetExpenses = getLocalData(currentPetId, 'budget', []);
    updateBudgetUI();
}

function updateBudgetUI() {
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    
    const monthExpenses = budgetExpenses.filter(expense => {
        const expDate = new Date(expense.date);
        return expDate.getMonth() === currentMonth && expDate.getFullYear() === currentYear;
    });

    const total = monthExpenses.reduce((sum, expense) => sum + expense.amount, 0);
    const formattedTotal = total.toFixed(2).replace('.', ',') + " €";

    const updateEl = (id, text) => { const el = document.getElementById(id); if(el) el.innerText = text; };
    updateEl('home-budget-total', formattedTotal);
    updateEl('home-budget-pet-name', petProfile.name);
    updateEl('budget-screen-total', formattedTotal);
    
    renderBudgetHistory(monthExpenses);
}

function renderBudgetHistory(expenses) {
    const list = document.getElementById('budget-history-list');
    if (!list) return;
    list.innerHTML = '';
    
    [...expenses].sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(expense => {
        const item = document.createElement('div');
        item.className = 'budget-item';
        item.innerHTML = `<span class="budget-item-title">${expense.title}</span>
                          <div><span class="budget-item-amount">${expense.amount.toFixed(2)} €</span>
                          <span style="color: #888; font-size: 12px; margin-left:10px;">${new Date(expense.date).toLocaleDateString('fr-FR', {day:'numeric',month:'short'})}</span></div>`;
        list.appendChild(item);
    });
}

window.addBudgetExpense = function() {
    const title = document.getElementById('budget-title').value.trim();
    const amount = parseFloat(document.getElementById('budget-amount').value);
    if (!title || !amount || amount <= 0) return alert("Valeurs invalides.");

    budgetExpenses.push({ id: Date.now(), title: title, amount: amount, date: new Date().toISOString() });
    saveLocalData(currentPetId, 'budget', budgetExpenses);
    updateBudgetUI();
    document.getElementById('budget-title').value = '';
    document.getElementById('budget-amount').value = '';
};

// ==========================================
// CHAT SECURISE ADAPTE POUR GEMINI 1.5 FLASH
// ==========================================
function initChat() {
    chatHistory = getLocalData(currentPetId, 'chat', [{ sender: 'bot', text: `Wouf ! Je suis l'assistant de ${petProfile.name}. Comment puis-je vous aider aujourd'hui ?` }]);
    renderChat();
}

function renderChat() {
    const container = document.getElementById('chat-messages-container');
    if (!container) return;
    container.innerHTML = '';

    chatHistory.forEach(msg => {
        const msgDiv = document.createElement('div');
        if (msg.sender === 'bot') {
            msgDiv.className = 'msg msg-bot';
            const initial = petProfile.name ? petProfile.name.charAt(0).toUpperCase() : 'A';
            msgDiv.innerHTML = `<div class="chat-avatar-container">${initial}</div><div class="msg-content">${msg.text}</div>`;
        } else {
            msgDiv.className = 'msg msg-user';
            msgDiv.innerHTML = `<div class="msg-content">${msg.text}</div>`;
        }
        container.appendChild(msgDiv);
    });
    container.scrollTop = container.scrollHeight;
}

window.askPreset = (questionText) => {
    document.getElementById('chat-input-field').value = questionText;
    window.sendMessage();
};

window.sendMessage = async () => {
    const input = document.getElementById('chat-input-field');
    const text = input.value.trim();
    if (!text) return;

    chatHistory.push({ sender: 'user', text: text });
    input.value = '';
    renderChat();

    const botLoadingMsgId = Date.now();
    chatHistory.push({ sender: 'bot', text: '...', id: botLoadingMsgId });
    renderChat();

    // Prompt système adapté aux spécificités de l'animal
    const systemPrompt = `Tu es l'assistant intelligent de l'application Pablo. Tu aides le propriétaire de l'animal suivant : Nom: ${petProfile.name}, Espèce: ${petProfile.species}, Race: ${petProfile.breed}, Âge: ${petProfile.age} mois, Poids: ${petProfile.weight} kg. Donne des conseils précis, chaleureux, bienveillants et termine tes phrases de manière amusante par un petit wouf ou miaou en fonction de l'espèce.`;

    try {
        const response = await fetch("/api/mammouth-proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                systemInstruction: systemPrompt, // Attribut d'instruction système de Gemini
                messages: [{ content: text }]     // Envoi du message utilisateur
            })
        });

        const data = await response.json();
        
        if (data.error) {
            const errorMsg = typeof data.error === 'object' ? (data.error.message || JSON.stringify(data.error)) : data.error;
            throw new Error(errorMsg);
        }
        
        chatHistory = chatHistory.filter(msg => msg.id !== botLoadingMsgId);
        chatHistory.push({ sender: 'bot', text: data.choices[0].message.content });
        renderChat();
        saveLocalData(currentPetId, 'chat', chatHistory);

    } catch (e) {
        console.error("❌ Erreur proxy Gemini:", e);
        chatHistory = chatHistory.filter(msg => msg.id !== botLoadingMsgId);
        chatHistory.push({ sender: 'bot', text: `Une erreur est survenue lors de la communication avec Gemini : ${e.message}` });
        renderChat();
    }
};

// ==========================================
// NOTIFICATIONS ET NAVIGATION RETOUCHÉE
// ==========================================
window.requestNotificationPermission = () => {
    if (!("Notification" in window)) return alert("Votre navigateur ne prend pas en charge les notifications.");
    Notification.requestPermission().then(permission => {
        if (permission === "granted") {
            const btn = document.getElementById('btn-enable-notifications');
            if (btn) {
                btn.innerHTML = '<i class="fa-solid fa-check"></i> Notifications activées !';
                btn.style.borderColor = '#47d175';
                btn.style.color = '#47d175';
                btn.disabled = true;
            }
            new Notification("Félicitations !", { body: "Les rappels sont actifs.", icon: '/pablo.jpg' });
        }
    });
};

window.exportToPDF = () => window.print();

window.navigateTo = (screenId) => {
    document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    
    const navBtns = document.querySelectorAll(`[onclick="navigateTo('${screenId}')"]`);
    navBtns.forEach(btn => btn.classList.add('active'));

    const titles = {
        'screen-home': "Vue d'ensemble", 
        'screen-health': "Poids & Santé", 
        'screen-edu': "Carnet d'Éducation", 
        'screen-budget': "Suivi Budget", 
        'screen-chat': "Hey Pablo", 
        'screen-profile': "Configuration"
    };
    const titleEl = document.getElementById('page-title');
    if(titleEl && titles[screenId]) titleEl.innerText = titles[screenId];
    if(screenId === 'screen-health') setTimeout(() => renderWeightChart(), 50);
};

// EXPORTS GLOBAUX
window.switchPet = switchPet;
window.createNewPet = createNewPet;
window.confirmCreateNewPet = confirmCreateNewPet;
window.closePetModal = closePetModal;
window.toggleDarkMode = toggleDarkMode;
window.updateNutritionUI = updateNutritionUI;
window.addNewWeight = addNewWeight;
window.uploadPetPhoto = uploadPetPhoto;
window.savePetProfile = savePetProfile;
window.deleteCurrentPet = deleteCurrentPet;
window.navigateTo = navigateTo;