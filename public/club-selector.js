/**
 * ClubSelector Component v1.0
 * Reusable club selection for FitMyGolfClubs
 * 
 * Usage:
 *   ClubSelector.init(db);  // Initialize with Firestore instance
 *   ClubSelector.open({ mode: 'known-type', clubType: '7-Iron', onSelect: callback });
 */

const ClubSelector = (function() {
  'use strict';

  // ============================================
  // PRIVATE STATE
  // ============================================
  
  let db = null;
  let clubHeadSpecsCache = null;
  let shaftSpecsCache = null;
  let isInitialized = false;
  
  // Club types by category
  const clubTypesByCategory = {
    woods: ['Driver', '2-Wood', '3-Wood', '4-Wood', '5-Wood', '7-Wood', '9-Wood'],
    hybrids: ['2-Hybrid', '3-Hybrid', '4-Hybrid', '5-Hybrid', '6-Hybrid', '7-Hybrid'],
    irons: ['2-Iron', '3-Iron', '4-Iron', '5-Iron', '6-Iron', '7-Iron', '8-Iron', '9-Iron', 'PW'],
    wedges: ['GW', 'AW', '50°', '52°', '54°', '56°', '58°', '60°', '62°', '64°']
  };
  
  // Current selection state
  let state = {
    mode: null,           // 'full-onboarding' | 'known-type' | 'pick-existing'
    category: null,       // 'woods' | 'hybrids' | 'irons' | 'wedges'
    clubType: null,       // '7-Iron', 'Driver', etc.
    brand: null,
    model: null,
    clubHeadSpecId: null,
    shaftBrand: null,
    shaftModel: null,
    shaftId: null,
    shaftSpecs: {},
    isManualShaft: false,
    specs: {},            // Auto-filled specs from database
    onSelect: null,       // Callback when selection complete
    onCancel: null,       // Callback when cancelled
    userClubs: null       // User's existing clubs (for pick-existing mode)
  };

  // ============================================
  // INITIALIZATION
  // ============================================

  /**
   * Initialize the ClubSelector with Firestore instance
   * @param {Firestore} firestore - Firebase Firestore instance
   */
  async function init(firestore) {
    if (isInitialized) {
      console.log('ClubSelector already initialized');
      return;
    }

    db = firestore;
    
    try {
      await Promise.all([
        loadClubHeadSpecs(),
        loadShaftSpecs()
      ]);
      
      createModalHTML();
      attachEventListeners();
      
      isInitialized = true;
      console.log('✅ ClubSelector initialized');
    } catch (error) {
      console.error('❌ ClubSelector init failed:', error);
      throw error;
    }
  }

  /**
   * Load clubHeadSpecs from Firestore into cache
   */
  async function loadClubHeadSpecs() {
    if (clubHeadSpecsCache) return;
    
    const snapshot = await db.collection('clubHeadSpecs').get();
    clubHeadSpecsCache = {};
    
    snapshot.forEach(doc => {
      clubHeadSpecsCache[doc.id] = { docId: doc.id, ...doc.data() };
    });
    
    console.log(`✅ ClubSelector: Loaded ${Object.keys(clubHeadSpecsCache).length} clubHeadSpecs`);
  }

  /**
   * Load shaftSpecs from Firestore into cache
   */
  async function loadShaftSpecs() {
    if (shaftSpecsCache) return;
    
    const snapshot = await db.collection('shaftSpecDatabase').get();
    shaftSpecsCache = {};
    
    snapshot.forEach(doc => {
      shaftSpecsCache[doc.id] = { docId: doc.id, ...doc.data() };
    });
    
    console.log(`✅ ClubSelector: Loaded ${Object.keys(shaftSpecsCache).length} shaftSpecs`);
  }

  // ============================================
  // MODAL HTML
  // ============================================

  function createModalHTML() {
    // Remove existing if present
    const existing = document.getElementById('club-selector-modal');
    if (existing) existing.remove();

    const modalHTML = `
      <div id="club-selector-modal" class="cs-modal-overlay">
        <div class="cs-modal">
          <div class="cs-modal-header">
            <h3 class="cs-modal-title" id="cs-title">Select Club</h3>
            <button class="cs-modal-close" id="cs-close">&times;</button>
          </div>
          
          <div class="cs-modal-body">
            <!-- Step indicator -->
            <div class="cs-steps" id="cs-steps">
              <span class="cs-step" data-step="category" style="display: none;">Category</span>
              <span class="cs-step-arrow" data-step="category-arrow" style="display: none;">→</span>
              <span class="cs-step" data-step="type" style="display: none;">Type</span>
              <span class="cs-step-arrow" data-step="type-arrow" style="display: none;">→</span>
              <span class="cs-step active" data-step="brand">Brand</span>
              <span class="cs-step-arrow">→</span>
              <span class="cs-step" data-step="model">Model</span>
              <span class="cs-step-arrow">→</span>
              <span class="cs-step" data-step="shaft">Shaft</span>
            </div>
            
            <!-- Pick Existing Mode -->
            <div class="cs-section" id="cs-existing-section" style="display: none;">
              <label class="cs-label">Select from Your Bag</label>
              <select class="cs-input cs-select" id="cs-existing-select">
                <option value="">Choose a club...</option>
              </select>
              <div class="cs-existing-preview" id="cs-existing-preview" style="display: none;">
                <div class="cs-existing-club" id="cs-existing-club-info"></div>
              </div>
            </div>
            
            <!-- Category Selection (Full Onboarding Mode) -->
            <div class="cs-section" id="cs-category-section" style="display: none;">
              <label class="cs-label">Category</label>
              <div class="cs-category-grid">
                <button class="cs-category-btn" data-category="woods" onclick="ClubSelector.selectCategory('woods')">
                  <span class="cs-category-icon">🪵</span>
                  <span class="cs-category-name">Woods</span>
                </button>
                <button class="cs-category-btn" data-category="hybrids" onclick="ClubSelector.selectCategory('hybrids')">
                  <span class="cs-category-icon">⚡</span>
                  <span class="cs-category-name">Hybrids</span>
                </button>
                <button class="cs-category-btn" data-category="irons" onclick="ClubSelector.selectCategory('irons')">
                  <span class="cs-category-icon">🏌️</span>
                  <span class="cs-category-name">Irons</span>
                </button>
                <button class="cs-category-btn" data-category="wedges" onclick="ClubSelector.selectCategory('wedges')">
                  <span class="cs-category-icon">🎯</span>
                  <span class="cs-category-name">Wedges</span>
                </button>
              </div>
            </div>
            
            <!-- Club Type Selection -->
            <div class="cs-section" id="cs-type-section" style="display: none;">
              <label class="cs-label">Club Type</label>
              <div class="cs-type-grid" id="cs-type-grid">
                <!-- Populated by JavaScript -->
              </div>
            </div>
            
            <!-- Brand Selection -->
            <div class="cs-section" id="cs-brand-section">
              <label class="cs-label">Brand</label>
              <div class="cs-autocomplete-wrapper">
                <input type="text" 
                       class="cs-input" 
                       id="cs-brand-input" 
                       placeholder="Type or select brand..."
                       autocomplete="off">
                <div class="cs-dropdown" id="cs-brand-dropdown"></div>
              </div>
            </div>
            
            <!-- Model Selection -->
            <div class="cs-section" id="cs-model-section" style="display: none;">
              <label class="cs-label">Model</label>
              <div class="cs-autocomplete-wrapper">
                <input type="text" 
                       class="cs-input" 
                       id="cs-model-input" 
                       placeholder="Type or select model..."
                       autocomplete="off">
                <div class="cs-dropdown" id="cs-model-dropdown"></div>
              </div>
              
              <!-- Specs Preview -->
              <div class="cs-specs-preview" id="cs-specs-preview" style="display: none;">
                <div class="cs-specs-title">Specs from Database</div>
                <div class="cs-specs-content" id="cs-specs-content"></div>
              </div>
            </div>
            
            <!-- Shaft Selection -->
            <div class="cs-section" id="cs-shaft-section" style="display: none;">
              
              <!-- Stock vs Custom Choice -->
              <div class="cs-shaft-choice" id="cs-shaft-choice">
                <label class="cs-label">Shaft Type</label>
                <div class="cs-choice-buttons">
                  <button class="cs-choice-btn" id="cs-shaft-stock-btn" onclick="ClubSelector.selectShaftType('stock')">
                    Stock Shaft
                  </button>
                  <button class="cs-choice-btn" id="cs-shaft-custom-btn" onclick="ClubSelector.selectShaftType('custom')">
                    Aftermarket
                  </button>
                </div>
              </div>
              
              <!-- Stock Shaft Info (shows when stock selected) -->
              <div class="cs-stock-shaft-info" id="cs-stock-shaft-info" style="display: none;">
                <div class="cs-stock-shaft-name" id="cs-stock-shaft-name"></div>
                <div class="cs-stock-shaft-specs" id="cs-stock-shaft-specs"></div>
              </div>
              
              <!-- Custom Shaft Selection (shows when custom selected) -->
              <div class="cs-custom-shaft" id="cs-custom-shaft" style="display: none;">
                <!-- Shaft Brand -->
                <div class="cs-subsection">
                  <label class="cs-label">Shaft Brand</label>
                  <div class="cs-autocomplete-wrapper">
                    <input type="text" 
                           class="cs-input" 
                           id="cs-shaft-brand-input" 
                           placeholder="Type or select shaft brand..."
                           autocomplete="off">
                    <div class="cs-dropdown" id="cs-shaft-brand-dropdown"></div>
                  </div>
                </div>
                
                <!-- Shaft Model -->
                <div class="cs-subsection" id="cs-shaft-model-section" style="display: none;">
                  <label class="cs-label">Shaft Model</label>
                  <div class="cs-autocomplete-wrapper">
                    <input type="text" 
                           class="cs-input" 
                           id="cs-shaft-model-input" 
                           placeholder="Type or select shaft model..."
                           autocomplete="off">
                    <div class="cs-dropdown" id="cs-shaft-model-dropdown"></div>
                  </div>
                </div>
                
                <!-- Shaft Specs Preview -->
                <div class="cs-specs-preview" id="cs-shaft-specs-preview" style="display: none;">
                  <div class="cs-specs-title">Shaft Specs</div>
                  <div class="cs-specs-content" id="cs-shaft-specs-content"></div>
                </div>
              </div>
              
              <!-- Manual Entry Fallback -->
              <div class="cs-manual-entry" id="cs-manual-entry" style="display: none;">
                <div class="cs-manual-toggle" onclick="ClubSelector.toggleManualEntry()">
                  Can't find shaft? Enter manually ▼
                </div>
                <div class="cs-manual-fields" id="cs-manual-fields" style="display: none;">
                  <div class="cs-manual-row">
                    <input type="text" class="cs-input cs-input-half" id="cs-manual-shaft-brand" placeholder="Brand">
                    <input type="text" class="cs-input cs-input-half" id="cs-manual-shaft-model" placeholder="Model">
                  </div>
                  <div class="cs-manual-row">
                    <input type="text" class="cs-input cs-input-third" id="cs-manual-shaft-weight" placeholder="Weight (g)">
                    <select class="cs-input cs-input-third" id="cs-manual-shaft-flex">
                      <option value="">Flex</option>
                      <option value="L">L - Ladies</option>
                      <option value="A">A - Senior</option>
                      <option value="R">R - Regular</option>
                      <option value="S">S - Stiff</option>
                      <option value="X">X - Extra Stiff</option>
                    </select>
                    <select class="cs-input cs-input-third" id="cs-manual-shaft-kick">
                      <option value="">Kickpoint</option>
                      <option value="low">Low</option>
                      <option value="mid">Mid</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div class="cs-modal-footer">
            <button class="cs-btn cs-btn-secondary" id="cs-cancel">Cancel</button>
            <button class="cs-btn cs-btn-primary" id="cs-confirm" disabled>Select Club</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    injectStyles();
  }

  function injectStyles() {
    if (document.getElementById('club-selector-styles')) return;

    const styles = `
      <style id="club-selector-styles">
        /* Modal Overlay */
        .cs-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.85);
          display: none;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          padding: 20px;
        }
        .cs-modal-overlay.active {
          display: flex;
        }

        /* Modal Container */
        .cs-modal {
          background: #1a1d29;
          border-radius: 16px;
          width: 100%;
          max-width: 480px;
          max-height: 90vh;
          overflow: visible;
          display: flex;
          flex-direction: column;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        }

        /* Header */
        .cs-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .cs-modal-title {
          font-size: 18px;
          font-weight: 600;
          color: #fff;
          margin: 0;
        }
        .cs-modal-close {
          background: none;
          border: none;
          color: #888;
          font-size: 24px;
          cursor: pointer;
          padding: 0;
          line-height: 1;
        }
        .cs-modal-close:hover {
          color: #fff;
        }

        /* Body */
        .cs-modal-body {
          padding: 20px;
          overflow-y: auto;
          overflow-x: visible;
          flex: 1;
          max-height: calc(90vh - 140px);
        }

        /* Step Indicator */
        .cs-steps {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-bottom: 20px;
          font-size: 12px;
        }
        .cs-step {
          color: #555;
          padding: 4px 10px;
          border-radius: 12px;
          background: rgba(255,255,255,0.05);
        }
        .cs-step.active {
          color: #00d4ff;
          background: rgba(0, 212, 255, 0.15);
        }
        .cs-step.complete {
          color: #00c864;
          background: rgba(0, 200, 100, 0.15);
        }
        .cs-step-arrow {
          color: #444;
          font-size: 10px;
        }

        /* Category Grid */
        .cs-category-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
        }
        .cs-category-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 16px 12px;
          background: rgba(0,0,0,0.3);
          border: 2px solid #333;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .cs-category-btn:hover {
          border-color: #555;
          background: rgba(0,0,0,0.4);
        }
        .cs-category-btn.active {
          border-color: #00d4ff;
          background: rgba(0, 212, 255, 0.1);
        }
        .cs-category-icon {
          font-size: 24px;
          margin-bottom: 6px;
        }
        .cs-category-name {
          font-size: 13px;
          color: #aaa;
        }
        .cs-category-btn.active .cs-category-name {
          color: #00d4ff;
        }

        /* Club Type Grid */
        .cs-type-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .cs-type-btn {
          padding: 10px 14px;
          background: rgba(0,0,0,0.3);
          border: 2px solid #333;
          border-radius: 8px;
          color: #888;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .cs-type-btn:hover {
          border-color: #555;
          color: #aaa;
        }
        .cs-type-btn.active {
          border-color: #00d4ff;
          background: rgba(0, 212, 255, 0.1);
          color: #00d4ff;
        }

        /* Existing Club Selection */
        .cs-select {
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 12px center;
          padding-right: 36px;
        }
        .cs-existing-preview {
          margin-top: 12px;
          padding: 14px;
          background: rgba(0, 212, 255, 0.1);
          border: 1px solid rgba(0, 212, 255, 0.3);
          border-radius: 8px;
        }
        .cs-existing-club {
          font-size: 13px;
          color: #aaa;
        }
        .cs-existing-club strong {
          color: #fff;
          display: block;
          margin-bottom: 4px;
        }

        /* Sections */
        .cs-section {
          margin-bottom: 20px;
          overflow: visible;
        }
        .cs-label {
          display: block;
          font-size: 12px;
          color: #888;
          margin-bottom: 8px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        /* Input */
        .cs-input {
          width: 100%;
          padding: 12px 14px;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid #333;
          border-radius: 8px;
          color: #fff;
          font-size: 15px;
          outline: none;
          transition: border-color 0.2s;
        }
        .cs-input:focus {
          border-color: #00d4ff;
        }
        .cs-input::placeholder {
          color: #555;
        }

        /* Autocomplete Wrapper */
        .cs-autocomplete-wrapper {
          position: relative;
        }

        /* Dropdown */
        .cs-dropdown {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          background: #252a38;
          border: 1px solid #333;
          border-radius: 8px;
          max-height: 250px;
          overflow-y: auto;
          display: none;
          z-index: 10001;
          margin-top: 4px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
        }
        .cs-dropdown.show {
          display: block;
        }
        .cs-dropdown-item {
          padding: 10px 14px;
          cursor: pointer;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          transition: background 0.15s;
        }
        .cs-dropdown-item:last-child {
          border-bottom: none;
        }
        .cs-dropdown-item:hover {
          background: rgba(0, 212, 255, 0.1);
        }
        .cs-dropdown-item-title {
          font-size: 14px;
          color: #fff;
        }
        .cs-dropdown-item-subtitle {
          font-size: 11px;
          color: #888;
          margin-top: 2px;
        }
        .cs-dropdown-section {
          padding: 8px 14px 4px;
          font-size: 10px;
          color: #00d4ff;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          background: rgba(0,0,0,0.2);
        }

        /* Specs Preview */
        .cs-specs-preview {
          margin-top: 12px;
          padding: 12px;
          background: rgba(0, 200, 100, 0.1);
          border: 1px solid rgba(0, 200, 100, 0.3);
          border-radius: 8px;
        }
        .cs-specs-title {
          font-size: 11px;
          color: #00c864;
          text-transform: uppercase;
          margin-bottom: 6px;
        }
        .cs-specs-content {
          font-size: 13px;
          color: #aaa;
        }

        /* Footer */
        .cs-modal-footer {
          display: flex;
          gap: 10px;
          padding: 16px 20px;
          border-top: 1px solid rgba(255,255,255,0.1);
        }

        /* Buttons */
        .cs-btn {
          flex: 1;
          padding: 12px 16px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          border: none;
        }
        .cs-btn-primary {
          background: linear-gradient(135deg, #00d4ff, #0099cc);
          color: #000;
        }
        .cs-btn-primary:hover:not(:disabled) {
          opacity: 0.9;
        }
        .cs-btn-primary:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .cs-btn-secondary {
          background: #333;
          color: #aaa;
        }
        .cs-btn-secondary:hover {
          background: #444;
          color: #fff;
        }

        /* Shaft placeholder */
        .cs-shaft-placeholder {
          padding: 20px;
          text-align: center;
          color: #555;
          font-style: italic;
          background: rgba(0,0,0,0.2);
          border-radius: 8px;
        }

        /* Shaft Choice Buttons */
        .cs-choice-buttons {
          display: flex;
          gap: 10px;
        }
        .cs-choice-btn {
          flex: 1;
          padding: 12px;
          background: rgba(0,0,0,0.3);
          border: 2px solid #333;
          border-radius: 8px;
          color: #888;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .cs-choice-btn:hover {
          border-color: #555;
          color: #aaa;
        }
        .cs-choice-btn.active {
          border-color: #00d4ff;
          background: rgba(0, 212, 255, 0.1);
          color: #00d4ff;
        }

        /* Stock Shaft Info */
        .cs-stock-shaft-info {
          margin-top: 12px;
          padding: 14px;
          background: rgba(0, 200, 100, 0.1);
          border: 1px solid rgba(0, 200, 100, 0.3);
          border-radius: 8px;
        }
        .cs-stock-shaft-name {
          font-size: 15px;
          font-weight: 600;
          color: #00c864;
          margin-bottom: 4px;
        }
        .cs-stock-shaft-specs {
          font-size: 12px;
          color: #888;
        }

        /* Custom Shaft Section */
        .cs-custom-shaft {
          margin-top: 12px;
        }
        .cs-subsection {
          margin-bottom: 14px;
        }

        /* Manual Entry */
        .cs-manual-entry {
          margin-top: 16px;
          border-top: 1px solid rgba(255,255,255,0.1);
          padding-top: 12px;
        }
        .cs-manual-toggle {
          font-size: 13px;
          color: #00d4ff;
          cursor: pointer;
          text-align: center;
          padding: 8px;
        }
        .cs-manual-toggle:hover {
          text-decoration: underline;
        }
        .cs-manual-fields {
          margin-top: 12px;
        }
        .cs-manual-row {
          display: flex;
          gap: 8px;
          margin-bottom: 10px;
        }
        .cs-input-half {
          flex: 1;
        }
        .cs-input-third {
          flex: 1;
        }
      </style>
    `;

    document.head.insertAdjacentHTML('beforeend', styles);
  }

  // ============================================
  // EVENT LISTENERS
  // ============================================

  function attachEventListeners() {
    const modal = document.getElementById('club-selector-modal');
    const brandInput = document.getElementById('cs-brand-input');
    const modelInput = document.getElementById('cs-model-input');
    const closeBtn = document.getElementById('cs-close');
    const cancelBtn = document.getElementById('cs-cancel');
    const confirmBtn = document.getElementById('cs-confirm');

    // Close modal
    closeBtn.addEventListener('click', close);
    cancelBtn.addEventListener('click', close);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });

    // Existing club select
    const existingSelect = document.getElementById('cs-existing-select');
    existingSelect.addEventListener('change', (e) => selectExistingClub(e.target.value));

    // Brand input
    brandInput.addEventListener('input', () => showBrandSuggestions());
    brandInput.addEventListener('focus', () => showBrandSuggestions());
    brandInput.addEventListener('blur', () => {
      setTimeout(() => hideBrandDropdown(), 150);
    });

    // Model input
    modelInput.addEventListener('input', () => showModelSuggestions());
    modelInput.addEventListener('focus', () => showModelSuggestions());
    modelInput.addEventListener('blur', () => {
      setTimeout(() => hideModelDropdown(), 150);
    });

    // Confirm
    confirmBtn.addEventListener('click', confirmSelection);

    // Shaft brand input
    const shaftBrandInput = document.getElementById('cs-shaft-brand-input');
    shaftBrandInput.addEventListener('input', () => showShaftBrandSuggestions());
    shaftBrandInput.addEventListener('focus', () => showShaftBrandSuggestions());
    shaftBrandInput.addEventListener('blur', () => {
      setTimeout(() => hideShaftBrandDropdown(), 150);
    });

    // Shaft model input
    const shaftModelInput = document.getElementById('cs-shaft-model-input');
    shaftModelInput.addEventListener('input', () => showShaftModelSuggestions());
    shaftModelInput.addEventListener('focus', () => showShaftModelSuggestions());
    shaftModelInput.addEventListener('blur', () => {
      setTimeout(() => hideShaftModelDropdown(), 150);
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.cs-autocomplete-wrapper')) {
        hideBrandDropdown();
        hideModelDropdown();
      }
    });
  }

  // ============================================
  // CATEGORY & TYPE SELECTION
  // ============================================

  /**
   * Select a category (Woods, Hybrids, Irons, Wedges)
   */
  function selectCategory(category) {
    state.category = category;
    state.clubType = null;
    state.brand = null;
    state.model = null;
    state.clubHeadSpecId = null;

    // Update category button states
    document.querySelectorAll('.cs-category-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.category === category);
    });

    // Update step indicator
    updateStepIndicator('type');

    // Populate club types for this category
    const typeGrid = document.getElementById('cs-type-grid');
    const types = clubTypesByCategory[category] || [];
    
    typeGrid.innerHTML = types.map(type => 
      `<button class="cs-type-btn" data-type="${type}" onclick="ClubSelector.selectClubType('${type}')">${type}</button>`
    ).join('');

    // Show type section
    document.getElementById('cs-type-section').style.display = 'block';

    // Hide downstream sections
    document.getElementById('cs-brand-section').style.display = 'none';
    document.getElementById('cs-model-section').style.display = 'none';
    document.getElementById('cs-shaft-section').style.display = 'none';
    document.getElementById('cs-confirm').disabled = true;

    console.log('✅ Category selected:', category);
  }

  /**
   * Select a club type within category
   */
  function selectClubType(clubType) {
    state.clubType = clubType;
    state.brand = null;
    state.model = null;
    state.clubHeadSpecId = null;

    // Update type button states
    document.querySelectorAll('.cs-type-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.type === clubType);
    });

    // Update step indicator
    updateStepIndicator('brand');

    // Show brand section
    document.getElementById('cs-brand-section').style.display = 'block';
    document.getElementById('cs-brand-input').value = '';
    document.getElementById('cs-brand-input').focus();

    // Hide downstream sections
    document.getElementById('cs-model-section').style.display = 'none';
    document.getElementById('cs-shaft-section').style.display = 'none';
    document.getElementById('cs-confirm').disabled = true;

    console.log('✅ Club type selected:', clubType);
  }

  // ============================================
  // EXISTING CLUB SELECTION (pick-existing mode)
  // ============================================

  /**
   * Select an existing club from user's bag
   */
  function selectExistingClub(clubId) {
    if (!clubId || !state.userClubs) {
      document.getElementById('cs-existing-preview').style.display = 'none';
      document.getElementById('cs-confirm').disabled = true;
      return;
    }

    const club = state.userClubs.find(c => c.id === clubId);
    if (!club) {
      console.error('Club not found:', clubId);
      return;
    }

    // Store selection
    state.selectedExistingClub = club;
    state.clubHeadSpecId = club.clubHeadSpecId || null;
    state.brand = club.brand;
    state.model = club.model;
    state.clubType = club.clubType;
    state.shaftId = club.shaftId || null;
    state.shaftBrand = club.shaft_brand || club.shaftBrand;
    state.shaftModel = club.shaft_model || club.shaftModel;

    // Show preview
    const preview = document.getElementById('cs-existing-preview');
    const info = document.getElementById('cs-existing-club-info');
    
    let html = `<strong>${club.clubType} - ${club.brand} ${club.model}</strong>`;
    
    const specs = [];
    if (club.loft) specs.push(`${club.loft}°`);
    if (club.shaft_brand || club.shaftBrand) {
      specs.push(`${club.shaft_brand || club.shaftBrand} ${club.shaft_model || club.shaftModel || ''}`);
    }
    if (club.shaft_flex || club.shaftFlex) specs.push(club.shaft_flex || club.shaftFlex);
    
    if (specs.length > 0) {
      html += `<br>${specs.join(' • ')}`;
    }
    
    info.innerHTML = html;
    preview.style.display = 'block';

    // Enable confirm
    document.getElementById('cs-confirm').disabled = false;

    console.log('✅ Existing club selected:', club.clubType, club.brand, club.model);
  }

  /**
   * Populate existing clubs dropdown
   */
  function populateExistingClubs() {
    const select = document.getElementById('cs-existing-select');
    select.innerHTML = '<option value="">Choose a club...</option>';

    if (!state.userClubs || state.userClubs.length === 0) {
      select.innerHTML = '<option value="">No clubs in bag</option>';
      return;
    }

    // Group by category
    const byCategory = { woods: [], hybrids: [], irons: [], wedges: [] };
    
    state.userClubs.forEach(club => {
      const cat = getCategoryForClubType(club.clubType);
      if (byCategory[cat]) {
        byCategory[cat].push(club);
      }
    });

    // Build options grouped by category
    Object.entries(byCategory).forEach(([cat, clubs]) => {
      if (clubs.length === 0) return;
      
      const optgroup = document.createElement('optgroup');
      optgroup.label = cat.charAt(0).toUpperCase() + cat.slice(1);
      
      clubs.forEach(club => {
        const option = document.createElement('option');
        option.value = club.id;
        option.textContent = `${club.clubType} - ${club.brand} ${club.model}`;
        optgroup.appendChild(option);
      });
      
      select.appendChild(optgroup);
    });
  }

  /**
   * Get category for a club type
   */
  function getCategoryForClubType(clubType) {
    if (!clubType) return 'irons';
    const t = clubType.toLowerCase();
    
    if (t === 'driver' || t.includes('wood')) return 'woods';
    if (t.includes('hybrid')) return 'hybrids';
    if (t.includes('iron') || t === 'pw') return 'irons';
    if (t.includes('°') || t === 'gw' || t === 'aw' || t === 'sw' || t === 'lw') return 'wedges';
    
    return 'irons';
  }

  // ============================================
  // BRAND AUTOCOMPLETE
  // ============================================

  function showBrandSuggestions() {
    const input = document.getElementById('cs-brand-input');
    const dropdown = document.getElementById('cs-brand-dropdown');
    const search = input.value.toLowerCase().trim();

    if (!clubHeadSpecsCache) {
      dropdown.classList.remove('show');
      return;
    }

    // Get unique brands
    const brandsSet = new Set();
    Object.values(clubHeadSpecsCache).forEach(spec => {
      if (spec.brand) brandsSet.add(spec.brand);
    });

    // Popular brands (show first when empty)
    const popularBrands = ['Callaway', 'TaylorMade', 'Titleist', 'Ping', 'Cobra', 'Mizuno', 'Srixon', 'Cleveland'];

    let filtered;
    if (search.length === 0) {
      // Show popular brands first
      filtered = popularBrands.filter(b => brandsSet.has(b));
    } else {
      // Filter by search
      filtered = [...brandsSet]
        .filter(b => b.toLowerCase().includes(search))
        .sort((a, b) => {
          // Prioritize starts-with matches
          const aStarts = a.toLowerCase().startsWith(search);
          const bStarts = b.toLowerCase().startsWith(search);
          if (aStarts && !bStarts) return -1;
          if (!aStarts && bStarts) return 1;
          return a.localeCompare(b);
        });
    }

    if (filtered.length === 0) {
      dropdown.classList.remove('show');
      return;
    }

    // Build dropdown HTML
    let html = '';
    if (search.length === 0) {
      html += '<div class="cs-dropdown-section">Popular Brands</div>';
    }
    
    filtered.slice(0, 12).forEach(brand => {
      html += `
        <div class="cs-dropdown-item" onclick="ClubSelector.selectBrand('${brand}')">
          <div class="cs-dropdown-item-title">${brand}</div>
        </div>
      `;
    });

    dropdown.innerHTML = html;
    dropdown.classList.add('show');
  }

  function hideBrandDropdown() {
    document.getElementById('cs-brand-dropdown').classList.remove('show');
  }

  function selectBrand(brand) {
    state.brand = brand;
    state.model = null;
    state.clubHeadSpecId = null;
    state.specs = {};

    // Update UI
    document.getElementById('cs-brand-input').value = brand;
    hideBrandDropdown();

    // Update steps
    updateStepIndicator('model');

    // Show model section
    document.getElementById('cs-model-section').style.display = 'block';
    document.getElementById('cs-model-input').value = '';
    document.getElementById('cs-model-input').focus();
    document.getElementById('cs-specs-preview').style.display = 'none';

    // Disable confirm until model selected
    document.getElementById('cs-confirm').disabled = true;

    console.log('✅ Brand selected:', brand);
  }

  // ============================================
  // MODEL AUTOCOMPLETE
  // ============================================

  function showModelSuggestions() {
    const input = document.getElementById('cs-model-input');
    const dropdown = document.getElementById('cs-model-dropdown');
    const search = input.value.toLowerCase().trim();

    if (!clubHeadSpecsCache || !state.brand) {
      dropdown.classList.remove('show');
      return;
    }

    // Filter models by brand and optionally by club type
    const models = [];
    const brandLower = state.brand.toLowerCase();
    
    Object.entries(clubHeadSpecsCache).forEach(([docId, spec]) => {
      // Case-insensitive brand match
      if ((spec.brand || '').toLowerCase() !== brandLower) return;
      
      // If club type is set, filter by type
      if (state.clubType) {
        const clubKey = getClubKey(state.clubType);
        
        // spec.clubs is an OBJECT like {'Driver': {...}, '7i': {...}, '56°': {...}}
        // Keys are club identifiers, values contain specs (loft, lie, length, etc.)
        if (spec.clubs && typeof spec.clubs === 'object' && !Array.isArray(spec.clubs)) {
          const clubKeys = Object.keys(spec.clubs);
          const hasClub = clubKeys.some(k => 
            k.toLowerCase() === clubKey.toLowerCase()
          );
          if (!hasClub) return;
        } else {
          // No clubs object - skip this spec for typed searches
          return;
        }
      }

      const modelName = `${spec.model || ''} ${spec.year || ''}`.toLowerCase();
      if (search.length === 0 || modelName.includes(search)) {
        models.push({
          docId: docId,
          model: spec.model,
          year: spec.year,
          type: spec.type
        });
      }
    });

    // Sort by year (newest first), then model name
    models.sort((a, b) => {
      if (a.year !== b.year) return (b.year || 0) - (a.year || 0);
      return (a.model || '').localeCompare(b.model || '');
    });

    if (models.length === 0) {
      dropdown.innerHTML = `
        <div class="cs-dropdown-item" style="color: #888; cursor: default;">
          No models found for ${state.brand}
        </div>
      `;
      dropdown.classList.add('show');
      return;
    }

    // Group by year
    const byYear = {};
    models.forEach(m => {
      const year = m.year || 'Unknown';
      if (!byYear[year]) byYear[year] = [];
      byYear[year].push(m);
    });

    // Build dropdown HTML
    let html = '';
    Object.keys(byYear).sort((a, b) => b - a).slice(0, 5).forEach(year => {
      html += `<div class="cs-dropdown-section">${year}</div>`;
      byYear[year].slice(0, 10).forEach(m => {
        const displayName = `${m.model}${m.year ? ' (' + m.year + ')' : ''}`;
        html += `
          <div class="cs-dropdown-item" onclick="ClubSelector.selectModel('${m.docId}')">
            <div class="cs-dropdown-item-title">${m.model}</div>
            <div class="cs-dropdown-item-subtitle">${m.type || ''}</div>
          </div>
        `;
      });
    });

    dropdown.innerHTML = html;
    dropdown.classList.add('show');
  }

  function hideModelDropdown() {
    document.getElementById('cs-model-dropdown').classList.remove('show');
  }

  function selectModel(docId) {
    const spec = clubHeadSpecsCache[docId];
    if (!spec) {
      console.error('Model not found:', docId);
      return;
    }

    state.model = spec.model;
    state.clubHeadSpecId = docId;

    // Get specs for the selected club type
    if (state.clubType) {
      const clubKey = getClubKey(state.clubType);
      if (spec.clubs && spec.clubs[clubKey]) {
        state.specs = {
          loft: spec.clubs[clubKey].loft,
          lie: spec.clubs[clubKey].lie,
          length: spec.clubs[clubKey].length
        };
      }
    }

    // Update UI
    const displayName = `${spec.model}${spec.year ? ' (' + spec.year + ')' : ''}`;
    document.getElementById('cs-model-input').value = displayName;
    hideModelDropdown();

    // Update steps
    updateStepIndicator('shaft');

    // Show specs preview
    showSpecsPreview(spec);

    // Show shaft section
    document.getElementById('cs-shaft-section').style.display = 'block';
    
    // Reset shaft selection
    document.getElementById('cs-shaft-stock-btn').classList.remove('active');
    document.getElementById('cs-shaft-custom-btn').classList.remove('active');
    document.getElementById('cs-stock-shaft-info').style.display = 'none';
    document.getElementById('cs-custom-shaft').style.display = 'none';
    document.getElementById('cs-manual-entry').style.display = 'none';
    
    // Disable confirm until shaft selected
    document.getElementById('cs-confirm').disabled = true;

    console.log('✅ Model selected:', spec.model, '| DocId:', docId);
  }

  function showSpecsPreview(spec) {
    const preview = document.getElementById('cs-specs-preview');
    const content = document.getElementById('cs-specs-content');

    if (!spec) {
      preview.style.display = 'none';
      return;
    }

    let specsHtml = '';
    
    if (state.clubType) {
      const clubKey = getClubKey(state.clubType);
      if (spec.clubs && spec.clubs[clubKey]) {
        const clubSpec = spec.clubs[clubKey];
        if (clubSpec.loft) specsHtml += `Loft: ${clubSpec.loft}° • `;
        if (clubSpec.lie) specsHtml += `Lie: ${clubSpec.lie}° • `;
        if (clubSpec.length) specsHtml += `Length: ${clubSpec.length}"`;
      }
    }

    if (!specsHtml) {
      specsHtml = `Year: ${spec.year || 'N/A'} • Type: ${spec.type || 'N/A'}`;
    }

    content.innerHTML = specsHtml;
    preview.style.display = 'block';
  }

  // ============================================
  // SHAFT SELECTION
  // ============================================

  /**
   * Select stock or custom shaft type
   */
  function selectShaftType(type) {
    // Update button states
    document.getElementById('cs-shaft-stock-btn').classList.toggle('active', type === 'stock');
    document.getElementById('cs-shaft-custom-btn').classList.toggle('active', type === 'custom');

    // Hide both sections first
    document.getElementById('cs-stock-shaft-info').style.display = 'none';
    document.getElementById('cs-custom-shaft').style.display = 'none';
    document.getElementById('cs-manual-entry').style.display = 'none';

    if (type === 'stock') {
      showStockShaft();
    } else {
      showCustomShaftEntry();
    }
  }

  /**
   * Show stock shaft info for selected club head
   */
  function showStockShaft() {
    const spec = clubHeadSpecsCache[state.clubHeadSpecId];
    if (!spec) return;

    const stockShaftRefs = spec.stockShaftRefs || [];
    
    if (stockShaftRefs.length === 0) {
      // No stock shaft data - show message
      document.getElementById('cs-stock-shaft-info').style.display = 'block';
      document.getElementById('cs-stock-shaft-name').textContent = 'Stock shaft not in database';
      document.getElementById('cs-stock-shaft-specs').textContent = 'Please select Aftermarket and enter shaft details';
      document.getElementById('cs-confirm').disabled = true;
      return;
    }

    // Get default stock shaft
    const defaultRef = stockShaftRefs.find(s => s.isDefault) || stockShaftRefs[0];
    const shaftId = defaultRef.shaftId;
    const shaft = shaftSpecsCache[shaftId];

    if (!shaft) {
      document.getElementById('cs-stock-shaft-info').style.display = 'block';
      document.getElementById('cs-stock-shaft-name').textContent = 'Stock shaft data unavailable';
      document.getElementById('cs-stock-shaft-specs').textContent = 'Please select Aftermarket and enter shaft details';
      document.getElementById('cs-confirm').disabled = true;
      return;
    }

    // Update state
    state.shaftId = shaftId;
    state.shaftBrand = shaft.brand;
    state.shaftModel = shaft.model;
    state.shaftSpecs = {
      weight: shaft.weight,
      flex: shaft.flex,
      kickPoint: shaft.kickPoint,
      torque: shaft.torque
    };

    // Show stock shaft info
    document.getElementById('cs-stock-shaft-info').style.display = 'block';
    document.getElementById('cs-stock-shaft-name').textContent = `${shaft.brand} ${shaft.model}`;
    
    let specsText = [];
    if (shaft.weight) specsText.push(`${shaft.weight}g`);
    if (shaft.flex) specsText.push(shaft.flex);
    if (shaft.kickPoint) specsText.push(`${shaft.kickPoint} kick`);
    if (shaft.torque) specsText.push(`${shaft.torque}° torque`);
    document.getElementById('cs-stock-shaft-specs').textContent = specsText.join(' • ');

    // Enable confirm
    document.getElementById('cs-confirm').disabled = false;

    console.log('✅ Stock shaft selected:', shaft.brand, shaft.model, '| ShaftId:', shaftId);
  }

  /**
   * Show custom shaft entry fields
   */
  function showCustomShaftEntry() {
    // Clear shaft state
    state.shaftId = null;
    state.shaftBrand = null;
    state.shaftModel = null;
    state.shaftSpecs = {};

    // Show custom entry
    document.getElementById('cs-custom-shaft').style.display = 'block';
    document.getElementById('cs-manual-entry').style.display = 'block';
    document.getElementById('cs-shaft-brand-input').value = '';
    document.getElementById('cs-shaft-model-section').style.display = 'none';
    document.getElementById('cs-shaft-specs-preview').style.display = 'none';
    
    // Focus on shaft brand
    document.getElementById('cs-shaft-brand-input').focus();
    
    // Disable confirm until shaft selected
    document.getElementById('cs-confirm').disabled = true;
  }

  // ============================================
  // SHAFT BRAND AUTOCOMPLETE
  // ============================================

  function showShaftBrandSuggestions() {
    const input = document.getElementById('cs-shaft-brand-input');
    const dropdown = document.getElementById('cs-shaft-brand-dropdown');
    const search = input.value.toLowerCase().trim();

    if (!shaftSpecsCache) {
      dropdown.classList.remove('show');
      return;
    }

    // Get unique brands
    const brandsSet = new Set();
    Object.values(shaftSpecsCache).forEach(shaft => {
      if (shaft.brand) brandsSet.add(shaft.brand);
    });

    // Popular shaft brands
    const popularBrands = ['Fujikura', 'Project X', 'True Temper', 'Mitsubishi', 'Graphite Design', 'KBS', 'Nippon', 'Aldila'];

    let filtered;
    if (search.length === 0) {
      filtered = popularBrands.filter(b => brandsSet.has(b));
    } else {
      filtered = [...brandsSet]
        .filter(b => b.toLowerCase().includes(search))
        .sort((a, b) => {
          const aStarts = a.toLowerCase().startsWith(search);
          const bStarts = b.toLowerCase().startsWith(search);
          if (aStarts && !bStarts) return -1;
          if (!aStarts && bStarts) return 1;
          return a.localeCompare(b);
        });
    }

    if (filtered.length === 0) {
      dropdown.classList.remove('show');
      return;
    }

    let html = '';
    if (search.length === 0) {
      html += '<div class="cs-dropdown-section">Popular Shaft Brands</div>';
    }
    
    filtered.slice(0, 12).forEach(brand => {
      html += `
        <div class="cs-dropdown-item" onclick="ClubSelector.selectShaftBrand('${brand}')">
          <div class="cs-dropdown-item-title">${brand}</div>
        </div>
      `;
    });

    dropdown.innerHTML = html;
    dropdown.classList.add('show');
  }

  function hideShaftBrandDropdown() {
    document.getElementById('cs-shaft-brand-dropdown').classList.remove('show');
  }

  function selectShaftBrand(brand) {
    state.shaftBrand = brand;
    state.shaftModel = null;
    state.shaftId = null;
    state.shaftSpecs = {};

    document.getElementById('cs-shaft-brand-input').value = brand;
    hideShaftBrandDropdown();

    // Show shaft model section
    document.getElementById('cs-shaft-model-section').style.display = 'block';
    document.getElementById('cs-shaft-model-input').value = '';
    document.getElementById('cs-shaft-model-input').focus();
    document.getElementById('cs-shaft-specs-preview').style.display = 'none';

    document.getElementById('cs-confirm').disabled = true;

    console.log('✅ Shaft brand selected:', brand);
  }

  // ============================================
  // SHAFT MODEL AUTOCOMPLETE
  // ============================================

  function showShaftModelSuggestions() {
    const input = document.getElementById('cs-shaft-model-input');
    const dropdown = document.getElementById('cs-shaft-model-dropdown');
    const search = input.value.toLowerCase().trim();

    if (!shaftSpecsCache || !state.shaftBrand) {
      dropdown.classList.remove('show');
      return;
    }

    // Filter shafts by brand and search
    const shafts = [];
    Object.entries(shaftSpecsCache).forEach(([docId, shaft]) => {
      if (shaft.brand !== state.shaftBrand) return;

      const modelName = `${shaft.model || ''} ${shaft.flex || ''}`.toLowerCase();
      if (search.length === 0 || modelName.includes(search)) {
        shafts.push({
          docId: docId,
          model: shaft.model,
          flex: shaft.flex,
          weight: shaft.weight,
          kickPoint: shaft.kickPoint
        });
      }
    });

    // Sort by model, then flex
    shafts.sort((a, b) => {
      if (a.model !== b.model) return (a.model || '').localeCompare(b.model || '');
      return (a.flex || '').localeCompare(b.flex || '');
    });

    if (shafts.length === 0) {
      dropdown.innerHTML = `
        <div class="cs-dropdown-item" style="color: #888; cursor: default;">
          No shafts found for ${state.shaftBrand}
        </div>
      `;
      dropdown.classList.add('show');
      return;
    }

    // Build dropdown
    let html = '';
    shafts.slice(0, 20).forEach(s => {
      const subtitle = [s.weight ? `${s.weight}g` : null, s.flex, s.kickPoint ? `${s.kickPoint} kick` : null]
        .filter(Boolean).join(' • ');
      html += `
        <div class="cs-dropdown-item" onclick="ClubSelector.selectShaftModel('${s.docId}')">
          <div class="cs-dropdown-item-title">${s.model}${s.flex ? ' ' + s.flex : ''}</div>
          <div class="cs-dropdown-item-subtitle">${subtitle}</div>
        </div>
      `;
    });

    dropdown.innerHTML = html;
    dropdown.classList.add('show');
  }

  function hideShaftModelDropdown() {
    document.getElementById('cs-shaft-model-dropdown').classList.remove('show');
  }

  function selectShaftModel(docId) {
    const shaft = shaftSpecsCache[docId];
    if (!shaft) {
      console.error('Shaft not found:', docId);
      return;
    }

    state.shaftModel = shaft.model;
    state.shaftId = docId;
    state.shaftSpecs = {
      weight: shaft.weight,
      flex: shaft.flex,
      kickPoint: shaft.kickPoint,
      torque: shaft.torque
    };

    // Update UI
    const displayName = `${shaft.model}${shaft.flex ? ' ' + shaft.flex : ''}`;
    document.getElementById('cs-shaft-model-input').value = displayName;
    hideShaftModelDropdown();

    // Show shaft specs preview
    const preview = document.getElementById('cs-shaft-specs-preview');
    const content = document.getElementById('cs-shaft-specs-content');
    
    let specsText = [];
    if (shaft.weight) specsText.push(`${shaft.weight}g`);
    if (shaft.flex) specsText.push(`Flex: ${shaft.flex}`);
    if (shaft.kickPoint) specsText.push(`${shaft.kickPoint} kickpoint`);
    if (shaft.torque) specsText.push(`${shaft.torque}° torque`);
    
    content.textContent = specsText.join(' • ');
    preview.style.display = 'block';

    // Enable confirm
    document.getElementById('cs-confirm').disabled = false;

    console.log('✅ Shaft selected:', shaft.model, '| ShaftId:', docId);
  }

  // ============================================
  // MANUAL SHAFT ENTRY
  // ============================================

  function toggleManualEntry() {
    const fields = document.getElementById('cs-manual-fields');
    const isVisible = fields.style.display !== 'none';
    fields.style.display = isVisible ? 'none' : 'block';

    if (!isVisible) {
      // Add listener for manual fields to enable confirm
      const manualInputs = fields.querySelectorAll('input, select');
      manualInputs.forEach(input => {
        input.addEventListener('input', checkManualEntryComplete);
        input.addEventListener('change', checkManualEntryComplete);
      });
    }
  }

  function checkManualEntryComplete() {
    const brand = document.getElementById('cs-manual-shaft-brand').value.trim();
    const model = document.getElementById('cs-manual-shaft-model').value.trim();
    const weight = document.getElementById('cs-manual-shaft-weight').value.trim();
    const flex = document.getElementById('cs-manual-shaft-flex').value;

    if (brand && model && (weight || flex)) {
      // Update state with manual entry
      state.shaftBrand = brand;
      state.shaftModel = model;
      state.shaftId = null; // No database ID for manual entry
      state.shaftSpecs = {
        weight: weight ? parseInt(weight) : null,
        flex: flex || null,
        kickPoint: document.getElementById('cs-manual-shaft-kick').value || null
      };
      state.isManualShaft = true;

      document.getElementById('cs-confirm').disabled = false;
    } else {
      document.getElementById('cs-confirm').disabled = true;
    }
  }

  // ============================================
  // STEP INDICATOR
  // ============================================

  function updateStepIndicator(currentStep) {
    const steps = document.querySelectorAll('.cs-step');
    const stepOrder = state.mode === 'full-onboarding' 
      ? ['category', 'type', 'brand', 'model', 'shaft']
      : ['brand', 'model', 'shaft'];
    
    const currentIndex = stepOrder.indexOf(currentStep);

    steps.forEach((step) => {
      const stepName = step.dataset.step;
      if (!stepName) return; // Skip arrows
      
      const stepIndex = stepOrder.indexOf(stepName);
      if (stepIndex === -1) return; // Step not in current mode

      step.classList.remove('active', 'complete');
      
      if (stepIndex < currentIndex) {
        step.classList.add('complete');
      } else if (stepIndex === currentIndex) {
        step.classList.add('active');
      }
    });
  }

  // ============================================
  // HELPERS
  // ============================================

  function getClubKey(clubType) {
    if (!clubType) return null;
    
    // Convert "7-Iron" to "7i", "Driver" to "Driver", "3-Wood" to "3W", etc.
    // Database uses: 'Driver', '3W', '5W', '7W', '3H', '4H', '7i', '8i', 'PW'
    const t = clubType.toLowerCase();
    
    if (t === 'driver') return 'Driver';
    if (t.includes('wood')) {
      // "3-Wood" -> "3W"
      const num = t.match(/\d+/);
      return num ? num[0] + 'W' : t;
    }
    if (t.includes('hybrid')) {
      // "4-Hybrid" -> "4H"
      const num = t.match(/\d+/);
      return num ? num[0] + 'H' : t;
    }
    if (t.includes('iron')) {
      // "7-Iron" -> "7i"
      const num = t.match(/\d+/);
      return num ? num[0] + 'i' : t;
    }
    if (t === 'pw') return 'PW';
    if (t === 'gw') return 'GW';
    if (t === 'aw') return 'AW';
    if (t === 'sw') return 'SW';
    if (t === 'lw') return 'LW';
    if (t.includes('°')) return t; // Wedges like "56°"
    
    return clubType; // Return as-is for anything else
  }

  // ============================================
  // PUBLIC API
  // ============================================

  /**
   * Open the club selector
   * @param {Object} options
   * @param {string} options.mode - 'full-onboarding' | 'known-type' | 'pick-existing'
   * @param {string} options.clubType - Pre-set club type (for known-type mode)
   * @param {string} options.category - Pre-set category
   * @param {string} options.title - Custom modal title
   * @param {Array} options.userClubs - User's existing clubs (for pick-existing mode)
   * @param {Function} options.onSelect - Callback with selected club data
   * @param {Function} options.onCancel - Callback when cancelled
   */
  function open(options = {}) {
    if (!isInitialized) {
      console.error('ClubSelector not initialized. Call ClubSelector.init(db) first.');
      return;
    }

    // Reset state
    state = {
      mode: options.mode || 'known-type',
      category: options.category || null,
      clubType: options.clubType || null,
      brand: null,
      model: null,
      clubHeadSpecId: null,
      shaftBrand: null,
      shaftModel: null,
      shaftId: null,
      shaftSpecs: {},
      isManualShaft: false,
      specs: {},
      onSelect: options.onSelect || null,
      onCancel: options.onCancel || null,
      userClubs: options.userClubs || null,
      selectedExistingClub: null
    };

    // Reset all UI sections
    document.getElementById('cs-title').textContent = options.title || 'Select Club';
    document.getElementById('cs-existing-section').style.display = 'none';
    document.getElementById('cs-category-section').style.display = 'none';
    document.getElementById('cs-type-section').style.display = 'none';
    document.getElementById('cs-brand-section').style.display = 'none';
    document.getElementById('cs-model-section').style.display = 'none';
    document.getElementById('cs-shaft-section').style.display = 'none';
    document.getElementById('cs-specs-preview').style.display = 'none';
    document.getElementById('cs-confirm').disabled = true;
    
    // Reset inputs
    document.getElementById('cs-brand-input').value = '';
    document.getElementById('cs-model-input').value = '';
    document.getElementById('cs-shaft-brand-input').value = '';
    document.getElementById('cs-shaft-model-section').style.display = 'none';
    document.getElementById('cs-shaft-specs-preview').style.display = 'none';
    document.getElementById('cs-manual-fields').style.display = 'none';
    
    // Reset shaft section
    document.getElementById('cs-shaft-stock-btn').classList.remove('active');
    document.getElementById('cs-shaft-custom-btn').classList.remove('active');
    document.getElementById('cs-stock-shaft-info').style.display = 'none';
    document.getElementById('cs-custom-shaft').style.display = 'none';
    document.getElementById('cs-manual-entry').style.display = 'none';
    
    // Reset category/type buttons
    document.querySelectorAll('.cs-category-btn').forEach(btn => btn.classList.remove('active'));
    
    // Configure based on mode
    configureForMode(state.mode, options);

    // Show modal
    document.getElementById('club-selector-modal').classList.add('active');

    console.log('📂 ClubSelector opened:', state.mode, state.clubType || '');
  }

  /**
   * Configure UI based on mode
   */
  function configureForMode(mode, options) {
    const stepsContainer = document.getElementById('cs-steps');
    
    switch (mode) {
      case 'pick-existing':
        // Simple dropdown of user's clubs
        document.getElementById('cs-title').textContent = options.title || 'Select Club from Bag';
        document.getElementById('cs-existing-section').style.display = 'block';
        stepsContainer.style.display = 'none';
        populateExistingClubs();
        break;
        
      case 'full-onboarding':
        // Full flow: Category → Type → Brand → Model → Shaft
        document.getElementById('cs-title').textContent = options.title || 'Add Club';
        document.getElementById('cs-category-section').style.display = 'block';
        stepsContainer.style.display = 'flex';
        
        // Show category and type steps
        document.querySelector('[data-step="category"]').style.display = 'inline';
        document.querySelector('[data-step="category-arrow"]').style.display = 'inline';
        document.querySelector('[data-step="type"]').style.display = 'inline';
        document.querySelector('[data-step="type-arrow"]').style.display = 'inline';
        
        updateStepIndicator('category');
        break;
        
      case 'known-type':
      default:
        // Known club type: Brand → Model → Shaft
        document.getElementById('cs-title').textContent = options.title || `Select ${state.clubType || 'Club'}`;
        document.getElementById('cs-brand-section').style.display = 'block';
        stepsContainer.style.display = 'flex';
        
        // Hide category and type steps
        document.querySelector('[data-step="category"]').style.display = 'none';
        document.querySelector('[data-step="category-arrow"]').style.display = 'none';
        document.querySelector('[data-step="type"]').style.display = 'none';
        document.querySelector('[data-step="type-arrow"]').style.display = 'none';
        
        // If category provided, set it
        if (options.category) {
          state.category = options.category;
        } else if (state.clubType) {
          state.category = getCategoryForClubType(state.clubType);
        }
        
        updateStepIndicator('brand');
        document.getElementById('cs-brand-input').focus();
        break;
    }
  }

  /**
   * Close the club selector
   */
  function close() {
    document.getElementById('club-selector-modal').classList.remove('active');
    
    if (state.onCancel) {
      state.onCancel();
    }

    console.log('📁 ClubSelector closed');
  }

  /**
   * Confirm selection and return data
   */
  function confirmSelection() {
    let result;
    
    if (state.mode === 'pick-existing') {
      // Return existing club data
      if (!state.selectedExistingClub) {
        console.warn('No existing club selected');
        return;
      }
      
      result = {
        mode: 'pick-existing',
        clubId: state.selectedExistingClub.id,
        club: state.selectedExistingClub,
        clubHeadSpecId: state.clubHeadSpecId,
        brand: state.brand,
        model: state.model,
        clubType: state.clubType,
        shaftId: state.shaftId,
        shaftBrand: state.shaftBrand,
        shaftModel: state.shaftModel
      };
    } else {
      // Return new club selection data
      if (!state.clubHeadSpecId) {
        console.warn('No club selected');
        return;
      }

      const spec = clubHeadSpecsCache[state.clubHeadSpecId];
      const shaftSpec = state.shaftId ? shaftSpecsCache[state.shaftId] : null;
      
      result = {
        mode: state.mode,
        // Club head data
        clubHeadSpecId: state.clubHeadSpecId,
        brand: state.brand,
        model: state.model,
        year: spec?.year || null,
        type: spec?.type || null,
        category: state.category,
        clubType: state.clubType,
        specs: state.specs,
        
        // Shaft data
        shaftId: state.shaftId,
        shaftBrand: state.shaftBrand,
        shaftModel: state.shaftModel,
        shaftSpecs: state.shaftSpecs || {},
        isManualShaft: state.isManualShaft || false,
        
        // Full spec references for convenience
        clubHeadSpec: spec,
        shaftSpec: shaftSpec
      };
    }

    console.log('✅ ClubSelector confirmed:', result);

    document.getElementById('club-selector-modal').classList.remove('active');

    if (state.onSelect) {
      state.onSelect(result);
    }
  }

  /**
   * Check if initialized
   */
  function isReady() {
    return isInitialized;
  }

  /**
   * Get cache for external use
   */
  function getCache() {
    return {
      clubHeadSpecs: clubHeadSpecsCache,
      shaftSpecs: shaftSpecsCache
    };
  }

  // ============================================
  // EXPOSE PUBLIC API
  // ============================================

  return {
    init,
    open,
    close,
    isReady,
    getCache,
    // Category & Type selection
    selectCategory,
    selectClubType,
    // Club head selection
    selectBrand,
    selectModel,
    // Shaft selection
    selectShaftType,
    selectShaftBrand,
    selectShaftModel,
    toggleManualEntry
  };

})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ClubSelector;
}
