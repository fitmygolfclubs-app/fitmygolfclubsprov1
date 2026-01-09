/**
 * GHIN Integration Cloud Functions
 * FitMyGolfClubs - Phase 2
 * 
 * UPDATED: Using service account auth (single login for all lookups)
 * 
 * Functions:
 * 1. validateGhinAccount - Link user to their GHIN
 * 2. syncGhinData - Refresh handicap data on-demand
 * 3. scheduledGhinSync - Daily auto-refresh all linked users
 * 4. calculateBagChangeImpact - Correlate equipment changes with handicap
 * 5. getHandicapTimeline - Get combined timeline for UI
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const fetch = require('node-fetch');

// Initialize if not already done
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// =============================================================================
// GHIN API CONFIGURATION
// =============================================================================

const GHIN_API = {
  LOGIN_URL: 'https://api2.ghin.com/api/v1/golfer_login.json',
  SEARCH_URL: 'https://api.ghin.com/api/v1/golfers/search.json',
  GOLFER_URL: 'https://api.ghin.com/api/v1/golfers',
};

// Service account credentials - stored in Firebase environment config
// Set with: firebase functions:config:set ghin.email="xxx" ghin.password="xxx"
const getGhinCredentials = () => {
  const config = functions.config();
  return {
    email: config.ghin?.email || process.env.GHIN_EMAIL,
    password: config.ghin?.password || process.env.GHIN_PASSWORD,
  };
};

// Token cache (refreshed when expired)
let cachedToken = null;
let tokenExpiry = null;

// =============================================================================
// AUTHENTICATION
// =============================================================================

/**
 * Get a valid auth token (from cache or fresh login)
 */
async function getAuthToken() {
  // Return cached token if still valid (tokens last ~24 hours, refresh at 12)
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    return cachedToken;
  }
  
  const credentials = getGhinCredentials();
  
  if (!credentials.email || !credentials.password) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'GHIN service credentials not configured'
    );
  }
  
  console.log('Authenticating with GHIN API...');
  
  const response = await fetch(GHIN_API.LOGIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      user: {
        email_or_ghin: credentials.email,
        password: credentials.password,
        remember_me: true
      },
      token: 'nonblank'
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error('GHIN auth failed:', response.status, error);
    throw new functions.https.HttpsError('internal', 'GHIN authentication failed');
  }
  
  const data = await response.json();
  
  if (!data.golfer_user?.golfer_user_token) {
    console.error('No token in GHIN response');
    throw new functions.https.HttpsError('internal', 'Failed to get GHIN token');
  }
  
  cachedToken = data.golfer_user.golfer_user_token;
  tokenExpiry = Date.now() + (12 * 60 * 60 * 1000); // 12 hours
  
  console.log('GHIN authentication successful');
  return cachedToken;
}

// =============================================================================
// API HELPERS
// =============================================================================

/**
 * Search for golfers by name and state
 */
async function searchGolfers(lastName, state, firstName = null) {
  const token = await getAuthToken();
  
  let url = `${GHIN_API.SEARCH_URL}?last_name=${encodeURIComponent(lastName)}&per_page=20&page=1`;
  
  if (state) {
    url += `&state=${encodeURIComponent(state)}`;
  }
  if (firstName) {
    url += `&first_name=${encodeURIComponent(firstName)}`;
  }
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    }
  });
  
  if (!response.ok) {
    console.error('GHIN search failed:', response.status);
    return [];
  }
  
  const data = await response.json();
  return data.golfers || [];
}

/**
 * Get golfer by GHIN number
 */
async function getGolferByGhin(ghinNumber) {
  const token = await getAuthToken();
  
  const url = `${GHIN_API.SEARCH_URL}?per_page=1&page=1&golfer_id=${ghinNumber}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    }
  });
  
  if (!response.ok) {
    console.error('GHIN lookup failed:', response.status);
    return null;
  }
  
  const data = await response.json();
  return data.golfers?.[0] || null;
}

/**
 * Get handicap revision history
 */
async function getHandicapHistory(ghinNumber, revCount = 20) {
  const token = await getAuthToken();
  
  const url = `${GHIN_API.GOLFER_URL}/${ghinNumber}/handicap_history_count.json?rev_count=${revCount}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    }
  });
  
  if (!response.ok) {
    console.error('GHIN history failed:', response.status);
    return [];
  }
  
  const data = await response.json();
  return data.handicap_revisions || [];
}

