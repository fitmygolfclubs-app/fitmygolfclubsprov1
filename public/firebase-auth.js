/**
 * FitMyGolfClubs Pro - Firebase Auth & Data
 * Phase 1: Authentication
 * Phase 3: Firestore Client Data
 */

// Helper functions (safe to call before index.html defines them)
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
}

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById('page-' + pageId);
  if (page) page.classList.add('active');
}

// Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyCvoxmCGM0tizJmj5y_nsD2GQPO81XeoBA",
  authDomain: "fitmygolfclubs-pro-dev.firebaseapp.com",
  projectId: "fitmygolfclubs-pro-dev",
  storageBucket: "fitmygolfclubs-pro-dev.firebasestorage.app",
  messagingSenderId: "663221768630",
  appId: "1:663221768630:web:1266515765996d023df117"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Current user state
let currentUser = null;
let currentUserData = null;
let clientsData = [];

// Club grading data from last analysis (keyed by club ID)
let clubGradingData = {};

// Full analysis data from last grading (for factor modals)
let currentAnalysisData = null;

/**
 * Auth State Listener
 */
auth.onAuthStateChanged(async (user) => {
  currentUser = user;
  updateAuthUI(user);
  
  if (user) {
    console.log('✅ Logged in as:', user.email);
    
    // Fetch user data from Firestore
    await fetchUserData(user.uid);
    
    // If Pro, fetch their clients
    if (currentUserData && currentUserData.account_type === 'professional') {
      await fetchClients(user.uid);
    }
    
    // Initialize grading engine preference
    if (typeof loadGradingEnginePreference === 'function') {
      loadGradingEnginePreference();
    }
    
    // Hide login modal if open
    closeModal('login-modal');
  } else {
    console.log('❌ Not logged in');
    currentUserData = null;
    clientsData = [];
  }
});

/**
 * Fetch user data from Firestore
 */
async function fetchUserData(userId) {
  try {
    const doc = await db.collection('users').doc(userId).get();
    if (doc.exists) {
      currentUserData = doc.data();
      console.log('📋 User data loaded:', currentUserData.display_name, '| Type:', currentUserData.account_type);
    } else {
      console.warn('⚠️ No user document found');
    }
  } catch (error) {
    console.error('❌ Error fetching user data:', error);
  }
}

/**
 * Fetch clients for a Pro user
 */
