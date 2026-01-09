/**
 * Cloud Function: updateBagAfterTest
 * 
 * Executes bag changes after a performance testing session.
 * This function:
 * 1. Archives old clubs (moves to archivedClubs subcollection)
 * 2. Adds new clubs (single or full set)
 * 3. Triggers bag regrading
 * 4. Logs change to bagChangeHistory
 * 5. Returns new grade and metadata
 * 
 * Input:
 * {
 *   userId: "user_xyz",
 *   sessionId: "session_123",
 *   winningClubId: "club_p790_7iron",
 *   losingClubId: "club_ap2_7iron",
 *   replacementType: "set_replacement" | "single_club",
 *   setConfig: {  // Only for set replacements
 *     setType: "irons",
 *     startClub: "5-iron",
 *     endClub: "pitching-wedge",
 *     brand: "TaylorMade",
 *     model: "P790",
 *     year: 2023
 *   }
 * }
 * 
 * Output:
 * {
 *   success: true,
 *   newGrade: { overallScore: 94, letterGrade: "A", ... },
 *   changeId: "change_abc123",
 *   clubsAdded: 6,
 *   clubsRemoved: 6,
 *   improvement: 7
 * }
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');

// Note: admin.initializeApp() is called in index.js

exports.updateBagAfterTest = functions.https.onCall(async (data, context) => {
  // 1. Authentication check
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'User must be logged in to update bag'
    );
  }

  const userId = context.auth.uid;
  const db = admin.firestore();

  // 2. Validate required fields
  const { sessionId, winningClubId, losingClubId, replacementType, setConfig } = data;

  if (!sessionId || !winningClubId || !losingClubId || !replacementType) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Missing required fields: sessionId, winningClubId, losingClubId, replacementType'
    );
  }

  if (replacementType === 'set_replacement' && !setConfig) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'setConfig required for set replacements'
    );
  }

  try {
    // 3. Get current bag state and grade BEFORE changes
    console.log('Getting current bag state...');
    const currentBagSnapshot = await db.collection('clubs')
      .where('userId', '==', userId)
      .where('status', '==', 'active')
      .get();

    const currentClubs = [];
    currentBagSnapshot.forEach(doc => {
      currentClubs.push({ id: doc.id, ...doc.data() });
    });

    // Get current grade by calling gradeUserBag
    const currentGradeResponse = await callGradeUserBag(userId);
    const currentBagGrade = currentGradeResponse;

    console.log(`Current bag grade: ${currentBagGrade.letterGrade} (${currentBagGrade.overallScore})`);

    // 4. Check if trying to remove favorite club
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();
    const favoriteClubId = userData?.preferences?.favoriteClubId;

    if (favoriteClubId === losingClubId) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Cannot remove your favorite club. Please select a new favorite first.'
      );
    }

    // 5. Determine which clubs to remove and add
    let clubsToRemove = [];
    let clubsToAdd = [];

    if (replacementType === 'single_club') {
      // Single club replacement
      clubsToRemove = [losingClubId];
      
      // Get winning club data to clone
      const winningClubDoc = await db.collection('clubs').doc(winningClubId).get();
      if (!winningClubDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Winning club not found');
      }
      
      clubsToAdd = [winningClubDoc.data()];
      
    } else if (replacementType === 'set_replacement') {
      // Set replacement - need to determine full set
      clubsToRemove = await determineSetToRemove(db, userId, setConfig, losingClubId);
      clubsToAdd = await generateSetClubs(setConfig, winningClubId, db);
    }

    console.log(`Removing ${clubsToRemove.length} clubs, adding ${clubsToAdd.length} clubs`);

    // 6. Archive clubs being removed (move to archivedClubs)
    for (const clubId of clubsToRemove) {
      const clubDoc = await db.collection('clubs').doc(clubId).get();
      if (clubDoc.exists) {
        const clubData = clubDoc.data();
        
        // Calculate time in bag
        const addedAt = clubData.addedToBagAt || clubData.createdAt;
        const timeInBag = calculateTimeInBag(addedAt);
        
        // Create archived club document
        await db.collection('users').doc(userId)
          .collection('archivedClubs').doc(clubId).set({
            ...clubData,
            archivedAt: admin.firestore.FieldValue.serverTimestamp(),
            archivedReason: 'replaced_in_testing',
            replacedBy: winningClubId,
            changeHistoryId: null, // Will update after creating history doc
            finalGrade: clubData.finalGrade || null,
            timeInBag: timeInBag,
            canRestore: true
          });

        // Update original club status to archived
        await db.collection('clubs').doc(clubId).update({
          status: 'archived',
          archivedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }

    console.log('Clubs archived successfully');

    // 7. Add new clubs to bag
    const addedClubIds = [];
    for (const newClubData of clubsToAdd) {
      const newClubRef = await db.collection('clubs').add({
        userId: userId,
        ...newClubData,
        status: 'active',
        addedToBagAt: admin.firestore.FieldValue.serverTimestamp(),
        source: 'performance_test',
        testSessionId: sessionId,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      addedClubIds.push(newClubRef.id);
    }

    console.log(`Added ${addedClubIds.length} new clubs`);

    // 8. Trigger bag re-grade
    console.log('Triggering bag regrade...');
    const newBagGrade = await callGradeUserBag(userId);
    console.log(`New bag grade: ${newBagGrade.letterGrade} (${newBagGrade.overallScore})`);

    // 9. Create change history document
    const changeId = `change_${Date.now()}`;
    const undoExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Get club summaries for history
    const removedClubSummaries = await Promise.all(
      clubsToRemove.map(async (clubId) => {
        const archivedDoc = await db.collection('users').doc(userId)
          .collection('archivedClubs').doc(clubId).get();
        if (archivedDoc.exists) {
          const data = archivedDoc.data();
          return {
            clubId: clubId,
            brand: data.identification?.brand || data.brand,
            model: data.identification?.model || data.model,
            type: data.identification?.clubType || data.club_type,
            year: data.identification?.year || data.year_purchased,
            finalGrade: data.finalGrade,
            timeInBag: data.timeInBag
          };
        }
        return null;
      })
    );

    const addedClubSummaries = clubsToAdd.map((club, index) => ({
      clubId: addedClubIds[index],
      brand: club.identification?.brand || club.brand,
      model: club.identification?.model || club.model,
      type: club.identification?.clubType || club.club_type,
      year: club.identification?.year || club.year_purchased,
      finalGrade: null // Will be updated after first grading
    }));

    // Calculate category impacts
    const categoryImpacts = calculateCategoryImpacts(currentBagGrade, newBagGrade);

    // Create history document
    await db.collection('users').doc(userId)
      .collection('bagChangeHistory').doc(changeId).set({
        changeId: changeId,
        userId: userId,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        changeType: replacementType === 'set_replacement' ? 'set_replacement' : 'single_replacement',
        triggeredBy: 'performance_test',
        testSessionId: sessionId,
        isSetReplacement: (replacementType === 'set_replacement'),
        setType: setConfig?.setType || null,
        clubsAdded: addedClubSummaries,
        clubsRemoved: removedClubSummaries.filter(c => c !== null),
        gradeImpact: {
          beforeBagGrade: currentBagGrade.overallScore,
          afterBagGrade: newBagGrade.overallScore,
          improvement: newBagGrade.overallScore - currentBagGrade.overallScore,
          beforeLetterGrade: currentBagGrade.letterGrade,
          afterLetterGrade: newBagGrade.letterGrade,
          categoryImpacts: categoryImpacts
        },
        userChoice: replacementType,
        canUndo: true,
        undoExpiresAt: admin.firestore.Timestamp.fromDate(undoExpiresAt),
        undone: false,
        undoneAt: null
      });

    // Update archived clubs with changeHistoryId
    for (const clubId of clubsToRemove) {
      await db.collection('users').doc(userId)
        .collection('archivedClubs').doc(clubId).update({
          changeHistoryId: changeId
        });
    }

    console.log(`Change history created: ${changeId}`);

    // 10. Return results
    return {
      success: true,
      newGrade: newBagGrade,
      changeId: changeId,
      clubsAdded: clubsToAdd.length,
      clubsRemoved: clubsToRemove.length,
      improvement: newBagGrade.overallScore - currentBagGrade.overallScore,
      improvementLetter: `${currentBagGrade.letterGrade} → ${newBagGrade.letterGrade}`
    };

  } catch (error) {
    console.error('Error in updateBagAfterTest:', error);
    throw new functions.https.HttpsError(
      'internal',
      `Failed to update bag: ${error.message}`
    );
  }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Calls the gradeUserBag function to get bag analysis
 */
