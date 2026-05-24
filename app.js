// --- IMPORTS FIREBASE ---
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from "firebase/auth";

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

// Variables d'état globales
let petsList = [];
let currentPetId = null;
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
// AUTHENTIFICATION FIREBASE
// ==========================================
onAuthStateChanged(auth, (user) => {
    const authPage = document.getElementById('auth-page');
    const mainApp = document.getElementById('main-app-layout');
    const landing = document.getElementById('landing-page');
    
    if (user) {
        console.log("🟢 Connecté :", user.email);
        if(landing) landing.style.display = 'none';
        if(authPage) authPage.style.display = 'none';
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
// INITIALISATION
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
    renderWeightChart();
}

function toggleDarkMode() {
    darkModeActive = !darkModeActive;
    localStorage.setItem(GLOBAL_CONFIG_ID, JSON.stringify({ darkMode: darkModeActive }));
    applyTheme();
}

// ==========================================
// GESTION MULTI-CHIENS (PRÉPARATION CLOUD)
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
        
        currentPetId = defaultId;
        localStorage.setItem('current_pet_id', currentPetId);
    } else {
        currentPetId = localStorage.getItem('current_pet_id') || petsList[0].id;
    }

    renderPetSelector();
    loadCurrentPetData();
}

function saveLocalData(petId, key, data) {
    localStorage.setItem(`${key}_${petId}`, JSON.stringify(data));
}

function getLocalData(petId, key, defaultValue) {
    const data = localStorage.getItem(`${key}_${petId}`);
    return data ? JSON.parse(data) : defaultValue;
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
    
    const newProfile = { name: name, species: species, breed: breed, age: 0, size: 0, weight: 0, avatar: "", breedAdvice: "" };
    
    saveLocalData(newId, 'profile', newProfile);
    saveLocalData(newId, 'weight', []);
    saveLocalData(newId, 'medical', []);
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
    initDailyTrackers();
    initChat();
    initBudgetTracker();
}

function deleteCurrentPet() {
    if (!confirm(`⚠️ Êtes-vous sûr de vouloir supprimer ${petProfile.name} ?`)) return;

    const keys = ['profile', 'weight', 'medical', 'daily', 'chat', 'budget'];
    keys.forEach(key => localStorage.removeItem(`${key}_${currentPetId}`));

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
// PROFIL ET CONSEILS IA
// ==========================================
function initPetProfile() {
    petProfile = getLocalData(currentPetId, 'profile', {});

    const updateText = (id, text) => { const el = document.getElementById(id); if (el) el.innerText = text; };
    const updateHTML = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
    
    updateHTML('header-pet-name', `PABLO<span>.</span>`);
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

    // Déclenche la carte de conseil dynamique sur l'accueil
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

    adviceContent.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> Génération du guide par l'IA en cours...";

    try {
        const prompt = `Génère un court guide très concis (3 puces courtes maximum) pour un propriétaire de ${petProfile.species || 'chien'} de race ${petProfile.breed}. Donne un conseil sur son éducation et un trait de caractère dominant. Formate la réponse directement en HTML (utilise <ul> et <li>). Pas d'introduction, va droit au but.`;
        
        const response = await fetch("/.netlify/functions/mammouth-proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "gpt-4.1",
                messages: [{ role: "user", content: prompt }]
            })
        });
        
        const data = await response.json();
        if (data.error) throw new Error(data.error);

        petProfile.breedAdvice = data.choices[0].message.content.trim();
        saveLocalData(currentPetId, 'profile', petProfile);
        
        adviceContent.innerHTML = petProfile.breedAdvice;
    } catch (error) {
        console.error("Erreur génération conseils:", error);
        adviceContent.innerText = "Conseils non disponibles. Demandez à l'assistant dans l'onglet IA !";
    }
}

function savePetProfile() {
    const name = document.getElementById('profile-name').value.trim();
    if (!name) return alert("Le nom est obligatoire.");

    const weight = parseFloat(document.getElementById('profile-weight').value);
    const newBreed = document.getElementById('profile-breed').value.trim();
    
    // Si la race a changé, on réinitialise le conseil IA pour en générer un nouveau
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
        };
        reader.readAsDataURL(file);
    }
}

