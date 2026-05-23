import { GoogleGenerativeAI } from "@google/generative-ai";
// --- IMPORTS FIREBASE ---
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from "firebase/auth";

// ==========================================
// CONFIGURATION GLOBALE & IA
// ==========================================
const GEMINI_API_KEY = "AIzaSyDcwF6m35xKJsJmzAitIF8LomPzsck_7jg";

// ==========================================
// CONFIGURATION FIREBASE
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyBuz7iwOzeEFsFDU1G5aAe69JCczaduI44",
  authDomain: "pablo-app-f6057.firebaseapp.com",
  projectId: "pablo-app-f6057",
  storageBucket: "pablo-app-f6057.firebasestorage.app",
  messagingSenderId: "764832752787",
  appId: "1:764832752787:web:21948ed789665c531b9966",
  measurementId: "G-RE0F1KKEK3"
};

// Initialisation unique de Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);


const GLOBAL_CONFIG_ID = "pablo_global_config";

// GESTION MULTI-CHIENS (Base locale)
let petsList = [];
let currentPetId = null;

// VARIABLES GLOBALES DE L'ANIMAL ACTUEL
let petProfile = {};
let weightHistory = [];
let medicalEvents = [];
let dailyTrackers = {};
let chatHistory = [];
let budgetExpenses = [];

let weightChartInstance = null;
let darkModeActive = false;
let isLoginMode = true;

// ==========================================
// GESTION DE L'AUTHENTIFICATION FIREBASE
// ==========================================

// Écouteur en temps réel de l'état de connexion
onAuthStateChanged(auth, (user) => {
    const authPage = document.getElementById('auth-page');
    const mainApp = document.getElementById('main-app-layout');
    const landing = document.getElementById('landing-page');
    
    if (user) {
        // Utilisateur connecté ! On cache les écrans d'accueil/connexion et on montre l'app
        console.log("🟢 Connecté :", user.email);
        if(landing) landing.style.display = 'none';
        if(authPage) authPage.style.display = 'none';
        if(mainApp) {
            mainApp.style.display = 'flex';
            setTimeout(() => { if (typeof renderWeightChart === 'function') renderWeightChart(); }, 150);
        }
    } else {
        // Personne n'est connecté. On laisse l'UI gérer si on affiche la landing ou la page de co.
        console.log("🔴 Déconnecté.");
        if(mainApp) mainApp.style.display = 'none';
    }
});

// Appelé par le bouton "Lancer le Dashboard" de la Landing Page
window.enterApp = function() {
    const landing = document.getElementById('landing-page');
    const authPage = document.getElementById('auth-page');
    
    if (landing) landing.style.display = 'none';
    
    // Si on n'est pas connecté, on affiche l'écran de connexion
    if (!auth.currentUser && authPage) {
        authPage.style.display = 'flex';
    }
};

window.toggleAuthMode = function() {
    isLoginMode = !isLoginMode;
    const btn = document.getElementById('auth-action-btn');
    const subtitle = document.getElementById('auth-subtitle');
    const switchText = document.getElementById('auth-switch-text');
    const switchLink = document.querySelector('.auth-switch a');

    if (isLoginMode) {
        btn.innerText = "Se connecter";
        subtitle.innerText = "Connectez-vous pour retrouver votre compagnon.";
        switchText.innerText = "Pas encore de compte ?";
        switchLink.innerText = "Créer un compte";
    } else {
        btn.innerText = "Créer mon compte";
        subtitle.innerText = "Rejoignez la meute et gérez la santé de votre chien.";
        switchText.innerText = "Déjà un compte ?";
        switchLink.innerText = "Se connecter";
    }
};

