/**
 * TestingTab Module v1.0
 * FitMyGolfClubs Pro - Performance Testing
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
        <div class="empty-state">
          <div class="empty-icon">📊</div>
          <div class="empty-text">No saved tests yet</div>
          <div class="empty-hint">Run a comparison to see results here</div>
        </div>
      `;
      return;
    }
    
    container.innerHTML = savedTests.map(test => `
      <div class="banner-card ${test.winner === 'yours' ? 'winner-yours' : 'winner-test'}" 
           data-test-id="${test.id}" onclick="TestingTab.loadTest('${test.id}')">
        <div class="banner-card-header">
          <span class="banner-card-type">${test.club_a?.clubType || 'Club'} Test</span>
          <span class="banner-card-date">${formatDate(test.created_at)}</span>
        </div>
        <div class="banner-card-title">
          ${test.winner === 'test' ? '🏆 Test Club Won' : '✓ Your Club Won'}
        </div>
        <div class="banner-card-subtitle">
          ${test.club_a?.name || 'Your Club'} vs ${test.club_b?.name || 'Test Club'}
        </div>
        <div class="banner-card-metrics">
          ${test.net_gains?.carry ? `+${test.net_gains.carry} yds` : ''} 
          ${test.net_gains?.ballSpeed ? `+${test.net_gains.ballSpeed} mph` : ''}
        </div>
        <button class="banner-card-delete" onclick="event.stopPropagation(); TestingTab.deleteTest('${test.id}')">
          🗑️
        </button>
      </div>
    `).join('');
  }

  // ============================================
  // WIZARD FLOW
  // ============================================

  /**
   * Render club selection grid (Step 1)
   */
  function renderClubSelectGrid() {
    const container = document.getElementById('test-club-select-grid');
    if (!container) return;
    
    // Group clubs by category for display
    const categories = {
      'Woods': userClubs.filter(c => c.category === 'Woods'),
      'Hybrids': userClubs.filter(c => c.category === 'Hybrids'),
      'Irons': userClubs.filter(c => c.category === 'Irons'),
      'Wedges': userClubs.filter(c => c.category === 'Wedges')
    };
    
    let html = '';
    for (const [category, clubs] of Object.entries(categories)) {
      if (clubs.length === 0) continue;
      
      clubs.forEach(club => {
        const testCount = savedTests.filter(t => t.club_a?.id === club.id).length;
        html += `
          <div class="club-select-item" data-club-id="${club.id}" onclick="TestingTab.selectClub('${club.id}', this)">
            <div class="club-select-icon">🏌️</div>
            <div class="club-select-info">
              <div class="club-select-name">${club.clubType}</div>
              <div class="club-select-specs">${club.brand} ${club.model} • ${club.loft || ''}°</div>
            </div>
            <span class="club-select-count">${testCount} tests</span>
          </div>
        `;
      });
    }
    
    container.innerHTML = html;
  }

  /**
   * Select a club from bag (Step 1)
   */
  function selectClub(clubId, element) {
    const club = userClubs.find(c => c.id === clubId);
    if (!club) return;
    
    // Update state
    currentTest.clubA = club;
    
    // Update UI
    document.querySelectorAll('.club-select-item').forEach(item => 
      item.classList.remove('selected')
    );
    element.classList.add('selected');
    
    // Enable next button
    document.getElementById('test-step1-next').disabled = false;
    
    // Update step 2 display
    updateClubADisplay();
  }

  /**
   * Go to a specific step
   */
  function goToStep(step) {
    // Validate step transitions
    if (step === 2 && !currentTest.clubA) return;
    if (step === 3 && !currentTest.clubB) return;
    if (step === 4 && !hasValidData()) return;
    
    currentTest.step = step;
    
    // Update progress indicators
    for (let i = 1; i <= 5; i++) {
      const el = document.getElementById('test-progress-' + i);
      if (!el) continue;
      el.classList.remove('active', 'complete');
      if (i < step) el.classList.add('complete');
      if (i === step) el.classList.add('active');
    }
    
    // Show correct step
    document.querySelectorAll('.test-step').forEach(s => 
      s.classList.remove('active')
    );
    document.getElementById('test-step-' + step).classList.add('active');
  }

  /**
   * Open ClubSelector for comparison club (Step 2)
   */
  function openComparisonSelector() {
    // Use ClubSelector in 'known-type' mode
    ClubSelector.open({
      mode: 'known-type',
      clubType: currentTest.clubA.clubType,
      onSelect: (selectedClub) => {
        currentTest.clubB = selectedClub;
        updateClubBDisplay();
        document.getElementById('test-step2-next').disabled = false;
      },
      onCancel: () => {
        console.log('Club selection cancelled');
      }
    });
  }

  // ============================================
  // DATA CAPTURE (Step 3)
  // ============================================

  /**
   * Handle photo capture for Club A
   */
  function capturePhotoA() {
    // TODO: Integrate with photo capture / Vision API
    console.log('Photo capture for Club A');
    showManualEntryA();
  }

  /**
   * Handle photo capture for Club B
   */
  function capturePhotoB() {
    // TODO: Integrate with photo capture / Vision API
    console.log('Photo capture for Club B');
    showManualEntryB();
  }

  /**
   * Show manual entry form for Club A
   */
  function showManualEntryA() {
    document.getElementById('photo-capture-zone-a').style.display = 'none';
    document.getElementById('club-a-data').style.display = 'block';
  }

  /**
   * Show manual entry form for Club B
   */
  function showManualEntryB() {
    document.getElementById('photo-capture-zone-b').style.display = 'none';
    document.getElementById('club-b-data').style.display = 'block';
  }

  /**
   * Check if we have valid performance data
   */
  function hasValidData() {
    // Minimum required: ball speed and carry distance for both clubs
    return currentTest.clubAData.ballSpeed && currentTest.clubAData.carryDistance &&
           currentTest.clubBData.ballSpeed && currentTest.clubBData.carryDistance;
  }

  // ============================================
  // RESULTS & ANALYSIS (Step 5)
  // ============================================

  /**
   * Run the comparison analysis
   */
  async function runComparison() {
    // Check credits
    if (!checkCredits()) return;
    
    // Deduct credit
    deductCredit();
    
    // Calculate winner and net gains
    calculateResults();
    
    // Generate AI analysis (or mock for now)
    await generateAIAnalysis();
    
    // Display results
    displayResults();
    
    // Move to step 5
    goToStep(5);
  }

  /**
   * Calculate winner and net gains
   */
  function calculateResults() {
    const a = currentTest.clubAData;
    const b = currentTest.clubBData;
    
    // Simple comparison: total distance wins
    const totalA = parseFloat(a.totalDistance) || parseFloat(a.carryDistance) || 0;
    const totalB = parseFloat(b.totalDistance) || parseFloat(b.carryDistance) || 0;
    
    currentTest.winner = totalB > totalA ? 'test' : 'yours';
    
    currentTest.netGains = {
      carry: Math.round((parseFloat(b.carryDistance) || 0) - (parseFloat(a.carryDistance) || 0)),
      ballSpeed: Math.round((parseFloat(b.ballSpeed) || 0) - (parseFloat(a.ballSpeed) || 0)),
      spin: Math.round((parseFloat(b.spinRate) || 0) - (parseFloat(a.spinRate) || 0))
    };
  }

  /**
   * Display comparison results
   */
  function displayResults() {
    const resultsContainer = document.getElementById('test-results');
    if (!resultsContainer) return;
    
    // Update winner display
    const isTestWinner = currentTest.winner === 'test';
    
    // TODO: Update all result elements with currentTest data
    console.log('Results:', currentTest);
  }

  // ============================================
  // SAVE / DELETE / LOAD
  // ============================================

  /**
   * Save current test to Firestore
   */
  async function saveTest() {
    // Check if at max capacity
    if (savedTests.length >= MAX_SAVED_TESTS) {
      // Delete oldest test
      const oldest = savedTests[savedTests.length - 1];
      await deleteTest(oldest.id, true); // silent delete
    }
    
    const testData = {
      created_at: new Date(),
      club_a: {
        id: currentTest.clubA.id,
        clubType: currentTest.clubA.clubType,
        name: `${currentTest.clubA.brand} ${currentTest.clubA.model}`,
        brand: currentTest.clubA.brand,
        model: currentTest.clubA.model
      },
      club_b: {
        name: currentTest.clubB.name || `${currentTest.clubB.brand} ${currentTest.clubB.model}`,
        brand: currentTest.clubB.brand,
        model: currentTest.clubB.model,
        shaft: currentTest.clubB.shaft
      },
      club_a_data: currentTest.clubAData,
      club_b_data: currentTest.clubBData,
      goals: currentTest.goals,
      winner: currentTest.winner,
      net_gains: currentTest.netGains,
      ai_analysis: currentTest.aiAnalysis,
      applied_to_scenario: false
    };
    
    const docRef = await db.collection('users').doc(userId)
      .collection('tests').add(testData);
    
    console.log('✅ Test saved:', docRef.id);
    
    // Refresh saved tests
    await loadSavedTests();
    renderBannerCards();
    
    showToast('Test saved!');
  }

  /**
   * Delete a saved test
   */
  async function deleteTest(testId, silent = false) {
    if (!silent && !confirm('Delete this saved test?')) return;
    
    await db.collection('users').doc(userId)
      .collection('tests').doc(testId).delete();
    
    console.log('✅ Test deleted:', testId);
    
    // Refresh
    await loadSavedTests();
    renderBannerCards();
    
    if (!silent) showToast('Test deleted');
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
      clubAData: test.club_a_data,
      clubBData: test.club_b_data,
      goals: test.goals || [],
      winner: test.winner,
      aiAnalysis: test.ai_analysis,
      netGains: test.net_gains
    };
    
    // Display results
    displayResults();
    goToStep(5);
  }

  // ============================================
  // ADD TO SCENARIO (with teaser)
  // ============================================

  /**
   * Show teaser grade preview (FREE)
   */
  async function showTeaserPreview() {
    // Call gradeUserBag with scenario mode to get grade change
    // But only show teaser: "B+ → A-"
    
    // TODO: Implement API call for teaser
    const teaser = {
      currentGrade: 'B+',
      projectedGrade: 'A-',
      improved: true
    };
    
    const teaserEl = document.getElementById('teaser-preview');
    teaserEl.innerHTML = `
      <div class="teaser-grades">
        <span class="teaser-current">${teaser.currentGrade}</span>
        <span class="teaser-arrow">→</span>
        <span class="teaser-projected ${teaser.improved ? 'improved' : ''}">${teaser.projectedGrade}</span>
      </div>
      <p>Adding ${currentTest.clubB.name} would ${teaser.improved ? 'improve' : 'change'} your bag grade</p>
      <button class="btn btn-primary" onclick="TestingTab.addToScenarioFull()">
        See Full Analysis (1 credit)
      </button>
    `;
    teaserEl.style.display = 'block';
  }

  /**
   * Add winner to scenario with full analysis (1 credit)
   */
  async function addToScenarioFull() {
    if (!checkCredits()) return;
    deductCredit();
    
    // Navigate to Scenarios tab with winner pre-loaded
    // ScenariosTab.addClubFromTest(currentTest.winner === 'test' ? currentTest.clubB : currentTest.clubA);
    
    showClientTab('scenarios');
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
    // TODO: Integrate with credit system
    return true;
  }

  function deductCredit() {
    // TODO: Integrate with credit system
    console.log('Credit deducted');
  }

  function showToast(message) {
    // TODO: Implement toast notification
    console.log('Toast:', message);
  }

  function updateClubADisplay() {
    const club = currentTest.clubA;
    if (!club) return;
    
    // Update various display elements
    const elements = ['step2-your-club', 'step3-your-club'];
    elements.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = club.clubType;
    });
    
    const specElements = ['step2-your-specs', 'step3-your-specs'];
    specElements.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = `${club.brand} ${club.model} • ${club.loft || ''}°`;
    });
  }

  function updateClubBDisplay() {
    const club = currentTest.clubB;
    if (!club) return;
    
    document.getElementById('compare-preview').style.display = 'block';
    document.getElementById('compare-preview-name').textContent = club.name || `${club.brand} ${club.model}`;
    document.getElementById('compare-preview-specs').textContent = club.shaft || 'Stock Shaft';
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
    
    // Reset UI elements
    document.querySelectorAll('.club-select-item').forEach(item => 
      item.classList.remove('selected')
    );
    document.getElementById('test-step1-next').disabled = true;
    document.getElementById('compare-preview').style.display = 'none';
    
    goToStep(1);
  }

  async function generateAIAnalysis() {
    // TODO: Call Claude API for analysis
    currentTest.aiAnalysis = 'AI analysis will be generated here based on the comparison data.';
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
