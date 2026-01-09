const functions = require('firebase-functions');
const admin = require('firebase-admin');

/**
 * Fetch AI recommendation rules from Firestore
 * Returns enabled rules sorted by priority
 */
async function fetchAIRules() {
  try {
    const rulesSnapshot = await admin.firestore()
      .collection('aiRecommendationRules')
      .where('enabled', '==', true)
      .orderBy('priority')
      .get();
    
    if (rulesSnapshot.empty) {
      console.log('No AI recommendation rules found');
      return [];
    }
    
    const rules = [];
    rulesSnapshot.forEach(doc => {
      const data = doc.data();
      rules.push({
        name: data.name,
        priority: data.priority,
        ruleText: data.ruleText
      });
    });
    
    console.log(`Fetched ${rules.length} AI recommendation rules`);
    return rules;
    
  } catch (error) {
    console.error('Error fetching AI rules:', error);
    return [];
  }
}

/**
 * Build the prompt for Claude API
 */
function buildPrompt(club, user, favoriteClub, aiRules) {
  let rulesSection = '';
  if (aiRules && aiRules.length > 0) {
    rulesSection = '\n\nAI RECOMMENDATION RULES:\nPlease follow these guidelines when making recommendations:\n\n';
    aiRules.forEach((rule, index) => {
      rulesSection += `${index + 1}. ${rule.name}\n${rule.ruleText}\n\n`;
    });
  }
  
  return `You are a professional golf club fitter. Analyze this club and provide personalized recommendations.

USER PROFILE:
- Handicap: ${user.handicap || 'Not provided'}
- Swing Speed (Driver): ${user.swingSpeed?.driver || 'Unknown'} mph
- Swing Speed (7-Iron): ${user.swingSpeed?.sevenIron || 'Unknown'} mph
- Favorite Club: ${favoriteClub.clubType} (${favoriteClub.brand} ${favoriteClub.model})

FAVORITE CLUB SPECS (User's Baseline):
- Year: ${favoriteClub.year}
- Shaft: ${favoriteClub.shaft.brand} ${favoriteClub.shaft.model}
- Weight: ${favoriteClub.shaft.weight}g
- Flex: ${favoriteClub.shaft.flex}
- Kick Point: ${favoriteClub.shaft.kickPoint}
- Grade: ${favoriteClub.letterGrade} (${favoriteClub.grade}/100)

CLUB BEING ANALYZED:
- Type: ${club.clubType}
- Brand: ${club.brand} ${club.model}
- Year: ${club.year}
- Shaft: ${club.shaft.brand} ${club.shaft.model}
- Weight: ${club.shaft.weight}g
- Flex: ${club.shaft.flex}
- Kick Point: ${club.shaft.kickPoint}
- Overall Grade: ${club.letterGrade} (${club.grade}/100)

COMPONENT SCORES:
- Age Score: ${club.componentScores.age}/100
- Weight Progression: ${club.componentScores.weightProgression}/100
- Kick Point Consistency: ${club.componentScores.kickPointConsistency}/100
- Flex Consistency: ${club.componentScores.flexConsistency}/100
- Loft Gapping: ${club.componentScores.loftGapping}/100
${rulesSection}
INSTRUCTIONS:
1. Write in a conversational, encouraging tone
2. Explain WHY each issue matters to the golfer's game (not just technical specs)
3. Compare to their favorite club (the baseline they know works)
4. Provide specific, actionable recommendations
5. Estimate potential improvement (yards, accuracy, consistency)
6. Keep it 200-400 words
7. Use handicap to adjust complexity:
   - 0-10: Can use technical terms
   - 11-20: Balance technical and casual
   - 21+: Keep simple and practical

Format your response as:
- Start with overall assessment (1-2 sentences)
- List specific issues (numbered, with explanations)
- End with clear recommendation and estimated impact

Do NOT use overly technical jargon. Do NOT be critical or negative. Focus on improvement potential.`;
}

/**
 * Call Claude API with retry logic
 */
async function callClaudeAPI(prompt, apiKey, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
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
      return data.content[0].text;
      
    } catch (error) {
      console.error(`Claude API attempt ${attempt} failed:`, error);
      
      if (attempt === retries) {
        throw error;
      }
      
      const delay = Math.pow(2, attempt - 1) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Main Cloud Function - Generate AI recommendation for a club
 */
exports.generateAIRecommendation = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  }

  const { clubId } = data;
  const userId = context.auth.uid;

  try {
    // Get API key from config
    const apiKey = functions.config().anthropic?.key;
    if (!apiKey) {
      throw new functions.https.HttpsError('failed-precondition', 'API key not configured');
    }

    // 1. Fetch club data
    const clubDoc = await admin.firestore().collection('clubs').doc(clubId).get();
    
    if (!clubDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Club not found');
    }
    
    const club = clubDoc.data();

    if (club.userId !== userId) {
      throw new functions.https.HttpsError('permission-denied', 'Not your club');
    }

    // 2. Fetch user profile
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'User profile not found');
    }
    
    const user = userDoc.data();

    // 3. Fetch favorite club
    if (!user.favoriteClubId) {
      throw new functions.https.HttpsError('failed-precondition', 'No favorite club set');
    }
    
    const favoriteDoc = await admin.firestore().collection('clubs').doc(user.favoriteClubId).get();
    
    if (!favoriteDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Favorite club not found');
    }
    
    const favoriteClub = favoriteDoc.data();

    // 4. Fetch AI recommendation rules
    console.log('Fetching AI recommendation rules...');
    const aiRules = await fetchAIRules();

    // 5. Build prompt with rules
    console.log('Building prompt with AI rules...');
    const prompt = buildPrompt(club, user, favoriteClub, aiRules);

    // 6. Call Claude API
    console.log('Calling Claude API...');
    const recommendation = await callClaudeAPI(prompt, apiKey);

    // 7. Save recommendation
    await admin.firestore().collection('clubs').doc(clubId).update({
      aiRecommendation: {
        summary: recommendation,
        reasoning: recommendation,
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
        modelUsed: 'claude-sonnet-4-20250514',
        rulesUsed: aiRules.length
      }
    });

    console.log(`Successfully generated recommendation for club ${clubId}`);

    return {
      success: true,
      recommendation: recommendation,
      rulesApplied: aiRules.length
    };

  } catch (error) {
    console.error('Error generating AI recommendation:', error);
    
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    
    throw new functions.https.HttpsError('internal', error.message);
  }
});
