/**
 * Cloud Function: getReplacementSuggestion
 * 
 * Intelligently suggests whether to replace a single club or full set
 * based on club type and user preferences.
 * 
 * Input:
 * {
 *   userId: "user123",
 *   clubType: "7-iron",
 *   winningClubId: "club_p790_7iron"
 * }
 * 
 * Output:
 * {
 *   defaultOption: "set" | "single",
 *   showSetOption: true | false,
 *   confidence: "high" | "medium" | "low",
 *   message: "Explanation text...",
 *   setOptions: {
 *     currentRange: "5-PW",
 *     suggestedRange: "5-PW",
 *     clubsAffected: 6
 *   }
 * }
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Note: admin.initializeApp() is called in index.js already

exports.getReplacementSuggestion = functions.https.onCall(async (data, context) => {
  // Authentication check
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'User must be logged in to get replacement suggestions'
    );
  }

  const userId = context.auth.uid;
  const { clubType, winningClubId } = data;
  // Validation
  if (!clubType) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Missing required field: clubType'
    );
  }

  if (!winningClubId) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Missing required field: winningClubId'
    );
  }

  try {
    const db = admin.firestore();

    // Normalize club type for comparison
    const normalizedClubType = clubType.toLowerCase().trim();

    // Determine club category and recommendation logic
    const recommendation = determineReplacementStrategy(normalizedClubType);

    // If set replacement is possible, get current set info from user's bag
    if (recommendation.showSetOption) {
      const setInfo = await analyzeCurrentSet(db, userId, normalizedClubType);
      recommendation.setOptions = setInfo;
    }

    // Get winning club details for additional context
    const winningClubDoc = await db.collection('clubs').doc(winningClubId).get();
    if (winningClubDoc.exists) {
      const clubData = winningClubDoc.data();
      recommendation.winningClubBrand = clubData.identification?.brand || 'Unknown';
      recommendation.winningClubModel = clubData.identification?.model || 'Unknown';
    }

    return recommendation;

  } catch (error) {
    console.error('Error in getReplacementSuggestion:', error);
    throw new functions.https.HttpsError(
      'internal',
      `Failed to get replacement suggestion: ${error.message}`
    );
  }
});

/**
 * Determines replacement strategy based on club type
 */
function determineReplacementStrategy(clubType) {
  // Driver - always single, no set option
  if (clubType === 'driver') {
    return {
      defaultOption: 'single',
      showSetOption: false,
      confidence: 'high',
      message: 'Drivers are typically replaced individually. You have one driver in your bag.',
      setOptions: null
    };
  }

  // Putter - always single, no set option
  if (clubType === 'putter') {
    return {
      defaultOption: 'single',
      showSetOption: false,
      confidence: 'high',
      message: 'Putters are always replaced individually. You have one putter in your bag.',
      setOptions: null
    };
  }

  // Irons - default to set, show single as alternative
  if (isIron(clubType)) {
    return {
      defaultOption: 'set',
      showSetOption: true,
      confidence: 'high',
      message: 'Most golfers prefer matching iron sets for consistent feel and performance. You can also choose to replace just this single iron.',
      setOptions: {
        // Will be populated with actual data from analyzeCurrentSet
        currentRange: null,
        suggestedRange: null,
        clubsAffected: 0
      }
    };
  }

  // Wedges - default single, but show set option (balanced)
  if (isWedge(clubType)) {
    return {
      defaultOption: 'single',
      showSetOption: true,
      confidence: 'medium',
      message: 'Wedges can be replaced individually or as a set. Many golfers mix wedge brands, but matching wedges provide consistent spin and feel.',
      setOptions: {
        currentRange: null,
        suggestedRange: null,
        clubsAffected: 0
      }
    };
  }

  // Woods (3-wood, 5-wood, 7-wood) - default single, show set option
  if (isWood(clubType)) {
    return {
      defaultOption: 'single',
      showSetOption: true,
      confidence: 'medium',
      message: 'Fairway woods are often replaced individually, but matching woods provide consistent performance. Consider a set if you want matching technology.',
      setOptions: {
        currentRange: null,
        suggestedRange: null,
        clubsAffected: 0
      }
    };
  }

  // Hybrids - default single, show set option
  if (isHybrid(clubType)) {
    return {
      defaultOption: 'single',
      showSetOption: true,
      confidence: 'medium',
      message: 'Hybrids are typically replaced individually, but matching hybrids provide consistent gapping. Consider a set if you use multiple hybrids.',
      setOptions: {
        currentRange: null,
        suggestedRange: null,
        clubsAffected: 0
      }
    };
  }

  // Default fallback (shouldn't happen, but safe)
  return {
    defaultOption: 'single',
    showSetOption: false,
    confidence: 'low',
    message: 'Unable to determine optimal replacement strategy. Single club replacement recommended.',
    setOptions: null
  };
}

/**
 * Analyzes user's current bag to determine set range
 */