// Connexion / Inscription Classique (Email + MDP)
window.processAuth = function() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value.trim();

    if (!email || !password) return alert("Veuillez remplir tous les champs. 🐾");
    if (password.length < 6) return alert("Le mot de passe doit faire au moins 6 caractères.");

    const btn = document.getElementById('auth-action-btn');
    const originalText = btn.innerText;
    btn.innerText = "Chargement...";

    if (isLoginMode) {
        signInWithEmailAndPassword(auth, email, password)
            .then(() => { btn.innerText = originalText; })
            .catch((error) => {
                btn.innerText = originalText;
                alert("Erreur de connexion : Vérifiez vos identifiants.");
                console.error(error);
            });
    } else {
        createUserWithEmailAndPassword(auth, email, password)
            .then(() => { 
                btn.innerText = originalText; 
                alert("Compte créé avec succès ! Bienvenue ! 🎉");
            })
            .catch((error) => {
                btn.innerText = originalText;
                alert("Erreur lors de l'inscription : " + error.message);
                console.error(error);
            });
    }
};

// Connexion avec Google
window.processGoogleAuth = function() {
    const provider = new GoogleAuthProvider();
    signInWithPopup(auth, provider)
        .then((result) => {
            console.log("Google Auth OK:", result.user.email);
            // La redirection est automatique grâce à onAuthStateChanged
        })
        .catch((error) => {
            alert("Erreur avec Google : " + error.message);
            console.error(error);
        });
};

// Déconnexion
window.logoutApp = function() {
    signOut(auth).then(() => {
        location.reload(); // Rafraîchit l'app pour tout remettre à zéro
    }).catch((error) => {
        console.error("Erreur déconnexion:", error);
    });
};

// ==========================================
// INITIALISATION DE L'APPLICATION
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
});

// ==========================================
// MODE SOMBRE
// ==========================================
function initGlobalConfig() {
    const config = localStorage.getItem(GLOBAL_CONFIG_ID);
    if (config) {
        const parsed = JSON.parse(config);
        darkModeActive = parsed.darkMode || false;
    }
    applyTheme();
}

function applyTheme() {
    const container = document.querySelector('.app-container');
    const mainAppLayout = document.getElementById('main-app-layout');
    
    if (darkModeActive) {
        if(container) container.classList.add('dark-mode');
        if(mainAppLayout) mainAppLayout.classList.add('dark-mode');
        document.body.classList.add('dark-mode');
    } else {
        if(container) container.classList.remove('dark-mode');
        if(mainAppLayout) mainAppLayout.classList.remove('dark-mode');
        document.body.classList.remove('dark-mode');
    }
    renderWeightChart();
}

function toggleDarkMode() {
    darkModeActive = !darkModeActive;
    localStorage.setItem(GLOBAL_CONFIG_ID, JSON.stringify({ darkMode: darkModeActive }));
    applyTheme();
}

// ==========================================
// LOGIQUE D'AMORÇAGE (Données Locales)
// ==========================================
function initApp() {
    const savedPets = localStorage.getItem('app_pets_list');
    if (savedPets) petsList = JSON.parse(savedPets);

    if (petsList.length === 0) {
        const defaultId = 'pet_' + Date.now();
        petsList.push({ id: defaultId, name: 'Pablo' });
        localStorage.setItem('app_pets_list', JSON.stringify(petsList));
        
        petProfile = { name: "Pablo", breed: "Berger Allemand", age: 14, size: 65, weight: 31.5, avatar: "" };
        localStorage.setItem(`profile_${defaultId}`, JSON.stringify(petProfile));
        localStorage.setItem(`weight_${defaultId}`, JSON.stringify([{ date: new Date().toISOString().split('T')[0], weight: 31.5 }]));
        
        currentPetId = defaultId;
        localStorage.setItem('current_pet_id', currentPetId);
    } else {
        currentPetId = localStorage.getItem('current_pet_id') || petsList[0].id;
    }

    renderPetSelector();
    loadCurrentPetData();
}

function renderPetSelector() {
    const selector = document.getElementById('pet-selector');
    if(!selector) return;
    selector.innerHTML = '';
    petsList.forEach(pet => {
        const option = document.createElement('option');
        option.value = pet.id;
        option.textContent = pet.name;
        if(pet.id === currentPetId) option.selected = true;
        selector.appendChild(option);
    });
}

function switchPet(petId) {
    currentPetId = petId;
    localStorage.setItem('current_pet_id', currentPetId);
    loadCurrentPetData();
    navigateTo('screen-home');
}