/**
 * Get recent scores
 */
async function getRecentScores(ghinNumber, limit = 20) {
  const token = await getAuthToken();
  
  const url = `${GHIN_API.GOLFER_URL}/${ghinNumber}/scores.json?per_page=${limit}&page=1`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    }
  });
  
  if (!response.ok) {
    console.error('GHIN scores failed:', response.status);
    return [];
  }
  
  const data = await response.json();
  return data.scores || [];
}

/**
 * Calculate trend from handicap history
 */
function calculateTrend(history) {
  if (!history || history.length < 2) return 'stable';
  
  // History is most recent first
  const recent = parseFloat(history[0]?.Value || 0);
  const older = parseFloat(history[Math.min(4, history.length - 1)]?.Value || 0);
  
  const diff = recent - older;
  
  if (diff < -0.5) return 'improving';
  if (diff > 0.5) return 'declining';
  return 'stable';
}

/**
 * Find handicap index at a specific date
 */
function findIndexAtDate(history, targetDate) {
  const target = new Date(targetDate);
  
  for (const rev of history) {
    const revDate = new Date(rev.RevisionDate);
    if (revDate <= target) {
      return parseFloat(rev.Value);
    }
  }
  
  return history.length > 0 ? parseFloat(history[history.length - 1]?.Value) : null;
}

// =============================================================================
// CLOUD FUNCTIONS
// =============================================================================

/**
 * searchGhinGolfers
 * 
 * Search for golfers to help user find their GHIN
 * 
 * @param {string} lastName - Required
 * @param {string} state - Optional (2-letter code)
 * @param {string} firstName - Optional
 * @returns {array} List of matching golfers
 */
exports.searchGhinGolfers = functions.https.onCall(async (data, context) => {
  // Verify authenticated
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
  }
  
  const { lastName, state, firstName } = data;
  
  if (!lastName || lastName.length < 2) {
    throw new functions.https.HttpsError('invalid-argument', 'Last name required (min 2 chars)');
  }
  
  try {
    const golfers = await searchGolfers(lastName, state, firstName);
    
    // Return sanitized list
    return golfers.map(g => ({
      id: g.id,
      firstName: g.first_name,
      lastName: g.last_name,
      handicapIndex: g.handicap_index,
      clubName: g.club_name,
      state: g.state,
      association: g.association_name,
    }));
    
  } catch (error) {
    console.error('searchGhinGolfers error:', error);
    throw new functions.https.HttpsError('internal', 'Failed to search GHIN');
  }
});


/**
 * lookupGhinNumber
 * 
 * Simple GHIN lookup by number - returns name and handicap
 * Used in client onboarding to verify GHIN before saving
 * 
 * @param {string} ghinNumber - 7-8 digit GHIN number
 * @returns {object} { name, handicap, club, state } or null if not found
 */
exports.lookupGhinNumber = functions.https.onCall(async (data, context) => {
  // Note: Not requiring auth for simple lookup during onboarding
  // The pro is authenticated, just doing a quick verification
  
  const { ghinNumber } = data;
  
  if (!ghinNumber) {
    throw new functions.https.HttpsError('invalid-argument', 'GHIN number required');
  }
  
  // Clean GHIN number (remove non-digits)
  const cleanGhin = ghinNumber.toString().replace(/\D/g, '');
  
  if (cleanGhin.length < 7 || cleanGhin.length > 8) {
    throw new functions.https.HttpsError('invalid-argument', 'GHIN must be 7-8 digits');
  }
  
  console.log(`Looking up GHIN: ${cleanGhin}`);
  
  try {
    const golfer = await getGolferByGhin(cleanGhin);
    
    if (!golfer) {
      return null; // Not found
    }
    
    return {
      name: `${golfer.first_name} ${golfer.last_name}`.trim(),
      handicap: golfer.handicap_index,
      club: golfer.club_name || null,
      state: golfer.state || null,
      ghinNumber: cleanGhin,
    };
    
  } catch (error) {
    console.error('lookupGhinNumber error:', error);
    throw new functions.https.HttpsError('internal', 'Failed to lookup GHIN');
  }
});


