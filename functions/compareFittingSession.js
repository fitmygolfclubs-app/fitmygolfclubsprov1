const functions = require('firebase-functions');
const admin = require('firebase-admin');
const {sanitizeUserId, sanitizeText, sanitizeClubType} = require("./sanitization");

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * Compare Fitting Session Cloud Function - FINAL DEBUG VERSION
 * Exhaustive logging to identify Firestore issue
 */
exports.compareFittingSession = functions.https.onRequest(async (req, res) => {
  // CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '3600');
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('=== COMPARISON REQUEST START ===');
  console.log('Request body:', JSON.stringify(req.body, null, 2));

  try {
    // SECURITY: Sanitize input
let userId, sessionId, clubType, clubIds;
try {
  const rawUserId = req.body.userId;
  const rawSessionId = req.body.sessionId;
  const rawClubType = req.body.clubType;
  const rawClubIds = req.body.clubIds;
  
  // Validate all exist
  if (!rawUserId || !rawSessionId || !rawClubType || !Array.isArray(rawClubIds)) {
    console.error('Missing required fields');
    return res.status(400).json({
      error: 'Missing required fields',
      details: 'Required: userId, sessionId, clubType, clubIds (array)'
    });
  }
  
  // Validate types
  if (typeof rawUserId !== 'string' || typeof rawSessionId !== 'string' || typeof rawClubType !== 'string') {
    return res.status(400).json({
      error: 'Invalid request: userId, sessionId, and clubType must be strings',
    });
  }
  
  // Sanitize inputs
  userId = sanitizeUserId(rawUserId);
  sessionId = sanitizeText(rawSessionId, 50);
  clubType = sanitizeClubType(rawClubType);
  
  // Validate clubType
  if (!clubType) {
    return res.status(400).json({
      error: 'Invalid clubType',
      details: 'Must be a valid club type (driver, 7-iron, etc.)'
    });
  }
  
  // Sanitize array of club IDs
  clubIds = rawClubIds.map(id => sanitizeText(id, 50)).filter(id => id !== '');
  
  // Validate minimum clubs
  if (clubIds.length < 2) {
    console.error('Insufficient clubs for comparison');
    return res.status(400).json({
      error: 'Insufficient clubs for comparison',
      details: 'Need at least 2 clubs of the same type to compare'
    });
  }
  
  console.log(`Comparing ${clubIds.length} clubs for user ${userId}, session ${sessionId}`);
  
} catch (sanitizeError) {
  console.error('Sanitization error:', sanitizeError.message);
  return res.status(400).json({
    error: 'Invalid input format'
  });
}

    console.log(`Comparing ${clubIds.length} clubs for user ${userId}, session ${sessionId}`);

    const db = admin.firestore();
    const clubsWithData = [];

    // Process each club with exhaustive logging
    for (const clubId of clubIds) {
      console.log(`\n========================================`);
      console.log(`PROCESSING CLUB: ${clubId}`);
      console.log(`========================================`);
      
      try {
        // Get reference
        const clubRef = db.collection('clubs').doc(clubId);
        console.log(`✓ Created reference: clubs/${clubId}`);
        
        // Attempt to fetch
        console.log(`⟳ Calling .get() on reference...`);
        const clubDoc = await clubRef.get();
        console.log(`✓ .get() call completed`);
        
        // Log EVERYTHING about the response
        console.log(`\n--- FIRESTORE RESPONSE DETAILS ---`);
        console.log(`typeof clubDoc: ${typeof clubDoc}`);
        console.log(`clubDoc constructor: ${clubDoc.constructor.name}`);
        console.log(`clubDoc.exists: ${clubDoc.exists}`);
        console.log(`clubDoc.id: ${clubDoc.id}`);
        console.log(`clubDoc.ref: ${clubDoc.ref.path}`);
        console.log(`clubDoc.createTime: ${clubDoc.createTime}`);
        console.log(`clubDoc.updateTime: ${clubDoc.updateTime}`);
        console.log(`clubDoc.readTime: ${clubDoc.readTime}`);
        
        // Try to get data
        try {
          const data = clubDoc.data();
          console.log(`clubDoc.data() type: ${typeof data}`);
          if (data) {
            console.log(`clubDoc.data() keys: ${Object.keys(data).join(', ')}`);
            console.log(`clubDoc.data() full: ${JSON.stringify(data, null, 2)}`);
          } else {
            console.log(`clubDoc.data() returned: ${data}`);
          }
        } catch (dataError) {
          console.error(`ERROR calling clubDoc.data():`, dataError.message);
        }
        
        console.log(`--- END FIRESTORE RESPONSE ---\n`);
        
        if (!clubDoc.exists) {
          console.error(`❌ CLUB DOES NOT EXIST despite successful .get() call`);
          console.error(`This suggests the document is not in Firestore`);
          continue;
        }
        
        const clubData = clubDoc.data();
        if (!clubData) {
          console.error(`❌ clubData is null/undefined even though .exists = true`);
          continue;
        }
        
        console.log(`✓ Club found: ${clubData.brand} ${clubData.model}`);
        
        // Query performance data
        console.log(`\n⟳ Querying performance data...`);
        const perfQuery = db.collection('clubs')
          .doc(clubId)
          .collection('performanceData')
          .where('sessionId', '==', sessionId);
        
        const perfSnapshot = await perfQuery.get();
        console.log(`✓ Found ${perfSnapshot.size} performance documents`);

        if (perfSnapshot.empty) {
          console.warn(`⚠ No performance data for this club in session ${sessionId}`);
          continue;
        }

        // Extract shots
        const shots = [];
        perfSnapshot.forEach(doc => {
          const data = doc.data();
          if (data.shots && Array.isArray(data.shots)) {
            shots.push(...data.shots);
          } else if (data.carryDistance || data.ballSpeed) {
            shots.push(data);
          }
        });

        if (shots.length === 0) {
          console.warn(`⚠ No shot data found`);
          continue;
        }

        console.log(`✓ Total shots: ${shots.length}`);
        
        clubsWithData.push({
          clubId,
          clubData,
          shots,
          shotCount: shots.length
        });
        
        console.log(`✓ Successfully processed club ${clubId}`);
        
      } catch (clubError) {
        console.error(`\n❌ EXCEPTION processing club ${clubId}:`);
        console.error(`Error message: ${clubError.message}`);
        console.error(`Error stack: ${clubError.stack}`);
        console.error(`Error code: ${clubError.code}`);
        console.error(`Error name: ${clubError.name}`);
        continue;
      }
    }

    console.log(`\n========================================`);
    console.log(`PROCESSING COMPLETE`);
    console.log(`Clubs with data: ${clubsWithData.length}`);
    console.log(`========================================\n`);

    // Check if we have enough data
    if (clubsWithData.length < 2) {
      console.error(`❌ INSUFFICIENT DATA: found ${clubsWithData.length} clubs with performance data`);
      return res.status(400).json({
        error: 'Insufficient performance data',
        details: `At least 2 clubs need performance data for comparison. Found data for ${clubsWithData.length} club(s).`
      });
    }

    console.log(`✓ SUCCESS: Proceeding with comparison of ${clubsWithData.length} clubs`);

    // Calculate statistics for each club
    const clubStats = clubsWithData.map(club => {
      const { clubData, shots, clubId } = club;
      
      const calcAvg = (field) => {
        const values = shots
          .map(s => s[field])
          .filter(v => typeof v === 'number' && !isNaN(v));
        return values.length > 0 
          ? values.reduce((sum, v) => sum + v, 0) / values.length 
          : 0;
      };

      const avgCarry = calcAvg('carryDistance');
      const avgTotal = calcAvg('totalDistance');
      const avgBallSpeed = calcAvg('ballSpeed');
      const avgClubSpeed = calcAvg('clubHeadSpeed');
      const avgLaunch = calcAvg('launchAngle');
      const avgSpin = calcAvg('spinRate');

      const carryValues = shots
        .map(s => s.carryDistance)
        .filter(v => typeof v === 'number' && !isNaN(v));
      
      let stdDev = 0;
      if (carryValues.length > 1) {
        const variance = carryValues.reduce((sum, d) => {
          return sum + Math.pow(d - avgCarry, 2);
        }, 0) / carryValues.length;
        stdDev = Math.sqrt(variance);
      }

      return {
        clubId,
        brand: clubData.brand || 'Unknown',
        model: clubData.model || 'Unknown',
        clubType: clubData.clubType || clubType,
        shotCount: shots.length,
        avgCarryDistance: Math.round(avgCarry),
        avgTotalDistance: Math.round(avgTotal),
        avgBallSpeed: Math.round(avgBallSpeed),
        avgClubSpeed: Math.round(avgClubSpeed),
        avgLaunchAngle: Math.round(avgLaunch * 10) / 10,
        avgSpinRate: Math.round(avgSpin),
        consistency: Math.round(stdDev * 10) / 10,
        shaftWeight: clubData.shaft?.weight || null,
        shaftFlex: clubData.shaft?.flex || null,
        shaftKickPoint: clubData.shaft?.kickPoint || null
      };
    });

    // API key
    const anthropicKey = process.env.CLAUDE_API_KEY || functions.config().claude?.api_key || "";
    
    if (!anthropicKey) {
      console.error('Anthropic API key not found');
      return res.status(500).json({
        error: 'Configuration error',
        details: 'Anthropic API key not configured.'
      });
    }

    console.log('⟳ Calling Claude API...');
    const prompt = buildComparisonPrompt(clubStats, clubType);
    const analysis = await callClaudeAPI(prompt, anthropicKey);
    console.log('✓ Claude analysis received');

    const winnerClub = clubStats[0];

    // Save results
    try {
      await db.collection('users')
        .doc(userId)
        .collection('testingSessions')
        .doc(sessionId)
        .update({
          [`comparisons.${clubType}`]: {
            comparedAt: admin.firestore.FieldValue.serverTimestamp(),
            clubIds: clubIds,
            winner: winnerClub.clubId,
            analysis: analysis,
            clubStats: clubStats
          }
        });
      console.log('✓ Results saved to Firestore');
    } catch (saveError) {
      console.error('⚠ Error saving results:', saveError);
    }

    const response = {
      success: true,
      message: 'Comparison analysis complete',
      data: {
        clubType,
        comparedClubs: clubsWithData.length,
        winner: `${winnerClub.brand} ${winnerClub.model}`,
        verdict: 'clear_winner',
        fullAnalysis: {
          winner: `${winnerClub.brand} ${winnerClub.model}`,
          reasoning: analysis,
          clubStats: clubStats
        }
      }
    };

    console.log('✓✓✓ COMPARISON REQUEST SUCCESS ✓✓✓');
    return res.status(200).json(response);

  } catch (error) {
    console.error('❌❌❌ COMPARISON REQUEST FAILED ❌❌❌');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    
    return res.status(500).json({
      error: 'Comparison failed',
      details: error.message,
      stack: error.stack
    });
  }
});

