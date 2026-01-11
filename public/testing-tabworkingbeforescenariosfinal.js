/**
 * TestingTab Module v1.1
 * FitMyGolfClubs Pro - Performance Testing
 * 
 * UPDATED: Firestore integration for saving/loading tests
 * 
 * Features:
 * - Banner cards showing saved tests (10 max)
 * - 5-step wizard flow
 * - ClubSelector integration for comparison club
 * - Firestore persistence (users/{id}/tests subcollection)
 * - Teaser grade preview (free) with upsell
 * - "Add Winner to Scenario" flow
 * 
 * Usage:
 *   TestingTab.init(db, userId);
 *   TestingTab.open();
 *   TestingTab.startTestForClub(clubId);
 */

const TestingTab = (function() {
  'use strict';

  // ============================================
  // PRIVATE STATE
  // ============================================
  
  let db = null;
  let userId = null;
  let userClubs = [];      // Clubs from user's bag
  let savedTests = [];     // Saved test results (max 10)
  let isInitialized = false;
  
  const MAX_SAVED_TESTS = 10;
  
  // Current test state
  let currentTest = {
    step: 1,
    clubA: null,          // User's club from bag
    clubB: null,          // Comparison club
    clubAData: {},        // Performance metrics
    clubBData: {},        // Performance metrics
    goals: [],
    winner: null,
    aiAnalysis: null,
    netGains: {}
  };

  // ============================================
  // INITIALIZATION
  // ============================================

  /**
   * Initialize the Testing Tab
   * @param {Firestore} firestore - Firebase Firestore instance
   * @param {string} uid - Current user ID
   */
  async function init(firestore, uid) {
    if (isInitialized) {
      console.log('TestingTab already initialized');
      return;
    }

    db = firestore;
    userId = uid;
    
    try {
      await Promise.all([
        loadUserClubs(),
        loadSavedTests()
      ]);
      
      renderBannerCards();
      renderClubSelectGrid();
      attachEventListeners();
      
      isInitialized = true;
      console.log('✅ TestingTab initialized');
    } catch (error) {
      console.error('❌ TestingTab init failed:', error);
      throw error;
    }
  }

  // ============================================
  // DATA LOADING
  // ============================================

  /**
   * Load user's clubs from Firestore
   */
  async function loadUserClubs() {
    const snapshot = await db.collection('users').doc(userId)
      .collection('clubs').get();
    
    userClubs = [];
    snapshot.forEach(doc => {
      userClubs.push({ id: doc.id, ...doc.data() });
    });
    
    console.log(`✅ Loaded ${userClubs.length} clubs from bag`);
  }

  /**
   * Load saved tests from Firestore (newest first, max 10)
   */
  async function loadSavedTests() {
    try {
      const snapshot = await db.collection('users').doc(userId)
        .collection('tests')
        .orderBy('created_at', 'desc')
        .limit(MAX_SAVED_TESTS)
        .get();
      
      savedTests = [];
      snapshot.forEach(doc => {
        savedTests.push({ id: doc.id, ...doc.data() });
      });
      
      console.log(`✅ Loaded ${savedTests.length} saved tests`);
    } catch (error) {
      console.error('Error loading saved tests:', error);
      savedTests = [];
    }
  }

  /**
   * Refresh tests from Firestore and update UI
   */
  async function refreshTests() {
    await loadSavedTests();
    renderBannerCards();
    
    // Update count in UI
    const countEl = document.getElementById('saved-tests-count');
    if (countEl) {
      countEl.textContent = savedTests.length;
    }
  }

  // ============================================
  // BANNER CARDS (Saved Tests)
  // ============================================

  /**
   * Render banner cards for saved tests
   */
  function renderBannerCards() {
    const container = document.getElementById('testing-banner-cards');
    if (!container) return;
    
    if (savedTests.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="text-align: center; padding: 20px; color: var(--text-muted);">
          <div class="empty-icon" style="font-size: 32px; margin-bottom: 8px;">📊</div>
          <div class="empty-text" style="font-weight: 500;">No saved tests yet</div>
          <div class="empty-hint" style="font-size: 12px;">Run a comparison to see results here</div>
        </div>
      `;
      return;
    }
    
    container.innerHTML = `
      <div class="banner-cards-scroll" style="display: flex; gap: 12px; overflow-x: auto; padding: 12px 0;">
        ${savedTests.map(test => {
          // Determine winner display - winner is 'a', 'b', or 'tie'
          const bWins = test.winner === 'b';
          const aWins = test.winner === 'a';
          const isTie = test.winner === 'tie';
          
          // Club names
          const clubAName = test.club_a?.brand && test.club_a?.model 
            ? `${test.club_a.brand} ${test.club_a.model}` 
            : test.club_a?.clubType || 'Your Club';
          const clubBName = test.club_b?.name || 
            (test.club_b?.brand && test.club_b?.model ? `${test.club_b.brand} ${test.club_b.model}` : 'Test Club');
          
          // Format net gains
          const carryGain = test.net_gains?.carry || 0;
          const carryText = carryGain > 0 ? `+${Math.round(carryGain)} yds` : 
                           carryGain < 0 ? `${Math.round(carryGain)} yds` : '';
          
          // Format date
          const dateStr = formatDate(test.created_at);
          
          // Winner styling
          const cardBg = bWins ? 'var(--green-dim)' : aWins ? 'var(--cyan-dim)' : 'var(--bg-card)';
          const cardBorder = bWins ? 'var(--green)' : aWins ? 'var(--cyan)' : 'var(--border-light)';
          const winnerIcon = bWins ? '🏆' : aWins ? '✓' : '🤝';
          const winnerText = bWins ? 'Test Club Won' : aWins ? 'Your Club Won' : 'Tie';
          
          return `
            <div class="banner-card" 
                 style="min-width: 200px; background: ${cardBg}; border: 1px solid ${cardBorder}; border-radius: 12px; padding: 12px; cursor: pointer; position: relative;"
                 data-test-id="${test.id}" 
                 onclick="TestingTab.loadTest('${test.id}')">
              <div class="banner-card-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-size: 11px; text-transform: uppercase; color: var(--text-muted);">${test.club_a?.clubType || 'Club'} Test</span>
                <span style="font-size: 11px; color: var(--text-muted);">${dateStr}</span>
              </div>
              <div class="banner-card-title" style="font-weight: 600; margin-bottom: 4px;">
                ${winnerIcon} ${winnerText}
              </div>
              <div class="banner-card-subtitle" style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">
                vs ${clubBName}
              </div>
              ${carryText ? `
                <div class="banner-card-metrics" style="font-size: 14px; font-weight: 600; color: ${bWins ? 'var(--green)' : 'var(--cyan)'};">
                  ${carryText}
                </div>
              ` : ''}
              <button class="banner-card-delete" 
                      style="position: absolute; top: 8px; right: 8px; background: none; border: none; cursor: pointer; opacity: 0.5; font-size: 12px;"
                      onclick="event.stopPropagation(); TestingTab.deleteTest('${test.id}')">
                🗑️
              </button>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  /**
   * Attach event listeners for Testing Tab
   */
  function attachEventListeners() {
    // Event listeners will be added as features are built
    // For now, most interactions use inline onclick handlers
    console.log('✅ TestingTab event listeners attached');
  }

  // ============================================
  // WIZARD FLOW
  // ============================================

  /**
   * Render club selection grid (Step 1)
   */
  function renderClubSelectGrid() {
    const container = document.getElementById('test-club-select-grid');
    if (!container) {
      console.log('⚠️ test-club-select-grid container not found');
      return;
    }
    
    console.log('🔍 renderClubSelectGrid - userClubs:', userClubs);
    if (userClubs.length > 0) {
      console.log('🔍 First club fields:', Object.keys(userClubs[0]));
      console.log('🔍 First club data:', userClubs[0]);
    }
    
    // Sort order for club types (matching bag tab)
    const sortOrder = { 
      'driver': 1, '3-wood': 2, '3w': 2, '5-wood': 3, '5w': 3, '7-wood': 4,
      '2-hybrid': 9, '2h': 9, '3-hybrid': 10, '3h': 10, '4-hybrid': 11, '4h': 11, '5-hybrid': 12, '5h': 12,
      '4-iron': 19, '4i': 19, '5-iron': 20, '5i': 20, '6-iron': 21, '6i': 21, '7-iron': 22, '7i': 22, 
      '8-iron': 23, '8i': 23, '9-iron': 24, '9i': 24, 'pw': 25, 'pitching wedge': 25,
      'gw': 26, 'gap wedge': 26, '50°': 26, '52°': 27, 'sw': 28, 'sand wedge': 28, '54°': 28, '56°': 29,
      'lw': 30, 'lob wedge': 30, '58°': 30, '60°': 31, '62°': 32,
      'putter': 40
    };
    
    // Helper to get true category
    function getTrueCategory(club) {
      const clubType = (club.clubType || '').toLowerCase();
      
      // Driver
      if (clubType === 'driver') return 'woods';
      
      // Woods
      if (clubType.includes('wood') || clubType.match(/^\d+w$/)) return 'woods';
      
      // Hybrids
      if (clubType.includes('hybrid') || clubType.includes('rescue') || clubType.match(/^\d+h$/)) return 'hybrids';
      
      // Wedges - check BEFORE irons since PW could match both
      if (clubType === 'pw' || clubType === 'pitching wedge' ||
          clubType === 'gw' || clubType === 'gap wedge' ||
          clubType === 'sw' || clubType === 'sand wedge' ||
          clubType === 'lw' || clubType === 'lob wedge' ||
          clubType.match(/^\d{2}°?$/)) {
        return 'wedges';
      }
      
      // Irons
      if (clubType.includes('iron') || clubType.match(/^\d+i$/)) return 'irons';
      
      // Putter
      if (clubType === 'putter') return 'putters';
      
      // Fallback to stored category or default
      return club.category || 'other';
    }
    
    // Group clubs by category
    const categories = {
      woods: { label: '🌲 WOODS', clubs: [] },
      hybrids: { label: '🔀 HYBRIDS', clubs: [] },
      irons: { label: '⛳ IRONS', clubs: [] },
      wedges: { label: '🎯 WEDGES', clubs: [] },
      putters: { label: '⛳ PUTTERS', clubs: [] }
    };
    
    console.log('🔍 Categories:', categories);
    
    // Sort and categorize clubs
    const sortedClubs = [...userClubs].sort((a, b) => {
      const orderA = sortOrder[(a.clubType || '').toLowerCase()] || 50;
      const orderB = sortOrder[(b.clubType || '').toLowerCase()] || 50;
      return orderA - orderB;
    });
    
    sortedClubs.forEach(club => {
      const cat = getTrueCategory(club);
      if (categories[cat]) {
        categories[cat].clubs.push(club);
      }
    });
    
    // Build HTML
    let html = '';
    Object.entries(categories).forEach(([key, cat]) => {
      if (cat.clubs.length === 0) return;
      
      html += `<div class="club-category-header" style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); margin: 16px 0 8px 0; font-weight: 600;">${cat.label}</div>`;
      
      cat.clubs.forEach(club => {
        const specs = club.shaft?.name || club.shaftModel || '';
        html += `
          <div class="club-select-item" 
               data-club-id="${club.id}"
               data-club-type="${club.clubType}"
               onclick="TestingTab.selectClub('${club.id}', this)"
               style="display: flex; align-items: center; padding: 12px; background: var(--bg-card); border: 1px solid var(--border-light); border-radius: 8px; margin-bottom: 8px; cursor: pointer;">
            <div class="club-select-icon" style="font-size: 20px; margin-right: 12px;">🏌️</div>
            <div class="club-select-info" style="flex: 1;">
              <div style="font-weight: 600;">${club.clubType}</div>
              <div style="font-size: 12px; color: var(--text-muted);">${club.brand || ''} ${club.model || ''}</div>
              ${specs ? `<div style="font-size: 11px; color: var(--text-muted);">${specs}</div>` : ''}
            </div>
          </div>
        `;
      });
    });
    
    container.innerHTML = html || '<div style="text-align: center; padding: 20px; color: var(--text-muted);">No clubs in bag</div>';
  }

  /**
   * Select a club for testing (Step 1)
   */
  function selectClub(clubId, element) {
    const club = userClubs.find(c => c.id === clubId);
    if (!club) return;
    
    currentTest.clubA = club;
    
    // Sync with global perfTestState for inline functions
    if (typeof perfTestState !== 'undefined') {
      perfTestState.selectedClub = club;
    }
    
    // Update UI selection
    document.querySelectorAll('.club-select-item').forEach(el => {
      el.style.border = '1px solid var(--border-light)';
      el.style.background = 'var(--bg-card)';
    });
    element.style.border = '2px solid var(--cyan)';
    element.style.background = 'var(--cyan-dim)';
    
    // Enable Next button
    const nextBtn = document.getElementById('test-step1-next');
    if (nextBtn) nextBtn.disabled = false;
    
    console.log('✅ Selected club for testing:', club.clubType);
  }

  /**
   * Navigate to a wizard step
   */
  function goToStep(step) {
    // Update progress indicators
    for (let i = 1; i <= 5; i++) {
      const progressEl = document.getElementById('test-progress-' + i);
      if (progressEl) {
        progressEl.classList.toggle('active', i <= step);
        progressEl.classList.toggle('completed', i < step);
      }
    }
    
    // Show/hide step content
    document.querySelectorAll('#tab-testing .scenario-step').forEach(s => s.classList.remove('active'));
    const stepEl = document.getElementById('test-step-' + step);
    if (stepEl) stepEl.classList.add('active');
    
    currentTest.step = step;
    
    // Step-specific setup
    if (step === 2) {
      updateClubADisplay();
    } else if (step === 3) {
      updateClubADisplay();
      updateClubBDisplay();
    }
  }

  /**
   * Open ClubSelector for comparison club (Step 2)
   */
  function openComparisonSelector() {
    if (!currentTest.clubA) {
      alert('Please select your club first');
      return;
    }
    
    const clubType = currentTest.clubA.clubType;
    
    // Open ClubSelector in known-type mode
    ClubSelector.open({
      mode: 'known-type',
      clubType: clubType,
      title: `Select ${clubType} to Compare`,
      onSelect: (selectedClub) => {
        currentTest.clubB = {
          name: `${selectedClub.brand} ${selectedClub.model}`,
          brand: selectedClub.brand,
          model: selectedClub.model,
          shaft: selectedClub.shaft,
          specs: selectedClub.specs,
          source: 'database'
        };
        
        // Sync with global perfTestState for inline functions
        if (typeof perfTestState !== 'undefined') {
          perfTestState.compareClub = currentTest.clubB;
        }
        
        updateClubBDisplay();
        
        // Enable next button
        const nextBtn = document.getElementById('test-step2-next');
        if (nextBtn) nextBtn.disabled = false;
      }
    });
  }

  // ============================================
  // DATA CAPTURE (Step 3)
  // ============================================

  function capturePhotoA() {
    // TODO: Implement photo capture + OCR
    document.getElementById('club-a-data').style.display = 'block';
    document.getElementById('photo-capture-zone-a').style.display = 'none';
  }

  function capturePhotoB() {
    // TODO: Implement photo capture + OCR
    document.getElementById('club-b-data').style.display = 'block';
    document.getElementById('photo-capture-zone-b').style.display = 'none';
  }

  function showManualEntryA() {
    document.getElementById('club-a-data').style.display = 'block';
    document.getElementById('photo-capture-zone-a').style.display = 'none';
  }

  function showManualEntryB() {
    document.getElementById('club-b-data').style.display = 'block';
    document.getElementById('photo-capture-zone-b').style.display = 'none';
  }

  function hasValidData() {
    const aValid = currentTest.clubAData?.ballSpeed && currentTest.clubAData?.carry;
    const bValid = currentTest.clubBData?.ballSpeed && currentTest.clubBData?.carry;
    return aValid && bValid;
  }

  // ============================================
  // COMPARISON & RESULTS (Step 4-5)
  // ============================================

  async function runComparison() {
    if (!hasValidData()) {
      alert('Please enter ball speed and carry for both clubs');
      return;
    }
    
    calculateResults();
    displayResults();
    goToStep(5);
  }

  function calculateResults() {
    const dataA = currentTest.clubAData;
    const dataB = currentTest.clubBData;
    
    const carryDiff = (dataB.carry || 0) - (dataA.carry || 0);
    
    if (carryDiff > 2) {
      currentTest.winner = 'b';
    } else if (carryDiff < -2) {
      currentTest.winner = 'a';
    } else {
      currentTest.winner = 'tie';
    }
    
    currentTest.netGains = {
      carry: carryDiff,
      ballSpeed: (dataB.ballSpeed || 0) - (dataA.ballSpeed || 0),
      spin: (dataB.spin || 0) - (dataA.spin || 0)
    };
  }

  function displayResults() {
    // Results are displayed by the inline populateTestResults() function
    // This just sets up any module-specific display
  }

  // ============================================
  // SAVE/DELETE/LOAD TESTS
  // ============================================

  async function saveTest() {
    // This is handled by the global saveTest() function in index.html
    // which writes to Firestore and then calls refreshTests()
  }

  /**
   * Delete a saved test
   */
  async function deleteTest(testId, silent = false) {
    if (!silent && !confirm('Delete this saved test?')) return;
    
    try {
      await db.collection('users').doc(userId)
        .collection('tests').doc(testId).delete();
      
      console.log('✅ Test deleted:', testId);
      
      // Refresh
      await loadSavedTests();
      renderBannerCards();
      
      if (!silent && typeof showToast === 'function') {
        showToast('Test deleted', 'success');
      }
    } catch (error) {
      console.error('Error deleting test:', error);
      if (typeof showToast === 'function') {
        showToast('Failed to delete test', 'error');
      }
    }
  }

  /**
   * Load a saved test to view results
   */
  async function loadTest(testId) {
    const test = savedTests.find(t => t.id === testId);
    if (!test) return;
    
    // Populate currentTest from saved data
    currentTest = {
      step: 5,
      clubA: test.club_a,
      clubB: test.club_b,
      clubAData: test.club_a_data || {},
      clubBData: test.club_b_data || {},
      goals: test.goals || [],
      winner: test.winner,
      aiAnalysis: test.ai_summary,
      netGains: test.net_gains || {}
    };
    
    // Sync with global perfTestState
    if (typeof perfTestState !== 'undefined') {
      perfTestState.selectedClub = test.club_a;
      perfTestState.compareClub = test.club_b;
      perfTestState.clubAData = test.club_a_data || {};
      perfTestState.clubBData = test.club_b_data || {};
      perfTestState.goals = test.goals || [];
      perfTestState.isComplete = true;
    }
    
    // Populate results using the inline function
    if (typeof populateTestResults === 'function') {
      populateTestResults();
    }
    
    // Navigate to results step
    goToStep(5);
  }

  // ============================================
  // ADD TO SCENARIO (with teaser)
  // ============================================

  async function showTeaserPreview() {
    // TODO: Implement API call for teaser grade preview
    const teaser = {
      currentGrade: 'B+',
      projectedGrade: 'A-',
      improved: true
    };
    
    const teaserEl = document.getElementById('teaser-preview');
    if (teaserEl) {
      teaserEl.innerHTML = `
        <div class="teaser-grades">
          <span class="teaser-current">${teaser.currentGrade}</span>
          <span class="teaser-arrow">→</span>
          <span class="teaser-projected ${teaser.improved ? 'improved' : ''}">${teaser.projectedGrade}</span>
        </div>
        <p>Adding ${currentTest.clubB?.name || 'Test Club'} would ${teaser.improved ? 'improve' : 'change'} your bag grade</p>
        <button class="btn btn-primary" onclick="TestingTab.addToScenarioFull()">
          See Full Analysis (1 credit)
        </button>
      `;
      teaserEl.style.display = 'block';
    }
  }

  async function addToScenarioFull() {
    // TODO: Implement full scenario creation with credit deduction
    alert('Add to Scenario feature coming soon!');
  }

  // ============================================
  // UTILITIES
  // ============================================

  function formatDate(timestamp) {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function checkCredits() {
    // TODO: Implement credit checking
    return true;
  }

  function deductCredit() {
    // TODO: Implement credit deduction
  }

  function showToast(message, type = 'info') {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
    } else {
      console.log(`Toast (${type}): ${message}`);
    }
  }

  function updateClubADisplay() {
    const club = currentTest.clubA;
    if (!club) return;
    
    // Step 2 display
    const step2Name = document.getElementById('step2-your-club');
    const step2Specs = document.getElementById('step2-your-specs');
    if (step2Name) step2Name.textContent = club.clubType || 'Club';
    if (step2Specs) step2Specs.textContent = `${club.brand || ''} ${club.model || ''}`.trim();
    
    // Step 3 display
    const step3Name = document.getElementById('step3-your-club');
    const step3Specs = document.getElementById('step3-your-specs');
    if (step3Name) step3Name.textContent = club.clubType || 'Club';
    if (step3Specs) step3Specs.textContent = `${club.brand || ''} ${club.model || ''}`.trim();
  }

  function updateClubBDisplay() {
    const club = currentTest.clubB;
    if (!club) return;
    
    // Show preview card
    const preview = document.getElementById('compare-preview');
    if (preview) preview.style.display = 'block';
    
    const previewName = document.getElementById('compare-preview-name');
    const previewSpecs = document.getElementById('compare-preview-specs');
    if (previewName) previewName.textContent = club.name || `${club.brand} ${club.model}`;
    if (previewSpecs) previewSpecs.textContent = club.shaft || 'Stock Shaft';
    
    // Step 3 display
    const step3Name = document.getElementById('step3-compare-club');
    const step3Specs = document.getElementById('step3-compare-specs');
    if (step3Name) step3Name.textContent = club.name || `${club.brand} ${club.model}`;
    if (step3Specs) step3Specs.textContent = club.shaft || 'Stock Shaft';
  }

  function updateManualCompare() {
    const brand = document.getElementById('compare-brand-manual')?.value?.trim();
    const model = document.getElementById('compare-model-manual')?.value?.trim();
    const shaft = document.getElementById('compare-shaft-manual')?.value?.trim();
    
    if (brand && model) {
      currentTest.clubB = {
        name: `${brand} ${model}`,
        brand: brand,
        model: model,
        shaft: shaft || null,
        source: 'manual'
      };
      
      // Sync with global perfTestState
      if (typeof perfTestState !== 'undefined') {
        perfTestState.compareClub = currentTest.clubB;
      }
      
      updateClubBDisplay();
      
      // Enable next button
      const nextBtn = document.getElementById('test-step2-next');
      if (nextBtn) nextBtn.disabled = false;
    }
  }

  function clearComparisonClub() {
    currentTest.clubB = null;
    
    if (typeof perfTestState !== 'undefined') {
      perfTestState.compareClub = null;
    }
    
    // Hide preview
    const preview = document.getElementById('compare-preview');
    if (preview) preview.style.display = 'none';
    
    // Clear manual fields
    const brandEl = document.getElementById('compare-brand-manual');
    const modelEl = document.getElementById('compare-model-manual');
    const shaftEl = document.getElementById('compare-shaft-manual');
    if (brandEl) brandEl.value = '';
    if (modelEl) modelEl.value = '';
    if (shaftEl) shaftEl.value = '';
    
    // Disable next button
    const nextBtn = document.getElementById('test-step2-next');
    if (nextBtn) nextBtn.disabled = true;
  }

  function reset() {
    currentTest = {
      step: 1,
      clubA: null,
      clubB: null,
      clubAData: {},
      clubBData: {},
      goals: [],
      winner: null,
      aiAnalysis: null,
      netGains: {}
    };
    
    // Clear UI selections
    document.querySelectorAll('.club-select-item').forEach(el => {
      el.style.border = '1px solid var(--border-light)';
      el.style.background = 'var(--bg-card)';
    });
    
    clearComparisonClub();
    goToStep(1);
  }

  async function generateAIAnalysis() {
    // TODO: Call AI for analysis
  }

  // ============================================
  // PUBLIC API
  // ============================================

  return {
    init,
    open: () => goToStep(1),
    selectClub,
    goToStep,
    openComparisonSelector,
    updateManualCompare,
    clearComparisonClub,
    capturePhotoA,
    capturePhotoB,
    showManualEntryA,
    showManualEntryB,
    runComparison,
    saveTest,
    deleteTest,
    loadTest,
    showTeaserPreview,
    addToScenarioFull,
    reset,
    refreshTests,  // NEW: Added for external refresh calls
    startTestForClub: (clubId) => {
      reset();
      const element = document.querySelector(`[data-club-id="${clubId}"]`);
      if (element) selectClub(clubId, element);
    }
  };

})();

// Export for module systems if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TestingTab;
}