// ==========================================
// POIDS ET NUTRITION (PROXY SERVERLESS)
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

    nutritionRationText.style.fontSize = "16px";
    nutritionRationText.innerText = "Calcul IA en cours...";

    let baseRation = petProfile.weight * 13.5; 
    if (activityLevel.value === 'calm') baseRation *= 0.85;
    if (activityLevel.value === 'active') baseRation *= 1.15;

    const promptNutrition = `Calcule la ration de croquettes quotidienne idéale pour un ${petProfile.species || 'chien'} de race ${petProfile.breed || 'Inconnue'}, pesant ${petProfile.weight} kg, ${petProfile.age || 0} mois, activité ${activityLevel.value}. Réponds UNIQUEMENT par le nombre de grammes suivi de 'g'. Exemple : 420g`;

    try {
        const response = await fetch("/.netlify/functions/mammouth-proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "gpt-4.1",
                messages: [{ role: "user", content: promptNutrition }]
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

function addWater() { dailyTrackers.water += 250; saveLocalData(currentPetId, 'daily', dailyTrackers); updateTrackersUI(); }
function addWalk() { dailyTrackers.walk += 15; saveLocalData(currentPetId, 'daily', dailyTrackers); updateTrackersUI(); }
function resetDailyTrackers() { dailyTrackers.water = 0; dailyTrackers.walk = 0; saveLocalData(currentPetId, 'daily', dailyTrackers); updateTrackersUI(); }

// ==========================================
// CARNET & RAPPELS
// ==========================================
function initMedicalRecords() {
    medicalEvents = getLocalData(currentPetId, 'medical', []);
    renderMedicalHistory();
    renderReminders();
}

function addMedicalEvent() {
    const type = document.getElementById('event-type').value;
    const date = document.getElementById('event-date').value;
    if (!date) return alert("Sélectionnez une date.");
    medicalEvents.push({ type, date });
    saveLocalData(currentPetId, 'medical', medicalEvents);
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
        saveLocalData(currentPetId, 'medical', medicalEvents); 
        renderMedicalHistory(); renderReminders(); 
    }
}

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

function addBudgetExpense() {
    const title = document.getElementById('budget-title').value.trim();
    const amount = parseFloat(document.getElementById('budget-amount').value);
    if (!title || !amount || amount <= 0) return alert("Valeurs invalides.");

    budgetExpenses.push({ id: Date.now(), title: title, amount: amount, date: new Date().toISOString() });
    saveLocalData(currentPetId, 'budget', budgetExpenses);
    updateBudgetUI();
    document.getElementById('budget-title').value = '';
    document.getElementById('budget-amount').value = '';
}

// ==========================================
// CHAT IA - SÉCURISÉ (PROXY SERVERLESS)
// ==========================================
function initChat() {
    chatHistory = getLocalData(currentPetId, 'chat', [{ sender: 'bot', text: `Wouf ! Je suis l'assistant de ${petProfile.name}. Comment puis-je aider ?` }]);
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
    sendMessage();
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

    const systemPrompt = `Tu es l'assistant vétérinaire de l'application Pablo. Tu aides le maître de : ${petProfile.name}, Espèce: ${petProfile.species}, Race: ${petProfile.breed}, Âge: ${petProfile.age} mois, Poids: ${petProfile.weight} kg. Sois très concis, bienveillant et finis toujours par un wouf ou un miaou !`;

    try {
        const response = await fetch("/.netlify/functions/mammouth-proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "gpt-4.1",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: text }
                ]
            })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error);
        
        chatHistory = chatHistory.filter(msg => msg.id !== botLoadingMsgId);
        chatHistory.push({ sender: 'bot', text: data.choices[0].message.content });
        renderChat();
        saveLocalData(currentPetId, 'chat', chatHistory);

    } catch (e) {
        console.error("❌ Erreur proxy IA:", e);
        chatHistory = chatHistory.filter(msg => msg.id !== botLoadingMsgId);
        chatHistory.push({ sender: 'bot', text: `Wouf... Erreur de connexion avec le serveur sécurisé. (${e.message})` });
        renderChat();
    }
};

// ==========================================
// NOTIFICATIONS ET NAVIGATION
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
            new Notification("Félicitations !", { body: "Les rappels sont actifs.", icon: '/icons/icon-192x192.png' });
        }
    });
};

window.exportToPDF = () => window.print();

window.navigateTo = (screenId) => {
    document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    
    const navBtn = document.querySelector(`.nav-item[onclick="navigateTo('${screenId}')"]`);
    if(navBtn) navBtn.classList.add('active');

    const titles = {'screen-home': "Vue d'ensemble", 'screen-health': "Poids & Santé", 'screen-budget': "Suivi Budget", 'screen-chat': "Hey Pablo", 'screen-profile': "Configuration"};
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