/**
 * linkGhinAccount
 * 
 * Links a user to their GHIN account
 * 
 * @param {string} ghinNumber - User's GHIN number (from search results or direct entry)
 * @returns {object} { success, currentIndex, trend, historyCount }
 */
exports.linkGhinAccount = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
  }
  
  const userId = context.auth.uid;
  const { ghinNumber } = data;
  
  if (!ghinNumber) {
    throw new functions.https.HttpsError('invalid-argument', 'GHIN number required');
  }
  
  // Clean GHIN number
  const cleanGhin = ghinNumber.toString().replace(/\D/g, '');
  
  console.log(`Linking GHIN ${cleanGhin} to user ${userId}`);
  
  try {
    // Fetch golfer data
    const golfer = await getGolferByGhin(cleanGhin);
    
    if (!golfer) {
      throw new functions.https.HttpsError('not-found', 'GHIN number not found');
    }
    
    // Fetch handicap history
    const history = await getHandicapHistory(cleanGhin, 24);
    
    const currentIndex = golfer.handicap_index || (history[0]?.Value) || null;
    const trend = calculateTrend(history);
    
    // Find low index from history
    const lowIndex = history.length > 0
      ? Math.min(...history.map(h => parseFloat(h.Value)).filter(v => !isNaN(v)))
      : currentIndex;
    
    // Save to ghinData collection
    const ghinDoc = {
      user_id: userId,
      ghin_number: cleanGhin,
      
      // Golfer info
      golfer_name: `${golfer.first_name} ${golfer.last_name}`,
      home_club: golfer.club_name || null,
      association: golfer.association_name || null,
      state: golfer.state || null,
      
      // Current status
      current_index: currentIndex ? parseFloat(currentIndex) : null,
      low_index: lowIndex ? parseFloat(lowIndex) : null,
      trend: trend,
      
      // History
      handicap_history: history.map(rev => ({
        date: rev.RevisionDate,
        index: parseFloat(rev.Value),
      })),
      
      // Bag change impacts (calculated later)
      bag_change_impacts: [],
      
      // Sync metadata
      last_sync: admin.firestore.FieldValue.serverTimestamp(),
      linked_at: admin.firestore.FieldValue.serverTimestamp(),
      sync_status: 'success',
    };
    
    await db.doc(`ghinData/${userId}`).set(ghinDoc, { merge: true });
    
    // Update user document
    await db.doc(`users/${userId}`).update({
      'ghin_info.ghin_number': cleanGhin,
      'ghin_info.linked_at': admin.firestore.FieldValue.serverTimestamp(),
      'ghin_info.last_sync': admin.firestore.FieldValue.serverTimestamp(),
      'ghin_info.current_index': currentIndex ? parseFloat(currentIndex) : null,
      'ghin_info.home_club': golfer.club_name || null,
    });
    
    console.log(`GHIN ${cleanGhin} linked to user ${userId}`);
    
    return {
      success: true,
      golferName: `${golfer.first_name} ${golfer.last_name}`,
      currentIndex: currentIndex ? parseFloat(currentIndex) : null,
      lowIndex: lowIndex ? parseFloat(lowIndex) : null,
      trend: trend,
      homeClub: golfer.club_name || null,
      historyCount: history.length,
    };
    
  } catch (error) {
    console.error('linkGhinAccount error:', error);
    
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError('internal', 'Failed to link GHIN account');
  }
});


/**
 * syncGhinData
 * 
 * Refreshes GHIN data for current user
 */