function buildComparisonPrompt(clubStats, clubType) {
  let prompt = `You are a professional golf club fitter analyzing performance data from a testing session.\n\n`;
  prompt += `The golfer tested ${clubStats.length} different ${clubType}s. Here's the data:\n\n`;

  clubStats.forEach((club, index) => {
    prompt += `**Club ${index + 1}: ${club.brand} ${club.model}**\n`;
    prompt += `- Shots tested: ${club.shotCount}\n`;
    prompt += `- Average carry: ${club.avgCarryDistance} yards\n`;
    prompt += `- Average total: ${club.avgTotalDistance} yards\n`;
    prompt += `- Ball speed: ${club.avgBallSpeed} mph\n`;
    prompt += `- Club speed: ${club.avgClubSpeed} mph\n`;
    prompt += `- Launch angle: ${club.avgLaunchAngle}°\n`;
    prompt += `- Spin rate: ${club.avgSpinRate} rpm\n`;
    prompt += `- Consistency (std dev): ${club.consistency} yards\n`;
    if (club.shaftWeight) prompt += `- Shaft weight: ${club.shaftWeight}g\n`;
    if (club.shaftFlex) prompt += `- Shaft flex: ${club.shaftFlex}\n`;
    if (club.shaftKickPoint) prompt += `- Kick point: ${club.shaftKickPoint}\n`;
    prompt += `\n`;
  });

  prompt += `Based on this data, which club performs best? Provide a detailed but conversational analysis (200-300 words) that:\n`;
  prompt += `1. Identifies the winner and why\n`;
  prompt += `2. Explains the key performance differences\n`;
  prompt += `3. Mentions specific metrics that matter\n`;
  prompt += `4. Gives actionable recommendation\n\n`;
  prompt += `Write in a friendly, encouraging tone. Focus on what the golfer will gain by switching clubs.`;

  return prompt;
}

async function callClaudeAPI(prompt, apiKey, retries = 3) {
  const fetch = require('node-fetch');
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Claude API attempt ${attempt}/${retries}`);
      
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1500,
          messages: [{
            role: 'user',
            content: prompt
          }]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Claude API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('Claude API success');
      return data.content[0].text;
      
    } catch (error) {
      console.error(`Claude API attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        throw new Error(`Claude API failed after ${retries} attempts: ${error.message}`);
      }
      
      const delay = Math.pow(2, attempt - 1) * 1000;
      console.log(`Waiting ${delay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