function createNewPet() {
    const name = prompt("Quel est le nom de votre nouveau compagnon ?");
    if (!name || name.trim() === "") return;
    
    const newId = 'pet_' + Date.now();
    petsList.push({ id: newId, name: name });
    localStorage.setItem('app_pets_list', JSON.stringify(petsList));
    
    const newProfile = { name: name, breed: "", age: 0, size: 0, weight: 0, avatar: "" };
    localStorage.setItem(`profile_${newId}`, JSON.stringify(newProfile));
    localStorage.setItem(`weight_${newId}`, JSON.stringify([]));
    localStorage.setItem(`medical_${newId}`, JSON.stringify([]));
    localStorage.setItem(`daily_${newId}`, JSON.stringify({water: 0, walk: 0, date: new Date().toISOString().split('T')[0]}));
    localStorage.setItem(`chat_${newId}`, JSON.stringify([{sender: 'bot', text: `Wouf ! Je suis l'assistant de ${name}.`}]));
    localStorage.setItem(`budget_${newId}`, JSON.stringify([]));

    switchPet(newId);
}

function loadCurrentPetData() {
    initPetProfile();
    initWeightHistory();
    initMedicalRecords();
    initDailyTrackers();
    initChat();
    initBudgetTracker();
}

function deleteCurrentPet() {
    if (!confirm(`⚠️ Êtes-vous sûr de vouloir supprimer ${petProfile.name} ?`)) return;

    const keys = [`profile_${currentPetId}`, `weight_${currentPetId}`, `medical_${currentPetId}`, `daily_${currentPetId}`, `chat_${currentPetId}`, `budget_${currentPetId}`];
    keys.forEach(key => localStorage.removeItem(key));

    petsList = petsList.filter(pet => pet.id !== currentPetId);
    localStorage.setItem('app_pets_list', JSON.stringify(petsList));

    if(petsList.length === 0) {
        currentPetId = null;
        localStorage.removeItem('current_pet_id');
        initApp();
    } else {
        switchPet(petsList[0].id);
    }
}

// ==========================================
// PROFIL
// ==========================================
function initPetProfile() {
    const savedProfile = localStorage.getItem(`profile_${currentPetId}`);
    if (savedProfile) petProfile = JSON.parse(savedProfile);

    const titleHeader = document.getElementById('header-pet-name');
    if (titleHeader) titleHeader.innerHTML = `PABLO<span>.</span>`; 
    
    const breedDisplay = document.getElementById('header-pet-breed');
    if (breedDisplay) breedDisplay.innerText = petProfile.breed || "Race non définie";
    
    const welcomeName = document.getElementById('welcome-pet-name');
    if (welcomeName) welcomeName.innerText = petProfile.name;
    
    const topDisplay = document.getElementById('current-pet-display-top');
    if (topDisplay) topDisplay.innerText = petProfile.name;

    const sidebarImg = document.getElementById('sidebar-pet-image');
    const sidebarPlaceholder = document.getElementById('sidebar-placeholder');
    const profileImg = document.getElementById('profile-pet-image');
    const profilePlaceholder = document.getElementById('profile-avatar-placeholder');
    
    if (petProfile.avatar) {
        if(sidebarImg) { sidebarImg.src = petProfile.avatar; sidebarImg.style.display = 'block'; }
        if(sidebarPlaceholder) sidebarPlaceholder.style.display = 'none';
        if(profileImg) { profileImg.src = petProfile.avatar; profileImg.style.display = 'block'; }
        if(profilePlaceholder) profilePlaceholder.style.display = 'none';
    } else {
        if(sidebarImg) sidebarImg.style.display = 'none';
        if(sidebarPlaceholder) { sidebarPlaceholder.style.display = 'flex'; sidebarPlaceholder.innerText = petProfile.name.charAt(0).toUpperCase(); }
        if(profileImg) profileImg.style.display = 'none';
        if(profilePlaceholder) { profilePlaceholder.style.display = 'flex'; profilePlaceholder.innerText = petProfile.name.charAt(0).toUpperCase(); }
    }

    const fName = document.getElementById('profile-name'); if(fName) fName.value = petProfile.name;
    const fBreed = document.getElementById('profile-breed'); if(fBreed) fBreed.value = petProfile.breed;
    const fAge = document.getElementById('profile-age'); if(fAge) fAge.value = petProfile.age || "";
    const fSize = document.getElementById('profile-size'); if(fSize) fSize.value = petProfile.size || "";
    const fWeight = document.getElementById('profile-weight'); if(fWeight) fWeight.value = petProfile.weight || "";
}

