/**
 * AI Recommendations - Frontend Integration
 * FitMyGolfClubs Pro
 * 
 * Add this to your index.html or a separate ai-recommendations.js file
 */

// =============================================================================
// AI RECOMMENDATION SERVICE
// =============================================================================

const AIRecommendations = {
  
  /**
   * Generate full personalized recommendation
   * @param {string} userId - Client ID (null for self)
   * @param {string} analysisType - Type of analysis
   * @param {string} userQuery - The question/context
   * @param {object} additionalContext - Optional extra data
   * @returns {Promise<object>} - { success, recommendation, profileUsed }
   */
  async generate(userId, analysisType, userQuery, additionalContext = null) {
    const generateRec = firebase.functions().httpsCallable('generatePersonalizedRecommendation');
    
    try {
      // Show loading if function exists
      if (typeof showLoadingState === 'function') showLoadingState('Generating personalized recommendation...');
      
      const result = await generateRec({
        userId: userId,
        analysisType: analysisType,
        userQuery: userQuery,
        additionalContext: additionalContext
      });
      
      if (typeof hideLoadingState === 'function') hideLoadingState();
      return result.data;
      
    } catch (error) {
      if (typeof hideLoadingState === 'function') hideLoadingState();
      console.error('AI Recommendation error:', error);
      
      // Handle specific errors
      if (error.code === 'unauthenticated') {
        if (typeof showToast === 'function') showToast('Please log in to use AI recommendations', 'error');
      } else if (error.code === 'permission-denied') {
        if (typeof showToast === 'function') showToast('You do not have access to this client', 'error');
      } else if (error.message?.includes('not configured')) {
        if (typeof showToast === 'function') showToast('AI service is temporarily unavailable', 'error');
      } else {
        if (typeof showToast === 'function') showToast('Failed to generate recommendation', 'error');
      }
      
      throw error;
    }
  },
  
  /**
   * Quick inline recommendation (lighter weight)
   * @param {string} scenario - Brief description of the situation
   * @param {string} clubType - Club type being discussed
   * @param {object} currentSpecs - Current club specifications
   * @returns {Promise<string>} - Brief recommendation text
   */
  async quick(scenario, clubType, currentSpecs) {
    const quickRec = firebase.functions().httpsCallable('getQuickRecommendation');
    
    try {
      const result = await quickRec({
        scenario: scenario,
        clubType: clubType,
        currentSpecs: currentSpecs
      });
      
      return result.data.recommendation;
      
    } catch (error) {
      console.error('Quick recommendation error:', error);
      return null;
    }
  },
  
  // ==========================================================================
  // CONVENIENCE METHODS
  // ==========================================================================
  
  /**
   * Full bag review
   */
  async bagReview(clientId) {
    return this.generate(
      clientId,
      'bag_review',
      'Review my complete bag and identify the biggest opportunities for improvement. Consider gapping, weight progression, and shaft consistency.'
    );
  },
  
  /**
   * Club recommendation
   */
  async recommendClub(clientId, clubType, budget = null) {
    let query = `What ${clubType} would you recommend for me based on my profile and current bag?`;
    if (budget) {
      query += ` My budget is around $${budget}.`;
    }
    
    return this.generate(clientId, 'club_recommendation', query);
  },
  
  /**
   * Analyze performance test results
   */
  async analyzeTest(clientId, clubAData, clubBData, goals = []) {
    return this.generate(
      clientId,
      'performance_test',
      'Analyze these test results and tell me which club performed better and why.',
      {
        clubA: clubAData,
        clubB: clubBData,
        testGoals: goals
      }
    );
  },
  
  /**
   * Upgrade prioritization
   */
  async prioritizeUpgrades(clientId, budget = null) {
    let query = 'What should I upgrade first in my bag for maximum improvement?';
    if (budget) {
      query += ` I have about $${budget} to spend.`;
    }
    
    return this.generate(clientId, 'upgrade_priority', query);
  },
  
  /**
   * Pre-fitting preparation
   */
  async fittingPrep(clientId, fittingType = 'full bag') {
    return this.generate(
      clientId,
      'fitting_prep',
      `I'm going for a ${fittingType} fitting soon. What should I know, what questions should I ask, and what should I focus on?`
    );
  },
  
  /**
   * General question
   */
  async ask(clientId, question) {
    return this.generate(clientId, 'general', question);
  }
};

// =============================================================================
// UI INTEGRATION HELPERS
// =============================================================================

/**
 * Show AI recommendation in a modal
 */