async function fetchClients(proUserId) {
  try {
    console.log('🔍 Fetching clients for Pro:', proUserId);
    
    const snapshot = await db.collection('users')
      .where('pro_id', '==', proUserId)
      .where('account_type', '==', 'client')
      .get();
    
    clientsData = [];
    snapshot.forEach(doc => {
      clientsData.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    console.log(`✅ Loaded ${clientsData.length} clients`);
    
    // Update UI with real data
    renderClientsTable(clientsData);
    updateClientStats(clientsData);
    
  } catch (error) {
    console.error('❌ Error fetching clients:', error);
  }
}

/**
 * Create a new client record in Firestore
 * Returns the new client ID
 */
async function createClientRecord(clientData) {
  const currentUser = firebase.auth().currentUser;
  if (!currentUser) {
    throw new Error('Not authenticated');
  }
  
  try {
    // Generate invite code
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let inviteCode = 'FGA-';
    for (let i = 0; i < 4; i++) {
      inviteCode += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    const newClient = {
      display_name: clientData.name,
      email: clientData.email,
      ghin_number: clientData.ghin || null,
      handicap: clientData.handicap || null,
      pro_id: currentUser.uid,
      account_type: 'client',
      subscription_tier: 'limited',
      onboarded: false,
      clubs_count: 0,
      bag_grade: null,
      needs_attention: false,
      invite_code: inviteCode,
      invite_status: 'pending',
      created_at: firebase.firestore.FieldValue.serverTimestamp(),
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    const docRef = await db.collection('users').add(newClient);
    console.log('✅ Client created:', docRef.id);
    
    // Refresh clients list
    await fetchClients(currentUser.uid);
    
    return {
      id: docRef.id,
      inviteCode: inviteCode,
      ...newClient
    };
    
  } catch (error) {
    console.error('❌ Error creating client:', error);
    throw error;
  }
}

/**
 * Render clients table with real data
 */
// Retry counter for DOM timing issues
let renderRetryCount = 0;
const MAX_RENDER_RETRIES = 5;

function renderClientsTable(clients) {
  console.log('🔧 renderClientsTable called with', clients.length, 'clients');
  
  const tableBody = document.querySelector('#page-client-list .clients-table tbody');
  const mobileCards = document.querySelector('#page-client-list .clients-cards');
  
  console.log('🔧 tableBody found:', !!tableBody);
  console.log('🔧 mobileCards found:', !!mobileCards);
  
  // If DOM not ready, retry after short delay
  if (!tableBody || !mobileCards) {
    renderRetryCount++;
    if (renderRetryCount <= MAX_RENDER_RETRIES) {
      console.warn(`⚠️ DOM not ready, retry ${renderRetryCount}/${MAX_RENDER_RETRIES} in 300ms...`);
      setTimeout(() => renderClientsTable(clients), 300);
    } else {
      console.error('❌ DOM elements not found after max retries');
    }
    return;
  }
  
  // Reset retry counter on success
  renderRetryCount = 0;
  
  if (!tableBody) {
    console.warn('⚠️ Client table not found');
    return;
  }
  
  // Clear existing rows and cards
  tableBody.innerHTML = '';
  if (mobileCards) mobileCards.innerHTML = '';
  
  if (clients.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 40px; color: var(--text-muted);">
          No clients yet. Click "+ Add/Invite Client" to get started.
        </td>
      </tr>
    `;
    if (mobileCards) {
      mobileCards.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--text-muted);">
          No clients yet. Click "+ Add/Invite Client" to get started.
        </div>
      `;
    }
    return;
  }
  
  // Sort: needs attention first, then by name
  const sorted = [...clients].sort((a, b) => {
    if (a.needs_attention && !b.needs_attention) return -1;
    if (!a.needs_attention && b.needs_attention) return 1;
    return a.display_name.localeCompare(b.display_name);
  });
  
  sorted.forEach((client, index) => {
    // Desktop table row
    const row = document.createElement('tr');
    row.innerHTML = createClientRow(client);
    tableBody.appendChild(row);
    
    // Mobile card
    if (mobileCards) {
      try {
        const card = document.createElement('div');
        card.className = 'client-card';
        card.setAttribute('data-status', client.onboarded ? 'onboarded' : 'need-onboarding');
        card.setAttribute('data-attention', client.needs_attention ? 'true' : 'false');
        card.innerHTML = createClientCard(client);
        mobileCards.appendChild(card);
      } catch (err) {
        console.error(`❌ Error creating card for ${client.display_name}:`, err);
      }
    }
  });
  
  console.log('📊 Client table rendered with', sorted.length, 'clients');
  console.log('🔧 Mobile cards count:', mobileCards ? mobileCards.children.length : 'N/A');
}

/**
 * Create HTML for a mobile client card
 */
function createClientCard(client) {
  const initials = getInitials(client.display_name);
  const gradeClass = getGradeClass(client.bag_grade);
  
  const gradeBadge = client.bag_grade 
    ? `<span class="grade-badge ${gradeClass}">${client.bag_grade}</span>`
    : `<span class="grade-badge" style="background: var(--bg-main); color: var(--text-muted);">—</span>`;
  
  const attentionText = client.needs_attention ? ' • ⚠️ Needs attention' : '';
  const clubsText = client.clubs_count ? `${client.clubs_count} clubs` : 'No bag yet';
  const accessText = client.subscription_tier === 'premium' ? 'Full' : 'Limited';
  
  // Determine bag button based on clubs_count
  const hasBag = client.clubs_count && client.clubs_count > 0;
  const bagButton = hasBag
    ? `<button class="btn btn-primary" style="flex: 1; padding: 8px;" onclick="event.stopPropagation(); editBag('${client.id}')">Edit Bag</button>`
    : `<button class="btn btn-primary" style="flex: 1; padding: 8px;" onclick="event.stopPropagation(); addBagForClient('${client.id}')">Add Bag</button>`;
  
  const actionButtons = `
    <button class="btn btn-secondary" style="flex: 1; padding: 8px;" onclick="event.stopPropagation(); viewClient('${client.id}')">View</button>
    ${bagButton}
    <button class="btn btn-secondary" style="flex: 1; padding: 8px;" onclick="event.stopPropagation(); openProfileModal('${client.id}')">Profile</button>
    <button class="btn btn-secondary" style="padding: 8px 10px; color: var(--red);" onclick="event.stopPropagation(); deleteClient('${client.id}', '${client.display_name.replace(/'/g, "\\'")}')" title="Delete Client">🗑</button>
  `;
  
  return `
    <div class="client-card-header" onclick="viewClient('${client.id}')">
      <div class="client-card-info">
        <div class="client-avatar-sm">${initials}</div>
        <div class="client-card-details">
          <h3>${client.display_name}</h3>
          <p>${accessText} • ${clubsText}${attentionText}</p>
        </div>
      </div>
      ${gradeBadge}
    </div>
    <div class="client-card-actions">
      ${actionButtons}
    </div>
  `;
}

/**
 * Create HTML for a single client row
 */
function createClientRow(client) {
  const initials = getInitials(client.display_name);
  const gradeClass = getGradeClass(client.bag_grade);
  const accessBadge = client.subscription_tier === 'premium' 
    ? '<span class="badge badge-green">Full</span>'
    : '<span class="badge badge-yellow">Limited</span>';
  
  const gradeBadge = client.bag_grade 
    ? `<span class="badge ${gradeClass}" data-grade-badge="${client.id}">${client.bag_grade}</span>`
    : `<span class="badge badge-muted" data-grade-badge="${client.id}">—</span>`;
  
  // Determine bag button based on clubs_count
  const hasBag = client.clubs_count && client.clubs_count > 0;
  const bagButton = hasBag
    ? `<button class="table-btn secondary" onclick="editBag('${client.id}')">Edit Bag</button>`
    : `<button class="table-btn primary" onclick="addBagForClient('${client.id}')">Add Bag</button>`;
  
  const actionBtn = `
    <button class="table-btn primary" onclick="viewClient('${client.id}')">View</button>
    ${bagButton}
    <button class="table-btn secondary" onclick="event.stopPropagation(); openProfileModal('${client.id}')">Profile</button>
    <button class="table-btn secondary" style="color: var(--red); padding: 6px 8px;" onclick="event.stopPropagation(); deleteClient('${client.id}', '${client.display_name.replace(/'/g, "\\'")}')" title="Delete Client">🗑</button>
  `;
  
  // Attention indicator
  const attention = client.needs_attention 
    ? '<span style="color: var(--yellow); margin-left: 8px;" title="Needs attention">⚠️</span>' 
    : '';
  
  return `
    <td>
      <div style="display: flex; align-items: center; gap: 12px;">
        <div class="client-avatar">${initials}</div>
        <div>
          <div style="font-weight: 600;">${client.display_name}${attention}</div>
          <div style="color: var(--text-muted); font-size: 12px;">${client.email}</div>
        </div>
      </div>
    </td>
    <td>${accessBadge}</td>
    <td>${gradeBadge}</td>
    <td>${client.clubs_count || 0}</td>
    <td>${actionBtn}</td>
  `;
}

/**
 * Update client statistics cards
 * FIXED: Scoped selectors to #page-clients .stats-grid
 */
function updateClientStats(clients) {
  const statsGrid = document.querySelector('#page-client-list .stats-grid');
  if (!statsGrid) {
    console.warn('⚠️ Stats grid not found in #page-client-list');
    return;
  }
  
  const totalEl = statsGrid.querySelector('.stat-card:nth-child(1) .stat-value');
  const onboardedEl = statsGrid.querySelector('.stat-card:nth-child(2) .stat-value');
  const needOnboardingEl = statsGrid.querySelector('.stat-card:nth-child(3) .stat-value');
  const needAttentionEl = statsGrid.querySelector('.stat-card:nth-child(4) .stat-value');
  
  const total = clients.length;
  const onboarded = clients.filter(c => c.onboarded).length;
  const needOnboarding = clients.filter(c => !c.onboarded).length;
  const needAttention = clients.filter(c => c.needs_attention).length;
  
  if (totalEl) totalEl.textContent = total;
  if (onboardedEl) onboardedEl.textContent = onboarded;
  if (needOnboardingEl) needOnboardingEl.textContent = needOnboarding;
  if (needAttentionEl) needAttentionEl.textContent = needAttention;
  
  console.log(`📈 Stats updated: ${total} total, ${onboarded} onboarded, ${needOnboarding} need onboarding, ${needAttention} need attention`);
}

/**
 * Get initials from name
 */
function getInitials(name) {
  if (!name) return '?';
  const parts = name.split(' ');
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

/**
 * Get grade badge class
 */
function getGradeClass(grade) {
  if (!grade) return 'badge-muted';
  const letter = grade.charAt(0).toUpperCase();
  if (letter === 'A') return 'badge-green';
  if (letter === 'B') return 'badge-cyan';
  if (letter === 'C') return 'badge-yellow';
  return 'badge-red';
}

/**
 * Update UI based on auth state
 */
function updateAuthUI(user) {
  const avatarEl = document.querySelector('.user-avatar');
  
  if (user) {
    // Show user initials in avatar
    if (avatarEl) {
      const initials = user.email.substring(0, 2).toUpperCase();
      avatarEl.textContent = initials;
      avatarEl.title = user.email;
      avatarEl.style.cursor = 'pointer';
    }
  } else {
    // Show default avatar
    if (avatarEl) {
      avatarEl.textContent = '?';
      avatarEl.title = 'Click to login';
      avatarEl.style.cursor = 'pointer';
    }
  }
}

/**
 * Login with email/password
 */
async function loginWithEmail(email, password) {
  try {
    showLoading('Logging in...');
    const result = await auth.signInWithEmailAndPassword(email, password);
    hideLoading();
    return { success: true, user: result.user };
  } catch (error) {
    hideLoading();
    console.error('Login error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Sign up with email/password
 */
async function signUpWithEmail(email, password, displayName) {
  try {
    showLoading('Creating account...');
    const result = await auth.createUserWithEmailAndPassword(email, password);
    
    // Update profile with display name
    await result.user.updateProfile({ displayName: displayName });
    
    // Create user document in Firestore
    await db.collection('users').doc(result.user.uid).set({
      user_id: result.user.uid,
      email: email,
      display_name: displayName,
      account_type: 'professional',
      created_at: firebase.firestore.FieldValue.serverTimestamp(),
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      subscription_tier: 'free',
      clients_count: 0
    });
    
    hideLoading();
    return { success: true, user: result.user };
  } catch (error) {
    hideLoading();
    console.error('Signup error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Logout
 */
async function logout() {
  try {
    await auth.signOut();
    closeModal('login-modal');
    // Reset UI to demo data
    location.reload();
    return { success: true };
  } catch (error) {
    console.error('Logout error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Show login modal
 */
function showLoginModal() {
  // If already logged in, show logout option
  if (currentUser) {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('signup-form').style.display = 'none';
    document.getElementById('logout-section').style.display = 'block';
    document.getElementById('logged-in-email').textContent = currentUser.email;
  } else {
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('signup-form').style.display = 'none';
    document.getElementById('logout-section').style.display = 'none';
    showAuthTab('login');
  }
  openModal('login-modal');
}

/**
 * Handle login form submit
 */
async function handleLogin(event) {
  event.preventDefault();
  
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  
  if (!email || !password) {
    errorEl.textContent = 'Please enter email and password';
    errorEl.style.display = 'block';
    return;
  }
  
  const result = await loginWithEmail(email, password);
  
  if (result.success) {
    closeModal('login-modal');
    document.getElementById('login-form').reset();
    errorEl.style.display = 'none';
  } else {
    errorEl.textContent = result.error;
    errorEl.style.display = 'block';
  }
}

/**
 * Handle signup form submit
 */
async function handleSignup(event) {
  event.preventDefault();
  
  const name = document.getElementById('signup-name').value;
  const email = document.getElementById('signup-email').value;
  const password = document.getElementById('signup-password').value;
  const errorEl = document.getElementById('signup-error');
  
  if (!name || !email || !password) {
    errorEl.textContent = 'Please fill all fields';
    errorEl.style.display = 'block';
    return;
  }
  
  if (password.length < 6) {
    errorEl.textContent = 'Password must be at least 6 characters';
    errorEl.style.display = 'block';
    return;
  }
  
  const result = await signUpWithEmail(email, password, name);
  
  if (result.success) {
    closeModal('login-modal');
    document.getElementById('signup-form').reset();
    errorEl.style.display = 'none';
  } else {
    errorEl.textContent = result.error;
    errorEl.style.display = 'block';
  }
}

/**
 * Client action handlers (placeholders)
 */
function viewClient(clientId) {
  console.log('View client:', clientId);
  const client = clientsData.find(c => c.id === clientId);
  if (!client) {
    console.error('Client not found:', clientId);
    return;
  }
  
  // Clear previous client's grading data
  clubGradingData = {};
  currentAnalysisData = null;
  window.currentAnalysisData = null;
  
  // Clear AI summary (will be repopulated if analysis exists)
  populateAISummary(null);
  
  // Store current client for other functions
  window.currentClient = client;
  
  // Get initials
  const initials = getInitials(client.display_name || 'Unknown');
  
  // Format email (handle missing)
  const email = client.email || 'No email';
  
  // Format member since date
  const memberSince = client.created_at 
    ? new Date(client.created_at.seconds * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : 'Unknown';
  
  // Get tier badge
  const tier = client.subscription_tier || 'free';
  const tierClass = tier === 'full' ? 'full' : (tier === 'plus' ? 'plus' : 'free');
  const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
  
  // Update Pro View header elements
  const avatarEl = document.getElementById('client-avatar-lg');
  const nameEl = document.getElementById('client-detail-name');
  const metaEl = document.getElementById('client-detail-meta');
  const gradeEl = document.getElementById('client-bag-grade');
  const handicapEl = document.getElementById('client-handicap');
  const creditsEl = document.getElementById('client-credits');
  
  if (avatarEl) avatarEl.textContent = initials;
  if (nameEl) nameEl.textContent = client.display_name || 'Unknown Client';
  if (metaEl) {
    metaEl.innerHTML = `
      <span class="tier-badge ${tierClass}" style="margin-right: 8px;">${tierLabel}</span>
      ${email} • Member since ${memberSince}
    `;
  }
  if (gradeEl) {
    const grade = client.bag_grade || '--';
    gradeEl.textContent = grade;
    gradeEl.className = 'detail-stat-value grade ' + getGradeClass(grade);
  }
  
  // Also update the big overall grade circle
  const overallGradeEl = document.querySelector('.overall-grade-value');
  if (overallGradeEl) {
    const grade = client.bag_grade || '--';
    overallGradeEl.textContent = grade;
    overallGradeEl.className = 'overall-grade-value ' + getGradeClass(grade);
  }
  
  if (handicapEl) handicapEl.textContent = client.handicap || '--';
  if (creditsEl) creditsEl.textContent = client.credits_remaining || '--';
  
  // Also update Client View header (simpler version)
  const gradeElClient = document.getElementById('client-bag-grade-client');
  const handicapElClient = document.getElementById('client-handicap-client');
  const creditsElClient = document.getElementById('client-credits-client');
  
  if (gradeElClient) {
    const grade = client.bag_grade || '--';
    gradeElClient.textContent = grade;
    gradeElClient.className = 'detail-stat-value grade ' + getGradeClass(grade);
  }
  if (handicapElClient) handicapElClient.textContent = client.handicap || '--';
  if (creditsElClient) creditsElClient.textContent = client.credits_remaining || '--';
  
  // Navigate to client detail page
  showPage('client-detail');
  
  // Fetch and render client's clubs
  fetchClientClubs(clientId);
  
  // Fetch and display last analysis (factor scores)
  if (client.last_analysis_id) {
    fetchLastAnalysis(client.last_analysis_id);
  }
  
  // Initialize Testing Tab with client data
  if (typeof TestingTab !== 'undefined') {
    TestingTab.init(db, clientId);
  }
  
  console.log('✅ Loaded client:', client.display_name);
}

/**
 * Fetch last analysis and update factor scores display
 */
async function fetchLastAnalysis(analysisId) {
  console.log('📊 Fetching last analysis:', analysisId);
  
  try {
    const analysisDoc = await db.collection('bag_analysis').doc(analysisId).get();
    if (!analysisDoc.exists) {
      console.warn('Analysis not found:', analysisId);
      return;
    }
    
    const analysis = analysisDoc.data();
    
    // Map component scores to factor grid
    const componentMap = {
      'loft_gapping': 'loft',
      'age': 'age', 
      'weight_progression': 'weight',
      'flex_consistency': 'flex',
      'kickpoint_consistency': 'kickpoint',
      'length_progression': 'length',
      'lie_angle_progression': 'lie',
      'torque_consistency': 'torque'
    };
    
    // Update each factor score from stored analysis
    Object.entries(componentMap).forEach(([analysisKey, factorKey]) => {
      const score = analysis[`${analysisKey}_score`];
      const grade = analysis[`${analysisKey}_grade`];
      
      if (grade) {
        const gradeClass = grade.charAt(0).toLowerCase();
        
        // Find the factor item and update
        const factorItems = document.querySelectorAll('.factor-item');
        factorItems.forEach(item => {
          const onclick = item.getAttribute('onclick');
          if (onclick && onclick.includes(`'${factorKey}'`)) {
            const gradeSpan = item.querySelector('.factor-grade');
            if (gradeSpan) {
              gradeSpan.textContent = grade;
              gradeSpan.className = `factor-grade ${gradeClass}`;
            }
            
            // Mark as issue if score is below 70
            if (score < 70) {
              item.classList.add('issue');
            } else {
              item.classList.remove('issue');
            }
          }
        });
      }
    });
    
    // Update attention summary
    const attentionSummary = document.querySelector('.attention-summary span:last-child');
    if (attentionSummary) {
      const issues = analysis.issues_found || [];
      const issueCount = issues.length;
      if (issueCount > 0) {
        attentionSummary.innerHTML = `<strong>${issueCount} Issue${issueCount > 1 ? 's' : ''} Found</strong> — Click to view details`;
      } else {
        attentionSummary.innerHTML = `<strong>All clubs looking good!</strong> — No major issues found`;
      }
    }
    
    console.log('✅ Loaded factor scores from analysis');
    
    // Store full analysis for factor modals
    // Transform flattened format to match live grading format for consistency
    currentAnalysisData = {
      overall_grade: analysis.overall_grade,
      overall_score: analysis.overall_score,
      component_scores: {
        loft_gapping: { score: analysis.loft_gapping_score, grade: analysis.loft_gapping_grade },
        age: { score: analysis.age_score, grade: analysis.age_grade },
        weight_progression: { score: analysis.weight_progression_score, grade: analysis.weight_progression_grade },
        flex_consistency: { score: analysis.flex_consistency_score, grade: analysis.flex_consistency_grade },
        kickpoint_consistency: { score: analysis.kickpoint_consistency_score, grade: analysis.kickpoint_consistency_grade },
        length_progression: { score: analysis.length_progression_score, grade: analysis.length_progression_grade },
        lie_angle_progression: { score: analysis.lie_angle_progression_score, grade: analysis.lie_angle_progression_grade },
        torque_consistency: { score: analysis.torque_consistency_score, grade: analysis.torque_consistency_grade }
      },
      issues_found: analysis.issues_found || [],
      top_priority_fix: analysis.top_priority_fix,
      clubs: analysis.clubs || [],
      ai_bag_analysis: analysis.ai_bag_analysis || null,
      grade_explainer: analysis.grade_explainer || null,
      grip_assessment: analysis.grip_assessment || null,
      favorite_club_baseline: analysis.favorite_club_baseline || null,
      weight_suggestions: analysis.weight_suggestions || [],
      body_fit_baseline: analysis.body_fit_baseline || null,
      length_suggestions: analysis.length_suggestions || []
    };
    window.currentAnalysisData = currentAnalysisData;
    console.log('📊 Stored analysis data for factor modals');
    
    // Build club issues map for club card badges
    if (typeof buildClubIssuesMap === 'function') {
      buildClubIssuesMap();
    }
    
    // Merge fresh club lengths if clubs already loaded
    if (window.currentClientClubs && currentAnalysisData.clubs) {
      window.currentClientClubs.forEach(freshClub => {
        const analysisClub = currentAnalysisData.clubs.find(c => c.id === freshClub.id);
        if (analysisClub) {
          // Merge length data
          if (freshClub.length) {
            analysisClub.length = freshClub.length;
            analysisClub.lengthIsDefault = freshClub.lengthIsDefault || false;
          }
          // Merge shaft data for consistent access
          if (freshClub.shaft_kickpoint) analysisClub.shaft_kickpoint = freshClub.shaft_kickpoint;
          if (freshClub.shaft_flex) analysisClub.shaft_flex = freshClub.shaft_flex;
          if (freshClub.shaft_weight) analysisClub.shaft_weight = freshClub.shaft_weight;
          if (freshClub.shaft_torque) analysisClub.shaft_torque = freshClub.shaft_torque;
          // Merge lie angle data
          if (freshClub.lie) analysisClub.lie = freshClub.lie;
          if (freshClub.lieIsDefault !== undefined) analysisClub.lieIsDefault = freshClub.lieIsDefault;
          if (freshClub.lieIsUserEdited !== undefined) analysisClub.lieIsUserEdited = freshClub.lieIsUserEdited;
          if (freshClub.originalLieAngle !== undefined) analysisClub.originalLieAngle = freshClub.originalLieAngle;
          // Merge flex data
          if (freshClub.shaft_flex) analysisClub.shaft_flex = freshClub.shaft_flex;
          if (freshClub.flexIsDefault !== undefined) analysisClub.flexIsDefault = freshClub.flexIsDefault;
          if (freshClub.flexIsUserEdited !== undefined) analysisClub.flexIsUserEdited = freshClub.flexIsUserEdited;
          if (freshClub.originalShaftFlex !== undefined) analysisClub.originalShaftFlex = freshClub.originalShaftFlex;
          // Merge loft data
          if (freshClub.loft) analysisClub.loft = freshClub.loft;
          if (freshClub.loftIsDefault !== undefined) analysisClub.loftIsDefault = freshClub.loftIsDefault;
          if (freshClub.loftIsUserEdited !== undefined) analysisClub.loftIsUserEdited = freshClub.loftIsUserEdited;
          if (freshClub.originalLoft !== undefined) analysisClub.originalLoft = freshClub.originalLoft;
        }
      });
      console.log('📏 Merged fresh length and shaft data from currentClientClubs');
    }
    
    // Update grade explainer and grip assessment UI
    if (typeof loadAnalysisDisplay === 'function') {
      loadAnalysisDisplay(currentAnalysisData);
    }
    
    // Restore club grading data from saved analysis
    if (analysis.clubs && analysis.clubs.length > 0) {
      analysis.clubs.forEach(club => {
        if (club.id && club.grading) {
          clubGradingData[club.id] = club.grading;
        }
      });
      console.log(`📊 Restored grading data for ${Object.keys(clubGradingData).length} clubs`);
      
      // Re-render clubs with restored grading data
      if (window.currentClient) {
        fetchClientClubs(window.currentClient.id);
      }
    }
    
    // Populate AI Summary section from saved analysis
    populateAISummary(analysis.ai_bag_analysis);
    
  } catch (error) {
    console.error('Error fetching analysis:', error);
  }
}

/**
 * Fetch client's clubs from Firestore
 */
async function fetchClientClubs(clientId) {
  console.log('🔍 Fetching clubs for client:', clientId);
  
  const clubsContainer = document.getElementById('clubs-container');
  if (!clubsContainer) {
    console.error('clubs-container not found');
    return;
  }
  
  // Show loading state
  clubsContainer.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-muted);">Loading clubs...</div>';
  
  try {
    // Fetch clubs from subcollection
    const snapshot = await db.collection('users').doc(clientId).collection('clubs').get();
    
    if (snapshot.empty) {
      clubsContainer.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-muted);">No clubs found. Click "+ Add Club" to start building this client\'s bag.</div>';
      return;
    }
    
    // Group clubs by category
    const clubsByCategory = {
      woods: [],
      hybrids: [],
      irons: [],
      wedges: [],
      putter: []
    };
    
    const clubs = [];
    snapshot.forEach(doc => {
      clubs.push({ id: doc.id, ...doc.data() });
    });
    
    // Fetch specs for all clubs
    const enrichedClubs = await enrichClubsWithSpecs(clubs);
    
    // Group by category (derive from clubType if not set)
    enrichedClubs.forEach(club => {
      const cat = club.category || deriveCategoryFromClubType(club.clubType || club.club_type);
      if (clubsByCategory[cat]) {
        clubsByCategory[cat].push(club);
      }
    });
    
    // Sort clubs within each category
    sortClubsInCategory(clubsByCategory);
    
    // Render clubs
    renderClubs(clubsByCategory, clubsContainer);
    
    // Store clubs globally for reference
    window.currentClientClubs = enrichedClubs;
    
    // Merge fresh length data into analysis data if loaded
    if (window.currentAnalysisData && window.currentAnalysisData.clubs) {
      enrichedClubs.forEach(freshClub => {
        const analysisClub = window.currentAnalysisData.clubs.find(c => c.id === freshClub.id);
        if (analysisClub) {
          // Merge length data
          if (freshClub.length) {
            analysisClub.length = freshClub.length;
            analysisClub.lengthIsDefault = freshClub.lengthIsDefault || false;
          }
          // Merge shaft data for consistent access
          if (freshClub.shaft_kickpoint) analysisClub.shaft_kickpoint = freshClub.shaft_kickpoint;
          if (freshClub.shaft_flex) analysisClub.shaft_flex = freshClub.shaft_flex;
          if (freshClub.shaft_weight) analysisClub.shaft_weight = freshClub.shaft_weight;
          if (freshClub.shaft_torque) analysisClub.shaft_torque = freshClub.shaft_torque;
          // Merge weight edit tracking fields
          if (freshClub.weightIsDefault !== undefined) analysisClub.weightIsDefault = freshClub.weightIsDefault;
          if (freshClub.weightIsUserEdited !== undefined) analysisClub.weightIsUserEdited = freshClub.weightIsUserEdited;
          if (freshClub.originalShaftWeight !== undefined) analysisClub.originalShaftWeight = freshClub.originalShaftWeight;
          // Merge lie angle data
          if (freshClub.lie) analysisClub.lie = freshClub.lie;
          if (freshClub.lieIsDefault !== undefined) analysisClub.lieIsDefault = freshClub.lieIsDefault;
          if (freshClub.lieIsUserEdited !== undefined) analysisClub.lieIsUserEdited = freshClub.lieIsUserEdited;
          if (freshClub.originalLieAngle !== undefined) analysisClub.originalLieAngle = freshClub.originalLieAngle;
          // Merge flex data
          if (freshClub.shaft_flex) analysisClub.shaft_flex = freshClub.shaft_flex;
          if (freshClub.flexIsDefault !== undefined) analysisClub.flexIsDefault = freshClub.flexIsDefault;
          if (freshClub.flexIsUserEdited !== undefined) analysisClub.flexIsUserEdited = freshClub.flexIsUserEdited;
          if (freshClub.originalShaftFlex !== undefined) analysisClub.originalShaftFlex = freshClub.originalShaftFlex;
          // Merge loft data
          if (freshClub.loft) analysisClub.loft = freshClub.loft;
          if (freshClub.loftIsDefault !== undefined) analysisClub.loftIsDefault = freshClub.loftIsDefault;
          if (freshClub.loftIsUserEdited !== undefined) analysisClub.loftIsUserEdited = freshClub.loftIsUserEdited;
          if (freshClub.originalLoft !== undefined) analysisClub.originalLoft = freshClub.originalLoft;
        }
      });
      console.log('📏 Merged fresh length and shaft data into analysis');
    }
    
    console.log(`✅ Loaded ${clubs.length} clubs`);
    
  } catch (error) {
    console.error('❌ Error fetching clubs:', error);
    clubsContainer.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--red);">Error loading clubs. Please try again.</div>';
  }
}

// Expose as window function for pro-integration.js
window.loadClientBag = fetchClientClubs;

/**
 * Enrich clubs with spec data from database
 */
async function enrichClubsWithSpecs(clubs) {
  const enriched = [];
  
  // Cache for specs to avoid duplicate fetches
  const specCache = {};
  const shaftCache = {};
  
  for (const club of clubs) {
    const enrichedClub = { ...club };
    
    // Normalize clubType (handle old club_type field)
    if (!enrichedClub.clubType && enrichedClub.club_type) {
      enrichedClub.clubType = enrichedClub.club_type;
    }
    
    // Fetch clubHeadSpec if referenced and data not already present
    if (club.clubHeadSpecId && !club.brand) {
      if (!specCache[club.clubHeadSpecId]) {
        const specDoc = await db.collection('clubHeadSpecs').doc(club.clubHeadSpecId).get();
        if (specDoc.exists) {
          specCache[club.clubHeadSpecId] = specDoc.data();
        }
      }
      
      const spec = specCache[club.clubHeadSpecId];
      if (spec) {
        enrichedClub.brand = spec.brand;
        enrichedClub.model = spec.model;
        enrichedClub.year = spec.year;
        
        // Get club-specific specs (loft, lie, length)
        const clubKey = getClubKey(enrichedClub.clubType || enrichedClub.club_type);
        if (spec.clubs && spec.clubs[clubKey]) {
          const clubSpec = spec.clubs[clubKey];
          enrichedClub.loft = clubSpec.loft;
          enrichedClub.lie = clubSpec.lie;  // Standard: lie (not lie_angle)
          enrichedClub.length = clubSpec.length;
        }
      }
    }
    
    // Fetch shaftSpec if referenced and shaft data not already present
    // Output FLAT fields per Master Field Reference
    if (club.shaftId && !club.shaft_flex) {
      if (!shaftCache[club.shaftId]) {
        const shaftDoc = await db.collection('shaftSpecDatabase').doc(club.shaftId).get();
        if (shaftDoc.exists) {
          shaftCache[club.shaftId] = shaftDoc.data();
        }
      }
      
      const shaft = shaftCache[club.shaftId];
      if (shaft) {
        // Use FLAT shaft fields (per Master Field Reference)
        enrichedClub.shaft_brand = shaft.brand;
        enrichedClub.shaft_model = shaft.model;
        enrichedClub.shaft_flex = shaft.flex;
        enrichedClub.shaft_weight = shaft.weight;
        enrichedClub.shaft_torque = shaft.torque;
        enrichedClub.shaft_kickpoint = shaft.kickPoint || shaft.kickpoint;
      }
    }
    
    // Handle legacy nested shaft object - convert to flat
    if (!enrichedClub.shaft_flex && club.shaft) {
      enrichedClub.shaft_brand = club.shaft.brand;
      enrichedClub.shaft_model = club.shaft.model;
      enrichedClub.shaft_flex = club.shaft.flex;
      enrichedClub.shaft_weight = club.shaft.weight;
      enrichedClub.shaft_torque = club.shaft.torque;
      enrichedClub.shaft_kickpoint = club.shaft.kickpoint;
    }
    
    enriched.push(enrichedClub);
  }
  
  return enriched;
}

/**
 * Convert club_type to spec key (e.g., "5i" -> "5i", "Driver" -> "Driver")
 */
function getClubKey(clubType) {
  // Handle iron naming variations
  if (clubType.match(/^\d+i$/)) return clubType;
  if (clubType.match(/^\d+ Iron$/)) return clubType.replace(' Iron', 'i');
  if (clubType.match(/^\d+H$/)) return clubType;
  if (clubType.match(/^\d+W$/)) return clubType;
  if (clubType.match(/^\d+°$/)) return clubType;
  return clubType;
}

/**
 * Derive category from club type string
 */
function deriveCategoryFromClubType(clubType) {
  if (!clubType) return 'irons';
  const t = clubType.toLowerCase();
  
  // Woods: Driver, 3-Wood, 5W, etc.
  if (clubType === 'Driver' || t.includes('driver')) return 'woods';
  if (t.match(/^\d+[-\s]?wood$/) || t.match(/^\d+w$/i)) return 'woods';
  
  // Hybrids: 4-Hybrid, 4H, etc.
  if (t.match(/^\d+[-\s]?hybrid$/) || t.match(/^\d+h$/i)) return 'hybrids';
  
  // Wedges: 52°, 56°, etc. or named wedges like "Sand Wedge"
  if (t.match(/^\d+°$/) || t.includes('sand wedge') || t.includes('lob wedge')) return 'wedges';
  
  // Putter
  if (t.includes('putter')) return 'putter';
  
  // Irons: 5-Iron, 5i, PW, GW, AW, etc.
  if (t.match(/^\d+[-\s]?iron$/) || t.match(/^\d+i$/i)) return 'irons';
  if (['pw', 'gw', 'aw', 'sw', 'lw'].includes(t)) return 'irons';
  if (t === 'pitching wedge' || t === 'gap wedge' || t === 'approach wedge') return 'irons';
  
  return 'irons'; // Default
}

/**
 * Sort clubs within each category
 */
function sortClubsInCategory(clubsByCategory) {
  // Helper to get clubType (handles both old and new schema)
  const getType = (club) => club.clubType || club.club_type;
  
  // Helper to normalize club type for sorting (8-Iron → 8i, Pitching Wedge → PW)
  const normalizeForSort = (type) => {
    if (!type) return '';
    // Handle "8-Iron" or "8 Iron" → "8i"
    const ironMatch = type.match(/^(\d+)[-\s]?[Ii]ron$/);
    if (ironMatch) return ironMatch[1] + 'i';
    // Handle "Pitching Wedge" → "PW"
    if (type === 'Pitching Wedge') return 'PW';
    if (type === 'Gap Wedge') return 'GW';
    if (type === 'Approach Wedge') return 'AW';
    if (type === 'Sand Wedge') return 'SW';
    if (type === 'Lob Wedge') return 'LW';
    // Handle "4-Hybrid" or "4 Hybrid" → "4H"
    const hybridMatch = type.match(/^(\d+)[-\s]?[Hh]ybrid$/);
    if (hybridMatch) return hybridMatch[1] + 'H';
    // Handle "3-Wood" or "3 Wood" → "3W"
    const woodMatch = type.match(/^(\d+)[-\s]?[Ww]ood$/);
    if (woodMatch) return woodMatch[1] + 'W';
    return type;
  };
  
  // Woods: Driver first, then by number (3W, 5W, 7W)
  clubsByCategory.woods.sort((a, b) => {
    const aType = normalizeForSort(getType(a));
    const bType = normalizeForSort(getType(b));
    if (aType === 'Driver') return -1;
    if (bType === 'Driver') return 1;
    // Extract number from "3W" format
    const aNum = parseInt(aType) || 99;
    const bNum = parseInt(bType) || 99;
    return aNum - bNum;
  });
  
  // Hybrids: by number (3H, 4H, 5H)
  clubsByCategory.hybrids.sort((a, b) => {
    const aType = normalizeForSort(getType(a));
    const bType = normalizeForSort(getType(b));
    const aNum = parseInt(aType) || 99;
    const bNum = parseInt(bType) || 99;
    return aNum - bNum;
  });
  
  // Irons: by club number (5i before 6i, etc.)
  const ironOrder = ['3i', '4i', '5i', '6i', '7i', '8i', '9i', 'PW', 'AW', 'GW'];
  clubsByCategory.irons.sort((a, b) => {
    const aType = normalizeForSort(getType(a));
    const bType = normalizeForSort(getType(b));
    const aIdx = ironOrder.indexOf(aType);
    const bIdx = ironOrder.indexOf(bType);
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
  });
  
  // Wedges: by loft (extract from loft field or clubType name)
  clubsByCategory.wedges.sort((a, b) => {
    // Helper to get loft value
    const getLoft = (club) => {
      // Use loft field if available
      if (club.loft && typeof club.loft === 'number') return club.loft;
      
      // Try to extract from clubType (e.g., "60°" or "60° Wedge")
      const typeMatch = (club.clubType || '').match(/(\d+)°?/);
      if (typeMatch) return parseInt(typeMatch[1]);
      
      // Named wedges - assign typical lofts
      const type = (club.clubType || '').toLowerCase();
      if (type.includes('gap') || type === 'gw') return 50;
      if (type.includes('sand') || type === 'sw') return 56;
      if (type.includes('lob') || type === 'lw') return 60;
      if (type.includes('approach') || type === 'aw') return 52;
      if (type.includes('ultra') || type === 'uw') return 64;
      if (type.includes('pitching') || type === 'pw') return 46;
      
      return 99; // Unknown
    };
    
    return getLoft(a) - getLoft(b);
  });
}

/**
 * Render clubs to the DOM
 */
function renderClubs(clubsByCategory, container) {
  const categoryLabels = {
    woods: 'Woods',
    hybrids: 'Hybrids',
    irons: 'Irons',
    wedges: 'Wedges',
    putter: 'Putter'
  };
  
  // Add Club button at top
  let html = `
    <div style="margin-bottom: 20px; text-align: right;">
      <button class="btn btn-secondary" onclick="openAddClubModal()">+ Add Club</button>
    </div>
  `;
  
  for (const [category, clubs] of Object.entries(clubsByCategory)) {
    if (clubs.length === 0) continue;
    
    html += `
      <div class="clubs-category" data-category="${category}">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 20px;">
          <div class="section-label">${categoryLabels[category]}</div>
        </div>
    `;
    
    for (const club of clubs) {
      html += renderClubCard(club);
    }
    
    html += '</div>';
  }
  
  container.innerHTML = html;
}

/**
 * Render a single club card
 */
function renderClubCard(club) {
  // Handle both old (club_type) and new (clubType) schema
  const clubType = club.clubType || club.club_type;
  const clubName = formatClubName(clubType);
  const brandModel = club.brand && club.model 
    ? `${club.brand} ${club.model}${club.year ? ` (${club.year})` : ''}`
    : 'Unknown Club';
  
  // Build specs line
  const specsLine = buildSpecsLine(club);
  
  // Look up grading data for this club
  const grading = clubGradingData[club.id] || {};
  const condition = grading.condition || '';
  
  // Check for issues from the issues map
  const clubIssues = getClubIssuesFromMap(clubName, clubType, club.loft);
  
  // Determine status based on condition OR issues map
  let status = 'good';
  let statusText = '✓ Good Fit';
  let statusClass = 'good';
  
  // Check if this club has issues from grading
  const isGoodFit = !condition || 
                    condition === 'Optimal Fit' || 
                    condition === 'Good Fit' ||
                    condition.toLowerCase().includes('optimal') ||
                    condition.toLowerCase().includes('excellent');
  
  // Filter out 'defaults' issues - those are informational, not equipment problems
  const realIssues = clubIssues.filter(i => i.category !== 'defaults');
  
  // Override with issues map if we have REAL issues there
  if (realIssues.length > 0) {
    // Has real issues from issues_found array
    status = 'attention';
    statusClass = 'attention';
    // Create descriptive badge based on primary issue
    const primaryIssue = realIssues[0];
    statusText = getIssueBadgeText(primaryIssue);
  } else if (condition && !isGoodFit) {
    status = 'attention';
    statusText = '⚠️ Attention';
    statusClass = 'attention';
  }
  
  // Build suggestion box HTML (purple) - show specific_recommendation if exists
  // OR show full issue text for loft/gap/length/weight issues (they have valuable detail)
  let suggestionHtml = '';
  if (!isGoodFit && grading.specific_recommendation) {
    suggestionHtml = `<div class="club-suggestion">💡 ${grading.specific_recommendation}</div>`;
  } else if (realIssues.length > 0) {
    // For certain issue categories, the full issue text is more valuable than short badge
    const primaryIssue = realIssues[0];
    const detailedCategories = ['loft', 'length', 'weight'];
    if (detailedCategories.includes(primaryIssue.category) && primaryIssue.text && primaryIssue.text.length > 20) {
      suggestionHtml = `<div class="club-suggestion">💡 ${primaryIssue.text}</div>`;
    }
  }
  
  // Build issue box HTML (yellow) - only show if:
  // 1. NO purple suggestion box exists, AND
  // 2. NO descriptive badge (realIssues already shows issue in header badge)
  // This avoids redundancy where badge and yellow box show the same thing
  let issueHtml = '';
  const hasDescriptiveBadge = realIssues.length > 0; // Badge already shows the issue
  if (!suggestionHtml && !hasDescriptiveBadge) {
    if (!isGoodFit && condition) {
      issueHtml = `<div class="club-issue">${condition}</div>`;
    }
  }
  
  return `
    <div class="club-card status-${status}">
      <div class="club-header">
        <div class="club-header-left">
          <span class="club-name">${clubName}</span>
          <span class="club-status ${statusClass}">${statusText}</span>
        </div>
        <div class="club-menu-wrapper">
          <button class="club-menu-btn" onclick="toggleClubMenu(this, '${club.id}')">⋮</button>
          <div class="club-menu-dropdown" id="club-menu-${club.id}">
            <button class="club-menu-item" onclick="editClub('${club.id}')">✏️ Edit</button>
            <button class="club-menu-item danger" onclick="deleteClub('${club.id}')">🗑️ Delete</button>
          </div>
        </div>
      </div>
      <div class="club-specs">
        ${brandModel}<br>
        ${specsLine}
      </div>
      ${issueHtml}
      ${suggestionHtml}
      <div class="club-actions">
        <button class="club-action-btn scenario" onclick="startScenarioForClub('${club.id}')">🔄 Scenario</button>
        <button class="club-action-btn test" onclick="startTestForClub('${club.id}')">📊 Test</button>
        <button class="club-action-btn shop pro-only">🛒 Shop</button>
      </div>
    </div>
  `;
}

/**
 * Get issues for a club from the issues map
 */
function getClubIssuesFromMap(clubName, clubType, loft) {
  if (!window.clubIssuesMap) return [];
  
  // Try multiple key formats
  const keysToTry = [];
  
  // Format club name to key format
  if (clubName) {
    keysToTry.push(clubName.toLowerCase().replace(/\s+/g, '-'));
    keysToTry.push(clubName.toLowerCase().replace(/\s+/g, ''));
  }
  
  // Try type-based keys
  if (clubType) {
    const type = clubType.toLowerCase();
    keysToTry.push(type);
    
    // Handle variations
    if (type === 'driver') keysToTry.push('driver');
    if (type.match(/^\d+w$/)) {
      keysToTry.push(type.replace('w', '-wood'));
      keysToTry.push(type.charAt(0) + '-wood');
    }
    if (type.match(/^\d+h$/)) {
      keysToTry.push(type.replace('h', '-hybrid'));
      keysToTry.push(type.charAt(0) + '-hybrid');
    }
    if (type.match(/^\d+i$/)) {
      keysToTry.push(type.replace('i', '-iron'));
      keysToTry.push(type.charAt(0) + '-iron');
    }
    if (type === 'pw') keysToTry.push('pw', 'pitching-wedge');
    if (type === 'gw') keysToTry.push('gw', 'gap-wedge');
    if (type === 'sw') keysToTry.push('sw', 'sand-wedge');
    if (type === 'lw') keysToTry.push('lw', 'lob-wedge');
  }
  
  // Try loft-based key for wedges
  if (loft && loft >= 46) {
    keysToTry.push(`${loft}°`);
  }
  
  // Search for matching issues
  for (const key of keysToTry) {
    if (window.clubIssuesMap[key]) {
      return window.clubIssuesMap[key];
    }
  }
  
  return [];
}

/**
 * Get badge text based on issue category
 */
function getIssueBadgeText(issue) {
  if (!issue) return '⚠️ Attention';
  
  const category = issue.category;
  const shortDesc = issue.shortDesc || '';
  
  switch (category) {
    case 'age':
      return `⏰ ${shortDesc || 'Age Concern'}`;
    case 'loft':
      return `📐 ${shortDesc || 'Loft Issue'}`;
    case 'weight':
      return `⚖️ ${shortDesc || 'Weight Issue'}`;
    case 'flex':
      return `🔄 ${shortDesc || 'Flex Issue'}`;
    case 'kickpoint':
      return `📍 ${shortDesc || 'Kickpoint'}`;
    case 'length':
      return `📏 ${shortDesc || 'Length Issue'}`;
    case 'lie':
      return `📐 ${shortDesc || 'Lie Angle'}`;
    case 'torque':
      return `🌀 ${shortDesc || 'Torque Issue'}`;
    case 'defaults':
      return `📝 ${shortDesc || 'Needs specs'}`;
    default:
      return '⚠️ Attention';
  }
}

/**
 * Format club type for display
 */
function formatClubName(clubType) {
  if (!clubType) return 'Unknown';
  if (clubType === 'Driver') return 'Driver';
  if (clubType.match(/^\d+W$/)) return clubType.replace('W', '-Wood');
  if (clubType.match(/^\d+H$/)) return clubType.replace('H', ' Hybrid');
  if (clubType.match(/^\d+i$/)) return clubType.replace('i', '-Iron');
  if (clubType === 'PW') return 'Pitching Wedge';
  if (clubType === 'GW') return 'Gap Wedge';
  if (clubType === 'AW') return 'Approach Wedge';
  if (clubType === 'SW') return 'Sand Wedge';
  if (clubType === 'LW') return 'Lob Wedge';
  if (clubType.match(/^\d+°$/)) return clubType + ' Wedge';
  return clubType;
}

/**
 * Build the specs line for a club (supports both nested shaft and flat fields)
 */
function buildSpecsLine(club) {
  const parts = [];
  
  // Loft
  if (club.loft) {
    parts.push(`${club.loft}°`);
  }
  
  // Shaft info - prefer flat fields (standard), fall back to nested (legacy)
  const shaftBrand = club.shaft_brand || club.shaft?.brand;
  const shaftModel = club.shaft_model || club.shaft?.model;
  const shaftWeight = club.shaft_weight || club.shaft?.weight;
  const shaftFlex = club.shaft_flex || club.shaft?.flex;
  
  if (shaftBrand && shaftModel) {
    let shaftStr = `${shaftBrand} ${shaftModel}`;
    if (shaftWeight) shaftStr += ` ${shaftWeight}g`;
    parts.push(shaftStr);
  }
  
  // Flex
  if (shaftFlex) {
    parts.push(shaftFlex);
  }
  
  return parts.join(' • ') || 'No specs available';
}

function editBag(clientId) {
  console.log('Edit bag:', clientId);
  // Navigate to the client's bag tab
  viewClient(clientId);
}

/**
 * Delete a client and all their data
 */
async function deleteClient(clientId, clientName) {
  // Use branded modal if available, otherwise fall back to confirm
  let confirmed = false;
  
  if (typeof showConfirmModal === 'function') {
    confirmed = await showConfirmModal(
      `⚠️ Delete "${clientName}"?`,
      `This will permanently delete:\n\n• Client profile\n• All clubs in their bag\n• All analysis history\n\nThis action cannot be undone.`,
      'Delete'
    );
  } else {
    confirmed = confirm(
      `⚠️ Delete "${clientName}"?\n\nThis will permanently delete:\n• Client profile\n• All clubs in their bag\n• All analysis history\n\nThis action cannot be undone.`
    );
  }
  
  if (!confirmed) return;
  
  // Double confirm for safety
  let doubleConfirm = false;
  
  if (typeof showConfirmModal === 'function') {
    doubleConfirm = await showConfirmModal(
      'Final Confirmation',
      `Are you absolutely sure you want to delete "${clientName}"?\n\nThis cannot be undone.`,
      'Yes, Delete Forever'
    );
  } else {
    doubleConfirm = confirm(
      `Are you absolutely sure you want to delete "${clientName}"?\n\nType OK to confirm.`
    );
  }
  
  if (!doubleConfirm) return;
  
  try {
    showToast('Deleting client...', 'info');
    
    // Delete clubs subcollection first
    const clubsSnapshot = await db.collection('users').doc(clientId).collection('clubs').get();
    const clubBatch = db.batch();
    clubsSnapshot.docs.forEach(doc => {
      clubBatch.delete(doc.ref);
    });
    await clubBatch.commit();
    console.log(`🗑️ Deleted ${clubsSnapshot.size} clubs`);
    
    // Delete analysis subcollection if exists
    try {
      const analysisSnapshot = await db.collection('users').doc(clientId).collection('analysis').get();
      if (!analysisSnapshot.empty) {
        const analysisBatch = db.batch();
        analysisSnapshot.docs.forEach(doc => {
          analysisBatch.delete(doc.ref);
        });
        await analysisBatch.commit();
        console.log(`🗑️ Deleted ${analysisSnapshot.size} analysis records`);
      }
    } catch (e) {
      // Analysis collection may not exist
    }
    
    // Delete the client document
    await db.collection('users').doc(clientId).delete();
    console.log('🗑️ Client deleted:', clientId);
    
    showToast(`"${clientName}" deleted successfully`, 'success');
    
    // Refresh client list
    const currentUser = firebase.auth().currentUser;
    if (currentUser) {
      await fetchClients(currentUser.uid);
    }
    
    // If viewing this client, go back to clients list
    if (window.currentClient && window.currentClient.id === clientId) {
      showPage('clients');
    }
    
  } catch (error) {
    console.error('❌ Error deleting client:', error);
    showToast('Error deleting client: ' + error.message, 'error');
  }
}

/**
 * Add bag for a client using BagOnboarding wizard
 */
function addBagForClient(clientId) {
  const client = clientsData.find(c => c.id === clientId);
  if (!client) {
    showToast('Client not found', 'error');
    return;
  }
  
  console.log('📦 Starting bag onboarding for:', client.display_name);
  
  // Check if BagOnboarding is available
  if (typeof BagOnboarding === 'undefined' || !BagOnboarding.start) {
    showToast('Bag onboarding not available', 'error');
    return;
  }
  
  // Start BagOnboarding for this client
  BagOnboarding.start({
    userId: clientId,
    onComplete: async (bagData) => {
      console.log('✅ Bag onboarding complete:', bagData);
      
      try {
        // Save each club to Firestore
        const clubsRef = db.collection('users').doc(clientId).collection('clubs');
        const batch = db.batch();
        let clubCount = 0;
        
        for (const club of bagData) {
          const clubDoc = clubsRef.doc();
          const clubData = {
            clubType: club.clubType,
            category: club.category,
            brand: club.brand,
            model: club.model,
            year: club.year || null,
            clubHeadSpecId: club.clubHeadSpecId || null,
            // Specs can be nested in club.specs or at top level
            loft: club.loft || club.specs?.loft || null,
            lie: club.lie || club.specs?.lie || null,
            length: club.length || club.specs?.length || null,
            shaft_brand: club.shaftBrand || club.shaft_brand || null,
            shaft_model: club.shaftModel || club.shaft_model || null,
            shaft_weight: club.shaftWeight || club.shaft_weight || club.shaftSpecs?.weight || null,
            shaft_flex: club.shaftFlex || club.shaft_flex || club.shaftSpecs?.flex || null,
            shaft_kickpoint: club.shaftKickpoint || club.shaft_kickpoint || club.shaftSpecs?.kickPoint || null,
            shaft_torque: club.shaftTorque || club.shaft_torque || club.shaftSpecs?.torque || null,
            shaftId: club.shaftId || null,
            created_at: firebase.firestore.FieldValue.serverTimestamp()
          };
          
          batch.set(clubDoc, clubData);
          clubCount++;
        }
        
        await batch.commit();
        console.log(`✅ Saved ${clubCount} clubs to Firestore`);
        
        // Update client's clubs_count
        await db.collection('users').doc(clientId).update({
          clubs_count: clubCount,
          onboarded: true
        });
        
        showToast(`${clubCount} clubs saved. Running initial grade...`, 'success');
        
        // Refresh clients list to show updated clubs_count
        const currentUser = firebase.auth().currentUser;
        if (currentUser) {
          await fetchClients(currentUser.uid);
        }
        
        // Navigate to view the client first
        viewClient(clientId);
        
        // Trigger automatic grading with spinner
        try {
          console.log('📊 Running automatic initial grade...');
          
          // Show grading modal
          const gradingModal = document.getElementById('grading-modal');
          if (gradingModal) {
            gradingModal.style.display = 'flex';
            if (typeof startGradingAnimation === 'function') {
              startGradingAnimation();
            }
          }
          
          const gradeResponse = await fetch('https://gradeuserbag-lui6djrjya-uc.a.run.app', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: clientId, engine: 'fast' })
          });
          
          // Hide grading modal
          if (gradingModal) {
            if (typeof stopGradingAnimation === 'function') {
              stopGradingAnimation();
            }
            gradingModal.style.display = 'none';
          }
          
          if (gradeResponse.ok) {
            const gradeResult = await gradeResponse.json();
            console.log('✅ Initial grade complete:', gradeResult.analysis?.overall_grade);
            showToast(`Bag graded: ${gradeResult.analysis?.overall_grade || 'Complete'}`, 'success');
            
            // Refresh clients list to show new grade on dashboard
            const currentUser = firebase.auth().currentUser;
            if (currentUser) {
              await fetchClients(currentUser.uid);
            }
            
            // Refresh the client view to show grades
            viewClient(clientId);
          } else {
            console.warn('⚠️ Initial grade failed:', gradeResponse.status);
          }
        } catch (gradeError) {
          // Hide grading modal on error
          const gradingModal = document.getElementById('grading-modal');
          if (gradingModal) {
            if (typeof stopGradingAnimation === 'function') {
              stopGradingAnimation();
            }
            gradingModal.style.display = 'none';
          }
          console.warn('⚠️ Auto-grade error (non-critical):', gradeError);
        }
        
      } catch (error) {
        console.error('❌ Error saving clubs:', error);
        showToast('Error saving clubs: ' + error.message, 'error');
      }
    },
    onCancel: () => {
      console.log('❌ Bag onboarding cancelled');
    }
  });
}

/**
 * Onboard a client - opens bag onboarding
 */
function onboardClient(clientId) {
  const client = clientsData.find(c => c.id === clientId);
  if (!client) {
    showToast('Client not found', 'error');
    return;
  }
  
  console.log('🎯 Onboarding client:', client.display_name);
  
  // If client has no bag, start bag onboarding
  if (!client.clubs_count || client.clubs_count === 0) {
    addBagForClient(clientId);
  } else {
    // Client has a bag, just view them
    viewClient(clientId);
  }
}

/**
 * Create a new client record in Firestore
 * Called from the onboarding modal
 */
async function createClientRecord(clientData) {
  const currentUser = firebase.auth().currentUser;
  if (!currentUser) {
    throw new Error('Not authenticated');
  }
  
  try {
    const newClient = {
      display_name: clientData.name,
      email: clientData.email,
      ghin_number: clientData.ghin || null,
      handicap: clientData.handicap || null,
      pro_id: currentUser.uid,
      account_type: 'client',
      subscription_tier: 'basic',
      onboarded: false,
      clubs_count: 0,
      bag_grade: null,
      needs_attention: false,
      created_at: firebase.firestore.FieldValue.serverTimestamp(),
      invite_code: clientData.inviteCode || null,
      invite_status: 'pending'
    };
    
    console.log('📝 Creating client record:', newClient);
    
    const docRef = await db.collection('users').add(newClient);
    console.log('✅ Client created with ID:', docRef.id);
    
    // Refresh clients list
    await fetchClients(currentUser.uid);
    
    return {
      id: docRef.id,
      ...newClient
    };
  } catch (error) {
    console.error('❌ Error creating client:', error);
    throw error;
  }
}

/**
 * Start bag onboarding for newly created client
 * Called from onboarding modal step 2
 */
function startBagOnboardingForNewClient(clientId) {
  closeModal('onboarding-modal');
  
  // Small delay to let modal close
  setTimeout(() => {
    addBagForClient(clientId);
  }, 300);
}

// ============================================
// CLUB MANAGEMENT - Add/Edit/Delete
// ============================================

// Cache for database lookups
let clubHeadSpecsCache = null;
let shaftSpecsCache = null;
let currentClubData = null; // For edit mode

/**
 * Club type options by category
 */
const clubTypesByCategory = {
  woods: ['Driver', '2W', '3W', '4W', '5W', '7W', '9W', '2-Wood', '3-Wood', '4-Wood', '5-Wood', '7-Wood', '9-Wood'],
  hybrids: ['2H', '3H', '4H', '5H', '6H', '7H', '2-Hybrid', '3-Hybrid', '4-Hybrid', '5-Hybrid', '6-Hybrid', '7-Hybrid'],
  irons: ['2i', '3i', '4i', '5i', '6i', '7i', '8i', '9i', 'PW', 'AW', 'GW', '2-Iron', '3-Iron', '4-Iron', '5-Iron', '6-Iron', '7-Iron', '8-Iron', '9-Iron', 'Pitching Wedge', 'Approach Wedge', 'Gap Wedge'],
  wedges: ['46°', '48°', '50°', '52°', '54°', '56°', '58°', '60°', '62°', '64°', 'Sand Wedge', 'Lob Wedge'],
  putter: ['Putter']
};

/**
 * Detect club category from clubType string
 */
function detectCategoryFromClubType(clubType) {
  if (!clubType) return null;
  const ct = clubType.toLowerCase();
  
  // Woods
  if (ct === 'driver' || ct.includes('wood') || /^\d+w$/i.test(clubType)) {
    return 'woods';
  }
  // Hybrids
  if (ct.includes('hybrid') || /^\d+h$/i.test(clubType)) {
    return 'hybrids';
  }
  // Putter
  if (ct === 'putter') {
    return 'putter';
  }
  // Wedges (degree-based)
  if (ct.includes('°') || ct === 'sand wedge' || ct === 'lob wedge') {
    return 'wedges';
  }
  // Irons (including PW, AW, GW)
  if (ct.includes('iron') || /^\d+i$/i.test(clubType) || 
      ct === 'pw' || ct === 'aw' || ct === 'gw' ||
      ct.includes('pitching') || ct.includes('approach') || ct.includes('gap wedge')) {
    return 'irons';
  }
  
  return null;
}

/**
 * Open Add Club Modal
 */
function openAddClubModal() {
  if (!window.currentClient) {
    showToast('Please select a client first', 'error');
    return;
  }
  
  // Use new ClubSelector if available
  if (typeof openAddClubModalNew === 'function') {
    openAddClubModalNew();
    return;
  }
  
  // Reset to add mode
  document.getElementById('club-edit-mode').value = 'add';
  document.getElementById('club-edit-id').value = '';
  document.getElementById('club-modal-title').textContent = '🏌️ Add New Club';
  document.getElementById('club-save-btn').textContent = 'Add Club';
  
  // Show category row (hidden in edit mode)
  document.getElementById('club-category-row').style.display = 'block';
  
  // Reset all fields
  document.getElementById('club-category').value = '';
  document.getElementById('club-type').value = '';
  
  // Reset autocomplete inputs
  document.getElementById('club-brand-input').value = '';
  document.getElementById('club-brand').value = '';
  document.getElementById('club-model-input').value = '';
  document.getElementById('club-model').value = '';
  document.getElementById('shaft-brand-input').value = '';
  document.getElementById('shaft-brand').value = '';
  document.getElementById('shaft-model-input').value = '';
  document.getElementById('club-shaft').value = '';
  
  // Hide dependent rows
  document.getElementById('club-type-row').style.display = 'none';
  document.getElementById('club-brand-row').style.display = 'none';
  document.getElementById('club-model-row').style.display = 'none';
  document.getElementById('club-shaft-brand-row').style.display = 'none';
  document.getElementById('club-shaft-row').style.display = 'none';
  document.getElementById('club-specs-preview').style.display = 'none';
  
  // Load brands data
  loadClubHeadSpecs();
  loadShaftSpecs();
  
  // Show modal
  document.getElementById('club-modal').style.display = 'flex';
}

/**
 * Open Edit Club Modal
 */
async function editClub(clubId) {
  // Close dropdown menu if open
  const openMenu = document.querySelector('.club-menu-dropdown.show');
  if (openMenu) openMenu.classList.remove('show');
  
  if (!window.currentClient) {
    showToast('No client selected', 'error');
    return;
  }
  
  console.log('Edit club:', clubId);
  
  // Use new ClubSelector if available
  if (typeof editClubNew === 'function') {
    try {
      const clubDoc = await db.collection('users')
        .doc(window.currentClient.id)
        .collection('clubs')
        .doc(clubId)
        .get();
      
      if (clubDoc.exists) {
        editClubNew(clubId, clubDoc.data());
        return;
      }
    } catch (e) {
      console.warn('Error fetching club for new editor, falling back:', e);
    }
  }
  
  // Fetch the club data
  try {
    const clubDoc = await db.collection('users')
      .doc(window.currentClient.id)
      .collection('clubs')
      .doc(clubId)
      .get();
    
    if (!clubDoc.exists) {
      showToast('Club not found', 'error');
      return;
    }
    
    currentClubData = { id: clubDoc.id, ...clubDoc.data() };
    
    // Set to edit mode
    document.getElementById('club-edit-mode').value = 'edit';
    document.getElementById('club-edit-id').value = clubId;
    document.getElementById('club-modal-title').textContent = '✏️ Edit Club';
    document.getElementById('club-save-btn').textContent = 'Save Changes';
    
    // Hide category row (already known in edit mode)
    document.getElementById('club-category-row').style.display = 'none';
    
    // Load data first
    await loadClubHeadSpecs();
    await loadShaftSpecs();
    
    // Set category and trigger chain - detect from clubType if not stored
    const category = currentClubData.category || detectCategoryFromClubType(currentClubData.clubType || currentClubData.club_type) || 'irons';
    document.getElementById('club-category').value = category;
    
    // Populate club types for this category
    populateClubTypes(category);
    document.getElementById('club-type-row').style.display = 'block';
    document.getElementById('club-type').value = currentClubData.clubType || currentClubData.club_type || '';
    
    // Show brand field
    document.getElementById('club-brand-row').style.display = 'block';
    
    // Populate brand and model from clubHeadSpecId
    if (currentClubData.clubHeadSpecId && clubHeadSpecsCache) {
      const spec = clubHeadSpecsCache[currentClubData.clubHeadSpecId];
      if (spec) {
        document.getElementById('club-brand-input').value = spec.brand;
        document.getElementById('club-brand').value = spec.brand;
        
        const yearStr = spec.year ? ` (${spec.year})` : '';
        document.getElementById('club-model-input').value = `${spec.model}${yearStr}`;
        document.getElementById('club-model').value = currentClubData.clubHeadSpecId;
      }
    }
    
    document.getElementById('club-model-row').style.display = 'block';
    document.getElementById('club-shaft-brand-row').style.display = 'block';
    
    // Populate shaft brand and model
    if (currentClubData.shaftId && shaftSpecsCache) {
      const shaft = shaftSpecsCache[currentClubData.shaftId];
      if (shaft) {
        document.getElementById('shaft-brand-input').value = shaft.brand;
        document.getElementById('shaft-brand').value = shaft.brand;
        
        const shaftLabel = `${shaft.model || ''} ${shaft.flex || ''} ${shaft.weight ? shaft.weight + 'g' : ''}`.trim();
        document.getElementById('shaft-model-input').value = shaftLabel;
        document.getElementById('club-shaft').value = currentClubData.shaftId;
      }
    }
    
    document.getElementById('club-shaft-row').style.display = 'block';
    
    // Show modal
    document.getElementById('club-modal').style.display = 'flex';
    
  } catch (error) {
    console.error('Error loading club:', error);
    showToast('Error loading club data', 'error');
  }
}

/**
 * Delete Club - Show confirmation
 */
async function deleteClub(clubId) {
  // Close dropdown menu if open
  const openMenu = document.querySelector('.club-menu-dropdown.show');
  if (openMenu) openMenu.classList.remove('show');
  
  if (!window.currentClient) {
    showToast('No client selected', 'error');
    return;
  }
  
  console.log('Delete club:', clubId);
  
  // Fetch club data for confirmation display
  try {
    const clubDoc = await db.collection('users')
      .doc(window.currentClient.id)
      .collection('clubs')
      .doc(clubId)
      .get();
    
    if (!clubDoc.exists) {
      showToast('Club not found', 'error');
      return;
    }
    
    const club = clubDoc.data();
    
    // Store club ID for deletion
    document.getElementById('delete-club-id').value = clubId;
    
    // Get spec info for display
    let clubInfo = `<strong>${formatClubName(club.club_type)}</strong>`;
    
    if (club.clubHeadSpecId && clubHeadSpecsCache) {
      const spec = clubHeadSpecsCache[club.clubHeadSpecId];
      if (spec) {
        clubInfo += `<br>${spec.brand} ${spec.model}`;
        if (spec.year) clubInfo += ` (${spec.year})`;
      }
    } else if (club.brand) {
      clubInfo += `<br>${club.brand} ${club.model || ''}`;
    }
    
    document.getElementById('delete-club-info').innerHTML = clubInfo;
    
    // Show confirmation modal
    document.getElementById('delete-club-modal').style.display = 'flex';
    
  } catch (error) {
    console.error('Error loading club for delete:', error);
    showToast('Error loading club data', 'error');
  }
}

/**
 * Confirm and execute club deletion
 */
async function confirmDeleteClub() {
  const clubId = document.getElementById('delete-club-id').value;
  
  if (!clubId || !window.currentClient) {
    showToast('Error: Missing club or client data', 'error');
    return;
  }
  
  try {
    // Delete from Firestore
    await db.collection('users')
      .doc(window.currentClient.id)
      .collection('clubs')
      .doc(clubId)
      .delete();
    
    // Update clubs_count
    const clubsSnapshot = await db.collection('users')
      .doc(window.currentClient.id)
      .collection('clubs')
      .get();
    
    await db.collection('users')
      .doc(window.currentClient.id)
      .update({ 
        clubs_count: clubsSnapshot.size,
        updated_at: firebase.firestore.FieldValue.serverTimestamp()
      });
    
    console.log('✅ Club deleted');
    
    // Close delete modal
    document.getElementById('delete-club-modal').style.display = 'none';
    
    // Refresh clubs display
    fetchClientClubs(window.currentClient.id);
    
    // Show regrade prompt
    console.log('🔄 About to show regrade modal after delete...');
    showRegradeModal();
    
  } catch (error) {
    console.error('Error deleting club:', error);
    showToast('Error deleting club: ' + error.message, 'error');
  }
}

/**
 * Close club modal
 */
function closeClubModal() {
  document.getElementById('club-modal').style.display = 'none';
  currentClubData = null;
}

/**
 * Load clubHeadSpecs from Firestore
 */
async function loadClubHeadSpecs() {
  if (clubHeadSpecsCache) return;
  
  try {
    const snapshot = await db.collection('clubHeadSpecs').get();
    clubHeadSpecsCache = {};
    
    snapshot.forEach(doc => {
      clubHeadSpecsCache[doc.id] = doc.data();
    });
    
    console.log(`✅ Loaded ${Object.keys(clubHeadSpecsCache).length} clubHeadSpecs`);
    
  } catch (error) {
    console.error('Error loading clubHeadSpecs:', error);
  }
}

/**
 * Load shaftSpecs from Firestore
 */
async function loadShaftSpecs() {
  if (shaftSpecsCache) return;
  
  try {
    const snapshot = await db.collection('shaftSpecDatabase').get();
    shaftSpecsCache = {};
    
    snapshot.forEach(doc => {
      shaftSpecsCache[doc.id] = doc.data();
    });
    
    console.log(`✅ Loaded ${Object.keys(shaftSpecsCache).length} shaftSpecs`);
    
  } catch (error) {
    console.error('Error loading shaftSpecs:', error);
  }
}

/**
 * Category change handler
 */
function onCategoryChange() {
  const category = document.getElementById('club-category').value;
  
  if (!category) {
    document.getElementById('club-type-row').style.display = 'none';
    document.getElementById('club-brand-row').style.display = 'none';
    document.getElementById('club-model-row').style.display = 'none';
    document.getElementById('club-shaft-brand-row').style.display = 'none';
    document.getElementById('club-shaft-row').style.display = 'none';
    return;
  }
  
  // Populate club types for this category
  populateClubTypes(category);
  document.getElementById('club-type-row').style.display = 'block';
  
  // Show brand field (autocomplete will handle the rest)
  document.getElementById('club-brand-row').style.display = 'block';
  
  // Reset dependent fields
  document.getElementById('club-model-row').style.display = 'none';
  document.getElementById('club-shaft-brand-row').style.display = 'none';
  document.getElementById('club-shaft-row').style.display = 'none';
  document.getElementById('club-specs-preview').style.display = 'none';
}

/**
 * Populate club type dropdown based on category
 */
function populateClubTypes(category) {
  const select = document.getElementById('club-type');
  const types = clubTypesByCategory[category] || [];
  
  select.innerHTML = '<option value="">Select club...</option>';
  types.forEach(type => {
    select.innerHTML += `<option value="${type}">${formatClubName(type)}</option>`;
  });
}

// ============================================
// AUTOCOMPLETE FUNCTIONS
// ============================================

/**
 * Show brand suggestions as user types
 */
function showBrandSuggestions() {
  const input = document.getElementById('club-brand-input');
  const dropdown = document.getElementById('club-brand-dropdown');
  const search = input.value.toLowerCase();
  
  if (!clubHeadSpecsCache) {
    dropdown.classList.remove('show');
    return;
  }
  
  // Get unique brands
  const brands = new Set();
  Object.values(clubHeadSpecsCache).forEach(spec => {
    if (spec.brand) brands.add(spec.brand);
  });
  
  // Popular brands first
  const popularBrands = ['Callaway', 'TaylorMade', 'Titleist', 'Ping', 'Cobra', 'Mizuno', 'Srixon', 'Cleveland'];
  
  // Filter brands
  let filtered;
  if (search.length === 0) {
    // Show popular brands when empty
    filtered = popularBrands.filter(b => brands.has(b));
  } else {
    filtered = [...brands].filter(b => b.toLowerCase().includes(search)).sort();
  }
  
  // Build dropdown
  if (filtered.length === 0) {
    dropdown.classList.remove('show');
    return;
  }
  
  dropdown.innerHTML = filtered.slice(0, 10).map(brand => 
    `<div class="autocomplete-item" onclick="selectBrand('${brand}')">${brand}</div>`
  ).join('');
  
  dropdown.classList.add('show');
}

/**
 * Select a brand from autocomplete
 */
function selectBrand(brand) {
  document.getElementById('club-brand-input').value = brand;
  document.getElementById('club-brand').value = brand;
  document.getElementById('club-brand-dropdown').classList.remove('show');
  
  // Show model field and clear it
  document.getElementById('club-model-row').style.display = 'block';
  document.getElementById('club-model-input').value = '';
  document.getElementById('club-model').value = '';
  
  // Focus on model input
  document.getElementById('club-model-input').focus();
}

/**
 * Show model suggestions as user types
 */
function showModelSuggestions() {
  const input = document.getElementById('club-model-input');
  const dropdown = document.getElementById('club-model-dropdown');
  const search = input.value.toLowerCase();
  const brand = document.getElementById('club-brand').value;
  
  if (!clubHeadSpecsCache || !brand) {
    dropdown.classList.remove('show');
    return;
  }
  
  // Filter models by brand and search
  const models = [];
  Object.entries(clubHeadSpecsCache).forEach(([docId, spec]) => {
    if (spec.brand === brand) {
      const modelName = `${spec.model || ''} ${spec.year || ''}`.toLowerCase();
      if (search.length === 0 || modelName.includes(search)) {
        // Use docId explicitly (the Firestore document ID)
        models.push({ docId, ...spec });
      }
    }
  });
  
  // Sort by year (newest first)
  models.sort((a, b) => {
    if (a.year !== b.year) return (b.year || 0) - (a.year || 0);
    return (a.model || '').localeCompare(b.model || '');
  });
  
  if (models.length === 0) {
    dropdown.classList.remove('show');
    return;
  }
  
  // Show up to 20 results - use docId for the actual ID
  dropdown.innerHTML = models.slice(0, 20).map(m => {
    const yearStr = m.year ? ` (${m.year})` : '';
    return `<div class="autocomplete-item" onclick="selectModel('${m.docId}', '${m.model}${yearStr}')">${m.model}${yearStr}</div>`;
  }).join('');
  
  dropdown.classList.add('show');
}

/**
 * Select a model from autocomplete
 */
function selectModel(modelId, displayName) {
  document.getElementById('club-model-input').value = displayName;
  document.getElementById('club-model').value = modelId;
  document.getElementById('club-model-dropdown').classList.remove('show');
  
  // Show specs preview if available
  const spec = clubHeadSpecsCache[modelId];
  if (spec) {
    const clubType = document.getElementById('club-type').value;
    const clubKey = getClubKey(clubType);
    
    if (spec.clubs && spec.clubs[clubKey]) {
      const clubSpec = spec.clubs[clubKey];
      let specsHtml = '';
      if (clubSpec.loft) specsHtml += `Loft: ${clubSpec.loft}° • `;
      if (clubSpec.lie) specsHtml += `Lie: ${clubSpec.lie}° • `;
      if (clubSpec.length) specsHtml += `Length: ${clubSpec.length}"`;
      
      if (specsHtml) {
        document.getElementById('club-specs-content').innerHTML = specsHtml;
        document.getElementById('club-specs-preview').style.display = 'block';
      }
    }
  }
  
  // Show shaft brand field
  document.getElementById('club-shaft-brand-row').style.display = 'block';
  document.getElementById('shaft-brand-input').focus();
}

/**
 * Show shaft brand suggestions
 */
function showShaftBrandSuggestions() {
  const input = document.getElementById('shaft-brand-input');
  const dropdown = document.getElementById('shaft-brand-dropdown');
  const search = input.value.toLowerCase();
  
  if (!shaftSpecsCache) {
    dropdown.classList.remove('show');
    return;
  }
  
  // Get unique brands
  const brands = new Set();
  Object.values(shaftSpecsCache).forEach(shaft => {
    if (shaft.brand) brands.add(shaft.brand);
  });
  
  // Popular shaft brands
  const popularBrands = ['Fujikura', 'Project X', 'True Temper', 'Mitsubishi', 'Graphite Design', 'KBS', 'Nippon'];
  
  // Filter
  let filtered;
  if (search.length === 0) {
    filtered = popularBrands.filter(b => brands.has(b));
  } else {
    filtered = [...brands].filter(b => b.toLowerCase().includes(search)).sort();
  }
  
  if (filtered.length === 0) {
    dropdown.classList.remove('show');
    return;
  }
  
  dropdown.innerHTML = filtered.slice(0, 10).map(brand => 
    `<div class="autocomplete-item" onclick="selectShaftBrand('${brand}')">${brand}</div>`
  ).join('');
  
  dropdown.classList.add('show');
}

/**
 * Select shaft brand
 */
function selectShaftBrand(brand) {
  document.getElementById('shaft-brand-input').value = brand;
  document.getElementById('shaft-brand').value = brand;
  document.getElementById('shaft-brand-dropdown').classList.remove('show');
  
  // Show shaft model field
  document.getElementById('club-shaft-row').style.display = 'block';
  document.getElementById('shaft-model-input').value = '';
  document.getElementById('club-shaft').value = '';
  document.getElementById('shaft-model-input').focus();
}

/**
 * Show shaft model suggestions
 */
function showShaftModelSuggestions() {
  const input = document.getElementById('shaft-model-input');
  const dropdown = document.getElementById('shaft-model-dropdown');
  const search = input.value.toLowerCase();
  const brand = document.getElementById('shaft-brand').value;
  
  if (!shaftSpecsCache || !brand) {
    dropdown.classList.remove('show');
    return;
  }
  
  // Filter shafts
  const shafts = [];
  Object.entries(shaftSpecsCache).forEach(([docId, shaft]) => {
    if (shaft.brand === brand) {
      const shaftName = `${shaft.model || ''} ${shaft.flex || ''} ${shaft.weight || ''}`.toLowerCase();
      if (search.length === 0 || shaftName.includes(search)) {
        // Use docId explicitly (the Firestore document ID with hyphens)
        shafts.push({ docId, ...shaft });
      }
    }
  });
  
  // Sort
  shafts.sort((a, b) => (a.model || '').localeCompare(b.model || ''));
  
  if (shafts.length === 0) {
    dropdown.classList.remove('show');
    return;
  }
  
  // Show up to 20 results - use docId for the actual ID
  dropdown.innerHTML = shafts.slice(0, 20).map(shaft => {
    const label = `${shaft.model || ''} ${shaft.flex || ''} ${shaft.weight ? shaft.weight + 'g' : ''}`.trim();
    // Escape quotes in the label for the onclick
    const escapedLabel = label.replace(/'/g, "\\'");
    return `<div class="autocomplete-item" onclick="selectShaftModel('${shaft.docId}', '${escapedLabel}')">${label}</div>`;
  }).join('');
  
  dropdown.classList.add('show');
}

/**
 * Select shaft model
 */
function selectShaftModel(shaftId, displayName) {
  document.getElementById('shaft-model-input').value = displayName;
  document.getElementById('club-shaft').value = shaftId;
  document.getElementById('shaft-model-dropdown').classList.remove('show');
}

/**
 * Close all autocomplete dropdowns when clicking outside
 */
document.addEventListener('click', function(e) {
  if (!e.target.closest('.autocomplete-wrapper')) {
    document.querySelectorAll('.autocomplete-dropdown').forEach(d => d.classList.remove('show'));
  }
});

/**
 * Save club to Firestore (add or update)
 */
async function saveClubToFirestore() {
  const isEdit = document.getElementById('club-edit-mode').value === 'edit';
  const clubId = document.getElementById('club-edit-id').value;
  
  // Get values
  const category = document.getElementById('club-category').value;
  const clubType = document.getElementById('club-type').value;
  const modelId = document.getElementById('club-model').value;
  const modelInput = document.getElementById('club-model-input').value;
  const shaftId = document.getElementById('club-shaft').value;
  const shaftInput = document.getElementById('shaft-model-input').value;
  
  // Validate club type
  if (!clubType) {
    showToast('Please select a club type', 'error');
    return;
  }
  
  // Validate model - check if text entered but not selected
  if (!modelId && modelInput) {
    showToast('Please select a model from the dropdown', 'error');
    document.getElementById('club-model-input').focus();
    showModelSuggestions();
    return;
  }
  
  if (!modelId) {
    showToast('Please select a brand and model', 'error');
    return;
  }
  
  // Validate shaft - check if text entered but not selected
  if (!shaftId && shaftInput) {
    showToast('Please select a shaft from the dropdown', 'error');
    document.getElementById('shaft-model-input').focus();
    showShaftModelSuggestions();
    return;
  }
  
  // Look up spec data from cached specs
  const spec = clubHeadSpecsCache ? clubHeadSpecsCache[modelId] : null;
  if (!spec) {
    showToast('Error: Could not find club spec data', 'error');
    return;
  }
  
  // Get club-specific data (loft, lie, length) from the spec
  const clubKey = getClubKey(clubType);
  const clubSpecData = spec.clubs && spec.clubs[clubKey] ? spec.clubs[clubKey] : {};
  
  // Look up shaft data if selected
  let shaftData = null;
  if (shaftId && shaftSpecsCache) {
    shaftData = shaftSpecsCache[shaftId];
  }
  
  // Determine category from club type if not set
  let clubCategory = category || (isEdit ? currentClubData.category : null);
  if (!clubCategory) {
    if (clubType === 'Driver' || clubType.match(/^\d+W$/)) {
      clubCategory = 'woods';
    } else if (clubType.match(/^\d+H$/)) {
      clubCategory = 'hybrids';
    } else if (clubType.match(/^\d+i$/) || ['PW', 'GW', 'AW'].includes(clubType)) {
      clubCategory = 'irons';
    } else if (clubType.match(/^\d+°$/) || ['SW', 'LW'].includes(clubType)) {
      clubCategory = 'wedges';
    } else if (clubType === 'Putter') {
      clubCategory = 'putter';
    }
  }
  
  // Build club document using RETAIL SCHEMA (per Master Field Reference)
  const clubDoc = {
    // Core identification
    clubType: clubType,  // Standard: clubType (not club_type)
    category: clubCategory,
    
    // Club head data (denormalized for grading function)
    brand: spec.brand,
    model: spec.model,
    year: spec.year || null,
    loft: clubSpecData.loft || null,
    lie: clubSpecData.lie || null,  // Standard: lie (not lie_angle)
    length: clubSpecData.length || null,
    
    // Reference IDs (for editing/updates)
    clubHeadSpecId: modelId,
    shaftId: shaftId || null,
    
    // Shaft data as FLAT FIELDS (per Master Field Reference standard)
    shaft_brand: shaftData?.brand || null,
    shaft_model: shaftData?.model || null,
    shaft_flex: shaftData?.flex || null,
    shaft_weight: shaftData?.weight || null,
    shaft_torque: shaftData?.torque || null,
    shaft_kickpoint: shaftData?.kickPoint || shaftData?.kickpoint || null,
    
    updated_at: firebase.firestore.FieldValue.serverTimestamp()
  };
  
  try {
    const clientId = window.currentClient.id;
    
    if (isEdit) {
      // Update existing club
      await db.collection('users')
        .doc(clientId)
        .collection('clubs')
        .doc(clubId)
        .update(clubDoc);
      
      console.log('✅ Club updated:', clubId);
    } else {
      // Add new club
      clubDoc.created_at = firebase.firestore.FieldValue.serverTimestamp();
      
      await db.collection('users')
        .doc(clientId)
        .collection('clubs')
        .add(clubDoc);
      
      // Update clubs_count
      const clubsSnapshot = await db.collection('users')
        .doc(clientId)
        .collection('clubs')
        .get();
      
      await db.collection('users')
        .doc(clientId)
        .update({ 
          clubs_count: clubsSnapshot.size,
          updated_at: firebase.firestore.FieldValue.serverTimestamp()
        });
      
      console.log('✅ Club added');
    }
    
    // Close modal and refresh
    closeClubModal();
    fetchClientClubs(clientId);
    
    // Show regrade prompt
    console.log('🔄 About to show regrade modal after save...');
    showRegradeModal();
    
  } catch (error) {
    console.error('Error saving club:', error);
    showToast('Error saving club: ' + error.message, 'error');
  }
}

/**
 * Simple loading indicator
 */
function showLoading(message) {
  console.log('Loading:', message);
}

function hideLoading() {
  console.log('Loading complete');
}

/**
 * Check if user is logged in
 */
function requireAuth() {
  if (!currentUser) {
    showLoginModal();
    return false;
  }
  return true;
}

// ============================================
// REGRADE BAG FUNCTIONS
// ============================================

/**
 * Show the regrade confirmation modal
 */
function showRegradeModal() {
  console.log('📊 Showing regrade modal...');
  const modal = document.getElementById('regrade-modal');
  if (modal) {
    modal.style.display = 'flex';
    console.log('✅ Regrade modal displayed');
  } else {
    console.error('❌ Regrade modal not found!');
  }
}

/**
 * Close the regrade confirmation modal
 */
function closeRegradeModal() {
  document.getElementById('regrade-modal').style.display = 'none';
}

/**
 * Save length updates to Firestore
 * @param {Array} updates - Array of {clubId, clubType, newLength} objects
 */
async function saveLengthUpdates(updates) {
  if (!window.currentClient) {
    throw new Error('No client selected');
  }
  
  const clientId = window.currentClient.id;
  console.log(`📏 Saving length updates for ${updates.length} clubs to client: ${clientId}`);
  
  // Update each club in Firestore
  const batch = db.batch();
  let successCount = 0;
  
  for (const update of updates) {
    if (!update.clubId) {
      console.warn(`⚠️ Skipping ${update.clubType} - no club ID`);
      continue;
    }
    
    const clubRef = db.collection('users').doc(clientId)
      .collection('clubs').doc(update.clubId);
    
    batch.update(clubRef, {
      length: update.newLength,
      lengthIsDefault: false, // Mark as user-entered
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`  📏 ${update.clubType} (${update.clubId}): ${update.newLength}"`);
    successCount++;
  }
  
  if (successCount === 0) {
    throw new Error('No valid club IDs found to update');
  }
  
  await batch.commit();
  console.log(`✅ ${successCount} length updates saved to Firestore`);
  
  // Update the in-memory analysis data BEFORE fetching
  if (window.currentAnalysisData && window.currentAnalysisData.clubs) {
    for (const update of updates) {
      const club = window.currentAnalysisData.clubs.find(c => c.id === update.clubId);
      if (club) {
        club.length = update.newLength;
        club.lengthIsDefault = false;
        console.log(`  📝 Updated in-memory: ${club.clubType} = ${update.newLength}"`);
      }
    }
  }
  
  // Refresh the clubs display from Firestore
  await fetchClientClubs(clientId);
  
  // Mark bag as needing regrade
  window.bagNeedsRegrade = true;
}

/**
 * Save weight updates to Firestore
 * @param {Array} updates - Array of {clubId, clubType, originalWeight, newWeight} objects
 */
async function saveWeightUpdates(updates) {
  if (!window.currentClient) {
    throw new Error('No client selected');
  }
  
  const clientId = window.currentClient.id;
  console.log(`⚖️ Saving weight updates for ${updates.length} clubs to client: ${clientId}`);
  
  // Update each club in Firestore
  const batch = db.batch();
  let successCount = 0;
  
  for (const update of updates) {
    if (!update.clubId) {
      console.warn(`⚠️ Skipping ${update.clubType} - no club ID`);
      continue;
    }
    
    const clubRef = db.collection('users').doc(clientId)
      .collection('clubs').doc(update.clubId);
    
    // Check if this club already has an originalShaftWeight stored
    // If not, store the current weight as the original (for reset capability)
    const club = window.currentAnalysisData?.clubs?.find(c => c.id === update.clubId);
    const hasOriginal = club && club.originalShaftWeight !== undefined && club.originalShaftWeight !== null;
    
    const updateData = {
      shaft_weight: update.newWeight,
      weightIsDefault: false, // Mark as user-entered
      weightIsUserEdited: true, // Mark as manually changed
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    // Only set originalShaftWeight on first edit
    if (!hasOriginal) {
      updateData.originalShaftWeight = update.originalWeight;
      console.log(`  📦 Storing original weight for ${update.clubType}: ${update.originalWeight}g`);
    }
    
    batch.update(clubRef, updateData);
    
    console.log(`  ⚖️ ${update.clubType} (${update.clubId}): ${update.originalWeight}g → ${update.newWeight}g`);
    successCount++;
  }
  
  if (successCount === 0) {
    throw new Error('No valid club IDs found to update');
  }
  
  await batch.commit();
  console.log(`✅ ${successCount} weight updates saved to Firestore`);
  
  // Update the in-memory analysis data
  if (window.currentAnalysisData && window.currentAnalysisData.clubs) {
    for (const update of updates) {
      const club = window.currentAnalysisData.clubs.find(c => c.id === update.clubId);
      if (club) {
        // Store original if not already stored
        if (club.originalShaftWeight === undefined || club.originalShaftWeight === null) {
          club.originalShaftWeight = update.originalWeight;
        }
        club.shaft_weight = update.newWeight;
        club.weightIsDefault = false;
        club.weightIsUserEdited = true;
        console.log(`  📝 Updated in-memory: ${club.clubType} = ${update.newWeight}g`);
      }
    }
  }
  
  // Refresh the clubs display from Firestore
  await fetchClientClubs(clientId);
  
  // Mark bag as needing regrade
  window.bagNeedsRegrade = true;
}

/**
 * Save lie angle updates to Firestore
 * @param {Array} updates - Array of {clubId, clubType, originalLie, newLie} objects
 */
async function saveLieUpdates(updates) {
  if (!window.currentClient) {
    throw new Error('No client selected');
  }
  
  const clientId = window.currentClient.id;
  console.log(`📐 Saving lie angle updates for ${updates.length} clubs to client: ${clientId}`);
  
  // Update each club in Firestore
  const batch = db.batch();
  let successCount = 0;
  
  for (const update of updates) {
    if (!update.clubId) {
      console.warn(`⚠️ Skipping ${update.clubType} - no club ID`);
      continue;
    }
    
    const clubRef = db.collection('users').doc(clientId)
      .collection('clubs').doc(update.clubId);
    
    // Check if this club already has an originalLieAngle stored
    // If not, store the current lie as the original (for reset capability)
    const club = window.currentAnalysisData?.clubs?.find(c => c.id === update.clubId);
    const hasOriginal = club && club.originalLieAngle !== undefined && club.originalLieAngle !== null;
    
    const updateData = {
      lie: update.newLie,
      lieIsDefault: false, // Mark as user-entered
      lieIsUserEdited: true, // Mark as manually changed
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    // Only set originalLieAngle on first edit
    if (!hasOriginal) {
      updateData.originalLieAngle = update.originalLie;
      console.log(`  📦 Storing original lie angle for ${update.clubType}: ${update.originalLie}°`);
    }
    
    batch.update(clubRef, updateData);
    
    console.log(`  📐 ${update.clubType} (${update.clubId}): ${update.originalLie}° → ${update.newLie}°`);
    successCount++;
  }
  
  if (successCount === 0) {
    throw new Error('No valid club IDs found to update');
  }
  
  await batch.commit();
  console.log(`✅ ${successCount} lie angle updates saved to Firestore`);
  
  // Update the in-memory analysis data
  if (window.currentAnalysisData && window.currentAnalysisData.clubs) {
    for (const update of updates) {
      const club = window.currentAnalysisData.clubs.find(c => c.id === update.clubId);
      if (club) {
        // Store original if not already stored
        if (club.originalLieAngle === undefined || club.originalLieAngle === null) {
          club.originalLieAngle = update.originalLie;
        }
        club.lie = update.newLie;
        club.lieIsDefault = false;
        club.lieIsUserEdited = true;
        console.log(`  📝 Updated in-memory: ${club.clubType} = ${update.newLie}°`);
      }
    }
  }
  
  // Refresh the clubs display from Firestore
  await fetchClientClubs(clientId);
  
  // Mark bag as needing regrade
  window.bagNeedsRegrade = true;
}

/**
 * Save loft updates to Firestore
 * @param {Array} updates - Array of {clubId, clubType, originalLoft, newLoft} objects
 */
async function saveLoftUpdates(updates) {
  if (!window.currentClient) {
    throw new Error('No client selected');
  }
  
  const clientId = window.currentClient.id;
  console.log(`📐 Saving loft updates for ${updates.length} clubs to client: ${clientId}`);
  
  // Update each club in Firestore
  const batch = db.batch();
  let successCount = 0;
  
  for (const update of updates) {
    if (!update.clubId) {
      console.warn(`⚠️ Skipping ${update.clubType} - no club ID`);
      continue;
    }
    
    const clubRef = db.collection('users').doc(clientId)
      .collection('clubs').doc(update.clubId);
    
    // Check if this club already has an originalLoft stored
    const club = window.currentAnalysisData?.clubs?.find(c => c.id === update.clubId);
    const hasOriginal = club && club.originalLoft !== undefined && club.originalLoft !== null;
    
    const updateData = {
      loft: update.newLoft,
      loftIsDefault: false,
      loftIsUserEdited: true,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    // Only set originalLoft on first edit
    if (!hasOriginal) {
      updateData.originalLoft = update.originalLoft;
      console.log(`  📦 Storing original loft for ${update.clubType}: ${update.originalLoft}°`);
    }
    
    batch.update(clubRef, updateData);
    
    console.log(`  📐 ${update.clubType} (${update.clubId}): ${update.originalLoft}° → ${update.newLoft}°`);
    successCount++;
  }
  
  if (successCount === 0) {
    throw new Error('No valid club IDs found to update');
  }
  
  await batch.commit();
  console.log(`✅ ${successCount} loft updates saved to Firestore`);
  
  // Update the in-memory analysis data
  if (window.currentAnalysisData && window.currentAnalysisData.clubs) {
    for (const update of updates) {
      const club = window.currentAnalysisData.clubs.find(c => c.id === update.clubId);
      if (club) {
        if (club.originalLoft === undefined || club.originalLoft === null) {
          club.originalLoft = update.originalLoft;
        }
        club.loft = update.newLoft;
        club.loftIsDefault = false;
        club.loftIsUserEdited = true;
        console.log(`  📝 Updated in-memory: ${club.clubType} = ${update.newLoft}°`);
      }
    }
  }
  
  // Refresh the clubs display from Firestore
  await fetchClientClubs(clientId);
  
  // Mark bag as needing regrade
  window.bagNeedsRegrade = true;
}

/**
 * Save flex updates to Firestore
 * @param {Array} updates - Array of {clubId, clubType, originalFlex, newFlex} objects
 */
async function saveFlexUpdates(updates) {
  if (!window.currentClient) {
    throw new Error('No client selected');
  }
  
  const clientId = window.currentClient.id;
  console.log(`🔧 Saving flex updates for ${updates.length} clubs to client: ${clientId}`);
  
  // Update each club in Firestore
  const batch = db.batch();
  let successCount = 0;
  
  for (const update of updates) {
    if (!update.clubId) {
      console.warn(`⚠️ Skipping ${update.clubType} - no club ID`);
      continue;
    }
    
    const clubRef = db.collection('users').doc(clientId)
      .collection('clubs').doc(update.clubId);
    
    // Check if this club already has an originalShaftFlex stored
    const club = window.currentAnalysisData?.clubs?.find(c => c.id === update.clubId);
    const hasOriginal = club && club.originalShaftFlex !== undefined && club.originalShaftFlex !== null;
    
    const updateData = {
      shaft_flex: update.newFlex,
      flexIsDefault: false, // Mark as user-entered
      flexIsUserEdited: true, // Mark as manually changed
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    // Only set originalShaftFlex on first edit
    if (!hasOriginal && update.originalFlex) {
      updateData.originalShaftFlex = update.originalFlex;
      console.log(`  📦 Storing original flex for ${update.clubType}: ${update.originalFlex}`);
    }
    
    batch.update(clubRef, updateData);
    
    console.log(`  🔧 ${update.clubType} (${update.clubId}): ${update.originalFlex || 'Unknown'} → ${update.newFlex}`);
    successCount++;
  }
  
  if (successCount === 0) {
    throw new Error('No valid club IDs found to update');
  }
  
  await batch.commit();
  console.log(`✅ ${successCount} flex updates saved to Firestore`);
  
  // Update the in-memory analysis data
  if (window.currentAnalysisData && window.currentAnalysisData.clubs) {
    for (const update of updates) {
      const club = window.currentAnalysisData.clubs.find(c => c.id === update.clubId);
      if (club) {
        // Store original if not already stored
        if ((club.originalShaftFlex === undefined || club.originalShaftFlex === null) && update.originalFlex) {
          club.originalShaftFlex = update.originalFlex;
        }
        club.shaft_flex = update.newFlex;
        club.flexIsDefault = false;
        club.flexIsUserEdited = true;
        console.log(`  📝 Updated in-memory: ${club.clubType} = ${update.newFlex}`);
      }
    }
  }
  
  // Refresh the clubs display from Firestore
  await fetchClientClubs(clientId);
  
  // Mark bag as needing regrade
  window.bagNeedsRegrade = true;
}

/**
 * Confirm and execute bag regrade
 */
async function confirmRegrade() {
  if (!window.currentClient) {
    showToast('No client selected', 'error');
    return;
  }
  
  // Get current grading engine mode
  const engine = typeof currentGradingEngine !== 'undefined' ? currentGradingEngine : 'javascript';
  
  // Close regrade modal, show grading modal
  document.getElementById('regrade-modal').style.display = 'none';
  document.getElementById('grading-modal').style.display = 'flex';
  
  // Start grading animation
  startGradingAnimation();
  
  try {
    // Call the gradeUserBag Cloud Function
    // Use the deployed Cloud Run URL
    let functionUrl = 'https://gradeuserbag-lui6djrjya-uc.a.run.app';
    
    console.log('📡 Calling gradeUserBag at:', functionUrl);
    console.log('🧠 Engine mode:', engine);
    
    let response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userId: window.currentClient.id,
        engine: engine  // Pass engine mode to Cloud Function
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    
    const result = await response.json();
    console.log('✅ Bag graded:', result);
    console.log('🧠 Engine used:', result.engineUsed || engine);
    
    // Update the grade display with real data
    updateGradeDisplay(result);
    
    // Deduct 1 credit from pro account (TODO: implement credit system)
    console.log('💳 1 credit used for grading');
    
    // Close grading modal and stop animation
    stopGradingAnimation();
    document.getElementById('grading-modal').style.display = 'none';
    
    // Navigate to client's bag view to show updated grades
    if (window.currentClient && window.currentClient.id) {
      console.log('📍 Navigating to client bag view:', window.currentClient.id);
      viewClient(window.currentClient.id);
    }
    
  } catch (error) {
    console.error('Error grading bag:', error);
    stopGradingAnimation();
    document.getElementById('grading-modal').style.display = 'none';
    
    // Show helpful error message
    if (error.message.includes('404')) {
      showToast('Grading function not deployed yet', 'error');
    } else {
      showToast('Error grading bag: ' + error.message, 'error');
    }
  }
}

/**
 * Update the grade display with results from Cloud Function
 */
function updateGradeDisplay(result) {
  const analysis = result.analysis;
  if (!analysis) {
    console.error('No analysis data in result');
    return;
  }
  
  const overallGrade = analysis.overall_grade;
  const overallScore = analysis.overall_score;
  
  // Update overall grade display
  const overallGradeEl = document.querySelector('.overall-grade-value');
  if (overallGradeEl) {
    overallGradeEl.textContent = overallGrade || '--';
    overallGradeEl.className = 'overall-grade-value ' + getGradeClass(overallGrade);
  }
  
  // Map component scores to factor grid
  // Cloud Function returns: age, weight_progression, loft_gapping, etc.
  const componentMap = {
    'loft_gapping': 'loft',
    'age': 'age',
    'weight_progression': 'weight',
    'flex_consistency': 'flex',
    'kickpoint_consistency': 'kickpoint',
    'length_progression': 'length',
    'lie_angle_progression': 'lie',
    'torque_consistency': 'torque'
  };
  
  // Update each factor score
  if (analysis.component_scores) {
    Object.entries(analysis.component_scores).forEach(([key, data]) => {
      const factorKey = componentMap[key];
      if (!factorKey) return;
      
      const score = data.score;
      const letterGrade = data.grade;
      const gradeClass = letterGrade ? letterGrade.charAt(0).toLowerCase() : '';
      
      // Find the factor item and update
      const factorItems = document.querySelectorAll('.factor-item');
      factorItems.forEach(item => {
        const onclick = item.getAttribute('onclick');
        if (onclick && onclick.includes(`'${factorKey}'`)) {
          const gradeSpan = item.querySelector('.factor-grade');
          if (gradeSpan) {
            gradeSpan.textContent = letterGrade || '--';
            gradeSpan.className = `factor-grade ${gradeClass}`;
          }
          
          // Mark as issue if score is below 70
          if (score < 70) {
            item.classList.add('issue');
          } else {
            item.classList.remove('issue');
          }
        }
      });
    });
  }
  
  // Update attention summary
  const attentionSummary = document.querySelector('.attention-summary span:last-child');
  if (attentionSummary) {
    const issues = analysis.issues_found || [];
    const issueCount = issues.length;
    if (issueCount > 0) {
      attentionSummary.innerHTML = `<strong>${issueCount} Issue${issueCount > 1 ? 's' : ''} Found</strong> — Click to view details`;
    } else {
      attentionSummary.innerHTML = `<strong>All clubs looking good!</strong> — No major issues found`;
    }
  }
  
  // Update client detail stats
  const bagGradeStats = document.querySelectorAll('.detail-stat-value.grade');
  bagGradeStats.forEach(el => {
    el.textContent = overallGrade || '--';
    el.className = 'detail-stat-value grade ' + getGradeClass(overallGrade);
  });
  
  // Update score breakdown display if present
  const scoreBreakdown = analysis.score_breakdown;
  if (scoreBreakdown) {
    const clubQualityEl = document.getElementById('club-quality-score');
    const consistencyEl = document.getElementById('consistency-score');
    if (clubQualityEl) clubQualityEl.textContent = `${scoreBreakdown.club_quality_score} (${scoreBreakdown.club_quality_grade})`;
    if (consistencyEl) consistencyEl.textContent = `${scoreBreakdown.consistency_score} (${scoreBreakdown.consistency_grade})`;
  }
  
  // Store club-level grading data for rendering
  if (analysis.clubs && Array.isArray(analysis.clubs)) {
    clubGradingData = {};
    analysis.clubs.forEach(club => {
      if (club.id && club.grading) {
        clubGradingData[club.id] = club.grading;
      }
    });
    console.log(`📊 Stored grading data for ${Object.keys(clubGradingData).length} clubs`);
    
    // Re-render clubs with grading data
    if (window.currentClient) {
      fetchClientClubs(window.currentClient.id);
    }
  }
  
  // Store full analysis for factor modals
  currentAnalysisData = analysis;
  window.currentAnalysisData = analysis; // Also expose to window for index.html access
  console.log('📊 Stored full analysis data for factor modals');
  
  // Build club issues map for club card badges
  if (typeof buildClubIssuesMap === 'function') {
    buildClubIssuesMap();
  }
  
  // Update grade explainer and grip assessment UI
  if (typeof loadAnalysisDisplay === 'function') {
    loadAnalysisDisplay(analysis);
  }
  
  // Populate AI Summary section
  populateAISummary(analysis.ai_bag_analysis);
  
  // Get clubs count from response
  const clubsCount = result.clubsCount || analysis.clubs_analyzed;
  
  // Update currentClient object with new grade
  console.log('🔍 Checking window.currentClient:', window.currentClient ? window.currentClient.display_name : 'UNDEFINED');
  if (window.currentClient) {
    window.currentClient.bag_grade = overallGrade;
    window.currentClient.bag_score = overallScore;
    window.currentClient.clubs_count = clubsCount;
    window.currentClient.last_graded_at = new Date();
    window.currentClient.last_analysis_id = result.analysisId;
    
    // Refresh the client card in the list (include analysisId)
    refreshClientCard(window.currentClient.id, overallGrade, clubsCount, result.analysisId);
  } else {
    console.warn('⚠️ window.currentClient is undefined - cannot refresh client card');
  }
  
  console.log(`✅ Grade display updated: ${overallGrade} (${overallScore}), ${clubsCount} clubs`);
}

/**
 * Populate the AI Bag Summary section
 */
function populateAISummary(aiAnalysis) {
  const emptyEl = document.getElementById('ai-summary-empty');
  const contentEl = document.getElementById('ai-summary-content');
  
  if (!aiAnalysis) {
    // Show empty state
    if (emptyEl) emptyEl.style.display = 'block';
    if (contentEl) contentEl.style.display = 'none';
    console.log('📝 AI Summary: No data available');
    return;
  }
  
  // Hide empty, show content
  if (emptyEl) emptyEl.style.display = 'none';
  if (contentEl) contentEl.style.display = 'block';
  
  // Overall Assessment
  const assessmentEl = document.getElementById('ai-overall-assessment');
  if (assessmentEl) {
    assessmentEl.textContent = aiAnalysis.overall_assessment || '';
  }
  
  // Bag Personality
  const personalityEl = document.getElementById('ai-bag-personality');
  if (personalityEl) {
    personalityEl.textContent = aiAnalysis.bag_personality || '';
    personalityEl.style.display = aiAnalysis.bag_personality ? 'block' : 'none';
  }
  
  // Key Strengths
  const strengthsEl = document.getElementById('ai-key-strengths');
  if (strengthsEl && aiAnalysis.key_strengths) {
    strengthsEl.innerHTML = aiAnalysis.key_strengths
      .map(s => `<li>${s}</li>`)
      .join('');
  }
  
  // Key Weaknesses
  const weaknessesEl = document.getElementById('ai-key-weaknesses');
  if (weaknessesEl && aiAnalysis.key_weaknesses) {
    weaknessesEl.innerHTML = aiAnalysis.key_weaknesses
      .map(w => `<li>${w}</li>`)
      .join('');
  }
  
  // Priority Recommendations
  const recommendationsEl = document.getElementById('ai-priority-recommendations');
  if (recommendationsEl && aiAnalysis.priority_recommendations) {
    recommendationsEl.innerHTML = aiAnalysis.priority_recommendations
      .map(r => `<li>${r}</li>`)
      .join('');
  }
  
  console.log('✅ AI Summary populated');
}

/**
 * Refresh a client card in the list with new grade and club count
 */
function refreshClientCard(clientId, newGrade, clubsCount, analysisId) {
  console.log('🔄 refreshClientCard called:', { clientId, newGrade, clubsCount, analysisId });
  
  // Update the clientsData array (source of truth)
  const clientIndex = clientsData.findIndex(c => c.id === clientId);
  if (clientIndex !== -1) {
    clientsData[clientIndex].bag_grade = newGrade;
    if (clubsCount !== undefined) {
      clientsData[clientIndex].clubs_count = clubsCount;
    }
    if (analysisId) {
      clientsData[clientIndex].last_analysis_id = analysisId;
    }
    console.log('✅ Updated clientsData for:', clientsData[clientIndex].display_name);
  } else {
    console.warn('⚠️ Client not found in clientsData:', clientId);
  }
  
  // Find the client row in the table
  const rows = document.querySelectorAll('.clients-table tbody tr');
  console.log('🔍 Found', rows.length, 'rows in clients table');
  
  let rowFound = false;
  rows.forEach(row => {
    const viewBtn = row.querySelector('button[onclick*="viewClient"]');
    if (viewBtn && viewBtn.getAttribute('onclick').includes(clientId)) {
      rowFound = true;
      // Find the grade badge by data attribute (most reliable)
      const gradeBadge = row.querySelector(`[data-grade-badge="${clientId}"]`);
      if (gradeBadge) {
        gradeBadge.textContent = newGrade;
        gradeBadge.className = 'badge ' + getGradeClass(newGrade);
        console.log('✅ Updated grade badge in table row (by data-attr)');
      } else {
        console.warn('⚠️ No grade badge found with data-grade-badge attribute');
      }
      
      // Update clubs count column (4th column, index 3)
      const cells = row.querySelectorAll('td');
      if (cells.length >= 4 && clubsCount !== undefined) {
        cells[3].textContent = clubsCount;
      }
    }
  });
  
  if (!rowFound) {
    console.warn('⚠️ Row not found for client:', clientId);
  }
  
  // Also update the client card header if visible
  const clientHeader = document.querySelector('.client-header .badge');
  if (clientHeader) {
    clientHeader.textContent = newGrade;
    clientHeader.className = 'badge ' + getGradeClass(newGrade);
  }
}

/**
 * Convert numeric score to letter grade
 */
function scoreToLetterGrade(score) {
  if (score >= 93) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 87) return 'A-';
  if (score >= 83) return 'B+';
  if (score >= 80) return 'B';
  if (score >= 77) return 'B-';
  if (score >= 73) return 'C+';
  if (score >= 70) return 'C';
  if (score >= 67) return 'C-';
  if (score >= 63) return 'D+';
  if (score >= 60) return 'D';
  return 'F';
}

// ============================================
// GRADING ANIMATION
// ============================================
let gradingAnimationInterval = null;

const gradingSteps = [
  { icon: '📐', title: 'Analyzing Bag...', subtitle: 'Checking loft gapping...' },
  { icon: '⚖️', title: 'Analyzing Bag...', subtitle: 'Evaluating weight progression...' },
  { icon: '🔧', title: 'Analyzing Bag...', subtitle: 'Assessing shaft flex consistency...' },
  { icon: '🎯', title: 'Analyzing Bag...', subtitle: 'Checking kickpoint alignment...' },
  { icon: '📏', title: 'Analyzing Bag...', subtitle: 'Measuring length progression...' },
  { icon: '📐', title: 'Analyzing Bag...', subtitle: 'Analyzing lie angles...' },
  { icon: '🔄', title: 'Analyzing Bag...', subtitle: 'Evaluating torque consistency...' },
  { icon: '📅', title: 'Analyzing Bag...', subtitle: 'Checking club age and technology...' },
  { icon: '🧠', title: 'Running AI Analysis...', subtitle: 'Generating personalized insights...' },
  { icon: '💡', title: 'Running AI Analysis...', subtitle: 'Identifying key strengths...' },
  { icon: '⚠️', title: 'Running AI Analysis...', subtitle: 'Finding areas for improvement...' },
  { icon: '🎯', title: 'Finalizing...', subtitle: 'Generating recommendations...' },
  { icon: '📊', title: 'Almost Done...', subtitle: 'Calculating final grade...' }
];

function startGradingAnimation() {
  let stepIndex = 0;
  
  // Reset to first step
  updateGradingStep(gradingSteps[0], 0);
  
  // Rotate through steps every 3.5 seconds
  gradingAnimationInterval = setInterval(() => {
    stepIndex++;
    if (stepIndex >= gradingSteps.length) {
      stepIndex = gradingSteps.length - 1; // Stay on last step
    }
    const progress = Math.min((stepIndex / gradingSteps.length) * 100, 95);
    updateGradingStep(gradingSteps[stepIndex], progress);
  }, 3500);
}

function stopGradingAnimation() {
  if (gradingAnimationInterval) {
    clearInterval(gradingAnimationInterval);
    gradingAnimationInterval = null;
  }
  // Show completion briefly
  updateGradingStep({ icon: '✅', title: 'Complete!', subtitle: 'Your bag grade is ready' }, 100);
}

function updateGradingStep(step, progress) {
  const iconEl = document.getElementById('grading-icon');
  const titleEl = document.getElementById('grading-title');
  const subtitleEl = document.getElementById('grading-subtitle');
  const progressEl = document.getElementById('grading-progress');
  
  if (iconEl) iconEl.textContent = step.icon;
  if (titleEl) titleEl.textContent = step.title;
  if (subtitleEl) subtitleEl.textContent = step.subtitle;
  if (progressEl) progressEl.style.width = progress + '%';
}

// ============================================
// USER PROFILE MODAL FUNCTIONS
// ============================================

// Current profile being edited
let currentProfileClientId = null;
let originalBaselineValues = null; // Track original baseline settings for regrade detection

/**
 * Open the profile modal for a client
 */
async function openProfileModal(clientId) {
  console.log('🔧 openProfileModal called with:', clientId);
  
  try {
    currentProfileClientId = clientId;
    
    // Find client in clientsData
    const client = clientsData.find(c => c.id === clientId);
    if (!client) {
      console.error('❌ Client not found:', clientId);
      showToast('Client not found. Please refresh.', 'error');
      return;
    }
    
    console.log('🔧 Found client:', client.display_name);
    
    // Set header info
    const initials = getInitials(client.display_name || 'Unknown');
    const initialsEl = document.getElementById('profile-initials');
    const displayNameEl = document.getElementById('profile-display-name');
    const emailDisplayEl = document.getElementById('profile-email-display');
    
    if (initialsEl) initialsEl.textContent = initials;
    if (displayNameEl) displayNameEl.textContent = client.display_name || 'Unknown';
    if (emailDisplayEl) emailDisplayEl.textContent = client.email || '';
    
    // Handle profile picture
    const imgEl = document.getElementById('profile-picture-img');
    if (client.profile_picture_url && imgEl) {
      imgEl.src = client.profile_picture_url;
      imgEl.style.display = 'block';
      if (initialsEl) initialsEl.style.display = 'none';
    } else {
      if (imgEl) imgEl.style.display = 'none';
      if (initialsEl) initialsEl.style.display = 'flex';
    }
    
    // Populate form fields from client data
    populateProfileForm(client);
    
    // Populate favorite club dropdown
    await populateFavoriteClubDropdown(clientId);
    
    // Capture original baseline values for regrade detection
    originalBaselineValues = {
      favorite_club_id: client.favorite_club_id || null,
      use_favorite_baseline: client.use_favorite_baseline || false,
      height_inches: client.height_inches || null,
      wrist_to_floor: client.wrist_to_floor || null,
      use_body_baseline: client.use_body_baseline || false
    };
    console.log('📌 Captured original baseline values:', originalBaselineValues);
    
    // Show Pro Notes tab (always visible for pro users)
    const proNotesTab = document.getElementById('pro-notes-tab');
    if (proNotesTab) proNotesTab.style.display = 'block';
    
    // Reset to first tab
    switchProfileTab('basic');
    
    // Show modal
    const modal = document.getElementById('profile-modal');
    if (modal) {
      modal.classList.add('active');
      console.log('✅ Profile modal opened');
    } else {
      console.error('❌ profile-modal element not found');
      showToast('Profile modal not found. Please refresh.', 'error');
    }
  } catch (error) {
    console.error('❌ Error opening profile modal:', error);
    showToast('Error opening profile: ' + error.message, 'error');
  }
}

/**
 * Populate profile form fields from client data
 */
function populateProfileForm(client) {
  // Helper to safely set value
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  };
  
  // Helper to safely set checkbox
  const setChecked = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.checked = !!val;
  };
  
  // Basic Info
  const nameParts = (client.display_name || '').split(' ');
  setVal('profile-first-name', nameParts[0]);
  setVal('profile-last-name', nameParts.slice(1).join(' '));
  setVal('profile-email', client.email);
  setVal('profile-ghin', client.ghin_number);
  setVal('profile-handicap', client.handicap);
  setVal('profile-age', client.age);
  setVal('profile-gender', client.gender);
  setVal('profile-handedness', client.handedness || 'right');
  
  // Height - convert total inches to feet/inches
  if (client.height_inches) {
    const feet = Math.floor(client.height_inches / 12);
    const inches = client.height_inches % 12;
    setVal('profile-height-feet', feet);
    setVal('profile-height-inches', inches);
  } else {
    setVal('profile-height-feet', '');
    setVal('profile-height-inches', '');
  }
  
  setVal('profile-wrist-to-floor', client.wrist_to_floor);
  
  // Swing Profile
  setVal('profile-swing-speed', client.swing_speed);
  setVal('profile-tempo', client.tempo);
  setVal('profile-typical-miss', client.typical_miss);
  
  // Favorite Club Baseline
  setVal('profile-favorite-club', client.favorite_club_id);
  setChecked('profile-use-favorite-baseline', client.use_favorite_baseline);
  
  // Body Fit Baseline
  setChecked('profile-use-body-baseline', client.use_body_baseline);
  
  // Preferences
  setVal('profile-ball-flight', client.ball_flight || 'none');
  setVal('profile-primary-goal', client.primary_goal);
  setVal('profile-communication-level', client.communication_level || 'moderate');
  
  // Pro Notes
  setVal('profile-fitting-notes', client.fitting_notes);
  setVal('profile-last-fitting-date', client.last_fitting_date);
  setVal('profile-pro-observations', client.pro_observations);
}

/**
 * Populate favorite club dropdown from user's clubs
 */
async function populateFavoriteClubDropdown(clientId) {
  const select = document.getElementById('profile-favorite-club');
  if (!select) {
    console.warn('⚠️ profile-favorite-club element not found');
    return;
  }
  select.innerHTML = '<option value="">Select your favorite club...</option>';
  
  try {
    // Get clubs from current analysis data ONLY if it matches the clientId
    // Otherwise fetch fresh from Firebase to avoid cross-contamination
    let clubs = [];
    
    if (window.currentAnalysisData && window.currentAnalysisData.clubs && 
        window.currentClient && window.currentClient.id === clientId) {
      console.log('📋 Using cached clubs for dropdown (same client)');
      clubs = window.currentAnalysisData.clubs;
    } else {
      // Fetch clubs from Firebase for the specific client
      console.log('📋 Fetching clubs for dropdown from Firebase for client:', clientId);
      const clubsSnapshot = await db.collection('users').doc(clientId)
        .collection('clubs').get();
      
      clubsSnapshot.forEach(doc => {
        clubs.push({ id: doc.id, ...doc.data() });
      });
    }
    
    // Sort clubs in standard bag order
    const clubOrder = ['Driver', '3-Wood', '5-Wood', '7-Wood', '2-Hybrid', '3-Hybrid', '4-Hybrid', '5-Hybrid', 
                       '2-Iron', '3-Iron', '4-Iron', '5-Iron', '6-Iron', '7-Iron', '8-Iron', '9-Iron', 
                       'PW', 'GW', 'SW', 'LW', '46°', '48°', '50°', '52°', '54°', '56°', '58°', '60°', '62°', '64°', 'Putter'];
    
    clubs.sort((a, b) => {
      const aType = a.club_type || a.clubType || '';
      const bType = b.club_type || b.clubType || '';
      const aIndex = clubOrder.findIndex(c => aType.toLowerCase().includes(c.toLowerCase()));
      const bIndex = clubOrder.findIndex(c => bType.toLowerCase().includes(c.toLowerCase()));
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    });
    
    // Add options
    clubs.forEach(club => {
      const clubType = club.club_type || club.clubType || 'Unknown';
      const option = document.createElement('option');
      option.value = club.id || club.club_id;
      option.textContent = clubType;
      select.appendChild(option);
    });
    
    // Set current value if exists
    const client = clientsData.find(c => c.id === clientId);
    if (client && client.favorite_club_id) {
      select.value = client.favorite_club_id;
    }
    
  } catch (error) {
    console.error('❌ Error loading clubs for favorite dropdown:', error);
  }
}

/**
 * Switch between profile tabs
 */
function switchProfileTab(tabName) {
  console.log('🔧 switchProfileTab called:', tabName);
  
  // Update tab buttons
  const tabs = document.querySelectorAll('.profile-tab');
  tabs.forEach((tab, index) => {
    tab.classList.remove('active');
    // Match tab to tabName by index: basic=0, swing=1, preferences=2, notes=3
    const tabNames = ['basic', 'swing', 'preferences', 'notes'];
    if (tabNames[index] === tabName) {
      tab.classList.add('active');
    }
  });
  
  // Update tab content
  document.querySelectorAll('.profile-tab-content').forEach(content => {
    content.classList.remove('active');
  });
  
  const targetTab = document.getElementById(`profile-tab-${tabName}`);
  if (targetTab) {
    targetTab.classList.add('active');
    console.log('✅ Tab content activated:', tabName, 'Height:', targetTab.offsetHeight);
  } else {
    console.error('❌ Tab content not found:', `profile-tab-${tabName}`);
  }
}

/**
 * Handle profile picture upload
 */
async function handleProfilePictureUpload(event) {
  const file = event.target.files[0];
  if (!file || !currentProfileClientId) return;
  
  // Validate file type
  if (!file.type.startsWith('image/')) {
    showToast('Please select an image file', 'error');
    return;
  }
  
  // Validate file size (max 5MB)
  if (file.size > 5 * 1024 * 1024) {
    showToast('Image must be less than 5MB', 'error');
    return;
  }
  
  try {
    // Show loading state
    const initialsEl = document.getElementById('profile-initials');
    initialsEl.textContent = '⏳';
    
    // Upload to Firebase Storage
    const storageRef = firebase.storage().ref();
    const imageRef = storageRef.child(`profile-pictures/${currentProfileClientId}`);
    
    await imageRef.put(file);
    const url = await imageRef.getDownloadURL();
    
    // Update UI
    const imgEl = document.getElementById('profile-picture-img');
    imgEl.src = url;
    imgEl.style.display = 'block';
    initialsEl.style.display = 'none';
    
    // Save to Firestore immediately
    await db.collection('users').doc(currentProfileClientId).update({
      profile_picture_url: url,
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    // Update local data
    const client = clientsData.find(c => c.id === currentProfileClientId);
    if (client) {
      client.profile_picture_url = url;
    }
    
    console.log('✅ Profile picture uploaded');
    
  } catch (error) {
    console.error('❌ Error uploading profile picture:', error);
    showToast('Failed to upload image. Please try again.', 'error');
    
    // Reset UI
    const client = clientsData.find(c => c.id === currentProfileClientId);
    const initials = getInitials(client?.display_name || 'Unknown');
    document.getElementById('profile-initials').textContent = initials;
  }
}

/**
 * Save profile data to Firebase
 */
async function saveProfile() {
  if (!currentProfileClientId) {
    console.error('❌ No client ID for profile save');
    return;
  }
  
  // Gather form data
  const firstName = document.getElementById('profile-first-name').value.trim();
  const lastName = document.getElementById('profile-last-name').value.trim();
  const displayName = [firstName, lastName].filter(Boolean).join(' ');
  
  // Calculate height in total inches
  const heightFeet = parseInt(document.getElementById('profile-height-feet').value) || 0;
  const heightInches = parseInt(document.getElementById('profile-height-inches').value) || 0;
  const totalHeightInches = heightFeet > 0 ? (heightFeet * 12) + heightInches : null;
  
  const profileData = {
    // Basic Info
    display_name: displayName,
    email: document.getElementById('profile-email').value.trim(),
    ghin_number: document.getElementById('profile-ghin').value.trim() || null,
    handicap: parseFloat(document.getElementById('profile-handicap').value) || null,
    age: parseInt(document.getElementById('profile-age').value) || null,
    gender: document.getElementById('profile-gender').value || null,
    handedness: document.getElementById('profile-handedness').value || 'right',
    height_inches: totalHeightInches,
    wrist_to_floor: parseFloat(document.getElementById('profile-wrist-to-floor').value) || null,
    
    // Swing Profile
    swing_speed: parseInt(document.getElementById('profile-swing-speed').value) || null,
    tempo: document.getElementById('profile-tempo').value || null,
    typical_miss: document.getElementById('profile-typical-miss').value || null,
    
    // Favorite Club Baseline
    favorite_club_id: document.getElementById('profile-favorite-club').value || null,
    use_favorite_baseline: document.getElementById('profile-use-favorite-baseline').checked,
    
    // Body Fit Baseline
    use_body_baseline: document.getElementById('profile-use-body-baseline').checked,
    
    // Preferences
    ball_flight: document.getElementById('profile-ball-flight').value || 'none',
    primary_goal: document.getElementById('profile-primary-goal').value || null,
    communication_level: document.getElementById('profile-communication-level').value || 'moderate',
    
    // Pro Notes
    fitting_notes: document.getElementById('profile-fitting-notes').value.trim() || null,
    last_fitting_date: document.getElementById('profile-last-fitting-date').value || null,
    pro_observations: document.getElementById('profile-pro-observations').value.trim() || null,
    
    // Metadata
    updated_at: firebase.firestore.FieldValue.serverTimestamp()
  };
  
  // Remove null values to avoid overwriting with null
  Object.keys(profileData).forEach(key => {
    if (profileData[key] === null) {
      delete profileData[key];
    }
  });
  
  try {
    // Save to Firebase
    await db.collection('users').doc(currentProfileClientId).update(profileData);
    
    // Update local clientsData
    const clientIndex = clientsData.findIndex(c => c.id === currentProfileClientId);
    if (clientIndex !== -1) {
      clientsData[clientIndex] = { ...clientsData[clientIndex], ...profileData };
    }
    
    // Sync swing speed with factor cards if viewing this client
    if (window.currentClient && window.currentClient.id === currentProfileClientId) {
      window.currentClient = { ...window.currentClient, ...profileData };
      syncSwingSpeedWithFactorCards(profileData.swing_speed);
    }
    
    // Re-render client list to show updated name
    renderClientsTable(clientsData);
    
    console.log('✅ Profile saved successfully');
    
    // Check if baseline settings changed - prompt for regrade if viewing this client
    // Use form values directly since profileData may have nulls removed
    const newFavoriteClubId = document.getElementById('profile-favorite-club').value || null;
    const newUseFavoriteBaseline = document.getElementById('profile-use-favorite-baseline').checked;
    
    // Get body fit values
    const newHeightFeet = parseInt(document.getElementById('profile-height-feet').value) || 0;
    const newHeightInches = parseInt(document.getElementById('profile-height-inches').value) || 0;
    const newTotalHeightInches = newHeightFeet > 0 ? (newHeightFeet * 12) + newHeightInches : null;
    const newWristToFloor = parseFloat(document.getElementById('profile-wrist-to-floor').value) || null;
    const newUseBodyBaseline = document.getElementById('profile-use-body-baseline').checked;
    
    // Debug logging
    console.log('🔍 Regrade check:', {
      originalBaselineValues,
      newFavoriteClubId,
      newUseFavoriteBaseline,
      newTotalHeightInches,
      newWristToFloor,
      newUseBodyBaseline,
      currentClientId: window.currentClient?.id,
      profileClientId: currentProfileClientId,
      viewingThisClient: window.currentClient?.id === currentProfileClientId
    });
    
    const baselineChanged = originalBaselineValues && (
      newFavoriteClubId !== originalBaselineValues.favorite_club_id ||
      newUseFavoriteBaseline !== originalBaselineValues.use_favorite_baseline ||
      newTotalHeightInches !== originalBaselineValues.height_inches ||
      newWristToFloor !== originalBaselineValues.wrist_to_floor ||
      newUseBodyBaseline !== originalBaselineValues.use_body_baseline
    );
    
    console.log('🔍 Baseline changed:', baselineChanged);
    
    // Show regrade modal if baseline settings changed
    // Works whether viewing this client's bag or not
    if (baselineChanged) {
      console.log('🔄 Baseline settings changed, prompting for regrade');
      console.log('   Old:', originalBaselineValues);
      console.log('   New:', { 
        favorite_club_id: newFavoriteClubId, 
        use_favorite_baseline: newUseFavoriteBaseline,
        height_inches: newTotalHeightInches,
        wrist_to_floor: newWristToFloor,
        use_body_baseline: newUseBodyBaseline
      });
      
      // Ensure window.currentClient is set so confirmRegrade() works
      if (!window.currentClient || window.currentClient.id !== currentProfileClientId) {
        const client = clientsData.find(c => c.id === currentProfileClientId);
        if (client) {
          window.currentClient = client;
          console.log('📌 Set window.currentClient to:', client.display_name);
        }
      }
      
      // Close profile modal first
      closeModal('profile-modal');
      
      // Show regrade modal
      console.log('📊 About to call showRegradeModal()...');
      try {
        showRegradeModal();
        console.log('✅ showRegradeModal() completed');
      } catch (e) {
        console.error('❌ Error in showRegradeModal:', e);
        showToast('Error showing regrade modal: ' + e.message, 'error');
      }
      
      // Reset original values
      originalBaselineValues = null;
      return; // Don't show success toast, regrade modal is more important
    }
    
    // Reset original values
    originalBaselineValues = null;
    
    // Close modal
    closeModal('profile-modal');
    
    // Show success toast (if function exists)
    if (typeof showToast === 'function') {
      showToast('Profile saved successfully', 'success');
    }
    
  } catch (error) {
    console.error('❌ Error saving profile:', error);
    showToast('Failed to save profile. Please try again.', 'error');
  }
}

/**
 * Sync profile swing speed with factor card inputs
 */
function syncSwingSpeedWithFactorCards(swingSpeed) {
  if (!swingSpeed) return;
  
  // Update the swing speed slider and display in factor cards
  const sliderEl = document.getElementById('swing-speed-slider');
  const displayEl = document.getElementById('swing-speed-display');
  
  if (sliderEl) {
    sliderEl.value = swingSpeed;
  }
  if (displayEl) {
    displayEl.textContent = `${swingSpeed} mph`;
  }
  
  console.log(`🔄 Synced swing speed to factor cards: ${swingSpeed} mph`);
}


// ==========================================
// SCENARIO SWAP SYSTEM
// Simple: swap up to 7 clubs, run 1 full analysis
// ==========================================

// Pending swaps: { clubId: { original: {...}, replacement: {...} } }
let pendingSwaps = {};
// Pending additions: [ { tempId: 'add-1', ...clubData } ]
let pendingAdds = [];
// Pending removals: Set of clubIds temporarily removed
let pendingRemovals = new Set();
// Counter for temp IDs
let addCounter = 0;

/**
 * Render the scenario club list with swap buttons
 */
function renderScenarioClubList() {
  const container = document.getElementById('scenario-club-list');
  if (!container) return;
  
  const clubs = window.currentClientClubs || [];
  
  if (clubs.length === 0 && pendingAdds.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--text-muted);">No clubs in bag.</div>
      <button class="btn btn-primary" onclick="addScenarioClub()" style="width: 100%; margin-top: 16px;">+ Add Club to Scenario</button>
    `;
    return;
  }
  
  // Group by category (include pending adds)
  const categories = { woods: [], hybrids: [], irons: [], wedges: [] };
  clubs.forEach(club => {
    const cat = club.category || inferCategory(club.clubType);
    if (categories[cat]) categories[cat].push({ ...club, isExisting: true });
  });
  
  // Add pending adds to categories
  pendingAdds.forEach(club => {
    const cat = club.category || inferCategory(club.clubType);
    if (categories[cat]) categories[cat].push({ ...club, isAdded: true });
  });
  
  // Sort within categories
  const sortOrder = { 'driver': 1, '3-wood': 2, '3w': 2, '5-wood': 3, '5w': 3, '7-wood': 4,
    '3-hybrid': 10, '3h': 10, '4-hybrid': 11, '4h': 11, '5-hybrid': 12, '5h': 12, '2h': 9, '2-hybrid': 9,
    '5-iron': 20, '5i': 20, '6-iron': 21, '6i': 21, '7-iron': 22, '7i': 22, '8-iron': 23, '8i': 23, '9-iron': 24, '9i': 24, 'pw': 25,
    'gw': 30, '50': 31, '52': 32, 'sw': 33, '54': 34, '56': 35, 'lw': 36, '58': 37, '60': 38 };
  
  Object.values(categories).forEach(arr => {
    arr.sort((a, b) => (sortOrder[a.clubType?.toLowerCase()] || 50) - (sortOrder[b.clubType?.toLowerCase()] || 50));
  });
  
  let html = '';
  const catLabels = { woods: 'WOODS', hybrids: 'HYBRIDS', irons: 'IRONS', wedges: 'WEDGES' };
  
  Object.entries(categories).forEach(([cat, catClubs]) => {
    if (catClubs.length === 0) return;
    
    html += `<div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; margin: 16px 0 8px 0;">${catLabels[cat]}</div>`;
    
    catClubs.forEach(club => {
      const clubId = club.id || club.tempId;
      const isSwapped = club.isExisting && !!pendingSwaps[club.id];
      const isRemoved = club.isExisting && pendingRemovals.has(club.id);
      const isAdded = club.isAdded;
      const displayData = isSwapped ? pendingSwaps[club.id].replacement : club;
      const grade = club.grading?.grade || '—';
      
      // Determine styling
      let bgColor = 'var(--bg-secondary)';
      let borderStyle = '';
      let opacity = '1';
      
      if (isSwapped) {
        bgColor = 'var(--green-dim)';
        borderStyle = 'border: 1px solid rgba(0,200,100,0.3);';
      } else if (isRemoved) {
        bgColor = 'var(--bg-tertiary)';
        opacity = '0.5';
        borderStyle = 'border: 1px dashed var(--text-muted);';
      } else if (isAdded) {
        bgColor = 'var(--cyan-dim)';
        borderStyle = 'border: 1px solid rgba(0,200,255,0.3);';
      }
      
      // Build buttons
      let buttons = '';
      if (isRemoved) {
        buttons = `<button class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;" onclick="undoRemoval('${club.id}')">Undo</button>`;
      } else if (isSwapped) {
        buttons = `<button class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;" onclick="undoSwap('${club.id}')">Undo</button>`;
      } else if (isAdded) {
        buttons = `<button class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;" onclick="removeAddedClub('${club.tempId}')">Remove</button>`;
      } else {
        buttons = `
          <button class="btn btn-primary" style="padding: 6px 12px; font-size: 12px;" onclick="openSwapModal('${club.id}')">Swap</button>
          <button class="btn btn-secondary" style="padding: 6px 10px; font-size: 12px;" onclick="removeScenarioClub('${club.id}')" title="Remove from scenario">✕</button>
        `;
      }
      
      // Status label
      let statusLabel = '';
      if (isSwapped) statusLabel = '<div style="font-size: 11px; color: var(--green); margin-top: 4px;">✓ Swapped</div>';
      else if (isRemoved) statusLabel = '<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">✗ Removed</div>';
      else if (isAdded) statusLabel = '<div style="font-size: 11px; color: var(--cyan); margin-top: 4px;">+ Added</div>';
      
      html += `
        <div class="scenario-club-row" style="display: flex; align-items: center; padding: 12px; background: ${bgColor}; border-radius: 10px; margin-bottom: 8px; opacity: ${opacity}; ${borderStyle}">
          <div style="flex: 1;">
            <div style="font-size: 14px; font-weight: 600;">${formatClubType(club.clubType)}</div>
            <div style="font-size: 12px; color: var(--text-secondary);">
              ${displayData.brand} ${displayData.model} ${displayData.year ? '(' + displayData.year + ')' : ''}
            </div>
            <div style="font-size: 11px; color: var(--text-muted);">
              ${displayData.shaft_brand || ''} ${displayData.shaft_model || ''} ${displayData.shaft_weight ? displayData.shaft_weight + 'g' : ''}
            </div>
            ${statusLabel}
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            ${!isRemoved && !isAdded ? `<div style="font-size: 16px; font-weight: 700; width: 32px; text-align: center; color: ${grade.startsWith('A') ? 'var(--green)' : grade.startsWith('B') ? 'var(--cyan)' : 'var(--orange)'};">${grade}</div>` : ''}
            ${buttons}
          </div>
        </div>
      `;
    });
  });
  
  // Add Club button
  const totalChanges = Object.keys(pendingSwaps).length + pendingAdds.length + pendingRemovals.size;
  html += `
    <div style="margin-top: 16px;">
      <button class="btn btn-secondary" onclick="addScenarioClub()" style="width: 100%;" ${totalChanges >= 7 ? 'disabled' : ''}>
        + Add Club to Scenario ${totalChanges >= 7 ? '(max 7 changes)' : ''}
      </button>
    </div>
  `;
  
  container.innerHTML = html;
  updateSwapSummary();
}

/**
 * Update the swap summary and run button state
 */
function updateSwapSummary() {
  const swapCount = Object.keys(pendingSwaps).length;
  const addCount = pendingAdds.length;
  const removeCount = pendingRemovals.size;
  const totalCount = swapCount + addCount + removeCount;
  
  const summary = document.getElementById('scenario-swap-summary');
  const countEl = document.getElementById('swap-count');
  const runBtn = document.getElementById('run-scenario-btn');
  
  if (summary) summary.style.display = totalCount > 0 ? 'block' : 'none';
  if (countEl) {
    // Build description
    const parts = [];
    if (swapCount > 0) parts.push(`${swapCount} swapped`);
    if (addCount > 0) parts.push(`${addCount} added`);
    if (removeCount > 0) parts.push(`${removeCount} removed`);
    
    // Update the count span and hide the static text
    countEl.textContent = parts.join(', ') || '0 changes';
    // Hide the sibling "club(s) swapped" text
    const siblingText = countEl.nextElementSibling;
    if (siblingText) siblingText.style.display = 'none';
  }
  if (runBtn) runBtn.disabled = totalCount === 0;
  
  // Hide results when changes occur
  const results = document.getElementById('scenario-results-section');
  if (results) results.style.display = 'none';
}

/**
 * Open swap modal for a specific club
 */
async function openSwapModal(clubId) {
  const club = window.currentClientClubs?.find(c => c.id === clubId);
  if (!club) return;
  
  // Use ClubSelector if available
  if (typeof ClubSelector !== 'undefined' && ClubSelector.isReady()) {
    ClubSelector.open({
      mode: 'known-type',
      clubType: club.clubType,
      category: club.category || inferCategory(club.clubType),
      title: `Swap ${formatClubType(club.clubType)}`,
      onSelect: (result) => {
        // Build replacement object
        const replacement = {
          ...club,  // Keep original clubType, category, id
          brand: result.brand,
          model: result.model,
          year: result.year || null,
          clubHeadSpecId: result.clubHeadSpecId,
          loft: result.specs?.loft || club.loft,
          lie: result.specs?.lie || club.lie,
          length: result.specs?.length || club.length,
          shaft_brand: result.shaftBrand,
          shaft_model: result.shaftModel,
          shaft_weight: result.shaftSpecs?.weight,
          shaft_flex: result.shaftSpecs?.flex,
          shaftId: result.shaftId
        };
        
        pendingSwaps[clubId] = {
          original: club,
          replacement: replacement
        };
        
        // Check limit (7 total changes)
        const totalChanges = Object.keys(pendingSwaps).length + pendingAdds.length + pendingRemovals.size;
        if (totalChanges > 7) {
          delete pendingSwaps[clubId];
          showToast('Maximum 7 changes per scenario', 'error');
          return;
        }
        
        renderScenarioClubList();
        showToast('Club swapped', 'success');
      }
    });
    return;
  }
  
  // Fallback to old modal
  await loadClubHeadSpecs();
  await loadShaftSpecs();
  
  // Populate current club info
  document.getElementById('swap-current-name').textContent = formatClubType(club.clubType);
  document.getElementById('swap-current-specs').textContent = 
    `${club.brand} ${club.model} ${club.year ? '(' + club.year + ')' : ''} • ${club.shaft_brand || ''} ${club.shaft_model || ''} ${club.shaft_weight ? club.shaft_weight + 'g' : ''}`;
  
  document.getElementById('swap-club-id').value = clubId;
  document.getElementById('swap-category').value = club.category || inferCategory(club.clubType);
  
  // Reset form
  document.getElementById('swap-brand-input').value = '';
  document.getElementById('swap-brand').value = '';
  document.getElementById('swap-model-row').style.display = 'none';
  document.getElementById('swap-shaft-section').style.display = 'none';
  document.getElementById('swap-confirm-btn').disabled = true;
  
  document.getElementById('swap-modal').style.display = 'flex';
}

/**
 * Close swap modal
 */
function closeSwapModal() {
  document.getElementById('swap-modal').style.display = 'none';
}

/**
 * Show brand suggestions for swap modal
 */
function showSwapBrandSuggestions() {
  const input = document.getElementById('swap-brand-input');
  const dropdown = document.getElementById('swap-brand-dropdown');
  const search = input.value.toLowerCase();
  const category = document.getElementById('swap-category').value;
  
  if (!clubHeadSpecsCache) {
    dropdown.classList.remove('show');
    return;
  }
  
  const categoryPatterns = {
    'woods': /^(Driver|Mini Driver|[3-9]W|[1-9][1]?W)/i,
    'hybrids': /^([2-7]H|[2-6]U)/i,
    'irons': /^([2-9]i|PW|AW)$/i,
    'wedges': /^(GW|SW|LW|UW|DW|[4-6][0-9]°?)$/i
  };
  
  const pattern = categoryPatterns[category];
  const brands = new Set();
  
  Object.values(clubHeadSpecsCache).forEach(spec => {
    if (!spec.brand || !spec.clubs) return;
    const hasMatch = Object.keys(spec.clubs).some(key => pattern && pattern.test(key));
    if (hasMatch) brands.add(spec.brand);
  });
  
  const popularBrands = ['Callaway', 'TaylorMade', 'Titleist', 'Ping', 'Cobra', 'Mizuno', 'Srixon', 'Cleveland'];
  let filtered = search.length === 0 
    ? popularBrands.filter(b => brands.has(b))
    : [...brands].filter(b => b.toLowerCase().includes(search)).sort();
  
  if (filtered.length === 0) {
    dropdown.classList.remove('show');
    return;
  }
  
  dropdown.innerHTML = filtered.slice(0, 10).map(brand => 
    `<div class="autocomplete-item" onclick="selectSwapBrand('${brand}')">${brand}</div>`
  ).join('');
  dropdown.classList.add('show');
}

/**
 * Select brand in swap modal
 */
function selectSwapBrand(brand) {
  document.getElementById('swap-brand-input').value = brand;
  document.getElementById('swap-brand').value = brand;
  document.getElementById('swap-brand-dropdown').classList.remove('show');
  
  document.getElementById('swap-model-row').style.display = 'block';
  document.getElementById('swap-model-input').value = '';
  document.getElementById('swap-model').value = '';
  document.getElementById('swap-model-input').focus();
  
  document.getElementById('swap-shaft-section').style.display = 'none';
  document.getElementById('swap-confirm-btn').disabled = true;
}

/**
 * Show model suggestions for swap modal
 */
function showSwapModelSuggestions() {
  const input = document.getElementById('swap-model-input');
  const dropdown = document.getElementById('swap-model-dropdown');
  const search = input.value.toLowerCase();
  const brand = document.getElementById('swap-brand').value;
  const category = document.getElementById('swap-category').value;
  
  if (!clubHeadSpecsCache || !brand) {
    dropdown.classList.remove('show');
    return;
  }
  
  const categoryPatterns = {
    'woods': /^(Driver|Mini Driver|[3-9]W|[1-9][1]?W)/i,
    'hybrids': /^([2-7]H|[2-6]U)/i,
    'irons': /^([2-9]i|PW|AW)$/i,
    'wedges': /^(GW|SW|LW|UW|DW|[4-6][0-9]°?)$/i
  };
  
  const pattern = categoryPatterns[category];
  const models = [];
  
  Object.entries(clubHeadSpecsCache).forEach(([docId, spec]) => {
    if (spec.brand !== brand || !spec.clubs) return;
    const hasMatch = Object.keys(spec.clubs).some(key => pattern && pattern.test(key));
    if (!hasMatch) return;
    
    const modelName = `${spec.model || ''} ${spec.year || ''}`.toLowerCase();
    if (search.length === 0 || modelName.includes(search)) {
      models.push({ docId, ...spec });
    }
  });
  
  models.sort((a, b) => (parseInt(b.year) || 0) - (parseInt(a.year) || 0));
  
  if (models.length === 0) {
    dropdown.classList.remove('show');
    return;
  }
  
  dropdown.innerHTML = models.slice(0, 15).map(m => {
    const yearStr = m.year ? ` (${m.year})` : '';
    return `<div class="autocomplete-item" onclick="selectSwapModel('${m.docId}')">${m.model}${yearStr}</div>`;
  }).join('');
  dropdown.classList.add('show');
}

/**
 * Select model in swap modal - loads stock shaft
 */
function selectSwapModel(modelId) {
  const spec = clubHeadSpecsCache[modelId];
  if (!spec) return;
  
  const yearStr = spec.year ? ` (${spec.year})` : '';
  document.getElementById('swap-model-input').value = `${spec.model}${yearStr}`;
  document.getElementById('swap-model').value = modelId;
  document.getElementById('swap-model-dropdown').classList.remove('show');
  
  // Load stock shaft
  loadSwapStockShaft(spec);
  
  document.getElementById('swap-shaft-section').style.display = 'block';
  document.getElementById('swap-use-stock').checked = true;
  document.getElementById('swap-stock-info').style.display = 'block';
  document.getElementById('swap-custom-shaft').style.display = 'none';
  document.getElementById('swap-confirm-btn').disabled = false;
}

/**
 * Load stock shaft info for selected model
 */
function loadSwapStockShaft(spec) {
  const category = document.getElementById('swap-category').value;
  
  const categoryPatterns = {
    'woods': /^(Driver|Mini Driver|[3-9]W|[1-9][1]?W)/i,
    'hybrids': /^([2-7]H|[2-6]U)/i,
    'irons': /^([2-9]i|PW|AW)$/i,
    'wedges': /^(GW|SW|LW|UW|DW|[4-6][0-9]°?)$/i
  };
  
  const pattern = categoryPatterns[category];
  let stockShaftRef = null;
  
  if (spec.clubs) {
    for (const [key, data] of Object.entries(spec.clubs)) {
      if (pattern && pattern.test(key) && data.stockShaftRefs?.length > 0) {
        stockShaftRef = data.stockShaftRefs.find(s => s.isDefault) || data.stockShaftRefs[0];
        break;
      }
    }
  }
  
  let stockDisplay = 'Stock shaft (specs unavailable)';
  
  if (stockShaftRef?.shaftId && shaftSpecsCache) {
    const shaft = shaftSpecsCache[stockShaftRef.shaftId];
    if (shaft) {
      stockDisplay = `Stock: ${shaft.brand} ${shaft.model} ${shaft.flex || ''} ${shaft.weight ? shaft.weight + 'g' : ''}`.trim();
      document.getElementById('swap-stock-info').dataset.shaftId = stockShaftRef.shaftId;
    }
  }
  
  document.getElementById('swap-stock-shaft-name').textContent = stockDisplay;
}

/**
 * Toggle stock/custom shaft
 */
function toggleSwapStockShaft() {
  const useStock = document.getElementById('swap-use-stock').checked;
  document.getElementById('swap-stock-info').style.display = useStock ? 'block' : 'none';
  document.getElementById('swap-custom-shaft').style.display = useStock ? 'none' : 'block';
  
  if (!useStock) {
    document.getElementById('swap-shaft-brand-input').value = '';
    document.getElementById('swap-shaft-brand').value = '';
    document.getElementById('swap-shaft-model-row').style.display = 'none';
  }
  
  updateSwapConfirmButton();
}

/**
 * Show shaft brand suggestions
 */
function showSwapShaftBrandSuggestions() {
  const input = document.getElementById('swap-shaft-brand-input');
  const dropdown = document.getElementById('swap-shaft-brand-dropdown');
  const search = input.value.toLowerCase();
  
  if (!shaftSpecsCache) {
    dropdown.classList.remove('show');
    return;
  }
  
  const brands = new Set();
  Object.values(shaftSpecsCache).forEach(s => s.brand && brands.add(s.brand));
  
  const popular = ['Fujikura', 'Project X', 'True Temper', 'Mitsubishi', 'Graphite Design', 'KBS', 'Nippon'];
  let filtered = search.length === 0 
    ? popular.filter(b => brands.has(b))
    : [...brands].filter(b => b.toLowerCase().includes(search)).sort();
  
  if (filtered.length === 0) {
    dropdown.classList.remove('show');
    return;
  }
  
  dropdown.innerHTML = filtered.slice(0, 10).map(b => 
    `<div class="autocomplete-item" onclick="selectSwapShaftBrand('${b}')">${b}</div>`
  ).join('');
  dropdown.classList.add('show');
}

/**
 * Select shaft brand
 */
function selectSwapShaftBrand(brand) {
  document.getElementById('swap-shaft-brand-input').value = brand;
  document.getElementById('swap-shaft-brand').value = brand;
  document.getElementById('swap-shaft-brand-dropdown').classList.remove('show');
  
  document.getElementById('swap-shaft-model-row').style.display = 'block';
  document.getElementById('swap-shaft-model-input').value = '';
  document.getElementById('swap-shaft-model').value = '';
  document.getElementById('swap-shaft-model-input').focus();
  
  updateSwapConfirmButton();
}

/**
 * Show shaft model suggestions
 */
function showSwapShaftModelSuggestions() {
  const input = document.getElementById('swap-shaft-model-input');
  const dropdown = document.getElementById('swap-shaft-model-dropdown');
  const search = input.value.toLowerCase();
  const brand = document.getElementById('swap-shaft-brand').value;
  
  if (!shaftSpecsCache || !brand) {
    dropdown.classList.remove('show');
    return;
  }
  
  const shafts = [];
  Object.entries(shaftSpecsCache).forEach(([docId, s]) => {
    if (s.brand !== brand) return;
    const name = `${s.model || ''} ${s.flex || ''} ${s.weight || ''}`.toLowerCase();
    if (search.length === 0 || name.includes(search)) {
      shafts.push({ docId, ...s });
    }
  });
  
  shafts.sort((a, b) => (a.model || '').localeCompare(b.model || ''));
  
  if (shafts.length === 0) {
    dropdown.classList.remove('show');
    return;
  }
  
  dropdown.innerHTML = shafts.slice(0, 15).map(s => {
    const label = `${s.model || ''} ${s.flex || ''} ${s.weight ? s.weight + 'g' : ''}`.trim();
    return `<div class="autocomplete-item" onclick="selectSwapShaftModel('${s.docId}')">${label}</div>`;
  }).join('');
  dropdown.classList.add('show');
}

/**
 * Select shaft model
 */
function selectSwapShaftModel(shaftId) {
  const shaft = shaftSpecsCache[shaftId];
  if (!shaft) return;
  
  const label = `${shaft.model || ''} ${shaft.flex || ''} ${shaft.weight ? shaft.weight + 'g' : ''}`.trim();
  document.getElementById('swap-shaft-model-input').value = label;
  document.getElementById('swap-shaft-model').value = shaftId;
  document.getElementById('swap-shaft-model-dropdown').classList.remove('show');
  
  updateSwapConfirmButton();
}

/**
 * Update confirm button state
 */
function updateSwapConfirmButton() {
  const btn = document.getElementById('swap-confirm-btn');
  const modelSelected = !!document.getElementById('swap-model').value;
  const useStock = document.getElementById('swap-use-stock').checked;
  const customShaftSelected = !!document.getElementById('swap-shaft-model').value;
  
  btn.disabled = !modelSelected || (!useStock && !customShaftSelected);
}

/**
 * Confirm the swap
 */
function confirmSwap() {
  const clubId = document.getElementById('swap-club-id').value;
  const club = window.currentClientClubs?.find(c => c.id === clubId);
  if (!club) return;
  
  const modelId = document.getElementById('swap-model').value;
  const spec = clubHeadSpecsCache[modelId];
  if (!spec) return;
  
  const useStock = document.getElementById('swap-use-stock').checked;
  const category = document.getElementById('swap-category').value;
  
  // Get club-specific data (loft, lie, length) from spec
  const categoryPatterns = {
    'woods': /^(Driver|Mini Driver|[3-9]W|[1-9][1]?W)/i,
    'hybrids': /^([2-7]H|[2-6]U)/i,
    'irons': /^([2-9]i|PW|AW)$/i,
    'wedges': /^(GW|SW|LW|UW|DW|[4-6][0-9]°?)$/i
  };
  
  const pattern = categoryPatterns[category];
  let clubData = null;
  if (spec.clubs) {
    for (const [key, data] of Object.entries(spec.clubs)) {
      if (pattern && pattern.test(key)) {
        clubData = data;
        break;
      }
    }
  }
  
  // Build replacement object
  let shaftData = {};
  if (useStock) {
    const stockId = document.getElementById('swap-stock-info').dataset.shaftId;
    if (stockId && shaftSpecsCache[stockId]) {
      const s = shaftSpecsCache[stockId];
      shaftData = { shaft_brand: s.brand, shaft_model: s.model, shaft_weight: s.weight, shaft_flex: s.flex, shaftId: stockId };
    }
  } else {
    const shaftId = document.getElementById('swap-shaft-model').value;
    if (shaftId && shaftSpecsCache[shaftId]) {
      const s = shaftSpecsCache[shaftId];
      shaftData = { shaft_brand: s.brand, shaft_model: s.model, shaft_weight: s.weight, shaft_flex: s.flex, shaftId: shaftId };
    }
  }
  
  pendingSwaps[clubId] = {
    original: club,
    replacement: {
      ...club,  // Keep original clubType, category, etc.
      brand: spec.brand,
      model: spec.model,
      year: parseInt(spec.year) || null,
      clubHeadSpecId: modelId,
      loft: clubData?.loft || club.loft,
      lie: clubData?.lie || club.lie,
      length: clubData?.length || club.length,
      ...shaftData
    }
  };
  
  // Check limit
  if (Object.keys(pendingSwaps).length > 7) {
    delete pendingSwaps[clubId];
    showToast('Maximum 7 swaps per scenario', 'error');
    return;
  }
  
  closeSwapModal();
  renderScenarioClubList();
  showToast('Club swapped', 'success');
}

/**
 * Undo a swap
 */
function undoSwap(clubId) {
  delete pendingSwaps[clubId];
  renderScenarioClubList();
}

/**
 * Clear all scenario changes
 */
function clearAllSwaps() {
  pendingSwaps = {};
  pendingAdds = [];
  pendingRemovals.clear();
  renderScenarioClubList();
}

/**
 * Add a temporary club to scenario
 */
function addScenarioClub() {
  // Check limit
  const totalChanges = Object.keys(pendingSwaps).length + pendingAdds.length + pendingRemovals.size;
  if (totalChanges >= 7) {
    showToast('Maximum 7 changes per scenario', 'error');
    return;
  }
  
  if (typeof ClubSelector !== 'undefined' && ClubSelector.isReady()) {
    ClubSelector.open({
      mode: 'full-onboarding',
      title: 'Add Club to Scenario',
      onSelect: (result) => {
        addCounter++;
        const tempClub = {
          tempId: `add-${addCounter}`,
          clubType: result.clubType,
          category: result.category,
          brand: result.brand,
          model: result.model,
          year: result.year || null,
          clubHeadSpecId: result.clubHeadSpecId,
          loft: result.specs?.loft,
          lie: result.specs?.lie,
          length: result.specs?.length,
          shaft_brand: result.shaftBrand,
          shaft_model: result.shaftModel,
          shaft_weight: result.shaftSpecs?.weight,
          shaft_flex: result.shaftSpecs?.flex,
          shaftId: result.shaftId
        };
        
        pendingAdds.push(tempClub);
        renderScenarioClubList();
        showToast('Club added to scenario', 'success');
      }
    });
  } else {
    showToast('Club selector not ready', 'error');
  }
}

/**
 * Remove a club from scenario (mark as removed)
 */
function removeScenarioClub(clubId) {
  // Check limit
  const totalChanges = Object.keys(pendingSwaps).length + pendingAdds.length + pendingRemovals.size;
  if (totalChanges >= 7 && !pendingRemovals.has(clubId)) {
    showToast('Maximum 7 changes per scenario', 'error');
    return;
  }
  
  pendingRemovals.add(clubId);
  // If it was swapped, remove the swap too
  delete pendingSwaps[clubId];
  renderScenarioClubList();
  showToast('Club removed from scenario', 'success');
}

/**
 * Undo a removal
 */
function undoRemoval(clubId) {
  pendingRemovals.delete(clubId);
  renderScenarioClubList();
}

/**
 * Remove an added club from scenario
 */
function removeAddedClub(tempId) {
  pendingAdds = pendingAdds.filter(c => c.tempId !== tempId);
  renderScenarioClubList();
}

/**
 * Reset scenario (clear swaps and results)
 */
function resetScenario() {
  pendingSwaps = {};
  pendingAdds = [];
  pendingRemovals.clear();
  const results = document.getElementById('scenario-results-section');
  if (results) results.style.display = 'none';
  renderScenarioClubList();
}

/**
 * Run scenario analysis - calls gradeUserBag with scenario mode
 */
async function runScenarioAnalysis() {
  const userId = window.currentClient?.id;
  if (!userId) {
    showToast('No client selected', 'error');
    return;
  }
  
  const swapCount = Object.keys(pendingSwaps).length;
  const addCount = pendingAdds.length;
  const removeCount = pendingRemovals.size;
  const totalChanges = swapCount + addCount + removeCount;
  
  if (totalChanges === 0) {
    showToast('No changes to analyze', 'error');
    return;
  }
  
  const btn = document.getElementById('run-scenario-btn');
  btn.disabled = true;
  btn.textContent = 'Analyzing...';
  
  try {
    // Build temp bag: original clubs with swaps applied, removals excluded, adds included
    let tempBag = (window.currentClientClubs || [])
      .filter(club => !pendingRemovals.has(club.id))  // Exclude removed
      .map(club => {
        if (pendingSwaps[club.id]) {
          return pendingSwaps[club.id].replacement;
        }
        return club;
      });
    
    // Add new clubs
    tempBag = tempBag.concat(pendingAdds);
    
    // Build scenario name
    const parts = [];
    if (swapCount > 0) parts.push(`${swapCount} swap`);
    if (addCount > 0) parts.push(`${addCount} add`);
    if (removeCount > 0) parts.push(`${removeCount} remove`);
    
    console.log('🔄 Running scenario with temp bag:', tempBag);
    
    // Call gradeUserBag with scenario mode (same function, different params)
    const functionUrl = 'https://gradeuserbag-lui6djrjya-uc.a.run.app';
    
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userId,
        clubs: tempBag,
        isScenario: true,
        scenarioName: `Scenario - ${parts.join(', ')}`
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    
    const result = await response.json();
    console.log('✅ Scenario graded:', result);
    
    displayScenarioResults(result);
    
  } catch (error) {
    console.error('❌ Scenario failed:', error);
    showToast('Scenario failed: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run Scenario Analysis (1 credit)';
  }
}

/**
 * Display scenario results
 */
function displayScenarioResults(result) {
  const resultsSection = document.getElementById('scenario-results-section');
  
  // Grades
  const currentGrade = result.current?.overall_grade || '—';
  const projectedGrade = result.projected?.overall_grade || '—';
  document.getElementById('scenario-current-grade').textContent = currentGrade;
  document.getElementById('scenario-projected-grade').textContent = projectedGrade;
  
  // Score change
  const diff = result.improvement?.score_diff || 0;
  
  const changeEl = document.getElementById('scenario-score-change');
  if (diff > 0) {
    changeEl.textContent = `🎉 +${diff} points improvement`;
    changeEl.style.background = 'var(--green-dim)';
    changeEl.style.color = 'var(--green)';
  } else if (diff < 0) {
    changeEl.textContent = `📉 ${diff} points`;
    changeEl.style.background = 'rgba(255,100,100,0.1)';
    changeEl.style.color = '#ff6464';
  } else {
    changeEl.textContent = `➡️ No change`;
    changeEl.style.background = 'var(--bg-main)';
    changeEl.style.color = 'var(--text-secondary)';
  }
  
  // AI Analysis placeholder (full version would come from AI call)
  const aiEl = document.getElementById('scenario-ai-analysis');
  if (diff > 0) {
    aiEl.textContent = `This scenario improves your overall bag grade from ${currentGrade} to ${projectedGrade}. ` +
      `The ${Object.keys(pendingSwaps).length} club swap(s) you've made address equipment inconsistencies and improve your setup.`;
  } else if (diff < 0) {
    aiEl.textContent = `This scenario would decrease your grade from ${currentGrade} to ${projectedGrade}. ` +
      `Consider reviewing the factor changes below to understand the impact.`;
  } else {
    aiEl.textContent = `This scenario maintains your current ${currentGrade} grade. ` +
      `The changes are neutral in terms of overall bag optimization.`;
  }
  
  // Factor changes
  const factorEl = document.getElementById('scenario-factor-changes');
  let factorHtml = '';
  
  const factorNames = {
    age: 'Club Age',
    weightProgression: 'Weight Progression',
    loftGapping: 'Loft Gapping',
    flexConsistency: 'Flex Consistency',
    kickpointConsistency: 'Kickpoint Consistency',
    torqueConsistency: 'Torque Consistency',
    lengthProgression: 'Length Progression',
    lieAngleProgression: 'Lie Angle Progression'
  };
  
  Object.entries(factorNames).forEach(([key, label]) => {
    const oldData = result.current?.factors?.[key] || {};
    const newData = result.projected?.factors?.[key] || {};
    
    const oldGrade = oldData.grade || '—';
    const newGrade = newData.grade || '—';
    const oldScore = oldData.score || 0;
    const newScore = newData.score || 0;
    
    const scoreDiff = newScore - oldScore;
    const arrow = scoreDiff > 0 ? '↑' : scoreDiff < 0 ? '↓' : '→';
    const colorStyle = scoreDiff > 0 ? 'color: var(--green)' : scoreDiff < 0 ? 'color: #ff6464' : 'color: var(--text-muted)';
    
    factorHtml += `
      <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border);">
        <span style="font-size: 13px;">${label}</span>
        <span style="font-size: 13px; font-weight: 600; ${colorStyle}">${oldGrade} → ${newGrade} ${arrow}</span>
      </div>
    `;
  });
  
  factorEl.innerHTML = factorHtml;
  
  resultsSection.style.display = 'block';
  resultsSection.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Apply scenario changes to actual bag
 */
async function applyScenarioToBag() {
  if (Object.keys(pendingSwaps).length === 0) return;
  
  const userId = window.currentClient?.id;
  if (!userId) return;
  
  try {
    // Update each swapped club in Firestore
    for (const [clubId, swap] of Object.entries(pendingSwaps)) {
      const clubRef = db.collection('users').doc(userId).collection('clubs').doc(clubId);
      await clubRef.update({
        brand: swap.replacement.brand,
        model: swap.replacement.model,
        year: swap.replacement.year,
        clubHeadSpecId: swap.replacement.clubHeadSpecId,
        loft: swap.replacement.loft,
        lie: swap.replacement.lie,
        length: swap.replacement.length,
        shaft_brand: swap.replacement.shaft_brand,
        shaft_model: swap.replacement.shaft_model,
        shaft_weight: swap.replacement.shaft_weight,
        shaft_flex: swap.replacement.shaft_flex,
        shaftId: swap.replacement.shaftId,
        updated_at: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    
    showToast('Changes applied to bag!', 'success');
    pendingSwaps = {};
    
    // Refresh the bag
    if (typeof loadClientData === 'function') {
      await loadClientData(userId);
    }
    
    // Switch to bag tab
    if (typeof showClientTab === 'function') {
      showClientTab('bag');
    }
    
  } catch (error) {
    console.error('❌ Failed to apply changes:', error);
    showToast('Failed to apply changes', 'error');
  }
}

/**
 * Entry point from club card scenario button
 */
function startScenarioForClub(clubId) {
  // Switch to scenarios tab
  if (typeof showClientTab === 'function') {
    showClientTab('scenarios');
  }
  
  // Open swap modal for this club after a brief delay (let tab render)
  setTimeout(() => {
    openSwapModal(clubId);
  }, 100);
}

// Helper functions
function inferCategory(clubType) {
  if (!clubType) return 'irons';
  const t = clubType.toLowerCase();
  if (t.includes('driver') || t.includes('wood') || t.match(/\dw$/)) return 'woods';
  if (t.includes('hybrid') || t.match(/\dh$/)) return 'hybrids';
  if (t.includes('wedge') || t.match(/\d{2}/) || ['gw', 'sw', 'lw', 'pw'].includes(t)) return 'wedges';
  return 'irons';
}

function formatClubType(clubType) {
  if (!clubType) return 'Unknown';
  return clubType.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('-');
}

function formatFactorName(factor) {
  const names = {
    weightProgression: 'Weight Progression',
    loftGapping: 'Loft Gapping',
    shaftConsistency: 'Shaft Consistency',
    kickpointConsistency: 'Kickpoint Consistency',
    flexConsistency: 'Flex Consistency',
    technology: 'Technology'
  };
  return names[factor] || factor;
}

// ==========================================
// END SCENARIO SWAP SYSTEM
// ==========================================

// ==========================================
// TOAST NOTIFICATION SYSTEM
// ==========================================

/**
 * Show a toast notification
 * @param {string} message - Message to display
 * @param {string} type - 'success', 'error', or 'info'
 */
function showToast(message, type = 'info') {
  // Remove existing toast if any
  const existingToast = document.getElementById('toast-notification');
  if (existingToast) existingToast.remove();
  
  // Create toast element
  const toast = document.createElement('div');
  toast.id = 'toast-notification';
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    z-index: 10000;
    opacity: 0;
    transition: opacity 0.3s ease;
    max-width: 90%;
    text-align: center;
  `;
  
  // Set colors based on type
  if (type === 'success') {
    toast.style.background = 'var(--green, #00c853)';
    toast.style.color = 'white';
  } else if (type === 'error') {
    toast.style.background = 'var(--red, #ff5252)';
    toast.style.color = 'white';
  } else {
    toast.style.background = 'var(--cyan, #00bcd4)';
    toast.style.color = 'white';
  }
  
  toast.textContent = message;
  document.body.appendChild(toast);
  
  // Fade in
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
  });
  
  // Auto remove after 3 seconds
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Log ready state
console.log('🔥 Firebase Auth + Firestore initialized for fitmygolfclubs-pro-dev');

// =============================================================================
// SCENARIOS PHASE 2 - NEW FEATURES (Added Jan 11, 2026)
// =============================================================================

/**
 * Open saved scenarios modal and load from API
 */
function openSavedScenariosModal() {
  loadSavedScenarios();
  openModal('saved-scenarios-modal');
}

/**
 * Load saved scenarios from API
 */
async function loadSavedScenarios() {
  const listEl = document.getElementById('saved-scenarios-list');
  const noScenariosEl = document.getElementById('no-saved-scenarios');
  const aiSection = document.getElementById('saved-scenarios-ai-section');
  
  if (!listEl) return;
  
  const userId = window.currentClient?.id;
  if (!userId) {
    listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">Select a client first</div>';
    return;
  }
  
  listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">Loading...</div>';
  
  try {
    const response = await fetch('https://getsavedscenarios-lui6djrjya-uc.a.run.app', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId })
    });
    const result = await response.json();
    console.log('getSavedScenarios response:', result);
    const data = result.result || result;
    
    if (data.success && data.scenarios && data.scenarios.length > 0) {
      if (noScenariosEl) noScenariosEl.style.display = 'none';
      
      let html = '';
      data.scenarios.forEach(scenario => {
        const typeIcon = scenario.scenario_type === 'build_from_scratch' ? '🟣' :
                         scenario.scenario_type === 'from_test' ? '🔵' : '🟢';
        const date = scenario.created_at ? 
          new Date(scenario.created_at._seconds ? scenario.created_at._seconds * 1000 : scenario.created_at)
          .toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
        
        html += `
          <div class="saved-scenario-card" style="background: var(--bg-card); border: 1px solid var(--border-light); border-radius: 12px; padding: 14px; margin-bottom: 10px; cursor: pointer;" onclick="loadSavedScenario('${scenario.id}')">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <div>
                <div style="font-weight: 600; margin-bottom: 4px;">${typeIcon} ${scenario.name || 'Unnamed'}</div>
                <div style="font-size: 12px; color: var(--text-muted);">${scenario.swaps?.length || 0} change(s)</div>
              </div>
              <div style="text-align: right;">
                <div style="font-size: 18px; font-weight: 700; color: var(--green);">${scenario.current_grade || '--'} → ${scenario.projected_grade || '--'}</div>
                <div style="font-size: 11px; color: var(--text-muted);">${date}</div>
              </div>
            </div>
            <div style="display: flex; gap: 8px; margin-top: 12px;">
              <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 11px; flex: 1;" onclick="event.stopPropagation(); loadSavedScenario('${scenario.id}')">Load</button>
              <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 11px; flex: 1;" onclick="event.stopPropagation(); applySavedScenario('${scenario.id}')">Apply</button>
              <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 11px; color: var(--red);" onclick="event.stopPropagation(); deleteSavedScenario('${scenario.id}')">🗑️</button>
            </div>
          </div>
        `;
      });
      
      listEl.innerHTML = html;
      
      // AI recommendation if 2+ scenarios
      if (data.scenarios.length >= 2 && aiSection) {
        aiSection.style.display = 'block';
        const best = data.scenarios.reduce((b, s) => {
          const bImprove = (b.projected_score || 0) - (b.current_score || 0);
          const sImprove = (s.projected_score || 0) - (s.current_score || 0);
          return sImprove > bImprove ? s : b;
        }, data.scenarios[0]);
        const improve = (best.projected_score || 0) - (best.current_score || 0);
        document.getElementById('saved-scenarios-ai-content').innerHTML = 
          `"<strong>${best.name}</strong>" offers the best improvement at <strong>+${improve} points</strong> (${best.current_grade} → ${best.projected_grade}).`;
      } else if (aiSection) {
        aiSection.style.display = 'none';
      }
      
    } else {
      listEl.innerHTML = '';
      if (noScenariosEl) noScenariosEl.style.display = 'block';
      if (aiSection) aiSection.style.display = 'none';
    }
  } catch (error) {
    console.error('Load scenarios error:', error);
    listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--red);">Error loading scenarios</div>';
  }
}

/**
 * Load saved scenarios count for badge
 */
async function loadSavedScenariosCount() {
  const countEl = document.getElementById('saved-scenarios-count');
  if (!countEl) return;
  
  const userId = window.currentClient?.id;
  if (!userId) return;
  
  try {
    const response = await fetch('https://getsavedscenarios-lui6djrjya-uc.a.run.app', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId })
    });
    const result = await response.json();
    const data = result.result || result;
    countEl.textContent = data.count || data.scenarios?.length || 0;
  } catch (e) {
    console.error('Error loading scenarios count:', e);
  }
}

/**
 * Open save scenario modal
 */
function openSaveScenarioModal() {
  const totalChanges = Object.keys(pendingSwaps).length + pendingAdds.length + pendingRemovals.size;
  
  if (totalChanges === 0) {
    showToast('No changes to save', 'error');
    return;
  }
  
  // Pre-fill values
  const currentGrade = document.getElementById('scenario-current-grade')?.textContent || '--';
  const projectedGrade = document.getElementById('scenario-projected-grade')?.textContent || '--';
  
  document.getElementById('save-scenario-grade-change').textContent = `${currentGrade} → ${projectedGrade}`;
  document.getElementById('save-scenario-change-count').textContent = totalChanges;
  document.getElementById('save-scenario-name').value = '';
  
  openModal('save-scenario-modal');
}

/**
 * Save scenario to API
 */
async function confirmSaveScenario() {
  const name = document.getElementById('save-scenario-name').value.trim() || 'Unnamed Scenario';
  const userId = window.currentClient?.id;
  
  if (!userId) {
    showToast('No client selected', 'error');
    return;
  }
  
  try {
    const response = await fetch('https://savescenario-lui6djrjya-uc.a.run.app', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        name: name,
        swaps: Object.entries(pendingSwaps).map(([id, data]) => ({
          club_id: id,
          original: data.original,
          replacement: data.replacement
        })),
        adds: pendingAdds,
        removals: Array.from(pendingRemovals),
        current_grade: document.getElementById('scenario-current-grade')?.textContent,
        projected_grade: document.getElementById('scenario-projected-grade')?.textContent
      })
    });
    
    const result = await response.json();
    console.log('Save scenario response:', result);
    
    if (result.success || result.result?.success) {
      closeModal('save-scenario-modal');
      showToast('Scenario saved!', 'success');
      loadSavedScenariosCount();
    } else {
      throw new Error(result.error || result.result?.error || 'Failed to save');
    }
  } catch (error) {
    console.error('Save scenario error:', error);
    showToast('Error: ' + error.message, 'error');
  }
}

/**
 * Load a saved scenario into pending state
 */
async function loadSavedScenario(scenarioId) {
  const userId = window.currentClient?.id;
  if (!userId) return;
  
  closeModal('saved-scenarios-modal');
  showToast('Loading scenario...', 'info');
  
  try {
    const response = await fetch('https://getsavedscenarios-lui6djrjya-uc.a.run.app', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, scenario_id: scenarioId })
    });
    const result = await response.json();
    const data = result.result || result;
    
    if (data.success && data.scenario) {
      // Clear current state
      pendingSwaps = {};
      pendingAdds = [];
      pendingRemovals.clear();
      
      // Load swaps
      if (data.scenario.swaps) {
        data.scenario.swaps.forEach(swap => {
          pendingSwaps[swap.club_id] = {
            original: swap.original,
            replacement: swap.replacement
          };
        });
      }
      
      // Load adds
      if (data.scenario.adds) {
        pendingAdds = data.scenario.adds;
      }
      
      // Load removals
      if (data.scenario.removals) {
        data.scenario.removals.forEach(id => pendingRemovals.add(id));
      }
      
      renderScenarioClubList();
      showToast('Scenario loaded', 'success');
    }
  } catch (error) {
    console.error('Load scenario error:', error);
    showToast('Error loading scenario', 'error');
  }
}

/**
 * Apply saved scenario directly to bag
 */
async function applySavedScenario(scenarioId) {
  if (!confirm('Apply this scenario to the bag? This will update the actual equipment.')) return;
  
  const userId = window.currentClient?.id;
  if (!userId) return;
  
  try {
    const response = await fetch('https://applyscenario-lui6djrjya-uc.a.run.app', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        scenario_id: scenarioId
      })
    });
    
    const result = await response.json();
    console.log('Apply scenario response:', result);
    
    if (result.success || result.result?.success) {
      closeModal('saved-scenarios-modal');
      showToast('Scenario applied to bag!', 'success');
      // Refresh bag view
      if (typeof loadClientBag === 'function') {
        loadClientBag(userId);
      }
    } else {
      throw new Error(result.error || result.result?.error || 'Failed to apply');
    }
  } catch (error) {
    console.error('Apply scenario error:', error);
    showToast('Error: ' + error.message, 'error');
  }
}

/**
 * Delete saved scenario
 */
async function deleteSavedScenario(scenarioId) {
  if (!confirm('Delete this saved scenario?')) return;
  
  const userId = window.currentClient?.id;
  if (!userId) return;
  
  try {
    const response = await fetch('https://deletesavedscenario-lui6djrjya-uc.a.run.app', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        scenario_id: scenarioId
      })
    });
    
    const result = await response.json();
    console.log('Delete scenario response:', result);
    
    if (result.success || result.result?.success) {
      showToast('Scenario deleted', 'success');
      loadSavedScenarios();
      loadSavedScenariosCount();
    } else {
      throw new Error(result.error || result.result?.error || 'Failed to delete');
    }
  } catch (error) {
    console.error('Delete scenario error:', error);
    showToast('Error: ' + error.message, 'error');
  }
}

/**
 * Build from scratch (Pro only)
 */
function startBuildFromScratch() {
  if (!document.body.classList.contains('pro-view')) {
    showToast('Build from Scratch is a Pro feature', 'error');
    return;
  }
  
  // Open bag onboarding in scenario mode
  if (typeof BagOnboarding !== 'undefined' && BagOnboarding.start) {
    BagOnboarding.start({
      mode: 'scenario',
      onComplete: (clubs) => {
        console.log('Build from scratch complete:', clubs);
        // Clear existing and add all as new
        pendingSwaps = {};
        pendingAdds = clubs.map((club, i) => ({ ...club, tempId: 'new_' + i }));
        pendingRemovals.clear();
        renderScenarioClubList();
        showToast('New bag built! Click Run to analyze.', 'success');
      }
    });
  } else {
    showToast('Bag builder not available', 'error');
  }
}

/**
 * Add test winner to scenario (called from Testing tab)
 */
function addTestWinnerToScenario(testData) {
  // testData = { clubId, winningClub, performanceData }
  
  // Switch to Scenarios tab
  if (typeof showClientTab === 'function') {
    showClientTab('scenarios');
  }
  
  // Add as swap
  if (testData.clubId && testData.winningClub) {
    const originalClub = (window.currentClientClubs || []).find(c => c.id === testData.clubId);
    
    pendingSwaps[testData.clubId] = {
      original: originalClub,
      replacement: {
        ...testData.winningClub,
        fromTest: true,
        performanceData: testData.performanceData
      }
    };
    
    renderScenarioClubList();
    showToast('Test winner added to scenario', 'success');
  }
}

console.log('✅ Scenarios Phase 2 functions loaded');