function savePetProfile() {
    const name = document.getElementById('profile-name').value.trim();
    const breed = document.getElementById('profile-breed').value.trim();
    const age = document.getElementById('profile-age').value;
    const size = document.getElementById('profile-size').value;
    const weight = document.getElementById('profile-weight').value;

    if (!name) return alert("Le nom est obligatoire.");

    petProfile.name = name;
    petProfile.breed = breed;
    petProfile.age = parseInt(age) || 0;
    petProfile.size = parseInt(size) || 0;
    
    if(weight && parseFloat(weight) !== petProfile.weight) {
        weightHistory.push({ date: new Date().toISOString().split('T')[0], weight: parseFloat(weight) });
        localStorage.setItem(`weight_${currentPetId}`, JSON.stringify(weightHistory));
    }

    localStorage.setItem(`profile_${currentPetId}`, JSON.stringify(petProfile));
    
    const petObj = petsList.find(p => p.id === currentPetId);
    if(petObj) {
        petObj.name = name;
        localStorage.setItem('app_pets_list', JSON.stringify(petsList));
        renderPetSelector();
    }

    loadCurrentPetData();
    alert(`Profil de ${name} enregistré ! 🐾`);
    navigateTo('screen-home');
}

function uploadPetPhoto() {
    const fileInput = document.getElementById('file-upload-input');
    const file = fileInput.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onloadend = function() {
            petProfile.avatar = reader.result;
            if(document.getElementById('profile-pet-image')) {
                document.getElementById('profile-pet-image').src = reader.result;
                document.getElementById('profile-pet-image').style.display = 'block';
            }
            if(document.getElementById('profile-avatar-placeholder')) {
                document.getElementById('profile-avatar-placeholder').style.display = 'none';
            }
        }
        reader.readAsDataURL(file);
    }
}

// ==========================================
// POIDS ET NUTRITION INTELLIGENTE
// ==========================================
function initWeightHistory() {
    const savedHistory = localStorage.getItem(`weight_${currentPetId}`);
    if (savedHistory) weightHistory = JSON.parse(savedHistory);
    else weightHistory = [];
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
    localStorage.setItem(`profile_${currentPetId}`, JSON.stringify(petProfile));

    if (nutritionWeightText) nutritionWeightText.innerText = latestPesee.toFixed(1) + " kg";
    updateNutritionUI();

    const waterTarget = Math.round(latestPesee * 55);
    if (waterTargetText) waterTargetText.innerText = `Objectif : ${waterTarget} ml`;
}