async function showAIRecommendationModal(clientId, analysisType, title) {
  // Create modal if doesn't exist
  let modal = document.getElementById('ai-recommendation-modal');
  if (!modal) {
    modal = createAIRecommendationModal();
    document.body.appendChild(modal);
  }
  
  // Set title
  document.getElementById('ai-rec-modal-title').textContent = title || 'AI Recommendation';
  
  // Show loading state
  const contentDiv = document.getElementById('ai-rec-content');
  contentDiv.innerHTML = `
    <div style="text-align: center; padding: 40px;">
      <div class="loading-spinner"></div>
      <p style="margin-top: 16px; color: var(--text-muted);">Analyzing your profile and equipment...</p>
    </div>
  `;
  
  // Open modal
  openModal('ai-recommendation-modal');
  
  try {
    let result;
    
    switch (analysisType) {
      case 'bag_review':
        result = await AIRecommendations.bagReview(clientId);
        break;
      case 'upgrade_priority':
        result = await AIRecommendations.prioritizeUpgrades(clientId);
        break;
      case 'fitting_prep':
        result = await AIRecommendations.fittingPrep(clientId);
        break;
      default:
        result = await AIRecommendations.ask(clientId, 'Give me your top recommendations based on my profile.');
    }
    
    // Display result
    displayAIRecommendation(result);
    
  } catch (error) {
    contentDiv.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--red);">
        <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
        <p>Failed to generate recommendation</p>
        <p style="font-size: 12px; color: var(--text-muted); margin-top: 8px;">${error.message || 'Please try again'}</p>
      </div>
    `;
  }
}

/**
 * Create the AI recommendation modal HTML
 */
function createAIRecommendationModal() {
  const modal = document.createElement('div');
  modal.id = 'ai-recommendation-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="max-width: 700px; max-height: 80vh;">
      <div class="modal-header">
        <h3 class="modal-title" id="ai-rec-modal-title">🤖 AI Recommendation</h3>
        <button class="modal-close" onclick="closeModal('ai-recommendation-modal')">&times;</button>
      </div>
      <div class="modal-body" style="overflow-y: auto; max-height: 60vh;">
        <div id="ai-rec-content"></div>
      </div>
      <div class="modal-footer" style="display: flex; gap: 12px; justify-content: flex-end; padding: 16px 24px; border-top: 1px solid var(--border-light);">
        <button class="btn btn-secondary" onclick="copyAIRecommendation()">📋 Copy</button>
        <button class="btn btn-primary" onclick="closeModal('ai-recommendation-modal')">Done</button>
      </div>
    </div>
  `;
  return modal;
}

/**
 * Display AI recommendation with formatting
 */