exports.syncGhinData = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
  }
  
  const userId = context.auth.uid;
  
  // Get existing GHIN link
  const ghinDoc = await db.doc(`ghinData/${userId}`).get();
  
  if (!ghinDoc.exists || !ghinDoc.data().ghin_number) {
    throw new functions.https.HttpsError('failed-precondition', 'No GHIN account linked');
  }
  
  const ghinNumber = ghinDoc.data().ghin_number;
  
  try {
    // Fetch fresh data
    const golfer = await getGolferByGhin(ghinNumber);
    const history = await getHandicapHistory(ghinNumber, 24);
    
    const currentIndex = golfer?.handicap_index || (history[0]?.Value) || null;
    const trend = calculateTrend(history);
    
    // Update documents
    await db.doc(`ghinData/${userId}`).update({
      current_index: currentIndex ? parseFloat(currentIndex) : null,
      trend: trend,
      handicap_history: history.map(rev => ({
        date: rev.RevisionDate,
        index: parseFloat(rev.Value),
      })),
      last_sync: admin.firestore.FieldValue.serverTimestamp(),
      sync_status: 'success',
    });
    
    await db.doc(`users/${userId}`).update({
      'ghin_info.last_sync': admin.firestore.FieldValue.serverTimestamp(),
      'ghin_info.current_index': currentIndex ? parseFloat(currentIndex) : null,
    });
    
    return {
      success: true,
      currentIndex: currentIndex ? parseFloat(currentIndex) : null,
      trend: trend,
    };
    
  } catch (error) {
    console.error('syncGhinData error:', error);
    
    await db.doc(`ghinData/${userId}`).update({
      last_sync: admin.firestore.FieldValue.serverTimestamp(),
      sync_status: 'failed',
      sync_error: error.message,
    });
    
    throw new functions.https.HttpsError('internal', 'Failed to sync GHIN data');
  }
});


/**
 * Scheduled GHIN sync - runs daily at 6 AM EST
 */
exports.scheduledGhinSync = functions.pubsub
  .schedule('0 6 * * *')
  .timeZone('America/New_York')
  .onRun(async (context) => {
    console.log('Starting scheduled GHIN sync');
    
    const ghinDocs = await db.collection('ghinData')
      .where('sync_status', '==', 'success')
      .get();
    
    console.log(`Found ${ghinDocs.size} users with GHIN linked`);
    
    let successCount = 0;
    let failCount = 0;
    
    for (const doc of ghinDocs.docs) {
      const ghinData = doc.data();
      const userId = doc.id;
      
      try {
        const history = await getHandicapHistory(ghinData.ghin_number, 24);
        const currentIndex = history[0]?.Value || null;
        const trend = calculateTrend(history);
        
        await db.doc(`ghinData/${userId}`).update({
          current_index: currentIndex ? parseFloat(currentIndex) : null,
          trend: trend,
          handicap_history: history.map(rev => ({
            date: rev.RevisionDate,
            index: parseFloat(rev.Value),
          })),
          last_sync: admin.firestore.FieldValue.serverTimestamp(),
          sync_status: 'success',
        });
        
        await db.doc(`users/${userId}`).update({
          'ghin_info.last_sync': admin.firestore.FieldValue.serverTimestamp(),
          'ghin_info.current_index': currentIndex ? parseFloat(currentIndex) : null,
        });
        
        successCount++;
        
        // Rate limiting - 500ms between requests
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`Sync failed for user ${userId}:`, error.message);
        
        await db.doc(`ghinData/${userId}`).update({
          last_sync: admin.firestore.FieldValue.serverTimestamp(),
          sync_status: 'failed',
          sync_error: error.message,
        });
        
        failCount++;
      }
    }
    
    console.log(`GHIN sync complete: ${successCount} success, ${failCount} failed`);
    return null;
  });


/**
 * calculateBagChangeImpact
 * 
 * Triggered when a club is added/replaced
 * Calculates handicap correlation after settling period
 */