async function updateNutritionUI() {
    const nutritionRationText = document.getElementById('nutrition-ration-text');
    const activityLevel = document.getElementById('activity-level-selector');
    
    if (!petProfile.weight || !petProfile.breed || !nutritionRationText || !activityLevel) return;

    nutritionRationText.style.fontSize = "16px";
    nutritionRationText.innerText = "Calcul IA en cours...";

    // Si pas de clé IA, calcul local automatique discret
    if (!GEMINI_API_KEY || GEMINI_API_KEY === "TA_CLE_GEMINI_ICI" || GEMINI_API_KEY === "") {
        let backupRation = Math.round(petProfile.weight * 13.5);
        if (activityLevel.value === 'calm') backupRation *= 0.85;
        if (activityLevel.value === 'active') backupRation *= 1.15;
        nutritionRationText.style.fontSize = "";
        nutritionRationText.innerText = Math.round(backupRation) + " g";
        return;
    }

    const promptNutrition = `En tant qu'expert vétérinaire canin, calcule la ration de croquettes quotidienne idéale (en grammes) pour un chien avec ces caractéristiques précises :
    - Race : ${petProfile.breed}
    - Poids : ${petProfile.weight} kg
    - Âge : ${petProfile.age} mois
    - Niveau d'activité : ${activityLevel.value} (calm, normal, active)

    Réponds UNIQUEMENT et OBLIGATOIREMENT par le nombre de grammes, suivi de la lettre 'g'. Aucun autre texte, aucune phrase, aucune formule. Exemple de réponse attendue : 420g`;

    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(promptNutrition);
        const reply = result.response.text().trim();
        nutritionRationText.style.fontSize = ""; 
        nutritionRationText.innerText = reply;
    } catch (e) {
        console.error("❌ Erreur calcul nutrition IA:", e);
        // En cas de coupure réseau, affichage propre de la ration estimée
        let backupRation = Math.round(petProfile.weight * 13.5);
        if (activityLevel.value === 'calm') backupRation *= 0.85;
        if (activityLevel.value === 'active') backupRation *= 1.15;
        nutritionRationText.style.fontSize = "";
        nutritionRationText.innerText = Math.round(backupRation) + " g";
    }
}
function addNewWeight() {
    const weightVal = parseFloat(document.getElementById('weight-input').value);
    const dateVal = document.getElementById('weight-date').value;

    if(!weightVal || !dateVal || weightVal <= 0) return alert("Veuillez entrer des valeurs valides.");

    weightHistory.push({ date: dateVal, weight: weightVal });
    localStorage.setItem(`weight_${currentPetId}`, JSON.stringify(weightHistory));
    
    updateWeightUI();
    renderWeightChart();
    
    document.getElementById('weight-input').value = '';
    alert("Pesée enregistrée ! 📈");
}