async function analyzeCurrentSet(db, userId, clubType) {
  try {
    // Get all active clubs of the same category
    const clubsSnapshot = await db.collection('clubs')
      .where('userId', '==', userId)
      .where('status', '==', 'active')
      .get();

    if (clubsSnapshot.empty) {
      return {
        currentRange: 'Unknown',
        suggestedRange: 'Unknown',
        clubsAffected: 0
      };
    }

    const clubs = [];
    clubsSnapshot.forEach(doc => {
      const data = doc.data();
      const type = data.identification?.clubType?.toLowerCase() || '';
      clubs.push({
        id: doc.id,
        type: type,
        ...data
      });
    });

    // Determine category and analyze
    if (isIron(clubType)) {
      return analyzeIronSet(clubs);
    } else if (isWedge(clubType)) {
      return analyzeWedgeSet(clubs);
    } else if (isWood(clubType)) {
      return analyzeWoodSet(clubs);
    } else if (isHybrid(clubType)) {
      return analyzeHybridSet(clubs);
    }

    return {
      currentRange: 'Unknown',
      suggestedRange: 'Unknown',
      clubsAffected: 0
    };

  } catch (error) {
    console.error('Error analyzing current set:', error);
    return {
      currentRange: 'Unknown',
      suggestedRange: 'Unknown',
      clubsAffected: 0
    };
  }
}

/**
 * Analyzes iron set in bag
 */
function analyzeIronSet(clubs) {
  const irons = clubs.filter(c => isIron(c.type));
  
  if (irons.length === 0) {
    return {
      currentRange: 'None',
      suggestedRange: '5-PW',
      clubsAffected: 6
    };
  }

  // Get range of irons
  const ironNumbers = irons.map(c => getIronNumber(c.type)).filter(n => n !== null);
  ironNumbers.sort((a, b) => a - b);

  const minIron = ironNumbers[0];
  const maxIron = ironNumbers[ironNumbers.length - 1];

  const currentRange = `${formatIronName(minIron)}-${formatIronName(maxIron)}`;
  const suggestedRange = currentRange; // Keep same range
  const clubsAffected = ironNumbers.length;

  return {
    currentRange,
    suggestedRange,
    clubsAffected
  };
}

/**
 * Analyzes wedge set in bag
 */
function analyzeWedgeSet(clubs) {
  const wedges = clubs.filter(c => isWedge(c.type));
  
  if (wedges.length === 0) {
    return {
      currentRange: 'None',
      suggestedRange: 'PW-LW',
      clubsAffected: 3
    };
  }

  const wedgeTypes = wedges.map(c => c.type).sort();
  const currentRange = `${wedgeTypes[0].toUpperCase()}-${wedgeTypes[wedgeTypes.length - 1].toUpperCase()}`;
  
  return {
    currentRange,
    suggestedRange: currentRange,
    clubsAffected: wedges.length
  };
}

/**
 * Analyzes wood set in bag
 */
function analyzeWoodSet(clubs) {
  const woods = clubs.filter(c => isWood(c.type));
  
  if (woods.length === 0) {
    return {
      currentRange: 'None',
      suggestedRange: '3W-5W',
      clubsAffected: 2
    };
  }

  const woodTypes = woods.map(c => c.type).sort();
  const currentRange = woodTypes.map(t => t.toUpperCase()).join(', ');
  
  return {
    currentRange,
    suggestedRange: currentRange,
    clubsAffected: woods.length
  };
}

/**
 * Analyzes hybrid set in bag
 */
function analyzeHybridSet(clubs) {
  const hybrids = clubs.filter(c => isHybrid(c.type));
  
  if (hybrids.length === 0) {
    return {
      currentRange: 'None',
      suggestedRange: '3H-4H',
      clubsAffected: 2
    };
  }

  const hybridTypes = hybrids.map(c => c.type).sort();
  const currentRange = hybridTypes.map(t => t.toUpperCase()).join(', ');
  
  return {
    currentRange,
    suggestedRange: currentRange,
    clubsAffected: hybrids.length
  };
}

// ============================================
// HELPER FUNCTIONS - Club Type Detection
// ============================================

function isIron(clubType) {
  const ironPattern = /^[2-9]-?iron$/i;
  return ironPattern.test(clubType);
}

function isWedge(clubType) {
  const wedges = ['pw', 'pitching-wedge', 'gw', 'gap-wedge', 'aw', 'approach-wedge', 
                  'sw', 'sand-wedge', 'lw', 'lob-wedge'];
  return wedges.includes(clubType.toLowerCase().replace(/\s+/g, '-'));
}

function isWood(clubType) {
  const woodPattern = /^[3-9]-?wood$/i;
  return woodPattern.test(clubType);
}

function isHybrid(clubType) {
  const hybridPattern = /^[2-9]-?hybrid$/i;
  return hybridPattern.test(clubType);
}

function getIronNumber(clubType) {
  const match = clubType.match(/^([2-9])-?iron$/i);
  return match ? parseInt(match[1]) : null;
}

function formatIronName(ironNumber) {
  if (ironNumber === 10) return 'PW';
  return `${ironNumber}`;
}
