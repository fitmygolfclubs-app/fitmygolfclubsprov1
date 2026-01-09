/**
 * BagOnboarding Component v1.0
 * Full bag onboarding flow for FitMyGolfClubs
 * 
 * Uses ClubSelector internally for individual club selection.
 * Handles batch entry with "same set" and "same shaft" shortcuts.
 * 
 * Usage:
 *   BagOnboarding.init(db);
 *   BagOnboarding.start({
 *     userId: 'abc123',
 *     onComplete: (bag) => { ... },
 *     onCancel: () => { ... }
 *   });
 */

const BagOnboarding = (function() {
  'use strict';

  // ============================================
  // PRIVATE STATE
  // ============================================
  
  let db = null;
  let isInitialized = false;
  
  // Club types by category
  const clubTypesByCategory = {
    woods: [
      { type: 'Driver', label: 'Driver', icon: '🏌️' },
      { type: '2-Wood', label: '2-Wood', icon: '🪵' },
      { type: '3-Wood', label: '3-Wood', icon: '🪵' },
      { type: '4-Wood', label: '4-Wood', icon: '🪵' },
      { type: '5-Wood', label: '5-Wood', icon: '🪵' },
      { type: '7-Wood', label: '7-Wood', icon: '🪵' },
      { type: '9-Wood', label: '9-Wood', icon: '🪵' }
    ],
    hybrids: [
      { type: '2-Hybrid', label: '2H', icon: '⚡' },
      { type: '3-Hybrid', label: '3H', icon: '⚡' },
      { type: '4-Hybrid', label: '4H', icon: '⚡' },
      { type: '5-Hybrid', label: '5H', icon: '⚡' },
      { type: '6-Hybrid', label: '6H', icon: '⚡' },
      { type: '7-Hybrid', label: '7H', icon: '⚡' }
    ],
    irons: [
      { type: '2-Iron', label: '2i', icon: '🏌️' },
      { type: '3-Iron', label: '3i', icon: '🏌️' },
      { type: '4-Iron', label: '4i', icon: '🏌️' },
      { type: '5-Iron', label: '5i', icon: '🏌️' },
      { type: '6-Iron', label: '6i', icon: '🏌️' },
      { type: '7-Iron', label: '7i', icon: '🏌️' },
      { type: '8-Iron', label: '8i', icon: '🏌️' },
      { type: '9-Iron', label: '9i', icon: '🏌️' },
      { type: 'PW', label: 'PW', icon: '🏌️' }
    ],
    wedges: [
      { type: 'GW', label: 'GW', icon: '🎯' },
      { type: 'AW', label: 'AW', icon: '🎯' },
      { type: '50°', label: '50°', icon: '🎯' },
      { type: '52°', label: '52°', icon: '🎯' },
      { type: '54°', label: '54°', icon: '🎯' },
      { type: '56°', label: '56°', icon: '🎯' },
      { type: '58°', label: '58°', icon: '🎯' },
      { type: '60°', label: '60°', icon: '🎯' },
      { type: '62°', label: '62°', icon: '🎯' },
      { type: '64°', label: '64°', icon: '🎯' }
    ]
  };

  const categoryOrder = ['woods', 'hybrids', 'irons', 'wedges'];
  const categoryLabels = {
    woods: { title: 'Woods', icon: '🪵', desc: 'Driver and fairway woods' },
    hybrids: { title: 'Hybrids', icon: '⚡', desc: 'Hybrid/rescue clubs' },
    irons: { title: 'Irons', icon: '🏌️', desc: 'Iron set clubs' },
    wedges: { title: 'Wedges', icon: '🎯', desc: 'Specialty wedges' }
  };

  // Onboarding state
  let state = {
    userId: null,
    currentCategory: null,
    currentCategoryIndex: 0,
    currentStep: 'select-clubs', // 'select-clubs' | 'same-set' | 'enter-set' | 'same-shaft' | 'enter-shaft' | 'enter-individual' | 'review'
    
    // Selected clubs per category
    selectedClubs: {
      woods: [],
      hybrids: [],
      irons: [],
      wedges: []
    },
    
    // Entered club data
    clubsData: [],  // Array of complete club objects
    
    // Same-set shortcuts
    sameSetAnswer: null,      // true/false
    setClubHeadSpec: null,    // Shared club head spec for "same set"
    sameShaftAnswer: null,    // true/false  
    setShaftSpec: null,       // Shared shaft spec for "same shaft"
    
    // Current club being entered (when entering individually)
    currentClubIndex: 0,
    
    // Callbacks
    onComplete: null,
    onCancel: null,
    onProgress: null
  };

  // ============================================
  // INITIALIZATION
  // ============================================

  function init(firestore) {
    if (isInitialized) {
      console.log('BagOnboarding already initialized');
      return;
    }

    db = firestore;
    createModalHTML();
    attachEventListeners();
    isInitialized = true;
    
    console.log('✅ BagOnboarding initialized');
  }

  // ============================================
  // MODAL HTML
  // ============================================

  function createModalHTML() {
    const existing = document.getElementById('bag-onboarding-modal');
    if (existing) existing.remove();

    const html = `
      <div id="bag-onboarding-modal" class="bo-modal-overlay">
        <div class="bo-modal">
          <!-- Header -->
          <div class="bo-header">
            <button class="bo-back-btn" id="bo-back" style="visibility: hidden;">←</button>
            <div class="bo-header-center">
              <div class="bo-title" id="bo-title">Bag Onboarding</div>
              <div class="bo-subtitle" id="bo-subtitle">Let's catalog your clubs</div>
            </div>
            <button class="bo-close-btn" id="bo-close">×</button>
          </div>
          
          <!-- Progress Bar -->
          <div class="bo-progress">
            <div class="bo-progress-bar" id="bo-progress-bar" style="width: 0%"></div>
          </div>
          <div class="bo-progress-labels">
            <span class="bo-progress-label active" data-cat="woods">Woods</span>
            <span class="bo-progress-label" data-cat="hybrids">Hybrids</span>
            <span class="bo-progress-label" data-cat="irons">Irons</span>
            <span class="bo-progress-label" data-cat="wedges">Wedges</span>
          </div>
          
          <!-- Content Area -->
          <div class="bo-content" id="bo-content">
            <!-- Dynamically populated -->
          </div>
          
          <!-- Footer -->
          <div class="bo-footer">
            <button class="bo-btn bo-btn-secondary" id="bo-skip">Skip Category</button>
            <button class="bo-btn bo-btn-primary" id="bo-next" disabled>Continue</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    injectStyles();
  }

  function injectStyles() {
    if (document.getElementById('bag-onboarding-styles')) return;

    const styles = `
      <style id="bag-onboarding-styles">
        /* Modal Overlay */
        .bo-modal-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.9);
          display: none;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          padding: 20px;
        }
        .bo-modal-overlay.active { display: flex; }

        /* Modal Container */
        .bo-modal {
          background: #1a1d29;
          border-radius: 20px;
          width: 100%;
          max-width: 500px;
          max-height: 90vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: 0 25px 80px rgba(0, 0, 0, 0.5);
        }

        /* Header */
        .bo-header {
          display: flex;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .bo-back-btn, .bo-close-btn {
          background: none;
          border: none;
          color: #888;
          font-size: 24px;
          cursor: pointer;
          padding: 4px 8px;
          line-height: 1;
        }
        .bo-back-btn:hover, .bo-close-btn:hover { color: #fff; }
        .bo-header-center {
          flex: 1;
          text-align: center;
        }
        .bo-title {
          font-size: 18px;
          font-weight: 600;
          color: #fff;
        }
        .bo-subtitle {
          font-size: 12px;
          color: #888;
          margin-top: 2px;
        }

        /* Progress */
        .bo-progress {
          height: 4px;
          background: #252a38;
        }
        .bo-progress-bar {
          height: 100%;
          background: linear-gradient(90deg, #00d4ff, #00c864);
          transition: width 0.3s ease;
        }
        .bo-progress-labels {
          display: flex;
          justify-content: space-between;
          padding: 10px 20px;
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .bo-progress-label {
          font-size: 11px;
          color: #555;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .bo-progress-label.active { color: #00d4ff; }
        .bo-progress-label.complete { color: #00c864; }

        /* Content */
        .bo-content {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
        }

        /* Footer */
        .bo-footer {
          display: flex;
          gap: 12px;
          padding: 16px 20px;
          border-top: 1px solid rgba(255,255,255,0.1);
        }
        .bo-btn {
          flex: 1;
          padding: 14px 20px;
          border-radius: 10px;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          border: none;
          transition: all 0.2s;
        }
        .bo-btn-primary {
          background: linear-gradient(135deg, #00d4ff, #0099cc);
          color: #000;
        }
        .bo-btn-primary:hover:not(:disabled) { opacity: 0.9; }
        .bo-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
        .bo-btn-secondary {
          background: #333;
          color: #888;
        }
        .bo-btn-secondary:hover { background: #444; color: #aaa; }
        .bo-btn-green {
          background: linear-gradient(135deg, #00c864, #00a050);
          color: #fff;
        }

        /* Club Selection Grid */
        .bo-club-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
          margin-bottom: 20px;
        }
        .bo-club-grid.woods-grid { grid-template-columns: repeat(3, 1fr); }
        
        .bo-club-checkbox {
          background: rgba(0,0,0,0.3);
          border: 2px solid #333;
          border-radius: 12px;
          padding: 14px 8px;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s;
          user-select: none;
        }
        .bo-club-checkbox:hover { border-color: #555; }
        .bo-club-checkbox.selected {
          border-color: #00d4ff;
          background: rgba(0, 212, 255, 0.1);
        }
        .bo-club-checkbox .icon { font-size: 20px; margin-bottom: 4px; }
        .bo-club-checkbox .label { font-size: 13px; color: #aaa; }
        .bo-club-checkbox.selected .label { color: #00d4ff; }
        .bo-club-checkbox .check {
          width: 18px; height: 18px;
          border: 2px solid #555;
          border-radius: 4px;
          margin: 8px auto 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
        }
        .bo-club-checkbox.selected .check {
          background: #00d4ff;
          border-color: #00d4ff;
          color: #000;
        }

        /* Question Card */
        .bo-question {
          background: #252a38;
          border-radius: 14px;
          padding: 24px;
          margin-bottom: 20px;
          text-align: center;
        }
        .bo-question-icon { font-size: 40px; margin-bottom: 12px; }
        .bo-question-text {
          font-size: 18px;
          font-weight: 600;
          color: #fff;
          margin-bottom: 8px;
        }
        .bo-question-hint {
          font-size: 13px;
          color: #888;
          margin-bottom: 20px;
        }
        .bo-question-buttons {
          display: flex;
          gap: 12px;
        }
        .bo-question-btn {
          flex: 1;
          padding: 14px;
          border-radius: 10px;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          border: 2px solid #333;
          background: rgba(0,0,0,0.3);
          color: #aaa;
          transition: all 0.2s;
        }
        .bo-question-btn:hover { border-color: #555; color: #fff; }
        .bo-question-btn.selected {
          border-color: #00d4ff;
          background: rgba(0, 212, 255, 0.1);
          color: #00d4ff;
        }

        /* Set Entry Card */
        .bo-set-entry {
          background: #252a38;
          border-radius: 14px;
          padding: 20px;
          margin-bottom: 16px;
        }
        .bo-set-entry-title {
          font-size: 14px;
          font-weight: 600;
          color: #fff;
          margin-bottom: 4px;
        }
        .bo-set-entry-desc {
          font-size: 12px;
          color: #888;
          margin-bottom: 16px;
        }
        .bo-set-entry-btn {
          width: 100%;
          padding: 14px;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          border: 2px dashed #444;
          background: transparent;
          color: #888;
          transition: all 0.2s;
        }
        .bo-set-entry-btn:hover {
          border-color: #00d4ff;
          color: #00d4ff;
        }
        .bo-set-entry-btn.filled {
          border-style: solid;
          border-color: #00c864;
          background: rgba(0, 200, 100, 0.1);
          color: #00c864;
        }

        /* Club List */
        .bo-club-list { margin-bottom: 16px; }
        .bo-club-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          background: #252a38;
          border-radius: 10px;
          margin-bottom: 8px;
        }
        .bo-club-item-type {
          font-size: 13px;
          font-weight: 600;
          color: #00d4ff;
          min-width: 60px;
        }
        .bo-club-item-info {
          flex: 1;
        }
        .bo-club-item-name {
          font-size: 14px;
          color: #fff;
        }
        .bo-club-item-shaft {
          font-size: 11px;
          color: #888;
          margin-top: 2px;
        }
        .bo-club-item-edit {
          background: none;
          border: none;
          color: #00d4ff;
          font-size: 12px;
          cursor: pointer;
        }
        .bo-club-item.pending {
          border: 2px dashed #444;
          background: transparent;
        }
        .bo-club-item.pending .bo-club-item-name {
          color: #666;
          font-style: italic;
        }

        /* Info Box */
        .bo-info {
          background: rgba(0, 212, 255, 0.1);
          border: 1px solid rgba(0, 212, 255, 0.3);
          border-radius: 10px;
          padding: 14px;
          font-size: 13px;
          color: #00d4ff;
          margin-bottom: 16px;
        }

        /* Summary */
        .bo-summary-category {
          margin-bottom: 20px;
        }
        .bo-summary-title {
          font-size: 14px;
          font-weight: 600;
          color: #888;
          margin-bottom: 10px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .bo-summary-empty {
          font-size: 13px;
          color: #555;
          font-style: italic;
          padding: 10px 0;
        }
      </style>
    `;

    document.head.insertAdjacentHTML('beforeend', styles);
  }

  // ============================================
  // EVENT LISTENERS
  // ============================================

  function attachEventListeners() {
    document.getElementById('bo-close').addEventListener('click', cancel);
    document.getElementById('bo-back').addEventListener('click', goBack);
    document.getElementById('bo-next').addEventListener('click', goNext);
    document.getElementById('bo-skip').addEventListener('click', skipCategory);
    
    document.getElementById('bag-onboarding-modal').addEventListener('click', (e) => {
      if (e.target.id === 'bag-onboarding-modal') cancel();
    });
  }

  // ============================================
  // PUBLIC API
  // ============================================

  /**
   * Start bag onboarding
   */
  function start(options = {}) {
    if (!isInitialized) {
      console.error('BagOnboarding not initialized');
      return;
    }

    // Reset state
    state = {
      userId: options.userId || null,
      currentCategory: 'woods',
      currentCategoryIndex: 0,
      currentStep: 'select-clubs',
      selectedClubs: { woods: [], hybrids: [], irons: [], wedges: [] },
      clubsData: [],
      sameSetAnswer: null,
      setClubHeadSpec: null,
      sameShaftAnswer: null,
      setShaftSpec: null,
      currentClubIndex: 0,
      onComplete: options.onComplete || null,
      onCancel: options.onCancel || null,
      onProgress: options.onProgress || null
    };

    // Show modal
    document.getElementById('bag-onboarding-modal').classList.add('active');
    
    // Render first step
    renderCurrentStep();
    updateProgress();

    console.log('📂 BagOnboarding started');
  }

  /**
   * Close/cancel onboarding
   */
  function cancel() {
    document.getElementById('bag-onboarding-modal').classList.remove('active');
    if (state.onCancel) state.onCancel();
    console.log('📁 BagOnboarding cancelled');
  }

  // ============================================
  // NAVIGATION
  // ============================================

  function goBack() {
    const steps = getStepsForCategory();
    const currentIndex = steps.indexOf(state.currentStep);
    
    if (currentIndex > 0) {
      state.currentStep = steps[currentIndex - 1];
      renderCurrentStep();
    } else if (state.currentCategoryIndex > 0) {
      // Go to previous category
      state.currentCategoryIndex--;
      state.currentCategory = categoryOrder[state.currentCategoryIndex];
      state.currentStep = 'select-clubs';
      state.sameSetAnswer = null;
      state.sameShaftAnswer = null;
      renderCurrentStep();
    }
    
    updateBackButton();
    updateProgress();
  }

  function goNext() {
    const steps = getStepsForCategory();
    const currentIndex = steps.indexOf(state.currentStep);
    
    if (currentIndex < steps.length - 1) {
      state.currentStep = steps[currentIndex + 1];
      renderCurrentStep();
    } else {
      // Move to next category or finish
      moveToNextCategory();
    }
    
    updateBackButton();
    updateProgress();
  }

  function skipCategory() {
    state.selectedClubs[state.currentCategory] = [];
    moveToNextCategory();
  }

  function moveToNextCategory() {
    // Save clubs for current category if any
    saveCategoryClubs();
    
    // Move to next
    state.currentCategoryIndex++;
    
    if (state.currentCategoryIndex >= categoryOrder.length) {
      // All done - show summary
      state.currentStep = 'summary';
      renderSummary();
    } else {
      state.currentCategory = categoryOrder[state.currentCategoryIndex];
      state.currentStep = 'select-clubs';
      state.sameSetAnswer = null;
      state.sameShaftAnswer = null;
      state.setClubHeadSpec = null;
      state.setShaftSpec = null;
      state.currentClubIndex = 0;
      renderCurrentStep();
    }
    
    updateBackButton();
    updateProgress();
  }

  function getStepsForCategory() {
    const selected = state.selectedClubs[state.currentCategory] || [];
    if (selected.length === 0) return ['select-clubs'];
    if (selected.length === 1) return ['select-clubs', 'enter-individual'];
    
    // Multiple clubs - show same-set question
    const steps = ['select-clubs', 'same-set'];
    
    if (state.sameSetAnswer === true) {
      steps.push('enter-set');
      steps.push('same-shaft');
      if (state.sameShaftAnswer === true) {
        // Only add enter-shaft step if shaft wasn't already captured from ClubSelector
        if (!state.setShaftSpec) {
          steps.push('enter-shaft');
        }
      } else if (state.sameShaftAnswer === false) {
        steps.push('enter-individual-shafts');
      }
    } else if (state.sameSetAnswer === false) {
      steps.push('enter-individual');
    }
    
    return steps;
  }

  function updateBackButton() {
    const backBtn = document.getElementById('bo-back');
    const canGoBack = state.currentCategoryIndex > 0 || 
                      getStepsForCategory().indexOf(state.currentStep) > 0;
    backBtn.style.visibility = canGoBack ? 'visible' : 'hidden';
  }

  function updateProgress() {
    const totalCategories = categoryOrder.length;
    const progressPercent = ((state.currentCategoryIndex + 0.5) / totalCategories) * 100;
    
    document.getElementById('bo-progress-bar').style.width = `${progressPercent}%`;
    
    // Update labels
    document.querySelectorAll('.bo-progress-label').forEach(label => {
      const cat = label.dataset.cat;
      const catIndex = categoryOrder.indexOf(cat);
      label.classList.remove('active', 'complete');
      
      if (catIndex < state.currentCategoryIndex) {
        label.classList.add('complete');
      } else if (catIndex === state.currentCategoryIndex) {
        label.classList.add('active');
      }
    });
  }

  // ============================================
  // RENDER STEPS
  // ============================================

  function renderCurrentStep() {
    const catInfo = categoryLabels[state.currentCategory];
    document.getElementById('bo-title').textContent = catInfo.title;
    document.getElementById('bo-subtitle').textContent = catInfo.desc;
    
    switch (state.currentStep) {
      case 'select-clubs':
        renderClubSelection();
        break;
      case 'same-set':
        renderSameSetQuestion();
        break;
      case 'enter-set':
        renderSetEntry();
        break;
      case 'same-shaft':
        renderSameShaftQuestion();
        break;
      case 'enter-shaft':
        renderShaftEntry();
        break;
      case 'enter-individual':
        renderIndividualEntry();
        break;
      case 'enter-individual-shafts':
        renderIndividualShaftEntry();
        break;
      case 'summary':
        renderSummary();
        break;
    }
  }

  // ============================================
  // STEP: SELECT CLUBS
  // ============================================

  function renderClubSelection() {
    const content = document.getElementById('bo-content');
    const clubs = clubTypesByCategory[state.currentCategory];
    const selected = state.selectedClubs[state.currentCategory];
    const isWoods = state.currentCategory === 'woods';
    
    let html = `
      <div class="bo-info">
        Select the ${categoryLabels[state.currentCategory].title.toLowerCase()} in your bag
      </div>
      <div class="bo-club-grid ${isWoods ? 'woods-grid' : ''}">
    `;
    
    clubs.forEach(club => {
      const isSelected = selected.includes(club.type);
      html += `
        <div class="bo-club-checkbox ${isSelected ? 'selected' : ''}" 
             onclick="BagOnboarding.toggleClub('${club.type}')">
          <div class="icon">${club.icon}</div>
          <div class="label">${club.label}</div>
          <div class="check">${isSelected ? '✓' : ''}</div>
        </div>
      `;
    });
    
    html += '</div>';
    content.innerHTML = html;
    
    // Update buttons
    document.getElementById('bo-skip').style.display = 'block';
    document.getElementById('bo-skip').textContent = 'Skip Category';
    document.getElementById('bo-next').disabled = selected.length === 0;
    document.getElementById('bo-next').textContent = 'Continue';
  }

  function toggleClub(clubType) {
    const selected = state.selectedClubs[state.currentCategory];
    const index = selected.indexOf(clubType);
    
    if (index > -1) {
      selected.splice(index, 1);
    } else {
      selected.push(clubType);
    }
    
    // Sort by standard order
    const allTypes = clubTypesByCategory[state.currentCategory].map(c => c.type);
    selected.sort((a, b) => allTypes.indexOf(a) - allTypes.indexOf(b));
    
    renderClubSelection();
  }

  // ============================================
  // STEP: SAME SET QUESTION
  // ============================================

  function renderSameSetQuestion() {
    const content = document.getElementById('bo-content');
    const selected = state.selectedClubs[state.currentCategory];
    const catLabel = categoryLabels[state.currentCategory].title.toLowerCase();
    
    content.innerHTML = `
      <div class="bo-question">
        <div class="bo-question-icon">🎯</div>
        <div class="bo-question-text">Are these all the same set?</div>
        <div class="bo-question-hint">
          Same brand & model: ${selected.join(', ')}
        </div>
        <div class="bo-question-buttons">
          <button class="bo-question-btn ${state.sameSetAnswer === true ? 'selected' : ''}" 
                  onclick="BagOnboarding.answerSameSet(true)">
            Yes, Same Set
          </button>
          <button class="bo-question-btn ${state.sameSetAnswer === false ? 'selected' : ''}"
                  onclick="BagOnboarding.answerSameSet(false)">
            No, Different
          </button>
        </div>
      </div>
    `;
    
    document.getElementById('bo-skip').style.display = 'none';
    document.getElementById('bo-next').disabled = state.sameSetAnswer === null;
    document.getElementById('bo-next').textContent = 'Continue';
  }

  function answerSameSet(answer) {
    state.sameSetAnswer = answer;
    renderSameSetQuestion();
  }

  // ============================================
  // STEP: ENTER SET (Club Head)
  // ============================================

  function renderSetEntry() {
    const content = document.getElementById('bo-content');
    const selected = state.selectedClubs[state.currentCategory];
    const hasSpec = state.setClubHeadSpec !== null;
    
    let specDisplay = 'Tap to select brand & model →';
    if (hasSpec) {
      specDisplay = `✓ ${state.setClubHeadSpec.brand} ${state.setClubHeadSpec.model}`;
      if (state.setClubHeadSpec.year) specDisplay += ` (${state.setClubHeadSpec.year})`;
    }
    
    content.innerHTML = `
      <div class="bo-info">
        Enter the club head for your ${categoryLabels[state.currentCategory].title.toLowerCase()} set
      </div>
      
      <div class="bo-set-entry">
        <div class="bo-set-entry-title">Club Head</div>
        <div class="bo-set-entry-desc">
          Applies to: ${selected.join(', ')}
        </div>
        <button class="bo-set-entry-btn ${hasSpec ? 'filled' : ''}" 
                onclick="BagOnboarding.openClubHeadSelector()">
          ${specDisplay}
        </button>
      </div>
    `;
    
    document.getElementById('bo-skip').style.display = 'none';
    document.getElementById('bo-next').disabled = !hasSpec;
    document.getElementById('bo-next').textContent = 'Continue';
  }

  function openClubHeadSelector() {
    // Use first selected club type as reference
    const clubType = state.selectedClubs[state.currentCategory][0];
    
    ClubSelector.open({
      mode: 'known-type',
      clubType: clubType,
      category: state.currentCategory,
      title: `Select ${categoryLabels[state.currentCategory].title} Set`,
      onSelect: (result) => {
        state.setClubHeadSpec = {
          clubHeadSpecId: result.clubHeadSpecId,
          brand: result.brand,
          model: result.model,
          year: result.year,
          type: result.type,
          clubHeadSpec: result.clubHeadSpec
        };
        
        // Also capture shaft data if provided by ClubSelector
        if (result.shaftBrand && result.shaftModel) {
          state.setShaftSpec = {
            shaftId: result.shaftId || null,
            brand: result.shaftBrand,
            model: result.shaftModel,
            weight: result.shaftSpecs?.weight || null,
            flex: result.shaftSpecs?.flex || null,
            kickPoint: result.shaftSpecs?.kickPoint || null,
            torque: result.shaftSpecs?.torque || null
          };
          console.log('📦 Shaft also captured from ClubSelector:', state.setShaftSpec);
        }
        
        renderSetEntry();
      }
    });
  }

  // ============================================
  // STEP: SAME SHAFT QUESTION
  // ============================================

  function renderSameShaftQuestion() {
    const content = document.getElementById('bo-content');
    const selected = state.selectedClubs[state.currentCategory];
    
    // Check if shaft was already captured from ClubSelector
    // Only use it if it seems appropriate for this category (basic sanity check)
    let hasShaftFromSelector = state.setShaftSpec !== null;
    
    // Sanity check: don't auto-apply iron shafts to woods/hybrids or vice versa
    if (hasShaftFromSelector && state.setShaftSpec.model) {
      const shaftName = state.setShaftSpec.model.toLowerCase();
      const isIronShaft = shaftName.includes('iron') || shaftName.includes('wedge');
      const isWoodShaft = shaftName.includes('wood') || shaftName.includes('driver') || shaftName.includes('hybrid');
      
      // If it's clearly an iron shaft but we're in woods/hybrids, clear it
      if (isIronShaft && (state.currentCategory === 'woods' || state.currentCategory === 'hybrids')) {
        console.log('⚠️ Clearing iron shaft for woods/hybrids category');
        state.setShaftSpec = null;
        hasShaftFromSelector = false;
      }
      // If it's clearly a wood shaft but we're in irons/wedges, clear it
      if (isWoodShaft && (state.currentCategory === 'irons' || state.currentCategory === 'wedges')) {
        console.log('⚠️ Clearing wood shaft for irons/wedges category');
        state.setShaftSpec = null;
        hasShaftFromSelector = false;
      }
    }
    
    const shaftDisplay = hasShaftFromSelector 
      ? `<div class="bo-shaft-preview" style="margin-top: 12px; padding: 10px; background: var(--green-dim); border-radius: 8px; text-align: center;">
           <div style="font-size: 12px; color: var(--green); margin-bottom: 4px;">SHAFT ALREADY SELECTED</div>
           <div style="color: var(--text-primary);">${state.setShaftSpec.brand} ${state.setShaftSpec.model}</div>
         </div>`
      : '';
    
    content.innerHTML = `
      <div class="bo-question">
        <div class="bo-question-icon">🔧</div>
        <div class="bo-question-text">Same shaft in all?</div>
        <div class="bo-question-hint">
          Do all ${selected.length} clubs have the same shaft?
        </div>
        ${shaftDisplay}
        <div class="bo-question-buttons">
          <button class="bo-question-btn ${state.sameShaftAnswer === true ? 'selected' : ''}" 
                  onclick="BagOnboarding.answerSameShaft(true)">
            Yes, Same Shaft
          </button>
          <button class="bo-question-btn ${state.sameShaftAnswer === false ? 'selected' : ''}"
                  onclick="BagOnboarding.answerSameShaft(false)">
            No, Different
          </button>
        </div>
      </div>
    `;
    
    // Auto-select "Yes" if shaft was already captured
    if (hasShaftFromSelector && state.sameShaftAnswer === null) {
      state.sameShaftAnswer = true;
      // Re-render with selection
      renderSameShaftQuestion();
      return;
    }
    
    document.getElementById('bo-skip').style.display = 'none';
    document.getElementById('bo-next').disabled = state.sameShaftAnswer === null;
    document.getElementById('bo-next').textContent = 'Continue';
  }

  function answerSameShaft(answer) {
    state.sameShaftAnswer = answer;
    renderSameShaftQuestion();
  }

  // ============================================
  // STEP: ENTER SHAFT (for same-shaft)
  // ============================================

  function renderShaftEntry() {
    const content = document.getElementById('bo-content');
    const selected = state.selectedClubs[state.currentCategory];
    const hasShaft = state.setShaftSpec !== null;
    
    let shaftDisplay = 'Tap to select shaft →';
    if (hasShaft) {
      shaftDisplay = `✓ ${state.setShaftSpec.brand} ${state.setShaftSpec.model}`;
      if (state.setShaftSpec.flex) shaftDisplay += ` ${state.setShaftSpec.flex}`;
    }
    
    content.innerHTML = `
      <div class="bo-info">
        Enter the shaft for your ${categoryLabels[state.currentCategory].title.toLowerCase()} set
      </div>
      
      <div class="bo-set-entry">
        <div class="bo-set-entry-title">Shaft</div>
        <div class="bo-set-entry-desc">
          Applies to: ${selected.join(', ')}
        </div>
        <button class="bo-set-entry-btn ${hasShaft ? 'filled' : ''}" 
                onclick="BagOnboarding.openShaftSelector()">
          ${shaftDisplay}
        </button>
      </div>
    `;
    
    document.getElementById('bo-skip').style.display = 'none';
    document.getElementById('bo-next').disabled = !hasShaft;
    document.getElementById('bo-next').textContent = selected.length === 1 ? 'Continue' : 'Finish Category';
  }

  function openShaftSelector() {
    // Open ClubSelector just for shaft
    const clubType = state.selectedClubs[state.currentCategory]?.[0];
    ClubSelector.open({
      mode: 'shaft-only',
      title: 'Select Shaft',
      clubHeadSpecId: state.setClubHeadSpec?.clubHeadSpecId,
      clubType: clubType,
      onSelect: (result) => {
        state.setShaftSpec = {
          shaftId: result.shaftId,
          brand: result.shaftBrand,
          model: result.shaftModel,
          flex: result.shaftSpecs?.flex,
          weight: result.shaftSpecs?.weight,
          kickPoint: result.shaftSpecs?.kickPoint,
          torque: result.shaftSpecs?.torque,
          isManual: result.isManualShaft,
          shaftSpec: result.shaftSpec
        };
        renderShaftEntry();
      }
    });
  }

  // ============================================
  // STEP: ENTER INDIVIDUAL
  // ============================================

  function renderIndividualEntry() {
    const content = document.getElementById('bo-content');
    const selected = state.selectedClubs[state.currentCategory];
    
    // Build list of clubs with their entry status
    let html = `
      <div class="bo-info">
        Enter each club individually
      </div>
      <div class="bo-club-list">
    `;
    
    selected.forEach((clubType, index) => {
      const clubData = state.clubsData.find(c => 
        c.clubType === clubType && c.category === state.currentCategory
      );
      
      if (clubData) {
        html += `
          <div class="bo-club-item">
            <div class="bo-club-item-type">${clubType}</div>
            <div class="bo-club-item-info">
              <div class="bo-club-item-name">${clubData.brand} ${clubData.model}</div>
              <div class="bo-club-item-shaft">${clubData.shaftBrand || ''} ${clubData.shaftModel || ''}</div>
            </div>
            <button class="bo-club-item-edit" onclick="BagOnboarding.editClub('${clubType}')">Edit</button>
          </div>
        `;
      } else {
        html += `
          <div class="bo-club-item pending" onclick="BagOnboarding.enterClub('${clubType}')">
            <div class="bo-club-item-type">${clubType}</div>
            <div class="bo-club-item-info">
              <div class="bo-club-item-name">Tap to enter →</div>
            </div>
          </div>
        `;
      }
    });
    
    html += '</div>';
    content.innerHTML = html;
    
    // Check if all entered
    const enteredCount = state.clubsData.filter(c => 
      c.category === state.currentCategory && 
      selected.includes(c.clubType)
    ).length;
    
    const allEntered = enteredCount === selected.length;
    
    document.getElementById('bo-skip').style.display = 'none';
    document.getElementById('bo-next').disabled = !allEntered;
    document.getElementById('bo-next').textContent = 'Finish Category';
  }

  function enterClub(clubType) {
    ClubSelector.open({
      mode: 'known-type',
      clubType: clubType,
      category: state.currentCategory,
      title: `Enter ${clubType}`,
      onSelect: (result) => {
        // Remove existing entry if any
        state.clubsData = state.clubsData.filter(c => 
          !(c.clubType === clubType && c.category === state.currentCategory)
        );
        
        // Add new entry
        state.clubsData.push({
          category: state.currentCategory,
          clubType: clubType,
          clubHeadSpecId: result.clubHeadSpecId,
          brand: result.brand,
          model: result.model,
          year: result.year,
          specs: result.specs,
          shaftId: result.shaftId,
          shaftBrand: result.shaftBrand,
          shaftModel: result.shaftModel,
          shaftSpecs: result.shaftSpecs,
          isManualShaft: result.isManualShaft
        });
        
        renderIndividualEntry();
      }
    });
  }

  function editClub(clubType) {
    enterClub(clubType);
  }

  // ============================================
  // STEP: INDIVIDUAL SHAFT ENTRY
  // ============================================

  function renderIndividualShaftEntry() {
    // Similar to individual entry but user already selected set head
    const content = document.getElementById('bo-content');
    const selected = state.selectedClubs[state.currentCategory];
    
    let html = `
      <div class="bo-info">
        Enter shaft for each ${categoryLabels[state.currentCategory].title.toLowerCase()}
      </div>
      <div class="bo-club-list">
    `;
    
    selected.forEach((clubType) => {
      const clubData = state.clubsData.find(c => 
        c.clubType === clubType && c.category === state.currentCategory
      );
      
      const hasShaft = clubData && clubData.shaftBrand;
      
      html += `
        <div class="bo-club-item ${hasShaft ? '' : 'pending'}" 
             onclick="BagOnboarding.enterShaftForClub('${clubType}')">
          <div class="bo-club-item-type">${clubType}</div>
          <div class="bo-club-item-info">
            <div class="bo-club-item-name">${state.setClubHeadSpec.brand} ${state.setClubHeadSpec.model}</div>
            <div class="bo-club-item-shaft">${hasShaft ? `${clubData.shaftBrand} ${clubData.shaftModel}` : 'Tap to enter shaft →'}</div>
          </div>
        </div>
      `;
    });
    
    html += '</div>';
    content.innerHTML = html;
    
    // Check if all have shafts
    const withShaftCount = state.clubsData.filter(c => 
      c.category === state.currentCategory && 
      selected.includes(c.clubType) &&
      c.shaftBrand
    ).length;
    
    document.getElementById('bo-skip').style.display = 'none';
    document.getElementById('bo-next').disabled = withShaftCount !== selected.length;
    document.getElementById('bo-next').textContent = 'Finish Category';
  }

  function enterShaftForClub(clubType) {
    ClubSelector.open({
      mode: 'shaft-only',
      title: `Select Shaft for ${clubType}`,
      clubHeadSpecId: state.setClubHeadSpec?.clubHeadSpecId,
      clubType: clubType,
      onSelect: (result) => {
        // Find or create club entry
        let club = state.clubsData.find(c => 
          c.clubType === clubType && c.category === state.currentCategory
        );
        
        if (!club) {
          club = {
            category: state.currentCategory,
            clubType: clubType,
            clubHeadSpecId: state.setClubHeadSpec.clubHeadSpecId,
            brand: state.setClubHeadSpec.brand,
            model: state.setClubHeadSpec.model,
            year: state.setClubHeadSpec.year
          };
          state.clubsData.push(club);
        }
        
        // Update shaft
        club.shaftId = result.shaftId;
        club.shaftBrand = result.shaftBrand;
        club.shaftModel = result.shaftModel;
        club.shaftSpecs = result.shaftSpecs;
        club.isManualShaft = result.isManualShaft;
        
        renderIndividualShaftEntry();
      }
    });
  }

  // ============================================
  // SAVE CATEGORY
  // ============================================

  function saveCategoryClubs() {
    const selected = state.selectedClubs[state.currentCategory];
    if (selected.length === 0) return;
    
    // If same set + same shaft, create entries for all
    if (state.sameSetAnswer === true && state.sameShaftAnswer === true) {
      selected.forEach(clubType => {
        // Check if already exists
        const exists = state.clubsData.find(c => 
          c.clubType === clubType && c.category === state.currentCategory
        );
        
        if (!exists) {
          state.clubsData.push({
            category: state.currentCategory,
            clubType: clubType,
            clubHeadSpecId: state.setClubHeadSpec.clubHeadSpecId,
            brand: state.setClubHeadSpec.brand,
            model: state.setClubHeadSpec.model,
            year: state.setClubHeadSpec.year,
            // Include specs from clubHeadSpec
            specs: state.setClubHeadSpec.clubHeadSpec ? {
              loft: state.setClubHeadSpec.clubHeadSpec.loft,
              lie: state.setClubHeadSpec.clubHeadSpec.lie,
              length: state.setClubHeadSpec.clubHeadSpec.length
            } : null,
            shaftId: state.setShaftSpec.shaftId,
            shaftBrand: state.setShaftSpec.brand,
            shaftModel: state.setShaftSpec.model,
            shaftSpecs: {
              weight: state.setShaftSpec.weight,
              flex: state.setShaftSpec.flex,
              kickPoint: state.setShaftSpec.kickPoint,
              torque: state.setShaftSpec.torque
            },
            isManualShaft: state.setShaftSpec.isManual
          });
        }
      });
    }
    
    // If same set + individual shafts - already saved in renderIndividualShaftEntry
    // If individual - already saved in enterClub
  }

  // ============================================
  // SUMMARY
  // ============================================

  function renderSummary() {
    const content = document.getElementById('bo-content');
    
    document.getElementById('bo-title').textContent = 'Bag Summary';
    document.getElementById('bo-subtitle').textContent = `${state.clubsData.length} clubs entered`;
    document.getElementById('bo-progress-bar').style.width = '100%';
    
    let html = '';
    
    categoryOrder.forEach(cat => {
      const clubs = state.clubsData.filter(c => c.category === cat);
      const catInfo = categoryLabels[cat];
      
      html += `<div class="bo-summary-category">`;
      html += `<div class="bo-summary-title">${catInfo.icon} ${catInfo.title}</div>`;
      
      if (clubs.length === 0) {
        html += `<div class="bo-summary-empty">No ${cat} entered</div>`;
      } else {
        html += '<div class="bo-club-list">';
        clubs.forEach(club => {
          html += `
            <div class="bo-club-item">
              <div class="bo-club-item-type">${club.clubType}</div>
              <div class="bo-club-item-info">
                <div class="bo-club-item-name">${club.brand} ${club.model}</div>
                <div class="bo-club-item-shaft">${club.shaftBrand || ''} ${club.shaftModel || ''}</div>
              </div>
            </div>
          `;
        });
        html += '</div>';
      }
      
      html += '</div>';
    });
    
    content.innerHTML = html;
    
    // Update buttons
    document.getElementById('bo-skip').style.display = 'none';
    document.getElementById('bo-next').disabled = state.clubsData.length === 0;
    document.getElementById('bo-next').textContent = 'Save Bag';
    document.getElementById('bo-next').className = 'bo-btn bo-btn-green';
    
    // Change next handler for save
    document.getElementById('bo-next').onclick = finishOnboarding;
  }

  function finishOnboarding() {
    document.getElementById('bag-onboarding-modal').classList.remove('active');
    
    console.log('✅ BagOnboarding complete:', state.clubsData);
    
    if (state.onComplete) {
      state.onComplete(state.clubsData);
    }
  }

  // ============================================
  // EXPOSE PUBLIC API
  // ============================================

  return {
    init,
    start,
    cancel,
    // For onclick handlers
    toggleClub,
    answerSameSet,
    answerSameShaft,
    openClubHeadSelector,
    openShaftSelector,
    enterClub,
    editClub,
    enterShaftForClub
  };

})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BagOnboarding;
}