function renderWeightChart() {
    const canvas = document.getElementById('weightChart');
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    
    weightHistory.sort((a,b) => new Date(a.date) - new Date(b.date));

    const labels = weightHistory.map(item => new Date(item.date).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' }));
    const data = weightHistory.map(item => item.weight);

    if (weightChartInstance) weightChartInstance.destroy();

    const lineColor = darkModeActive ? '#D4A373' : '#2C2520';
    const bgColor = darkModeActive ? 'rgba(212, 163, 115, 0.1)' : 'rgba(44, 37, 32, 0.05)';

    weightChartInstance = new Chart(ctx, {
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
    const savedTrackers = localStorage.getItem(`daily_${currentPetId}`);
    const today = new Date().toISOString().split('T')[0];

    if (savedTrackers) {
        dailyTrackers = JSON.parse(savedTrackers);
        if (dailyTrackers.date !== today) {
            dailyTrackers = { water: 0, walk: 0, date: today };
            localStorage.setItem(`daily_${currentPetId}`, JSON.stringify(dailyTrackers));
        }
    } else {
        dailyTrackers = { water: 0, walk: 0, date: today };
        localStorage.setItem(`daily_${currentPetId}`, JSON.stringify(dailyTrackers));
    }
    updateTrackersUI();
}

function updateTrackersUI() {
    const waterEl = document.getElementById('water-current-text');
    const walkEl = document.getElementById('walk-current-text');
    if(waterEl) waterEl.innerText = `${dailyTrackers.water} ml`;
    if(walkEl) walkEl.innerText = `${dailyTrackers.walk} min`;
}

function addWater() { dailyTrackers.water += 250; localStorage.setItem(`daily_${currentPetId}`, JSON.stringify(dailyTrackers)); updateTrackersUI(); }
function addWalk() { dailyTrackers.walk += 15; localStorage.setItem(`daily_${currentPetId}`, JSON.stringify(dailyTrackers)); updateTrackersUI(); }
function resetDailyTrackers() { dailyTrackers.water = 0; dailyTrackers.walk = 0; localStorage.setItem(`daily_${currentPetId}`, JSON.stringify(dailyTrackers)); updateTrackersUI(); }

// ==========================================
// CARNET & RAPPELS
// ==========================================
function initMedicalRecords() {
    const localEvents = localStorage.getItem(`medical_${currentPetId}`);
    medicalEvents = localEvents ? JSON.parse(localEvents) : [];
    renderMedicalHistory();
    renderReminders();
}

function addMedicalEvent() {
    const type = document.getElementById('event-type').value;
    const date = document.getElementById('event-date').value;
    if (!date) return alert("Sélectionnez une date.");
    medicalEvents.push({ type, date });
    localStorage.setItem(`medical_${currentPetId}`, JSON.stringify(medicalEvents));
    renderMedicalHistory(); renderReminders();
    document.getElementById('event-date').value = '';
}

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

function clearMedicalHistory() {
    if(confirm(`Vider l'historique de ${petProfile.name} ?`)) { 
        medicalEvents = []; 
        localStorage.setItem(`medical_${currentPetId}`, JSON.stringify(medicalEvents)); 
        renderMedicalHistory(); renderReminders(); 
    }
}

function renderReminders() {
    const container = document.getElementById('dynamic-reminders-list');
    if(!container) return; container.innerHTML = '';
    const rules = { 'Vaccin': 365, 'Vermifuge': 90, 'Anti-puces': 30 };
    const types = ['Vaccin', 'Vermifuge', 'Anti-puces'];
    
    types.forEach(type => {
        const eventsOfType = medicalEvents.filter(e => e.type === type);
        let lastDate = null;
        if(eventsOfType.length > 0) lastDate = new Date(eventsOfType.sort((a,b) => new Date(b.date) - new Date(a.date))[0].date);
        let daysPass = 999; 
        if(lastDate) daysPass = Math.ceil(Math.abs(new Date() - lastDate) / 86400000);
        if (!lastDate || daysPass > rules[type]) {
            const reminderDiv = document.createElement('div'); reminderDiv.className = 'reminder-item main-card';
            reminderDiv.innerHTML = `<div class="reminder-info"><h4>${type} requis</h4><span>Dernier : ${lastDate ? lastDate.toLocaleDateString() : 'Jamais'}</span></div><span class="alert-badge danger">À FAIRE</span>`;
            container.appendChild(reminderDiv);
        }
    });
    if(container.innerHTML === '') container.innerHTML = `<p style="color: #777; font-size: 14px; text-align:center;">Tout est à jour ! ✨</p>`;
}

// ==========================================
// SUIVI DE BUDGET
// ==========================================
function initBudgetTracker() {
    const localBudget = localStorage.getItem(`budget_${currentPetId}`);
    budgetExpenses = localBudget ? JSON.parse(localBudget) : [];
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

    const ht = document.getElementById('home-budget-total'); if(ht) ht.innerText = formattedTotal;
    const hn = document.getElementById('home-budget-pet-name'); if(hn) hn.innerText = petProfile.name;
    const st = document.getElementById('budget-screen-total'); if(st) st.innerText = formattedTotal;
    
    renderBudgetHistory(monthExpenses);
}

function renderBudgetHistory(expenses) {
    const list = document.getElementById('budget-history-list');
    if (!list) return;
    list.innerHTML = '';
    const sorted = [...expenses].sort((a, b) => new Date(b.date) - new Date(a.date));

    sorted.forEach(expense => {
        const item = document.createElement('div');
        item.className = 'budget-item';
        item.innerHTML = `<span class="budget-item-title">${expense.title}</span>
                          <div><span class="budget-item-amount">${expense.amount.toFixed(2)} €</span>
                          <span style="color: #888; font-size: 12px; margin-left:10px;">${new Date(expense.date).toLocaleDateString('fr-FR', {day:'numeric',month:'short'})}</span></div>`;
        list.appendChild(item);
    });
}

function addBudgetExpense() {
    const title = document.getElementById('budget-title').value.trim();
    const amount = parseFloat(document.getElementById('budget-amount').value);
    if (!title || !amount || amount <= 0) return alert("Valeurs invalides.");

    budgetExpenses.push({ id: Date.now(), title: title, amount: amount, date: new Date().toISOString() });
    localStorage.setItem(`budget_${currentPetId}`, JSON.stringify(budgetExpenses));
    updateBudgetUI();
    document.getElementById('budget-title').value = '';
    document.getElementById('budget-amount').value = '';
}

// ==========================================
// CHAT IA - GOOGLE GEMINI SDK
// ==========================================
function initChat() {
    const localHistory = localStorage.getItem(`chat_${currentPetId}`);
    if (localHistory) {
        chatHistory = JSON.parse(localHistory);
    } else {
        chatHistory = [{ sender: 'bot', text: `Wouf ! Je suis l'assistant de ${petProfile.name}. Comment puis-je aider ?` }];
        localStorage.setItem(`chat_${currentPetId}`, JSON.stringify(chatHistory));
    }
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

window.askPreset = function(questionText) {
    document.getElementById('chat-input-field').value = questionText;
    sendMessage();
};

window.sendMessage = async function() {
    const input = document.getElementById('chat-input-field');
    const text = input.value.trim();
    if (!text) return;

    chatHistory.push({ sender: 'user', text: text });
    input.value = '';
    renderChat();

    if (!GEMINI_API_KEY || GEMINI_API_KEY === "TA_CLE_GEMINI_ICI" || GEMINI_API_KEY === "") {
        setTimeout(() => {
            let reply = `Simulation locale : Veuillez injecter une clé API Gemini valide en haut de app.js. 🐾`;
            chatHistory.push({ sender: 'bot', text: reply });
            renderChat();
        }, 800);
        return;
    }

    const botLoadingMsgId = Date.now();
    chatHistory.push({ sender: 'bot', text: '...', id: botLoadingMsgId });
    renderChat();

    const systemPrompt = `Tu es l'assistant vétérinaire de l'application Pablo. Tu aides le maître de : ${petProfile.name}, Race: ${petProfile.breed}, Âge: ${petProfile.age} mois, Poids: ${petProfile.weight} kg. Sois très concis, bienveillant et finis toujours par un wouf !`;

    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash",
            systemInstruction: systemPrompt 
        });

        const result = await model.generateContent(text);
        const reply = result.response.text();

        chatHistory = chatHistory.filter(msg => msg.id !== botLoadingMsgId);
        chatHistory.push({ sender: 'bot', text: reply });
        renderChat();
        localStorage.setItem(`chat_${currentPetId}`, JSON.stringify(chatHistory));

    } catch (e) {
        console.error("❌ Erreur SDK Gemini:", e);
        chatHistory = chatHistory.filter(msg => msg.id !== botLoadingMsgId);
        chatHistory.push({ sender: 'bot', text: `Wouf... Le SDK Google a renvoyé une erreur. (${e.message})` });
        renderChat();
    }
};

// ==========================================
// NAVIGATION & EXPORTS GLOBALES
// ==========================================
window.exportToPDF = function() { window.print(); };

window.navigateTo = function(screenId) {
    document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    
    const navBtn = document.querySelector(`.nav-item[onclick="navigateTo('${screenId}')"]`);
    if(navBtn) navBtn.classList.add('active');

    const title = document.getElementById('page-title');
    const titles = {'screen-home': "Vue d'ensemble", 'screen-health': "Poids & Santé", 'screen-budget': "Suivi Budget", 'screen-chat': "Hey Pablo", 'screen-profile': "Configuration"};
    if(title && titles[screenId]) title.innerText = titles[screenId];
    if(screenId === 'screen-health') setTimeout(() => renderWeightChart(), 50);
};

// EXPOSITION GLOBALE POUR LE HTML DES AUTRES BOUTONS
window.switchPet = switchPet;
window.createNewPet = createNewPet;
window.toggleDarkMode = toggleDarkMode;
window.updateNutritionUI = updateNutritionUI;
window.addWater = addWater;
window.addWalk = addWalk;
window.resetDailyTrackers = resetDailyTrackers;
window.addNewWeight = addNewWeight;
window.addMedicalEvent = addMedicalEvent;
window.clearMedicalHistory = clearMedicalHistory;
window.addBudgetExpense = addBudgetExpense;
window.uploadPetPhoto = uploadPetPhoto;
window.savePetProfile = savePetProfile;
window.deleteCurrentPet = deleteCurrentPet;

// ==========================================
// ENREGISTREMENT DU SERVICE WORKER (PWA)
// ==========================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('🚀 Service Worker Pablo enregistré avec succès !'))
            .catch(err => console.warn('❌ Échec de l\'enregistrement du Service Worker', err));
    });
}