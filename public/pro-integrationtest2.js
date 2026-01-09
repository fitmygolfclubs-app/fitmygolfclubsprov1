/**
 * FitMyGolfClubs Pro - Component Integration
 * Connects ClubSelector and BagOnboarding to the Pro app
 * 
 * Add this after firebase-auth.js in index.html
 */

(function() {
  'use strict';

  // Wait for Firebase auth to be ready, then initialize components
  let componentsInitialized = false;

  // Initialize when auth is ready
  function initializeComponents() {
    if (componentsInitialized) return;
    
    // Check for db (defined in firebase-auth.js as const, not on window)
    if (typeof db === 'undefined') {
      console.log('⏳ Waiting for Firebase db...');
      setTimeout(initializeComponents, 500);
      return;
    }

    // Initialize ClubSelector
    if (typeof ClubSelector !== 'undefined') {
      ClubSelector.init(db).then(() => {
        console.log('✅ ClubSelector integrated with Pro app');
      }).catch(err => {
        console.error('❌ ClubSelector init error:', err);
      });
    }

    // Initialize BagOnboarding
    if (typeof BagOnboarding !== 'undefined') {
      BagOnboarding.init(db);
      console.log('✅ BagOnboarding integrated with Pro app');
    }

    componentsInitialized = true;
  }

  // Start initialization
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(initializeComponents, 1000);
    });
  } else {
    setTimeout(initializeComponents, 1000);
  }

  // ============================================
  // ENHANCED FUNCTIONS (replace existing)
  // ============================================

  /**
   * Open Add Club Modal - NEW VERSION using ClubSelector
   * Call this instead of the old openAddClubModal()
   */
  window.openAddClubModalNew = function() {
    if (!window.currentClient) {
      alert('Please select a client first');
      return;
    }

    if (typeof ClubSelector === 'undefined' || !ClubSelector.isReady()) {
      console.warn('ClubSelector not ready, falling back to old modal');
      if (typeof openAddClubModalLegacy === 'function') {
        openAddClubModalLegacy();
      }
      return;
    }

    ClubSelector.open({
      mode: 'full-onboarding',
      title: 'Add Club',
      onSelect: async (result) => {
        try {
          await saveClubFromSelector(result);
          showToast('✓ Club added successfully');
          
          // Refresh the client's bag display
          if (typeof loadClientBag === 'function') {
            await loadClientBag(window.currentClient.id);
          }
        } catch (error) {
          console.error('Error saving club:', error);
          alert('Error saving club: ' + error.message);
        }
      },
      onCancel: () => {
        console.log('Add club cancelled');
      }
    });
  };

  /**
   * Edit Club - NEW VERSION using ClubSelector
   */
  window.editClubNew = function(clubId, clubData) {
    if (!window.currentClient) {
      alert('No client selected');
      return;
    }

    if (typeof ClubSelector === 'undefined' || !ClubSelector.isReady()) {
      console.warn('ClubSelector not ready, falling back to old edit');
      if (typeof editClub === 'function') {
        editClub(clubId);
      }
      return;
    }

    ClubSelector.open({
      mode: 'known-type',
      clubType: clubData.clubType || clubData.club_type,
      title: `Edit ${clubData.clubType || clubData.club_type}`,
      onSelect: async (result) => {
        try {
          await updateClubFromSelector(clubId, result);
          showToast('✓ Club updated successfully');
          
          // Refresh display
          if (typeof loadClientBag === 'function') {
            await loadClientBag(window.currentClient.id);
          }
        } catch (error) {
          console.error('Error updating club:', error);
          alert('Error updating club: ' + error.message);
        }
      }
    });
  };

  /**
   * Start Full Bag Onboarding - NEW
   */
  window.startBagOnboarding = function() {
    if (!window.currentClient) {
      alert('Please select a client first');
      return;
    }

    if (typeof BagOnboarding === 'undefined') {
      alert('Bag onboarding component not loaded');
      return;
    }

    BagOnboarding.start({
      userId: window.currentClient.id,
      onComplete: async (clubs) => {
        try {
          // Save all clubs
          let savedCount = 0;
          for (const club of clubs) {
            await saveClubFromBagOnboarding(club);
            savedCount++;
          }
          
          showToast(`✓ ${savedCount} clubs added to bag`);
          
          // Refresh display
          if (typeof loadClientBag === 'function') {
            await loadClientBag(window.currentClient.id);
          }
          
          // Update client status
          await updateClientStatus(window.currentClient.id, 'onboarded');
          
        } catch (error) {
          console.error('Error saving bag:', error);
          alert('Error saving clubs: ' + error.message);
        }
      },
      onCancel: () => {
        console.log('Bag onboarding cancelled');
      }
    });
  };

  /**
   * Quick Add Club for Scenario - Known type
   */
  window.selectClubForScenario = function(clubType, callback) {
    if (typeof ClubSelector === 'undefined' || !ClubSelector.isReady()) {
      alert('Club selector not ready');
      return;
    }

    ClubSelector.open({
      mode: 'known-type',
      clubType: clubType,
      title: `Select ${clubType} for Scenario`,
      onSelect: (result) => {
        if (callback) callback(result);
      }
    });
  };

  /**
   * Select Club from Existing Bag
   */
  window.selectExistingClub = async function(title, callback) {
    if (!window.currentClient) {
      alert('No client selected');
      return;
    }

    if (typeof ClubSelector === 'undefined' || !ClubSelector.isReady()) {
      alert('Club selector not ready');
      return;
    }

    // Load user's clubs
    try {
      const snapshot = await db.collection('users')
        .doc(window.currentClient.id)
        .collection('clubs')
        .get();
      
      const userClubs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      ClubSelector.open({
        mode: 'pick-existing',
        userClubs: userClubs,
        title: title || 'Select Club',
        onSelect: (result) => {
          if (callback) callback(result);
        }
      });
    } catch (error) {
      console.error('Error loading clubs:', error);
      alert('Error loading clubs: ' + error.message);
    }
  };

  // ============================================
  // SAVE HELPERS
  // ============================================

  /**
   * Save club from ClubSelector result
   */
  async function saveClubFromSelector(result) {
    if (!window.currentClient || !db) {
      throw new Error('No client or database');
    }

    const clubData = buildClubDocument(result);
    
    await db.collection('users')
      .doc(window.currentClient.id)
      .collection('clubs')
      .add(clubData);
    
    console.log('✅ Club saved:', clubData.brand, clubData.model);
  }

  /**
   * Update existing club from ClubSelector result
   */
  async function updateClubFromSelector(clubId, result) {
    if (!window.currentClient || !db) {
      throw new Error('No client or database');
    }

    const clubData = buildClubDocument(result);
    delete clubData.created_at; // Don't overwrite creation date
    
    await db.collection('users')
      .doc(window.currentClient.id)
      .collection('clubs')
      .doc(clubId)
      .update(clubData);
    
    console.log('✅ Club updated:', clubData.brand, clubData.model);
  }

  /**
   * Save club from BagOnboarding result
   */
  async function saveClubFromBagOnboarding(club) {
    if (!window.currentClient || !db) {
      throw new Error('No client or database');
    }

    const clubData = {
      // Database references
      clubHeadSpecId: club.clubHeadSpecId || null,
      shaftId: club.shaftId || null,
      
      // Club head
      brand: club.brand || '',
      model: club.model || '',
      year: club.year || null,
      clubType: club.clubType || '',
      category: club.category || '',
      
      // Specs
      loft: club.specs?.loft || null,
      lie: club.specs?.lie || null,
      length: club.specs?.length || null,
      
      // Shaft
      shaft_brand: club.shaftBrand || '',
      shaft_model: club.shaftModel || '',
      shaft_weight: club.shaftSpecs?.weight || null,
      shaft_flex: club.shaftSpecs?.flex || null,
      shaft_kickpoint: club.shaftSpecs?.kickPoint || null,
      shaft_torque: club.shaftSpecs?.torque || null,
      isManualShaft: club.isManualShaft || false,
      
      // Metadata
      created_at: firebase.firestore.FieldValue.serverTimestamp(),
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    await db.collection('users')
      .doc(window.currentClient.id)
      .collection('clubs')
      .add(clubData);
  }

  /**
   * Build club document from ClubSelector result
   */
  function buildClubDocument(result) {
    return {
      // Database references
      clubHeadSpecId: result.clubHeadSpecId || null,
      shaftId: result.shaftId || null,
      
      // Club head
      brand: result.brand || '',
      model: result.model || '',
      year: result.year || null,
      clubType: result.clubType || '',
      category: result.category || '',
      
      // Specs from database
      loft: result.specs?.loft || null,
      lie: result.specs?.lie || null,
      length: result.specs?.length || null,
      
      // Shaft
      shaft_brand: result.shaftBrand || '',
      shaft_model: result.shaftModel || '',
      shaft_weight: result.shaftSpecs?.weight || null,
      shaft_flex: result.shaftSpecs?.flex || null,
      shaft_kickpoint: result.shaftSpecs?.kickPoint || null,
      shaft_torque: result.shaftSpecs?.torque || null,
      isManualShaft: result.isManualShaft || false,
      
      // Metadata
      created_at: firebase.firestore.FieldValue.serverTimestamp(),
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    };
  }

  /**
   * Update client status after onboarding
   */
  async function updateClientStatus(clientId, status) {
    try {
      await db.collection('users').doc(clientId).update({
        status: status,
        updated_at: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating client status:', error);
    }
  }

  /**
   * Show toast notification
   */
  function showToast(message) {
    // Use existing toast function if available
    if (typeof window.showToast === 'function') {
      window.showToast(message);
      return;
    }
    
    // Simple fallback
    const existing = document.querySelector('.integration-toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = 'integration-toast';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #00c864;
      color: #fff;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      z-index: 99999;
      animation: toastIn 0.3s ease;
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'toastOut 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // Add toast animations
  if (!document.getElementById('integration-toast-styles')) {
    const style = document.createElement('style');
    style.id = 'integration-toast-styles';
    style.textContent = `
      @keyframes toastIn {
        from { opacity: 0; transform: translateX(-50%) translateY(20px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
      @keyframes toastOut {
        from { opacity: 1; transform: translateX(-50%) translateY(0); }
        to { opacity: 0; transform: translateX(-50%) translateY(-20px); }
      }
    `;
    document.head.appendChild(style);
  }

  console.log('📦 Pro Integration script loaded');

})();