exports.calculateBagChangeImpact = functions.firestore
  .document('clubs/{clubId}')
  .onWrite(async (change, context) => {
    if (!change.after.exists) return null;
    
    const club = change.after.data();
    const previousClub = change.before.exists ? change.before.data() : null;
    
    // Skip if not a new/changed club
    if (previousClub && 
        previousClub.make === club.make && 
        previousClub.model === club.model) {
      return null;
    }
    
    const userId = club.user_id;
    if (!userId) return null;
    
    // Get GHIN data
    const ghinDoc = await db.doc(`ghinData/${userId}`).get();
    if (!ghinDoc.exists) return null;
    
    const ghinData = ghinDoc.data();
    const history = ghinData.handicap_history || [];
    
    if (history.length < 3) return null;
    
    const changeDate = club.created_at?.toDate() || new Date();
    
    // Check if enough time has passed (6 weeks)
    const sixWeeksLater = new Date(changeDate);
    sixWeeksLater.setDate(sixWeeksLater.getDate() + 42);
    
    if (new Date() < sixWeeksLater) {
      console.log('Not enough time for impact calculation');
      return null;
    }
    
    // Calculate before/after indexes
    const beforeDate = new Date(changeDate);
    beforeDate.setDate(beforeDate.getDate() - 7);
    
    const beforeIndex = findIndexAtDate(history, beforeDate);
    const settledIndex = findIndexAtDate(history, sixWeeksLater);
    
    if (beforeIndex === null || settledIndex === null) return null;
    
    // Find peak during adjustment (worst score in first 4 weeks)
    const fourWeeksLater = new Date(changeDate);
    fourWeeksLater.setDate(fourWeeksLater.getDate() + 28);
    
    const adjustmentRevisions = history.filter(rev => {
      const revDate = new Date(rev.date);
      return revDate >= changeDate && revDate <= fourWeeksLater;
    });
    
    const peakIndex = adjustmentRevisions.length > 0
      ? Math.max(...adjustmentRevisions.map(r => r.index))
      : beforeIndex;
    
    const netImprovement = beforeIndex - settledIndex;
    
    const impactRecord = {
      change_date: changeDate.toISOString().split('T')[0],
      club_type: club.club_type,
      club_id: context.params.clubId,
      old_club: previousClub ? `${previousClub.make} ${previousClub.model}` : null,
      new_club: `${club.make} ${club.model}`,
      before_index: Math.round(beforeIndex * 10) / 10,
      peak_index: Math.round(peakIndex * 10) / 10,
      settled_index: Math.round(settledIndex * 10) / 10,
      net_improvement: Math.round(netImprovement * 10) / 10,
      calculated_at: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    console.log(`Bag change impact for ${userId}:`, impactRecord);
    
    await db.doc(`ghinData/${userId}`).update({
      bag_change_impacts: admin.firestore.FieldValue.arrayUnion(impactRecord),
    });
    
    return null;
  });


/**
 * getHandicapTimeline
 * 
 * Returns combined timeline of handicap + equipment + lessons
 */
exports.getHandicapTimeline = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
  }
  
  const userId = data.userId || context.auth.uid;
  
  // Security: only allow viewing own data or pro viewing client
  if (userId !== context.auth.uid) {
    const requestingUser = await db.doc(`users/${context.auth.uid}`).get();
    const targetUser = await db.doc(`users/${userId}`).get();
    
    if (!requestingUser.exists || 
        requestingUser.data().account_type !== 'professional' ||
        targetUser.data()?.pro_managed_info?.pro_user_id !== context.auth.uid) {
      throw new functions.https.HttpsError('permission-denied', 'Cannot view this data');
    }
  }
  
  const ghinDoc = await db.doc(`ghinData/${userId}`).get();
  if (!ghinDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'No GHIN data found');
  }
  
  const ghinData = ghinDoc.data();
  
  // Get bag changes
  const clubsSnapshot = await db.collection('clubs')
    .where('user_id', '==', userId)
    .orderBy('created_at', 'desc')
    .limit(20)
    .get();
  
  const bagChanges = clubsSnapshot.docs.map(doc => ({
    type: 'equipment',
    date: doc.data().created_at?.toDate()?.toISOString()?.split('T')[0],
    clubType: doc.data().club_type,
    description: `New ${doc.data().club_type}: ${doc.data().make} ${doc.data().model}`,
  }));
  
  // Get lessons (Phase 3)
  const lessonsSnapshot = await db.collection('lessons')
    .where('client_user_id', '==', userId)
    .orderBy('lesson_date', 'desc')
    .limit(20)
    .get();
  
  const lessons = lessonsSnapshot.docs.map(doc => ({
    type: 'lesson',
    date: doc.data().lesson_date?.toDate()?.toISOString()?.split('T')[0],
    lessonType: doc.data().lesson_type,
    description: `${doc.data().lesson_type} with ${doc.data().instructor_name}`,
  }));
  
  // Combine and sort
  const allEvents = [...bagChanges, ...lessons]
    .filter(e => e.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  
  return {
    currentIndex: ghinData.current_index,
    lowIndex: ghinData.low_index,
    trend: ghinData.trend,
    homeClub: ghinData.home_club,
    handicapHistory: ghinData.handicap_history || [],
    bagChangeImpacts: ghinData.bag_change_impacts || [],
    timeline: allEvents.slice(0, 50),
    lastSync: ghinData.last_sync?.toDate()?.toISOString(),
  };
});
