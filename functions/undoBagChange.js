/**
 * Cloud Function: undoBagChange
 * 
 * Reverses a recent bag change (within 7 days).
 * This function:
 * 1. Validates undo is still available (within 7 days, not already undone)
 * 2. Restores archived clubs back to active status
 * 3. Archives the newly added clubs
 * 4. Triggers bag regrading
 * 5. Marks the change as undone
 * 6. Returns the restored grade
 * 
 * Input:
 * {
 *   userId: "user_xyz",
 *   changeId: "change_abc123"
 * }
 * 
 * Output:
 * {
 *   success: true,
 *   restoredGrade: { overallScore: 87, letterGrade: "B+", ... },
 *   currentGrade: 87,
 *   message: "Bag restored to previous state"
 * }
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');

// Note: admin.initializeApp() is called in index.js

exports.undoBagChange = functions.https.onCall(async (data, context) => {
  // 1. Authentication check
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'User must be logged in to undo bag changes'
    );
  }

  const userId = context.auth.uid;
  const db = admin.firestore();

  // 2. Validate required fields
  const { changeId } = data;

  if (!changeId) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Missing required field: changeId'
    );
  }

  try {
    console.log(`Starting undo for changeId: ${changeId}`);

    // 3. Get change history document
    const changeDoc = await db.collection('users').doc(userId)
      .collection('bagChangeHistory').doc(changeId).get();

    if (!changeDoc.exists) {
      throw new functions.https.HttpsError(
        'not-found',
        'Change record not found'
      );
    }

    const changeData = changeDoc.data();

    // 4. Validate undo is still available
    if (!changeData.canUndo) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'This change can no longer be undone'
      );
    }

    const now = admin.firestore.Timestamp.now();
    if (now.toMillis() > changeData.undoExpiresAt.toMillis()) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Undo period has expired (7 days). Your bag has been updated.'
      );
    }

    if (changeData.undone === true) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'This change has already been undone'
      );
    }

    console.log('Validation passed. Proceeding with undo...');

    // 5. Restore archived clubs (clubs that were removed)
    const clubsToRestore = changeData.clubsRemoved || [];
    
    for (const clubSummary of clubsToRestore) {
      const clubId = clubSummary.clubId;
      
      // Get archived club data
      const archivedDoc = await db.collection('users').doc(userId)
        .collection('archivedClubs').doc(clubId).get();
      
      if (archivedDoc.exists) {
        const archivedData = archivedDoc.data();
        
        // Restore club to active status
        await db.collection('clubs').doc(clubId).update({
          status: 'active',
          archivedAt: null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`Restored club: ${clubId}`);
      }
    }

    // 6. Archive newly added clubs (clubs that were added in the original change)
    const clubsToArchive = changeData.clubsAdded || [];
    
    for (const clubSummary of clubsToArchive) {
      const clubId = clubSummary.clubId;
      
      // Get current club data
      const clubDoc = await db.collection('clubs').doc(clubId).get();
      
      if (clubDoc.exists) {
        const clubData = clubDoc.data();
        
        // Calculate time in bag
        const addedAt = clubData.addedToBagAt || clubData.createdAt;
        const timeInBag = calculateTimeInBag(addedAt);
        
        // Move to archived
        await db.collection('users').doc(userId)
          .collection('archivedClubs').doc(clubId).set({
            ...clubData,
            archivedAt: admin.firestore.FieldValue.serverTimestamp(),
            archivedReason: 'undone_change',
            changeHistoryId: changeId,
            timeInBag: timeInBag,
            canRestore: false
          });
        
        // Update original club status
        await db.collection('clubs').doc(clubId).update({
          status: 'archived',
          archivedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`Archived club: ${clubId}`);
      }
    }

    console.log('Clubs restored and archived. Triggering regrade...');

    // 7. Trigger bag re-grade
    const restoredGrade = await callGradeUserBag(userId);
    
    console.log(`Restored grade: ${restoredGrade.letterGrade} (${restoredGrade.overallScore})`);

    // 8. Mark change as undone
    await db.collection('users').doc(userId)
      .collection('bagChangeHistory').doc(changeId).update({
        undone: true,
        undoneAt: admin.firestore.FieldValue.serverTimestamp(),
        canUndo: false
      });

    console.log('Change marked as undone');

    // 9. Return results
    return {
      success: true,
      restoredGrade: restoredGrade,
      currentGrade: restoredGrade.overallScore,
      currentLetterGrade: restoredGrade.letterGrade,
      message: 'Bag successfully restored to previous state',
      clubsRestored: clubsToRestore.length,
      clubsArchived: clubsToArchive.length
    };

  } catch (error) {
    console.error('Error in undoBagChange:', error);
    
    // Re-throw HttpsErrors as-is
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    
    // Wrap other errors
    throw new functions.https.HttpsError(
      'internal',
      `Failed to undo bag change: ${error.message}`
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