async function callGradeUserBag(userId) {
  try {
    // Call the existing gradeUserBag Cloud Function
    const FUNCTION_URL = 'https://gradeuserbag-o4ujhnliya-uc.a.run.app';
    
    const response = await axios.post(FUNCTION_URL, {
      userId: userId
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    return response.data;
  } catch (error) {
    console.error('Error calling gradeUserBag:', error);
    throw new Error('Failed to grade bag');
  }
}

/**
 * Calculate time a club has been in the bag
 */
function calculateTimeInBag(addedDate) {
  if (!addedDate) return 'Unknown';
  
  const now = new Date();
  const added = addedDate.toDate ? addedDate.toDate() : new Date(addedDate);
  const diffTime = Math.abs(now - added);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  const months = Math.floor(diffDays / 30);
  const days = diffDays % 30;
  
  if (months === 0) {
    return `${days} days`;
  }
  return `${months} months ${days} days`;
}

/**
 * Calculate category-level impacts between two bag grades
 */
function calculateCategoryImpacts(beforeGrade, afterGrade) {
  const categories = [
    'age',
    'weightProgression',
    'loftGapping',
    'flexConsistency',
    'kickpointConsistency',
    'torqueConsistency',
    'lengthProgression',
    'lieAngleProgression'
  ];
  
  const impacts = {};
  
  for (const category of categories) {
    const beforeScore = beforeGrade.componentScores?.[category] || beforeGrade[category] || 0;
    const afterScore = afterGrade.componentScores?.[category] || afterGrade[category] || 0;
    
    impacts[category] = {
      before: beforeScore,
      after: afterScore,
      change: afterScore - beforeScore
    };
  }
  
  return impacts;
}

/**
 * Determine which clubs in a set should be removed
 */
async function determineSetToRemove(db, userId, setConfig, losingClubId) {
  const clubsToRemove = [];
  
  // Get the losing club to understand the set
  const losingClubDoc = await db.collection('clubs').doc(losingClubId).get();
  if (!losingClubDoc.exists) {
    throw new Error('Losing club not found');
  }
  
  const losingClubData = losingClubDoc.data();
  const losingClubType = losingClubData.identification?.clubType || losingClubData.club_type;
  
  if (setConfig.setType === 'irons') {
    // For irons, remove all irons in the specified range
    const startNum = getIronNumber(setConfig.startClub);
    const endNum = getIronNumber(setConfig.endClub);
    
    // Get all user's clubs
    const userClubsSnapshot = await db.collection('clubs')
      .where('userId', '==', userId)
      .where('status', '==', 'active')
      .get();
    
    userClubsSnapshot.forEach(doc => {
      const clubData = doc.data();
      const clubType = clubData.identification?.clubType || clubData.club_type;
      const ironNum = getIronNumber(clubType);
      
      if (ironNum && ironNum >= startNum && ironNum <= endNum) {
        clubsToRemove.push(doc.id);
      }
    });
    
  } else if (setConfig.setType === 'wedges') {
    // For wedges, remove all wedges
    const userClubsSnapshot = await db.collection('clubs')
      .where('userId', '==', userId)
      .where('status', '==', 'active')
      .get();
    
    userClubsSnapshot.forEach(doc => {
      const clubData = doc.data();
      const clubType = clubData.identification?.clubType || clubData.club_type;
      
      if (isWedge(clubType)) {
        clubsToRemove.push(doc.id);
      }
    });
    
  } else if (setConfig.setType === 'woods') {
    // For woods, remove all woods
    const userClubsSnapshot = await db.collection('clubs')
      .where('userId', '==', userId)
      .where('status', '==', 'active')
      .get();
    
    userClubsSnapshot.forEach(doc => {
      const clubData = doc.data();
      const clubType = clubData.identification?.clubType || clubData.club_type;
      
      if (isWood(clubType)) {
        clubsToRemove.push(doc.id);
      }
    });
  }
  
  return clubsToRemove;
}

/**
 * Generate club data for a full set
 */
async function generateSetClubs(setConfig, winningClubId, db) {
  const generatedClubs = [];
  
  // Get winning club as template
  const winningClubDoc = await db.collection('clubs').doc(winningClubId).get();
  if (!winningClubDoc.exists) {
    throw new Error('Winning club not found');
  }
  
  const templateClub = winningClubDoc.data();
  
  if (setConfig.setType === 'irons') {
    // Generate iron set
    const startNum = getIronNumber(setConfig.startClub);
    const endNum = getIronNumber(setConfig.endClub);
    
    for (let ironNum = startNum; ironNum <= endNum; ironNum++) {
      const clubType = formatIronName(ironNum);
      const specs = getStandardIronSpecs(ironNum);
      
      generatedClubs.push({
        identification: {
          clubType: clubType,
          brand: setConfig.brand,
          model: setConfig.model,
          year: setConfig.year,
          aiConfidence: 1.0,
          userConfirmed: true
        },
        loft: specs.loft,
        lie: specs.lie,
        length: specs.length,
        shaft_weight: specs.shaftWeight,
        shaft_flex: templateClub.shaft_flex || 'R',
        shaft_brand: templateClub.shaft_brand || setConfig.brand,
        shaft_model: templateClub.shaft_model || 'Stock',
        shaft_kickpoint: templateClub.shaft_kickpoint || 'mid',
        shaft_torque: templateClub.shaft_torque || 3.5,
        club_type: clubType,
        brand: setConfig.brand,
        model: setConfig.model,
        year_purchased: setConfig.year
      });
    }
    
  } else if (setConfig.setType === 'wedges') {
    // Generate wedge set (PW, GW, SW, LW)
    const wedgeTypes = [
      { type: 'pw', loft: 46, lie: 64 },
      { type: 'gw', loft: 50, lie: 64 },
      { type: 'sw', loft: 54, lie: 64 },
      { type: 'lw', loft: 58, lie: 64 }
    ];
    
    for (const wedge of wedgeTypes) {
      generatedClubs.push({
        identification: {
          clubType: wedge.type,
          brand: setConfig.brand,
          model: setConfig.model,
          year: setConfig.year,
          aiConfidence: 1.0,
          userConfirmed: true
        },
        loft: wedge.loft,
        lie: wedge.lie,
        length: 35.5,
        shaft_weight: 120,
        shaft_flex: templateClub.shaft_flex || 'W',
        shaft_brand: templateClub.shaft_brand || setConfig.brand,
        shaft_model: templateClub.shaft_model || 'Stock',
        club_type: wedge.type,
        brand: setConfig.brand,
        model: setConfig.model,
        year_purchased: setConfig.year
      });
    }
  }
  
  return generatedClubs;
}

/**
 * Get standard specifications for an iron
 */
function getStandardIronSpecs(ironNumber) {
  const specs = {
    4: { loft: 24, lie: 61, length: 38.5, shaftWeight: 110 },
    5: { loft: 27, lie: 61.5, length: 38.0, shaftWeight: 115 },
    6: { loft: 30, lie: 62, length: 37.5, shaftWeight: 115 },
    7: { loft: 34, lie: 62.5, length: 37.0, shaftWeight: 120 },
    8: { loft: 38, lie: 63, length: 36.5, shaftWeight: 120 },
    9: { loft: 42, lie: 63.5, length: 36.0, shaftWeight: 125 },
    10: { loft: 46, lie: 64, length: 35.75, shaftWeight: 125 } // PW
  };
  
  return specs[ironNumber] || specs[7]; // Default to 7-iron if not found
}

/**
 * Extract iron number from club type
 */
function getIronNumber(clubType) {
  const normalized = clubType.toLowerCase().replace(/\s+/g, '-');
  
  // Handle PW specially
  if (normalized === 'pw' || normalized === 'pitching-wedge') {
    return 10;
  }
  
  const match = normalized.match(/^([2-9])-?iron$/);
  return match ? parseInt(match[1]) : null;
}

/**
 * Format iron name from number
 */
function formatIronName(ironNumber) {
  if (ironNumber === 10) return 'pw';
  return `${ironNumber}-iron`;
}

/**
 * Check if club type is a wedge
 */
function isWedge(clubType) {
  const normalized = clubType.toLowerCase().replace(/\s+/g, '-');
  const wedges = ['pw', 'pitching-wedge', 'gw', 'gap-wedge', 'aw', 'approach-wedge',
                  'sw', 'sand-wedge', 'lw', 'lob-wedge'];
  return wedges.includes(normalized);
}

/**
 * Check if club type is a wood
 */
function isWood(clubType) {
  const normalized = clubType.toLowerCase().replace(/\s+/g, '-');
  const woodPattern = /^[3-9]-?wood$/;
  return woodPattern.test(normalized);
}

/**
 * Check if club type is a hybrid
 */
function isHybrid(clubType) {
  const normalized = clubType.toLowerCase().replace(/\s+/g, '-');
  const hybridPattern = /^[2-9]-?hybrid$/;
  return hybridPattern.test(normalized);
}
