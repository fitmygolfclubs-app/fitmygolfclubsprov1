/**
 * Cloud Function: setupSavedRecommendationsOnly (ONE-TIME USE)
 * 
 * Creates ONLY the savedRecommendations collection with sample data.
 * 
 * Usage:
 * 1. Update testUserId below with your Firebase user ID
 * 2. Add to your Cloud Functions index.js:
 *    exports.setupSavedRecommendationsOnly = require('./setupSavedRecommendationsOnly').setupSavedRecommendationsOnly;
 * 3. Deploy: firebase deploy --only functions:setupSavedRecommendationsOnly
 * 4. Trigger via HTTP GET request (see URL in Firebase Console)
 * 5. Delete this function after running
 * 
 * Date: November 11, 2025
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Initialize admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

exports.setupSavedRecommendationsOnly = functions.https.onRequest(async (req, res) => {
  try {
    console.log("Starting savedRecommendations collection setup...");
    
    // ⚠️ IMPORTANT: Replace with your actual test user ID
    const testUserId = "nXdjUdNSffQeBoZxhG6iC5nUuV22";  // ⚠️ UPDATE THIS!
    
    if (testUserId === "YOUR_TEST_USER_ID_HERE") {
      res.status(400).json({
        error: "Please update testUserId in the function code before deploying!",
        instructions: "1. Find your user ID in Firebase Console → Authentication\n2. Update line 26 in setupSavedRecommendationsOnly.js\n3. Redeploy the function"
      });
      return;
    }
    
    // ==========================================
    // SAMPLE SAVED RECOMMENDATION #1: 7-Iron
    // ==========================================
    
    const savedRecommendation7Iron = {
      // Which club type this recommendation is for
      clubType: "7-iron",
      
      // The user's current club (from their bag)
      currentClub: {
        clubId: "club_current_7iron_sample",
        brand: "TaylorMade",
        model: "P770",
        loft: 34,
        shaftWeight: 120,
        shaftFlex: "Stiff",
        shaftKickpoint: "Mid",
        shaftTorque: 3.2,
        length: 37.0,
        lie: 62.5,
        manufactureYear: 2020
      },
      
      // What the AI recommended (up to 3 clubs)
      recommendations: [
        {
          brand: "Mizuno",
          model: "JPX 923 Hot Metal",
          loft: 33,
          shaftWeight: 115,
          shaftFlex: "Stiff",
          shaftKickpoint: "Mid",
          shaftTorque: 2.8,
          reasoning: "Lighter shaft (115g vs 120g) matches your 78mph driver swing speed better. Will help with consistency and smoother weight progression from your favorite 6-iron.",
          estimatedPrice: 1200,
          whereToTest: "Club Champion, PGA Tour Superstore"
        },
        {
          brand: "TaylorMade",
          model: "P790",
          loft: 33.5,
          shaftWeight: 110,
          shaftFlex: "Regular",
          shaftKickpoint: "Low",
          shaftTorque: 3.0,
          reasoning: "Even lighter shaft option (110g) and regular flex might provide more forgiveness for your swing speed. Worth testing against the Mizuno.",
          estimatedPrice: 1400,
          whereToTest: "Club Champion, Dick's Sporting Goods"
        }
      ],
      
      // Why AI thinks current club needs upgrading
      currentClubGrade: "C",
      currentClubIssues: [
        "Shaft weight (120g) is too heavy for your 78mph driver swing speed",
        "Creates 25g gap to your 5-iron, should be ~10g",
        "Loft gap of 6° to 6-iron is too large (should be 3-4°)"
      ],
      
      // What would improve if they upgrade
      expectedBagGradeImprovement: "C → B+",
      expectedImprovements: [
        "Smoother weight progression across entire set",
        "Better loft gapping for consistent distances",
        "Improved consistency with lighter shaft matching swing speed"
      ],
      
      // Metadata about the recommendation
      recommendationId: "rec_" + Date.now(),
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      generatedFrom: "bagGrading",
      
      // Status tracking
      status: "saved",  // "saved" | "tested" | "dismissed"
      savedAt: admin.firestore.FieldValue.serverTimestamp(),
      testedDate: null,
      testSessionId: null,
      testResult: null,  // "better" | "worse" | "similar" (after testing)
      
      // User context at time of recommendation
      userContext: {
        handicap: 10,
        favoriteClub: {
          clubType: "6-iron",
          brand: "Titleist",
          model: "T200",
          shaftWeight: 115
        },
        swingSpeed: {
          driver: 78,
          sevenIron: 72
        }
      },
      
      // Tracking
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    // Create the 7-iron recommendation document
    await db.collection('users').doc(testUserId)
      .collection('savedRecommendations')
      .doc('7-iron')  // Document ID = club type for easy lookup
      .set(savedRecommendation7Iron);
    
    console.log(`✅ Created savedRecommendation for 7-iron`);
    
    // ==========================================
    // SAMPLE SAVED RECOMMENDATION #2: Driver
    // ==========================================
    
    const driverRecommendation = {
      clubType: "driver",
      
      currentClub: {
        clubId: "club_current_driver_sample",
        brand: "Callaway",
        model: "Rogue ST Max",
        loft: 10.5,
        shaftWeight: 65,
        shaftFlex: "Regular",
        shaftKickpoint: "Mid",
        shaftTorque: 4.5,
        length: 45.5,
        lie: 58.0,
        manufactureYear: 2022
      },
      
      recommendations: [
        {
          brand: "Ping",
          model: "G430 Max",
          loft: 10.5,
          shaftWeight: 55,
          shaftFlex: "Regular",
          shaftKickpoint: "Low",
          shaftTorque: 5.2,
          reasoning: "Lighter shaft (55g vs 65g) and lower kickpoint will help you get more clubhead speed and higher launch angle. Your 78mph swing speed is perfect for this setup.",
          estimatedPrice: 600,
          whereToTest: "Club Champion, Golf Galaxy"
        }
      ],
      
      currentClubGrade: "B",
      currentClubIssues: [
        "Shaft weight (65g) is heavier than ideal for your swing speed",
        "Creates large weight jump to 3-wood (should be 10-15g gap)"
      ],
      
      expectedBagGradeImprovement: "B → A-",
      expectedImprovements: [
        "Better weight progression to fairway woods",
        "5-8 yard distance gain from optimized shaft weight"
      ],
      
      recommendationId: "rec_" + (Date.now() + 1),
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      generatedFrom: "bagGrading",
      
      status: "saved",
      savedAt: admin.firestore.FieldValue.serverTimestamp(),
      testedDate: null,
      testSessionId: null,
      testResult: null,
      
      userContext: {
        handicap: 10,
        favoriteClub: {
          clubType: "6-iron",
          brand: "Titleist",
          model: "T200",
          shaftWeight: 115
        },
        swingSpeed: {
          driver: 78,
          sevenIron: 72
        }
      },
      
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    await db.collection('users').doc(testUserId)
      .collection('savedRecommendations')
      .doc('driver')
      .set(driverRecommendation);
    
    console.log(`✅ Created savedRecommendation for driver`);
    
    // ==========================================
    // RESPONSE
    // ==========================================
    
    res.status(200).json({
      success: true,
      message: "✅ Successfully created savedRecommendations collection!",
      data: {
        testUserId: testUserId,
        documentsCreated: [
          `users/${testUserId}/savedRecommendations/7-iron`,
          `users/${testUserId}/savedRecommendations/driver`
        ],
        structure: {
          "7-iron": {
            currentClub: "TaylorMade P770",
            recommendations: 2,
            status: "saved",
            currentGrade: "C"
          },
          "driver": {
            currentClub: "Callaway Rogue ST Max", 
            recommendations: 1,
            status: "saved",
            currentGrade: "B"
          }
        }
      },
      nextSteps: [
        "1. ✅ Go to Firebase Console → Firestore Database",
        "2. ✅ Navigate to: users → {your userId} → savedRecommendations",
        "3. ✅ You should see 2 documents: '7-iron' and 'driver'",
        "4. ✅ Verify the data structure looks correct",
        "5. ✅ Delete this Cloud Function after verification",
        "6. ✅ Proceed to deploy compareFittingSession function"
      ]
    });
    
  } catch (error) {
    console.error("❌ Error creating savedRecommendations:", error);
    res.status(500).json({
      error: "Failed to create savedRecommendations collection",
      details: error.message,
      stack: error.stack
    });
  }
});