function displayAIRecommendation(result) {
  const contentDiv = document.getElementById('ai-rec-content');
  
  if (!result || !result.recommendation) {
    contentDiv.innerHTML = '<p style="color: var(--text-muted);">No recommendation available.</p>';
    return;
  }
  
  // Convert markdown-style formatting to HTML
  let html = result.recommendation
    // Headers
    .replace(/^### (.+)$/gm, '<h4 style="color: var(--cyan); margin-top: 20px; margin-bottom: 8px;">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 style="color: var(--cyan); margin-top: 24px; margin-bottom: 12px;">$1</h3>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color: var(--text-primary);">$1</strong>')
    // Lists
    .replace(/^- (.+)$/gm, '<li style="margin-left: 20px; margin-bottom: 4px;">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li style="margin-left: 20px; margin-bottom: 4px;"><strong>$1.</strong> $2</li>')
    // Paragraphs
    .replace(/\n\n/g, '</p><p style="margin-bottom: 12px; line-height: 1.6;">')
    // Line breaks
    .replace(/\n/g, '<br>');
  
  // Wrap in paragraph tags
  html = '<p style="margin-bottom: 12px; line-height: 1.6;">' + html + '</p>';
  
  // Add profile context badge
  const profileBadge = result.profileUsed ? `
    <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--border-light);">
      <span class="badge" style="background: var(--cyan-dim); color: var(--cyan); padding: 4px 8px; border-radius: 4px; font-size: 11px;">
        ${result.profileUsed.communicationStyle || 'Balanced'}
      </span>
      ${result.profileUsed.primaryGoal ? `
        <span class="badge" style="background: var(--green-dim); color: var(--green); padding: 4px 8px; border-radius: 4px; font-size: 11px;">
          Goal: ${result.profileUsed.primaryGoal}
        </span>
      ` : ''}
      ${result.profileUsed.favoriteClubEnabled ? `
        <span class="badge" style="background: var(--yellow-dim); color: var(--yellow); padding: 4px 8px; border-radius: 4px; font-size: 11px;">
          ⭐ Favorite Club Baseline
        </span>
      ` : ''}
    </div>
  ` : '';
  
  contentDiv.innerHTML = profileBadge + html;
}

/**
 * Copy recommendation to clipboard
 */
function copyAIRecommendation() {
  const contentDiv = document.getElementById('ai-rec-content');
  const text = contentDiv.innerText;
  
  navigator.clipboard.writeText(text).then(() => {
    showToast('Recommendation copied to clipboard', 'success');
  }).catch(() => {
    showToast('Failed to copy', 'error');
  });
}

// =============================================================================
// INLINE AI TIPS (for factor cards, etc.)
// =============================================================================

/**
 * Get quick AI tip for a specific issue
 */
async function getInlineAITip(elementId, scenario, clubType, specs) {
  const tipElement = document.getElementById(elementId);
  if (!tipElement) return;
  
  tipElement.innerHTML = '<span style="color: var(--text-muted);">💭 Getting tip...</span>';
  
  const tip = await AIRecommendations.quick(scenario, clubType, specs);
  
  if (tip) {
    tipElement.innerHTML = `<span style="color: var(--cyan);">💡 ${tip}</span>`;
  } else {
    tipElement.innerHTML = '';
  }
}

// =============================================================================
// INTEGRATION WITH EXISTING UI
// =============================================================================

/**
 * Add AI button to bag view
 */
function addAIButtonToBagView() {
  const bagHeader = document.querySelector('.bag-header-actions');
  if (bagHeader && !document.getElementById('ai-bag-review-btn')) {
    const btn = document.createElement('button');
    btn.id = 'ai-bag-review-btn';
    btn.className = 'btn btn-secondary';
    btn.innerHTML = '🤖 AI Review';
    btn.onclick = () => showAIRecommendationModal(currentClientId, 'bag_review', 'AI Bag Review');
    bagHeader.appendChild(btn);
  }
}

/**
 * Add AI analysis to performance test results
 */
async function addAIAnalysisToTestResults(clientId, clubAData, clubBData, goals) {
  const analysisDiv = document.getElementById('ai-analysis-text');
  if (!analysisDiv) return;
  
  analysisDiv.innerHTML = '<span style="color: var(--text-muted);">🤖 Generating AI analysis...</span>';
  
  try {
    const result = await AIRecommendations.analyzeTest(clientId, clubAData, clubBData, goals);
    
    if (result && result.recommendation) {
      analysisDiv.innerHTML = result.recommendation;
    } else {
      // Fallback to local analysis
      analysisDiv.innerHTML = generateLocalAnalysis(clubAData, clubBData);
    }
  } catch (error) {
    // Fallback to local analysis on error
    analysisDiv.innerHTML = generateLocalAnalysis(clubAData, clubBData);
  }
}

/**
 * Local fallback analysis (no API call)
 */
function generateLocalAnalysis(clubAData, clubBData) {
  const carryDiff = (clubBData.carry || 0) - (clubAData.carry || 0);
  const ballSpeedDiff = (clubBData.ballSpeed || 0) - (clubAData.ballSpeed || 0);
  
  if (Math.abs(carryDiff) < 2) {
    return `The clubs perform nearly identically with only ${Math.abs(carryDiff).toFixed(0)} yard difference. Choose based on feel and confidence.`;
  }
  
  const winner = carryDiff > 0 ? 'Test Club (B)' : 'Your Club (A)';
  const gain = Math.abs(carryDiff).toFixed(0);
  
  return `${winner} shows ${gain} yards more carry${ballSpeedDiff !== 0 ? ` with ${Math.abs(ballSpeedDiff).toFixed(1)} mph ${ballSpeedDiff > 0 ? 'more' : 'less'} ball speed` : ''}. ${carryDiff > 0 ? 'Consider making the switch.' : 'Your current club is performing well.'}`;
}

// =============================================================================
// CSS FOR AI COMPONENTS
// =============================================================================

const aiStyles = `
  .ai-loading {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-muted);
  }
  
  .ai-tip {
    background: var(--bg-card);
    border-left: 3px solid var(--cyan);
    padding: 12px;
    margin-top: 12px;
    border-radius: 4px;
    font-size: 13px;
  }
  
  .ai-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--cyan-dim);
    color: var(--cyan);
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 500;
  }
  
  @keyframes ai-pulse {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 1; }
  }
  
  .ai-thinking {
    animation: ai-pulse 1.5s ease-in-out infinite;
  }
`;

// Inject styles
if (!document.getElementById('ai-styles')) {
  const styleSheet = document.createElement('style');
  styleSheet.id = 'ai-styles';
  styleSheet.textContent = aiStyles;
  document.head.appendChild(styleSheet);
}
