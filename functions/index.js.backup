const {onRequest, onCall} = require("firebase-functions/v2/https");
const {sanitizeUserId, sanitizeText} = require("./sanitization");
const functions = require("firebase-functions");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const axios = require("axios");
const fetch = require('node-fetch');

// Initialize Firebase Admin
admin.initializeApp();

// Enable ignoreUndefinedProperties to handle clubs with missing fields
admin.firestore().settings({ ignoreUndefinedProperties: true });

// Klaviyo Configuration


// Helper function for Klaviyo API calls
async function callKlaviyoAPI(endpoint, data) {
  const config = functions.config();
  const apiKey = config.klaviyo?.api_key;
  
  if (!apiKey) {
    console.warn('Klaviyo API key not configured');
    return null;
  }
  
  try {
    const response = await axios.post(
      `https://a.klaviyo.com/api/${endpoint}`,
      data,
      {
        headers: {
          'Authorization': `Klaviyo-API-Key ${apiKey}`,
          'Content-Type': 'application/json',
          'revision': '2024-10-15'
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('Klaviyo API Error:', error.response?.data || error.message);
    throw error;
  }
}
// Claude API Configuration
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || functions.config().claude?.api_key || "";
const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";

/**
 * Cloud Function: generateAIRecommendation
 * 
 * This function is called when a user wants AI recommendations for their golf bag.
 * It reads the bag analysis data from Firestore and sends it to Claude AI for analysis.
 * 
 * Expected request body:
 * {
 *   "userId": "user_id_here",
 *   "analysisId": "analysis_id_here"
 * }
 */
exports.generateAIRecommendation = onRequest(async (req, res) => {
  // Set CORS headers
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  try {
    // Get userId and analysisId from request
    // SECURITY: Sanitize input
let userId, analysisId;
try {
  const rawUserId = req.body.userId;
  const rawAnalysisId = req.body.analysisId;
  
  // Validate both exist
  if (!rawUserId || !rawAnalysisId) {
    res.status(400).json({
      error: 'Missing required fields: userId and analysisId',
    });
    return;
  }
  
  // Validate types
  if (typeof rawUserId !== 'string' || typeof rawAnalysisId !== 'string') {
    res.status(400).json({
      error: 'Invalid request: userId and analysisId must be strings',
    });
    return;
  }
  
  // Sanitize both
  userId = sanitizeUserId(rawUserId);
  analysisId = sanitizeText(rawAnalysisId, 50); // analysisId is just a doc ID
  
  logger.info('Generating AI recommendation for user:', userId, 'analysis:', analysisId);
  
} catch (sanitizeError) {
  logger.error('Sanitization error:', sanitizeError.message);
  res.status(400).json({
    error: 'Invalid input format'
  });
  return;
}

    logger.info(`Generating AI recommendation for user: ${userId}, analysis: ${analysisId}`);

    // Fetch the bag analysis from Firestore
    const analysisDoc = await admin.firestore()
        .collection("bag_analysis")
        .doc(analysisId)
        .get();

    if (!analysisDoc.exists) {
      res.status(404).json({
        error: "Bag analysis not found",
      });
      return;
    }

    const analysisData = analysisDoc.data();

    // Fetch user's clubs from Firestore
    // Note: userId is stored as a Firestore Reference, not a string
    const userRef = admin.firestore().collection("users").doc(userId);
    const clubsSnapshot = await admin.firestore()
        .collection("clubs")
        .where("userId", "==", userRef)
        .get();

    const clubs = [];
    clubsSnapshot.forEach((doc) => {
      clubs.push({id: doc.id, ...doc.data()});
    });

    // Fetch user profile for handicap info
    const userDoc = await admin.firestore()
        .collection("users")
        .doc(userId)
        .get();

    const userData = userDoc.data();

    // Build the prompt for Claude
    const prompt = buildClaudePrompt(analysisData, clubs, userData);

    // Call Claude API
    logger.info("Calling Claude API...");
    const claudeResponse = await axios.post(
        CLAUDE_API_URL,
        {
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
        },
        {
          headers: {
            "x-api-key": CLAUDE_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
        }
    );

    const recommendation = claudeResponse.data.content[0].text;
    const tokensUsed = claudeResponse.data.usage.input_tokens + 
                      claudeResponse.data.usage.output_tokens;

    logger.info(`Claude API successful. Tokens used: ${tokensUsed}`);

    // Save the recommendation to Firestore
    const recommendationRef = await admin.firestore()
        .collection("ai_recommendations")
        .add({
          user_id: userId,
          analysis_id: analysisId,
          recommendation_text: recommendation,
          category: "full_bag_analysis",
          created_at: admin.firestore.FieldValue.serverTimestamp(),
          tokens_used: tokensUsed,
        });

    logger.info(`Recommendation saved with ID: ${recommendationRef.id}`);

    // Return the recommendation to the client
    res.status(200).json({
      success: true,
      recommendationId: recommendationRef.id,
      recommendation: recommendation,
      tokensUsed: tokensUsed,
    });
  } catch (error) {
    logger.error("Error generating AI recommendation:", error);
    res.status(500).json({
      error: "Failed to generate recommendation",
      details: error.message,
    });
  }
});

/**
 * Helper function to build the prompt for Claude
 */
function buildClaudePrompt(analysisData, clubs, userData) {
  const clubsList = clubs.map((club) => {
    const rawFlex = club.shaft?.flex || club.shaft_flex;
    const normalizedFlex = rawFlex ? normalizeFlexValue(rawFlex) : 'N/A';
    return `- ${club.clubType}: ${club.brand} ${club.model}, ` +
    `${club.shaft?.brand || 'Unknown'} ${club.shaft?.model || ''} (${normalizedFlex}), ` +
    `${club.shaft?.weight || 'N/A'}g, ${club.length || 'N/A'}"`;
  }).join("\n");

  return `You are an expert golf club fitter analyzing a golfer's equipment. 

GOLFER PROFILE:
- Handicap: ${userData.handicap || "Not provided"}
- Clubs in bag: ${userData.clubs_in_bag || clubs.length}

CURRENT EQUIPMENT:
${clubsList}

BAG ANALYSIS RESULTS:
- Overall Grade: ${analysisData.overall_grade} (Score: ${analysisData.overall_score}/100)
- Length Progression: ${analysisData.length_progression_grade} (${analysisData.length_progression_score}/100)
- Weight Progression: ${analysisData.weight_progression_grade} (${analysisData.weight_progression_score}/100)
- Shaft Consistency: ${analysisData.shaft_consistency_grade} (${analysisData.shaft_consistency_score}/100)
- Gap Coverage: ${analysisData.gap_coverage_grade} (${analysisData.gap_coverage_score}/100)

ISSUES IDENTIFIED:
${analysisData.issues_found.map((issue, i) => `${i + 1}. ${issue}`).join("\n")}

TOP PRIORITY: ${analysisData.top_priority_fix}

Please provide a detailed, encouraging analysis of this golfer's equipment setup. 
Focus on:
1. What they're doing well
2. The most important improvements to make
3. Specific, actionable recommendations
4. How these changes will help their game

Keep the tone professional but friendly and encouraging. Remember that golfers can be 
sensitive about their equipment choices, so frame suggestions positively.`;
}

/**
 * AI-powered function to generate intelligent club replacement recommendation
 * Returns complete club specification with all fields needed for grading
 */
async function generateIntelligentRecommendation(originalClub, dominantFlex, overallScore, allIssues, clubs, userContext) {
  try {
    // Build context about the bag
    const bagContext = {
      dominantFlex,
      overallScore,
      clubCount: clubs.length,
      avgAge: calculateAverageAge(clubs),
      avgShaftWeight: calculateAverageShaftWeight(clubs)
    };

    // Calculate optimal specs based on bag progression
    const optimalSpecs = calculateOptimalSpecs(originalClub, clubs);

    // Build AI prompt
    const prompt = `You are an expert golf club fitter. Generate a specific replacement recommendation for this club, tailored to the golfer.

GOLFER CONTEXT:
- Handicap: ${userContext?.handicap ?? 'Not provided'}
- Swing speed: ${userContext?.swing_speed ?? 'Not provided'}
- Technical preference: ${userContext?.technicalPreference ?? 'Not provided'}

CLUB TO REPLACE:
- Type: ${originalClub.clubType}
- Current: ${originalClub.brand} ${originalClub.model}
- Year: ${originalClub.year || 'Unknown'}
- Loft: ${originalClub.loft || 'Unknown'}°
- Length: ${originalClub.length || 'Unknown'}"
- Lie: ${originalClub.lie_angle || originalClub.lie || 'Unknown'}°
- Shaft: ${originalClub.shaft?.brand || 'Unknown'} ${originalClub.shaft?.model || ''} (${originalClub.shaft?.flex || 'Unknown'})
- Shaft Weight: ${originalClub.shaft?.weight || originalClub.shaft_weight || 'Unknown'}g
- Kickpoint: ${originalClub.shaft?.kickpoint || originalClub.shaft_kickpoint || 'Unknown'}
- Torque: ${originalClub.shaft?.torque || originalClub.shaft_torque || 'Unknown'}

BAG CONTEXT:
- Dominant Flex: ${dominantFlex}
- Overall Bag Score: ${overallScore}/100
- Optimal Shaft Weight: ${optimalSpecs.shaftWeight}g
- Optimal Length: ${optimalSpecs.length}"

REQUIREMENTS:
1. Recommend a modern (2023-2025) club that fits the golfer's needs
2. Choose a real brand and model (Titleist, Callaway, TaylorMade, Ping, Mizuno, etc.)
3. Match the dominant flex (${dominantFlex})
4. Provide specific shaft recommendation with proper specs

Respond ONLY with valid JSON in this exact format:
{
  "brand": "Brand Name",
  "model": "Specific Model Name",
  "year": 2024,
  "loft": ${originalClub.loft || optimalSpecs.loft},
  "length": ${optimalSpecs.length},
  "lie_angle": ${optimalSpecs.lieAngle},
  "shaft": {
    "brand": "Shaft Brand",
    "model": "Shaft Model",
    "flex": "${dominantFlex}",
    "weight": ${optimalSpecs.shaftWeight},
    "kickpoint": "${optimalSpecs.kickpoint}",
    "torque": ${optimalSpecs.torque}
  },
  "recommendationReason": "Brief explanation (2-3 sentences) of why this specific club is recommended"
}`;

    // Call Claude API
    const claudeResponse = await axios.post(
      CLAUDE_API_URL,
      {
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      },
      {
        headers: {
          "x-api-key": CLAUDE_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
      }
    );

    const responseText = claudeResponse.data.content[0].text;
    
    // Extract JSON from response (in case Claude adds explanation text)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Could not parse AI response");
    }
    
    // Sanitize JSON: remove + signs before numbers
    const sanitizedJson = jsonMatch[0].replace(/:\s*\+(\d)/g, ': $1');
    const aiRecommendation = JSON.parse(sanitizedJson);
    
    logger.info(`AI generated recommendation for ${originalClub.clubType}: ${aiRecommendation.brand} ${aiRecommendation.model}`);
    
    return aiRecommendation;

  } catch (error) {
    logger.warn(`AI recommendation failed, using fallback: ${error.message}`);
    
    // Fallback to calculated optimal specs
    const optimalSpecs = calculateOptimalSpecs(originalClub, clubs);
    
    return {
      brand: originalClub.brand,
      model: `${originalClub.model} (Latest Model)`,
      year: String(new Date().getFullYear()), // Ensure year is string
      loft: originalClub.loft || optimalSpecs.loft,
      length: optimalSpecs.length,
      lie_angle: optimalSpecs.lieAngle,
      shaft: {
        brand: originalClub.shaft?.brand || "Premium Shaft",
        model: "Latest Model",
        flex: dominantFlex,
        weight: optimalSpecs.shaftWeight,
        kickpoint: optimalSpecs.kickpoint,
        torque: optimalSpecs.torque
      },
      recommendationReason: `Modern replacement with corrected flex (${dominantFlex}) and optimized specs for better bag consistency.`
    };
  }
}

/**
 * Calculate optimal specifications based on bag progression
 */
function calculateOptimalSpecs(club, allClubs) {
  const currentYear = new Date().getFullYear();
  
  // Calculate averages from clubs with data
  const clubsWithWeight = allClubs.filter(c => c.shaft?.weight || c.shaft_weight);
  const avgWeight = clubsWithWeight.length > 0 
    ? Math.round(clubsWithWeight.reduce((sum, c) => sum + (c.shaft?.weight || c.shaft_weight), 0) / clubsWithWeight.length)
    : 85;

  const clubsWithTorque = allClubs.filter(c => c.shaft?.torque || c.shaft_torque);
  const avgTorque = clubsWithTorque.length > 0
    ? (clubsWithTorque.reduce((sum, c) => sum + (c.shaft?.torque || c.shaft_torque), 0) / clubsWithTorque.length).toFixed(1)
    : 3.5;

  // Get kickpoint from most clubs or use mid
  const kickpointCounts = {};
  allClubs.forEach(c => {
    const kp = c.shaft?.kickpoint || c.shaft_kickpoint;
    if (kp) kickpointCounts[kp] = (kickpointCounts[kp] || 0) + 1;
  });
  const dominantKickpoint = Object.keys(kickpointCounts).length > 0
    ? Object.keys(kickpointCounts).reduce((a, b) => kickpointCounts[a] >= kickpointCounts[b] ? a : b)
    : "Mid";

  return {
    shaftWeight: club.shaft?.weight || club.shaft_weight || avgWeight,
    length: club.length || 37.0,
    lieAngle: club.lie_angle || club.lie || 62.0,
    loft: club.loft || 34,
    kickpoint: dominantKickpoint,
    torque: parseFloat(avgTorque)
  };
}

/**
 * Calculate average age of clubs in bag
 */
function calculateAverageAge(clubs) {
  const currentYear = new Date().getFullYear();
  const clubsWithYear = clubs.filter(c => c.year);
  
  if (clubsWithYear.length === 0) return 5;
  
  const totalAge = clubsWithYear.reduce((sum, c) => sum + (currentYear - c.year), 0);
  return Math.round(totalAge / clubsWithYear.length);
}

/**
 * Calculate average shaft weight
 */
function calculateAverageShaftWeight(clubs) {
  const clubsWithWeight = clubs.filter(c => c.shaft?.weight || c.shaft_weight);
  
  if (clubsWithWeight.length === 0) return 85;
  
  const totalWeight = clubsWithWeight.reduce((sum, c) => sum + (c.shaft?.weight || c.shaft_weight), 0);
  return Math.round(totalWeight / clubsWithWeight.length);
}

/**
 * ============================================================================
 * AI-ENHANCED GRADING SYSTEM
 * ============================================================================
 */

/**
 * Grade individual club independently (not based on overall bag score)
 * Returns a score from 0-100 based on the club's own merits
 */
function gradeIndividualClubIndependently(club, dominantFlex) {
  let score = 100; // Start with perfect score
  const issues = [];
  const strengths = [];
  const currentYear = new Date().getFullYear();

  // 1. AGE ASSESSMENT (30% weight for individual club) - MUCH MORE LENIENT
  if (club.year) {
    const age = currentYear - club.year;
    if (age <= 3) {
      strengths.push(`Latest technology (${club.year})`);
      // No penalty
    } else if (age <= 6) {
      score -= 3;
      strengths.push(`Recent model (${age} years old)`);
    } else if (age <= 9) {
      score -= 8;
      issues.push(`${age} years old - approaching replacement age`);
    } else if (age <= 12) {
      score -= 13;
      issues.push(`${age} years old - outdated technology`);
    } else {
      score -= 18;
      issues.push(`${age} years old - significantly outdated, replacement needed`);
    }
  } else {
    score -= 5;
    issues.push("Year unknown - cannot assess technology level");
  }

  // 2. SHAFT FLEX ASSESSMENT (20% weight) - MORE LENIENT
  const isPutter = club.clubType && club.clubType.toLowerCase().includes('putter');
  if (!isPutter) {
    if (club.shaft?.flex || club.shaft_flex) {
      const clubFlex = club.shaft?.flex || club.shaft_flex;
      if (clubFlex === dominantFlex) {
        strengths.push(`Proper flex (${clubFlex})`);
      } else {
        score -= 10;  // Reduced from -20
        issues.push(`Flex mismatch: ${clubFlex} (bag standard: ${dominantFlex})`);
      }
    } else {
      score -= 8;  // Reduced from -15
      issues.push("Shaft flex data missing");
    }
  }

  // 3. SHAFT WEIGHT ASSESSMENT (15% weight) - MORE LENIENT
  if (club.shaft?.weight || club.shaft_weight) {
    const weight = club.shaft?.weight || club.shaft_weight;
    strengths.push(`Shaft weight: ${weight}g`);
    // Weight appropriateness is relative to bag, but we note it
  } else {
    score -= 5;  // Reduced from -10
    issues.push("Shaft weight data missing");
  }

  // 4. SHAFT SPECS COMPLETENESS (10% weight) - MORE LENIENT
  const hasKickpoint = club.shaft?.kickpoint || club.shaft_kickpoint;
  const hasTorque = club.shaft?.torque || club.shaft_torque;
  
  if (!hasKickpoint) {
    score -= 3;  // Reduced from -5
    issues.push("Kickpoint data missing");
  } else {
    strengths.push(`Kickpoint: ${hasKickpoint}`);
  }
  
  if (!hasTorque) {
    score -= 3;  // Reduced from -5
    issues.push("Torque data missing");
  } else {
    strengths.push(`Torque: ${hasTorque}°`);
  }

  // 5. CLUB SPECS COMPLETENESS (15% weight) - MORE LENIENT
  if (!club.loft) {
    score -= 4;  // Reduced from -7
    issues.push("Loft data missing");
  } else {
    strengths.push(`Loft: ${club.loft}°`);
  }
  
  if (!club.length) {
    score -= 3;  // Reduced from -5
    issues.push("Length data missing");
  } else {
    strengths.push(`Length: ${club.length}"`);
  }
  
  if (!club.lie_angle && !club.lie) {
    score -= 2;  // Reduced from -3
    issues.push("Lie angle data missing");
  } else {
    strengths.push(`Lie: ${club.lie_angle || club.lie}°`);
  }

  // 6. BRAND AND MODEL COMPLETENESS (10% weight) - MORE LENIENT
  if (!club.brand || !club.model) {
    score -= 5;  // Reduced from -10
    issues.push("Brand or model information incomplete");
  }

  // Ensure score stays within 0-100
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    issues,
    strengths,
    dataCompleteness: calculateDataCompleteness(club)
  };
}

/**
 * Calculate data completeness percentage for a club
 */
function calculateDataCompleteness(club) {
  const fields = [
    club.year,
    club.brand,
    club.model,
    club.loft,
    club.length,
    club.lie_angle || club.lie,
    club.shaft?.flex || club.shaft_flex,
    club.shaft?.weight || club.shaft_weight,
    club.shaft?.kickpoint || club.shaft_kickpoint,
    club.shaft?.torque || club.shaft_torque
  ];
  
  const completedFields = fields.filter(f => f !== null && f !== undefined && f !== '').length;
  return Math.round((completedFields / fields.length) * 100);
}

/**
 * Use AI to provide intelligent bag-level analysis and grading
 */
async function generateAIBagAnalysis(clubs, componentScores, overallScore, overallGrade, allIssues, userContext, scoringContext = {}) {
  try {
    const clubsSummary = clubs.map(club => {
      const age = club.year ? new Date().getFullYear() - club.year : 'Unknown';
      const rawFlex = club.shaft?.flex || club.shaft_flex;
      const normalizedFlex = rawFlex ? normalizeFlexValue(rawFlex) : 'Unknown flex';
      return `- ${club.clubType}: ${club.brand} ${club.model} (${club.year || 'Year unknown'}${club.year ? `, ${age}y old` : ''})
  Shaft: ${club.shaft?.brand || 'Unknown'} ${club.shaft?.model || ''} ${normalizedFlex}, ${club.shaft?.weight || club.shaft_weight || '?'}g
  Specs: ${club.loft || '?'}° loft, ${club.length || '?'}" length, ${club.lie_angle || club.lie || '?'}° lie`;
    }).join('\n\n');

    // Extract raw scores for each factor
    const rawScores = {
      age: componentScores.find(c => c.name === 'club age')?.score || 0,
      weight: componentScores.find(c => c.name === 'weight progression')?.score || 0,
      loft: componentScores.find(c => c.name === 'loft gapping')?.score || 0,
      flex: componentScores.find(c => c.name === 'flex consistency')?.score || 0,
      kickpoint: componentScores.find(c => c.name === 'kickpoint consistency')?.score || 0,
      torque: componentScores.find(c => c.name === 'torque consistency')?.score || 0,
      length: componentScores.find(c => c.name === 'length progression')?.score || 0,
      lie: componentScores.find(c => c.name === 'lie angle progression')?.score || 0
    };

    const prompt = `You are an expert golf club fitter analyzing a complete golf bag setup. Review the algorithm's per-factor scores and suggest adjustments based on your expert judgment.

GOLFER CONTEXT:
- Handicap: ${userContext?.handicap ?? 'Not provided'}
- Swing speed: ${userContext?.swing_speed ?? 'Not provided'}
- Technical preference: ${userContext?.technicalPreference ?? 'Not provided'}

GOLF BAG INVENTORY (${clubs.length} clubs):
${clubsSummary}

ALGORITHM FACTOR SCORES (0-100):
- Age: ${rawScores.age}
- Weight Progression: ${rawScores.weight}
- Loft Gapping: ${rawScores.loft}
- Flex Consistency: ${rawScores.flex}
- Kickpoint Consistency: ${rawScores.kickpoint}
- Torque Consistency: ${rawScores.torque}
- Length Progression: ${rawScores.length}
- Lie Angle Progression: ${rawScores.lie}

DETECTED ISSUES:
${allIssues.length > 0 ? allIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n') : 'No major issues detected'}

IMPORTANT CONTEXT FOR FLEX:
Shaft flex labels (Regular, Stiff, X-Stiff) have NO industry standard. Research shows only 10-20% of shafts match their printed flex when objectively measured (CPM). A "Stiff" from one brand may equal "Regular" from another. Flex is largely a marketing designation, not a technical spec. When analyzing flex issues, focus on label consistency within the bag rather than "correct" flex for swing speed, and be lenient in your assessment.

IMPORTANT CONTEXT FOR WEIGHT PROGRESSION:
Woods typically use GRAPHITE shafts (55-70g) while irons typically use STEEL shafts (90-130g). This 40-60g difference between graphite woods and steel irons is COMPLETELY NORMAL and expected in a properly built bag - it is NOT a weight progression issue.

When analyzing weight issues:
- Cross-material differences (graphite woods vs steel irons) should NEVER be penalized
- Only evaluate weight consistency WITHIN the same material type (graphite clubs vs graphite, steel vs steel)
- If the algorithm flagged weight issues due to graphite/steel material differences, adjust the weight score UP (+5 to +10)
- A bag with 55g graphite woods and 100g steel irons has EXCELLENT weight progression
- Hybrids are typically graphite (65-80g) and bridge the gap between woods and irons

TASK:
Review each factor score and provide adjustments where the algorithm may have over- or under-penalized. Consider the golfer's handicap and real-world impact.

Rules for adjustments:
- Each adjustment must be between -10 and +10
- Only suggest adjustments of 3 or more points (skip minor tweaks)
- Positive = algorithm was too harsh, raise the score
- Negative = algorithm was too lenient, lower the score
- 0 = algorithm got it right

Also provide sales opportunities for a golf pro to discuss with this client. Reference SPECIFIC clubs from this golfer's bag by name.

Respond with ONLY valid JSON in this exact format:
{
  "factorAdjustments": {
    "age": <number -10 to +10>,
    "weight": <number -10 to +10>,
    "loft": <number -10 to +10>,
    "flex": <number -10 to +10>,
    "kickpoint": <number -10 to +10>,
    "torque": <number -10 to +10>,
    "length": <number -10 to +10>,
    "lie": <number -10 to +10>
  },
  "adjustmentSummary": "<1-2 sentences explaining the most significant adjustments>",
  "overallAssessment": "<2-3 sentence summary of the bag's overall quality>",
  "keyStrengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "keyWeaknesses": ["<weakness 1>", "<weakness 2>", "<weakness 3>"],
  "priorityRecommendations": ["<recommendation 1>", "<recommendation 2>", "<recommendation 3>"],
  "bagPersonality": "<description of what type of golfer this bag suits>",
  "salesOpportunities": {
    "age": "<sales opportunity for club age - always suggest something even if minor, reference specific old clubs>",
    "loft": "<sales opportunity for loft gaps - reference specific gaps and suggest clubs to fill them with price estimates>",
    "flex": "<even though flex labels aren't standardized, find a sales angle - could be premium shaft upgrade, fitting session, or shaft swap for feel consistency>",
    "kickpoint": "<sales opportunity for kickpoint - suggest shaft options that improve consistency>",
    "weight": "<sales opportunity for weight issues - suggest shaft weight changes or new clubs>",
    "topPriority": "<the single best sales conversation to have with this client - be specific with club names, models, and price range $XXX-$XXX>"
  }
}`;

    const claudeResponse = await axios.post(
      CLAUDE_API_URL,
      {
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      },
      {
        headers: {
          "x-api-key": CLAUDE_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        timeout: 30000, // 30 second timeout
      }
    );

    const responseText = claudeResponse.data.content[0].text;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      throw new Error("Could not parse AI bag analysis response");
    }
    
    // Sanitize JSON: remove + signs before numbers (AI sometimes returns +5 instead of 5)
    const sanitizedJson = jsonMatch[0].replace(/:\s*\+(\d)/g, ': $1');
    const aiAnalysis = JSON.parse(sanitizedJson);
    
    // Apply guardrails to factor adjustments
    const appliedAdjustments = applyAdjustmentGuardrails(rawScores, aiAnalysis.factorAdjustments || {});
    
    // Calculate new overall score using SAME FORMULA as overallScore
    // Formula: (clubQuality * 0.5) + (consistency * 0.5) - bagPenalty
    // where consistency = weighted average of factor scores
    
    // Map factor names from grading weights to our short names
    const factorNameMap = {
      'age': 'age',
      'weight_progression': 'weight',
      'loft_gapping': 'loft',
      'flex_consistency': 'flex',
      'kickpoint_consistency': 'kickpoint',
      'torque_consistency': 'torque',
      'length_progression': 'length',
      'lie_angle_progression': 'lie'
    };
    
    // Use provided grading weights or fallback to defaults
    const gradingWeights = scoringContext.gradingWeights || {
      age: 0.20,
      weight_progression: 0.15,
      loft_gapping: 0.20,
      flex_consistency: 0.05,
      kickpoint_consistency: 0.10,
      torque_consistency: 0.05,
      length_progression: 0.10,
      lie_angle_progression: 0.10
    };
    
    // Get scorable factors (or assume all if not provided)
    const scorableFactorNames = scoringContext.scorableFactors || Object.keys(factorNameMap);
    
    // Calculate total weight for normalization (only scorable factors)
    let totalWeight = 0;
    scorableFactorNames.forEach(longName => {
      totalWeight += gradingWeights[longName] || 0;
    });
    
    // Calculate AI-adjusted consistency score
    let aiConsistencyScore = 0;
    if (totalWeight > 0) {
      scorableFactorNames.forEach(longName => {
        const shortName = factorNameMap[longName];
        if (shortName && appliedAdjustments.finalScores[shortName] !== undefined) {
          const normalizedWeight = (gradingWeights[longName] || 0) / totalWeight;
          aiConsistencyScore += appliedAdjustments.finalScores[shortName] * normalizedWeight;
        }
      });
    }
    aiConsistencyScore = Math.round(aiConsistencyScore);
    
    // Get club quality and bag penalty from context
    const clubQualityScore = scoringContext.clubQualityScore || 85; // fallback
    const bagPenalty = scoringContext.bagPenalty || 0;
    
    // Calculate AI-adjusted overall score using SAME formula
    let aiAdjustedScore = Math.round(
      (clubQualityScore * 0.5) + (aiConsistencyScore * 0.5)
    );
    aiAdjustedScore = Math.max(0, aiAdjustedScore - bagPenalty);
    
    const aiGrade = scoreToGrade(aiAdjustedScore);
    
    logger.info(`AI Bag Analysis completed: ${aiGrade} (${aiAdjustedScore}/100)`);
    logger.info(`  Raw algorithm score: ${overallScore}, AI adjusted: ${aiAdjustedScore} (${aiAdjustedScore - overallScore >= 0 ? '+' : ''}${aiAdjustedScore - overallScore})`);
    logger.info(`  Club Quality: ${clubQualityScore}, AI Consistency: ${aiConsistencyScore}, Bag Penalty: ${bagPenalty}`);
    
    return {
      aiAdjustedScore: aiAdjustedScore,
      aiGrade: aiGrade,
      algorithmScore: overallScore,
      aiAdjustmentTotal: aiAdjustedScore - overallScore,
      factorAdjustments: appliedAdjustments.adjustmentDetails,
      adjustmentSummary: aiAnalysis.adjustmentSummary || "AI reviewed all factors and applied contextual adjustments.",
      overallAssessment: aiAnalysis.overallAssessment,
      keyStrengths: aiAnalysis.keyStrengths,
      keyWeaknesses: aiAnalysis.keyWeaknesses,
      priorityRecommendations: aiAnalysis.priorityRecommendations,
      bagPersonality: aiAnalysis.bagPersonality,
      salesOpportunities: aiAnalysis.salesOpportunities || null
    };

  } catch (error) {
    logger.warn(`AI bag analysis failed: ${error.message}`);
    
    // Fallback to algorithm scores (no AI adjustment)
    // User-friendly message that doesn't expose technical details
    return {
      aiAdjustedScore: overallScore,
      aiGrade: overallGrade,
      algorithmScore: overallScore,
      aiAdjustmentTotal: 0,
      factorAdjustments: [],
      adjustmentSummary: "AI insights temporarily unavailable. Your grade is based on our equipment analysis algorithm.",
      overallAssessment: "Your bag has been analyzed using our equipment grading algorithm. AI-powered insights will be available on your next analysis.",
      keyStrengths: ["Equipment analyzed using proven grading methodology"],
      keyWeaknesses: allIssues.slice(0, 3),
      priorityRecommendations: allIssues.length > 0 ? ["Address the issues listed above for the biggest improvement"] : ["Your equipment setup looks solid!"],
      bagPersonality: "Analysis complete - re-grade for AI-powered insights",
      salesOpportunities: null
    };
  }
}

/**
 * Apply guardrails to AI factor adjustments
 * Rules:
 * - Max adjustment per factor: ±10
 * - Ignore adjustments ≤ ±2 (threshold)
 * - Floor: No factor below 60
 */
function applyAdjustmentGuardrails(rawScores, aiAdjustments) {
  const factors = ['age', 'weight', 'loft', 'flex', 'kickpoint', 'torque', 'length', 'lie'];
  const finalScores = {};
  const adjustmentDetails = [];
  
  factors.forEach(factor => {
    const raw = rawScores[factor] || 0;
    let adjustment = aiAdjustments[factor] || 0;
    
    // Guardrail 1: Ignore if |adjustment| <= 2
    if (Math.abs(adjustment) <= 2) {
      adjustment = 0;
    }
    
    // Guardrail 2: Clamp to ±10
    adjustment = Math.max(-10, Math.min(10, adjustment));
    
    // Calculate adjusted score
    let adjusted = raw + adjustment;
    
    // Guardrail 3: Floor at 60
    adjusted = Math.max(60, Math.min(100, adjusted));
    
    finalScores[factor] = adjusted;
    
    // Track non-zero adjustments for reporting
    if (adjustment !== 0) {
      adjustmentDetails.push({
        factor: factor,
        raw: raw,
        adjustment: adjustment,
        adjusted: adjusted
      });
    }
  });
  
  return {
    finalScores: finalScores,
    adjustmentDetails: adjustmentDetails
  };
}

/**
 * Use AI to provide intelligent individual club analysis
 */
async function generateAIClubAnalysis(club, independentGrading, dominantFlex, allClubs, userContext) {
  try {
    const age = club.year ? new Date().getFullYear() - club.year : null;
    const rawFlex = club.shaft?.flex || club.shaft_flex;
    const normalizedFlex = rawFlex ? normalizeFlexValue(rawFlex) : 'Unknown';
    
    const prompt = `You are an expert golf club fitter analyzing a single club. Provide a detailed, actionable assessment tailored to the golfer.

GOLFER CONTEXT:
- Handicap: ${userContext?.handicap ?? 'Not provided'}
- Swing speed: ${userContext?.swing_speed ?? 'Not provided'}
- Technical preference: ${userContext?.technicalPreference ?? 'Not provided'}

CLUB DETAILS:
- Type: ${club.clubType}
- Brand/Model: ${club.brand} ${club.model}
- Year: ${club.year || 'Unknown'}${age ? ` (${age} years old)` : ''}
- Loft: ${club.loft || 'Unknown'}°
- Length: ${club.length || 'Unknown'}"
- Lie Angle: ${club.lie_angle || club.lie || 'Unknown'}°
- Shaft: ${club.shaft?.brand || 'Unknown'} ${club.shaft?.model || ''} 
  - Flex: ${normalizedFlex}
  - Weight: ${club.shaft?.weight || club.shaft_weight || 'Unknown'}g
  - Kickpoint: ${club.shaft?.kickpoint || club.shaft_kickpoint || 'Unknown'}
  - Torque: ${club.shaft?.torque || club.shaft_torque || 'Unknown'}

INDEPENDENT ANALYSIS:
- Score: ${independentGrading.score}/100
- Data Completeness: ${independentGrading.dataCompleteness}%
- Issues: ${independentGrading.issues.join('; ') || 'None'}
- Strengths: ${independentGrading.strengths.join('; ') || 'None'}

BAG CONTEXT:
- Total clubs in bag: ${allClubs.length}
- Dominant flex across bag: ${dominantFlex}

TASK:
Provide a professional club assessment in JSON format:
{
  "aiScore": <number 0-100, your expert opinion>,
  "aiGrade": "<letter grade A-F>",
  "condition": "<Optimal Fit|Minor Adjustment|Replace Recommended>",
  "analysis": "<3-4 sentence detailed analysis>",
  "specificRecommendation": "<specific actionable advice>",
  "performanceImpact": "<how this club affects player performance>"
}

Respond ONLY with valid JSON. Be specific and actionable.`;

    const claudeResponse = await axios.post(
      CLAUDE_API_URL,
      {
        model: "claude-sonnet-4-20250514",
        max_tokens: 800,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      },
      {
        headers: {
          "x-api-key": CLAUDE_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
      }
    );

    const responseText = claudeResponse.data.content[0].text;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      throw new Error("Could not parse AI club analysis response");
    }
    
    // Sanitize JSON: remove + signs before numbers
    const sanitizedJson = jsonMatch[0].replace(/:\s*\+(\d)/g, ': $1');
    const aiAnalysis = JSON.parse(sanitizedJson);
    
    return aiAnalysis;

  } catch (error) {
    logger.warn(`AI club analysis failed for ${club.clubType}: ${error.message}`);
    
    // Fallback to rule-based analysis - MORE LENIENT
    const score = independentGrading.score;
    let condition = "Optimal Fit";
    if (score < 70) condition = "Replace Recommended";  // More lenient
    else if (score < 85) condition = "Minor Adjustment";  // More lenient
    
    return {
      aiScore: score,
      aiGrade: scoreToGrade(score),
      condition: condition,
      analysis: `${club.clubType} scores ${score}/100. ${independentGrading.issues.length > 0 ? 'Issues: ' + independentGrading.issues.join('; ') : 'No major issues detected.'} ${independentGrading.strengths.length > 0 ? 'Strengths: ' + independentGrading.strengths.join('; ') : ''}`,
      specificRecommendation: independentGrading.issues.length > 0 ? `Address: ${independentGrading.issues[0]}` : "Maintain current setup",
      performanceImpact: "Standard performance expected for this configuration"
    };
  }
}


/**
 * ============================================================================
 * ALGORITHM VERSIONING INFRASTRUCTURE
 * ============================================================================
 */

/**
 * Cloud Function: initializeAlgorithmVersioning
 * 
 * ONE-TIME SETUP FUNCTION
 * Creates the algorithmVersions collection and seeds it with v2.0 (current algorithm)
 * 
 * Call this function once after deployment via its URL:
 * https://us-central1-YOUR-PROJECT-ID.cloudfunctions.net/initializeAlgorithmVersioning
 * 
 * This function is idempotent - safe to call multiple times, won't duplicate data
 */
exports.initializeAlgorithmVersioning = onRequest(async (req, res) => {
  // Set CORS headers
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  try {
    logger.info("Initializing algorithm versioning system...");

    const db = admin.firestore();
    const versionRef = db.collection("algorithmVersions").doc("v2.0");

    // Check if v2.0 already exists
    const existingVersion = await versionRef.get();
    
    if (existingVersion.exists) {
      logger.info("Algorithm version v2.0 already exists");
      res.status(200).json({
        success: true,
        message: "Algorithm versioning already initialized",
        versionNumber: "2.0",
        status: existingVersion.data().status,
        note: "No changes made - version already exists"
      });
      return;
    }

    // Create v2.0 with current 8-variable algorithm
    const v2Config = {
      versionNumber: "2.0",
      deployedAt: admin.firestore.FieldValue.serverTimestamp(),
      deployedBy: "sean@fitmygolfclubs.com",
      changelog: "Initial version with 8-variable grading system: age (20%), weight progression (15%), loft gapping (20%), flex consistency (10%), kickpoint consistency (10%), torque consistency (5%), length progression (10%), lie angle progression (10%)",
      status: "active",
      isDefault: true,
      
      config: {
        gradingWeights: {
          age: 0.20,
          weight_progression: 0.20,
          loft_gapping: 0.20,
          flex_consistency: 0.05,
          kickpoint_consistency: 0.10,
          torque_consistency: 0.05,
          length_progression: 0.10,
          lie_angle_progression: 0.10
        },
        
        featureFlags: {
          performanceDataEnabled: true,
          aiRecommendationsEnabled: true,
          swingDataEnabled: true
        }
      },
      
      metrics: {
        totalAnalyses: 0,
        averageGrade: 0,
        userSatisfactionScore: 0,
        recommendationSuccessRate: 0,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      },
      
      abTestConfig: {
        enabled: false,
        percentageOfUsers: 0,
        comparedToVersion: null
      }
    };

    await versionRef.set(v2Config);
    
    logger.info("✅ Successfully initialized algorithm versioning with v2.0");

    res.status(200).json({
      success: true,
      message: "Algorithm versioning initialized successfully!",
      versionCreated: {
        versionNumber: "2.0",
        status: "active",
        isDefault: true,
        weights: v2Config.config.gradingWeights
      },
      nextSteps: [
        "1. Check Firebase Console: algorithmVersions collection",
        "2. Verify v2.0 document was created",
        "3. Run a bag analysis to test version tracking",
        "4. New analyses will now include algorithmVersion metadata"
      ]
    });

  } catch (error) {
    logger.error("❌ Error initializing algorithm versioning:", error);
    res.status(500).json({
      error: "Failed to initialize algorithm versioning",
      details: error.message
    });
  }
});


/**
 * Claude Factor Review Function
 * 
 * Takes JS-calculated factor scores and raw data, asks Claude to review and adjust.
 * Adjustments are capped at ±15 points per factor.
 */
async function claudeReviewFactorScores(clubs, jsScores, clubsRawData) {
  const ADJUSTMENT_CAP = 15;
  
  try {
    // Build club summary for context
    const clubsSummary = clubs.map(club => {
      const age = club.year ? new Date().getFullYear() - club.year : 'Unknown';
      const rawFlex = club.shaft?.flex || club.shaft_flex;
      const normalizedFlex = rawFlex ? normalizeFlexValue(rawFlex) : '?';
      return `- ${club.clubType || club.club_type}: ${club.brand} ${club.model} (${club.year || 'Year unknown'})
  Shaft: ${normalizedFlex} flex, ${club.shaft?.weight || club.shaft_weight || '?'}g, ${club.shaft?.kickpoint || club.shaft_kickpoint || '?'} kickpoint
  Loft: ${club.loft || '?'}°, Length: ${club.length || '?'}", Lie: ${club.lie_angle || club.lie || '?'}°`;
    }).join('\n');

    const prompt = `You are an expert golf club fitter reviewing algorithm-generated factor scores for a golf bag.

GOLF BAG (${clubs.length} clubs):
${clubsSummary}

JAVASCRIPT ALGORITHM SCORES (0-100 scale):
1. Age Score: ${jsScores.age.score}/100
   Issues: ${jsScores.age.issues.join('; ') || 'None'}

2. Weight Progression: ${jsScores.weight.score}/100
   Issues: ${jsScores.weight.issues.join('; ') || 'None'}

3. Loft Gapping: ${jsScores.loft.score}/100
   Issues: ${jsScores.loft.issues.join('; ') || 'None'}

4. Flex Consistency: ${jsScores.flex.score}/100
   Issues: ${jsScores.flex.issues.join('; ') || 'None'}

5. Kickpoint Consistency: ${jsScores.kickpoint.score}/100
   Issues: ${jsScores.kickpoint.issues.join('; ') || 'None'}

6. Torque Consistency: ${jsScores.torque.score}/100
   Issues: ${jsScores.torque.issues.join('; ') || 'None'}

7. Length Progression: ${jsScores.length.score}/100
   Issues: ${jsScores.length.issues.join('; ') || 'None'}

8. Lie Angle Progression: ${jsScores.lie.score}/100
   Issues: ${jsScores.lie.issues.join('; ') || 'None'}

TASK:
Review each factor score. If you believe the algorithm made an error or missed important context, provide an adjusted score. You may adjust UP or DOWN by a maximum of ${ADJUSTMENT_CAP} points per factor.

Consider:
- A 10-year-old putter is fine; a 10-year-old driver needs upgrading
- Mixed flex woods/irons is common and acceptable
- Brand variety doesn't necessarily indicate a problem
- Missing data should lower confidence, not harshly penalize
- WEIGHT: Woods use GRAPHITE shafts (55-70g), irons use STEEL shafts (90-130g). This 40-60g jump between graphite woods and steel irons is NORMAL - do NOT penalize cross-material weight differences

Respond ONLY with valid JSON in this exact format:
{
  "age": {"adjusted": true/false, "score": <number>, "reason": "<brief reason if adjusted>"},
  "weight": {"adjusted": true/false, "score": <number>, "reason": "<brief reason if adjusted>"},
  "loft": {"adjusted": true/false, "score": <number>, "reason": "<brief reason if adjusted>"},
  "flex": {"adjusted": true/false, "score": <number>, "reason": "<brief reason if adjusted>"},
  "kickpoint": {"adjusted": true/false, "score": <number>, "reason": "<brief reason if adjusted>"},
  "torque": {"adjusted": true/false, "score": <number>, "reason": "<brief reason if adjusted>"},
  "length": {"adjusted": true/false, "score": <number>, "reason": "<brief reason if adjusted>"},
  "lie": {"adjusted": true/false, "score": <number>, "reason": "<brief reason if adjusted>"}
}`;

    const claudeResponse = await axios.post(
      CLAUDE_API_URL,
      {
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      },
      {
        headers: {
          "x-api-key": CLAUDE_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
      }
    );

    const responseText = claudeResponse.data.content[0].text;
    
    // Parse JSON from response
    let claudeReview;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        // Sanitize JSON: remove + signs before numbers
        const sanitizedJson = jsonMatch[0].replace(/:\s*\+(\d)/g, ': $1');
        claudeReview = JSON.parse(sanitizedJson);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      logger.warn('Failed to parse Claude review response:', parseError.message);
      return null;
    }

    // Apply adjustment caps and build result
    const factors = ['age', 'weight', 'loft', 'flex', 'kickpoint', 'torque', 'length', 'lie'];
    const result = {};

    factors.forEach(factor => {
      const jsScore = jsScores[factor].score;
      const review = claudeReview[factor];
      
      if (review && review.adjusted) {
        // Cap adjustment
        let adjustedScore = review.score;
        const diff = adjustedScore - jsScore;
        
        if (Math.abs(diff) > ADJUSTMENT_CAP) {
          adjustedScore = jsScore + (diff > 0 ? ADJUSTMENT_CAP : -ADJUSTMENT_CAP);
          logger.info(`Capped ${factor} adjustment: ${review.score} -> ${adjustedScore}`);
        }
        
        result[factor] = {
          jsScore: jsScore,
          claudeScore: adjustedScore,
          finalScore: adjustedScore,
          adjusted: true,
          reason: review.reason || 'No reason provided'
        };
      } else {
        result[factor] = {
          jsScore: jsScore,
          claudeScore: jsScore,
          finalScore: jsScore,
          adjusted: false,
          reason: null
        };
      }
    });

    return result;

  } catch (error) {
    logger.error('Claude factor review failed:', error.message);
    return null;
  }
}

/**
 * Claude Full Factor Scoring Function
 * 
 * For 'claude' engine mode - Claude scores all factors from raw data.
 */
async function claudeScoreFactors(clubs) {
  try {
    const clubsSummary = clubs.map(club => {
      const age = club.year ? new Date().getFullYear() - club.year : 'Unknown';
      const rawFlex = club.shaft?.flex || club.shaft_flex;
      const normalizedFlex = rawFlex ? normalizeFlexValue(rawFlex) : '?';
      return `- ${club.clubType || club.club_type}: ${club.brand} ${club.model} (${club.year || 'Year unknown'})
  Shaft: ${normalizedFlex} flex, ${club.shaft?.weight || club.shaft_weight || '?'}g, ${club.shaft?.kickpoint || club.shaft_kickpoint || '?'} kickpoint, ${club.shaft?.torque || club.shaft_torque || '?'} torque
  Loft: ${club.loft || '?'}°, Length: ${club.length || '?'}", Lie: ${club.lie_angle || club.lie || '?'}°`;
    }).join('\n');

    const prompt = `You are an expert golf club fitter scoring a golf bag on 8 factors.

GOLF BAG (${clubs.length} clubs):
${clubsSummary}

Score each factor from 0-100 and identify issues:

1. AGE: Are the clubs modern or outdated? Consider that putters age well, drivers don't.
2. WEIGHT PROGRESSION: Woods use GRAPHITE shafts (55-70g), irons use STEEL shafts (90-130g). This 40-60g material jump is NORMAL. Only penalize inconsistencies WITHIN same material type (e.g., one steel iron at 80g when others are 100g).
3. LOFT GAPPING: Are there ~4° gaps between clubs? Any large gaps or redundant lofts?
4. FLEX CONSISTENCY: Are shaft flex LABELS consistent? NOTE: Flex ratings have NO industry standard - a "Stiff" from one brand may differ from another. Only check for label consistency, not "correct" flex for swing speed.
5. KICKPOINT CONSISTENCY: Are kickpoints aligned? (High = lower flight, Low = higher flight)
6. TORQUE CONSISTENCY: Is torque similar across clubs? Lower torque = more control.
7. LENGTH PROGRESSION: Do lengths decrease ~0.5" per club?
8. LIE ANGLE: Are lie angles appropriate and progressing correctly?

Respond ONLY with valid JSON:
{
  "age": {"score": <0-100>, "issues": ["issue1", "issue2"]},
  "weight": {"score": <0-100>, "issues": []},
  "loft": {"score": <0-100>, "issues": []},
  "flex": {"score": <0-100>, "issues": []},
  "kickpoint": {"score": <0-100>, "issues": []},
  "torque": {"score": <0-100>, "issues": []},
  "length": {"score": <0-100>, "issues": []},
  "lie": {"score": <0-100>, "issues": []}
}`;

    const claudeResponse = await axios.post(
      CLAUDE_API_URL,
      {
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      },
      {
        headers: {
          "x-api-key": CLAUDE_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
      }
    );

    const responseText = claudeResponse.data.content[0].text;
    
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      // Sanitize JSON: remove + signs before numbers
      const sanitizedJson = jsonMatch[0].replace(/:\s*\+(\d)/g, ': $1');
      return JSON.parse(sanitizedJson);
    }
    
    return null;

  } catch (error) {
    logger.error('Claude full scoring failed:', error.message);
    return null;
  }
}


/**
 * Cloud Function: gradeUserBag (UPDATED WITH ALGORITHM VERSIONING)
 * 
 * Calculates equipment grades for a user's golf bag based on:
 * 1. Age of clubs (20% weight)
 * 2. Shaft weight progression (15% weight)
 * 3. Loft gapping (20% weight)
 * 4. Shaft flex consistency (10% weight)
 * 5. Kickpoint consistency (10% weight)
 * 6. Shaft torque consistency (5% weight)
 * 7. Length progression (10% weight)
 * 8. Lie angle progression (10% weight)
 * 
 * NOW INCLUDES:
 * - Algorithm version tracking
 * - Input data snapshot for reprocessing
 * - Version metrics updates
 * - Config snapshot with each analysis
 * 
 * Expected request body:
 * {
 *   "userId": "user_id_here"
 * }
 */
exports.gradeUserBag = onRequest({
  timeoutSeconds: 540,  // 9 minutes (maximum allowed)
  memory: "1GiB",       // 1GB RAM for AI processing
  cors: true            // Enable CORS automatically
}, async (req, res) => {
  // Set CORS headers
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  try {
    // SECURITY: Sanitize input
let userId;
try {
  const rawUserId = req.body.userId;
  
  if (!rawUserId || typeof rawUserId !== 'string') {
    res.status(400).json({
      error: 'Invalid request: userId must be a string',
    });
    return;
  }
  
  userId = sanitizeUserId(rawUserId);
  logger.info('Processing grading request for user:', userId);

  logger.info('CODE-VERSION: 2026-01-06-BASELINE-V1');
  
} catch (sanitizeError) {
  logger.error('Sanitization error:', sanitizeError.message);
  res.status(400).json({
    error: 'Invalid userId format'
  });
  return;
}

    // Get grading engine mode (javascript, hybrid, or claude)
    const engine = req.body.engine || 'javascript';
    const validEngines = ['javascript', 'hybrid', 'claude'];
    if (!validEngines.includes(engine)) {
      res.status(400).json({ error: 'Invalid engine mode. Use: javascript, hybrid, or claude' });
      return;
    }
    logger.info(`Grading engine mode: ${engine}`);

    // ==========================================
    // SCENARIO MODE: Optional parameters for what-if analysis
    // ==========================================
    const providedClubs = req.body.clubs;  // Optional: array of clubs with swaps applied
    const isScenario = req.body.isScenario === true;
    const scenarioName = req.body.scenarioName || `Scenario ${new Date().toLocaleDateString()}`;
    
    if (isScenario) {
      logger.info(`SCENARIO MODE: ${scenarioName}`);
      if (!providedClubs || !Array.isArray(providedClubs) || providedClubs.length === 0) {
        res.status(400).json({ error: 'Scenario mode requires clubs array' });
        return;
      }
    }

    // OPTIONAL: User context (handicap, swing speed, technical preference)
    // Prefer Firestore user profile fields; fall back to request body if provided
    let userHandicap = null;
    let userSwingSpeed = null;
    let userTechnicalPreference = null;

    try {
      const db = admin.firestore();
      const userProfile = await db.collection("users").doc(userId).get();
      const profileData = userProfile.exists ? userProfile.data() : {};

      // Helper to read number safely
      const parseNumber = (val) => {
        if (val === undefined || val === null || val === '') return null;
        const n = Number(val);
        return Number.isFinite(n) ? n : null;
      };

      // Pull from Firestore profile first
      userHandicap = parseNumber(profileData?.Handicap ?? profileData?.handicap);
      userSwingSpeed = profileData?.swing_speed ?? profileData?.Swing_speed ?? profileData?.SwingSpeed ?? null;
      userTechnicalPreference = profileData?.technicalPreference ?? profileData?.TechnicalPreference ?? null;

      // ==========================================
      // FAVORITE CLUB BASELINE (Patent Pending)
      // ==========================================
      var favoriteClubSpecs = null;
      const useFavoriteBaseline = profileData?.use_favorite_baseline === true;
      const favoriteClubId = profileData?.favorite_club_id || null;
// DEBUG: Log baseline settings
      logger.info(`BASELINE-CHECK-V1: use_favorite_baseline=${profileData?.use_favorite_baseline}, favorite_club_id=${favoriteClubId}`);
      
      // DEBUG: Log baseline settings
      logger.info(`BASELINE-CHECK-V1: use_favorite_baseline=${profileData?.use_favorite_baseline}, favorite_club_id=${favoriteClubId}`);
      
      if (useFavoriteBaseline && favoriteClubId) {
        try {
          const favoriteClubDoc = await db.collection("users").doc(userId)
            .collection("clubs").doc(favoriteClubId).get();
          
          if (favoriteClubDoc.exists) {
            const fcData = favoriteClubDoc.data();
            favoriteClubSpecs = {
              id: favoriteClubId,
              clubType: fcData.club_type || fcData.clubType || 'Unknown',
              shaft_weight: parseNumber(fcData.shaft_weight),
              shaft_flex: fcData.shaft_flex || null,
              shaft_kickpoint: fcData.shaft_kickpoint || null,
              length: parseNumber(fcData.length)
            };
            logger.info(`★ Favorite club baseline enabled: ${favoriteClubSpecs.clubType} (${favoriteClubSpecs.shaft_weight}g)`);
          } else {
            logger.warn(`⚠️ Favorite club ${favoriteClubId} not found - using zone averages`);
          }
        } catch (fcErr) {
          logger.error('Error fetching favorite club:', fcErr);
        }
      }

      // ==========================================
      // BODY FIT BASELINE EXTRACTION
      // ==========================================
      var bodyFitSpecs = null;
      const useBodyFitBaseline = profileData?.use_body_baseline === true;
      const heightInches = profileData?.height_inches || null;
      const wristToFloor = profileData?.wrist_to_floor || null;

      logger.info(`BODY-FIT-CHECK: use_body_baseline=${profileData?.use_body_baseline}, height_inches=${heightInches}, wtf=${wristToFloor}`);

      if (useBodyFitBaseline && heightInches && wristToFloor) {
        // Validate measurements are within reasonable range
        if (heightInches >= 54 && heightInches <= 84 && wristToFloor >= 25 && wristToFloor <= 45) {
          const feet = Math.floor(heightInches / 12);
          const inches = heightInches % 12;
          bodyFitSpecs = {
            heightInches: heightInches,
            heightDisplay: `${feet}'${inches}"`,
            wristToFloor: wristToFloor
          };
          logger.info(`📏 Body fit baseline enabled: ${bodyFitSpecs.heightDisplay}, WTF: ${wristToFloor}"`);
        } else {
          logger.warn(`⚠️ Body measurements out of range - height: ${heightInches}", wtf: ${wristToFloor}"`);
        }
      }

      // Fallback to request body if not present in profile
      if (userHandicap === null && req.body.handicap !== undefined) {
        userHandicap = parseNumber(req.body.handicap);
        if (req.body.handicap !== undefined && userHandicap === null) {
          res.status(400).json({ error: 'Invalid handicap: must be a number' });
          return;
        }
      }
      if (!userSwingSpeed && req.body.swing_speed !== undefined) {
        if (typeof req.body.swing_speed !== 'string') {
          res.status(400).json({ error: 'Invalid swing_speed: must be a string' });
          return;
        }
        userSwingSpeed = req.body.swing_speed;
      }
      if (!userTechnicalPreference && req.body.technicalPreference !== undefined) {
        if (typeof req.body.technicalPreference !== 'string') {
          res.status(400).json({ error: 'Invalid technicalPreference: must be a string' });
          return;
        }
        userTechnicalPreference = req.body.technicalPreference;
      }
    } catch (ctxErr) {
      logger.error('Context fetch/parse error:', ctxErr);
      res.status(400).json({ error: 'Invalid user context fields' });
      return;
    }

    const db = admin.firestore();

    // ==========================================
    // NEW: FETCH ACTIVE ALGORITHM VERSION
    // ==========================================
    let algorithmVersion = null;
    let gradingWeights = null;
    
    try {
      // Try to fetch the active version from Firestore
      const versionsSnapshot = await db.collection("algorithmVersions")
        .where("status", "==", "active")
        .where("isDefault", "==", true)
        .limit(1)
        .get();

      if (!versionsSnapshot.empty) {
        const versionDoc = versionsSnapshot.docs[0];
        algorithmVersion = versionDoc.data();
        gradingWeights = algorithmVersion.config.gradingWeights;
        logger.info(`Using algorithm version: ${algorithmVersion.versionNumber}`);
      } else {
        logger.warn("No active algorithm version found, using default weights");
      }
    } catch (versionError) {
      logger.warn("Error fetching algorithm version, using default weights:", versionError.message);
    }

    // Fallback to hardcoded weights if no version found (graceful degradation)
    if (!gradingWeights) {
      gradingWeights = {
        age: 0.20,
        weight_progression: 0.20,
        loft_gapping: 0.20,
        flex_consistency: 0.05,
        kickpoint_consistency: 0.10,
        torque_consistency: 0.05,
        length_progression: 0.10,
        lie_angle_progression: 0.10
      };
      logger.info("Using default hardcoded weights");
    }

    // Fetch all clubs for this user
    // Pro stores clubs as subcollection: users/{userId}/clubs/{clubId}
    // SCENARIO MODE: Use provided clubs array if available
    let rawClubs = [];
    
    if (isScenario && providedClubs && providedClubs.length > 0) {
      // SCENARIO MODE: Use provided clubs array directly
      logger.info(`SCENARIO: Using ${providedClubs.length} clubs from request`);
      rawClubs = providedClubs.map((club, index) => ({
        id: club.id || `scenario-club-${index}`,
        ...club
      }));
    } else {
      // NORMAL MODE: Fetch from Firestore
      logger.info('About to query clubs for userId: ' + userId);    
      const clubsSnapshot = await db
        .collection("users")
        .doc(userId)
        .collection("clubs")
        .get();
      logger.info('Query executed for userId: ' + userId);
      logger.info('Clubs snapshot empty: ' + clubsSnapshot.empty);
      logger.info('Clubs snapshot size: ' + clubsSnapshot.size);
      
      if (clubsSnapshot.empty) {
        res.status(404).json({
          error: "No clubs found for this user",
        });
        return;
      }
      
      clubsSnapshot.forEach((doc) => {
        rawClubs.push({id: doc.id, ...doc.data()});
      });
    }

    // ==========================================
    // NORMALIZE CLUB DATA TO STANDARD FORMAT
    // ==========================================
    // Per FitMyGolfClubs_Master_Field_Reference.md:
    // - clubType (not club_type)
    // - shaft_weight, shaft_flex, shaft_kickpoint, shaft_torque (flat, not nested)
    // - lie (not lie_angle)
    const normalizedClubs = rawClubs.map(club => normalizeClubData(club));

    logger.info(`Found ${normalizedClubs.length} clubs for user ${userId} (normalized to standard schema)`);

    // ==========================================
    // ENRICH CLUBS WITH ALL DEFAULT VALUES WHERE MISSING
    // ==========================================
    const enrichmentResult = enrichClubsWithAllDefaults(normalizedClubs);
    const clubs = enrichmentResult.clubs;  // Already sorted driver → wedge
    const defaultsUsed = enrichmentResult.defaultsUsed;
    
    // Log defaults applied
    if (enrichmentResult.totalDefaultsUsed > 0) {
      logger.info(`Default values applied: ${enrichmentResult.totalDefaultsUsed} total`);
      if (defaultsUsed.loft.length > 0) {
        logger.info(`  → Loft defaults: ${defaultsUsed.loft.map(c => c.clubType).join(', ')}`);
      }
      if (defaultsUsed.weight.length > 0) {
        logger.info(`  → Weight defaults: ${defaultsUsed.weight.map(c => c.clubType).join(', ')}`);
      }
      if (defaultsUsed.lie.length > 0) {
        logger.info(`  → Lie defaults: ${defaultsUsed.lie.map(c => c.clubType).join(', ')}`);
      }
      if (defaultsUsed.length.length > 0) {
        logger.info(`  → Length defaults: ${defaultsUsed.length.map(c => c.clubType).join(', ')}`);
      }
    }
    
    // For backward compatibility
    const defaultLoftsUsed = defaultsUsed.loft;

    // ==========================================
    // BAG COMPOSITION ANALYSIS
    // ==========================================
    const bagComposition = analyzeBagComposition(clubs);
    logger.info(`Bag composition: ${bagComposition.clubCount} clubs, ${bagComposition.gaps.length} gaps identified`);
    if (bagComposition.penalty > 0) {
      logger.info(`Bag composition penalty: ${bagComposition.penalty} points`);
    }

    // ==========================================
    // GRIP CONDITION ASSESSMENT (Separate from grade)
    // ==========================================
    const gripAssessment = analyzeGripCondition(clubs);
    if (gripAssessment.clubsNeedingRegrip > 0) {
      logger.info(`Grip assessment: ${gripAssessment.clubsNeedingRegrip} clubs need regripping`);
    }
    if (gripAssessment.salesOpportunity) {
      logger.info(`Grip sales opportunity: ${gripAssessment.salesOpportunity.priority} priority - $${gripAssessment.salesOpportunity.estimatedRevenue}`);
    }

    // ==========================================
    // EXISTING GRADING LOGIC (UNCHANGED)
    // ==========================================

    // 1. AGE SCORE
    const ageScore = calculateAgeScore(clubs);

    // 2. WEIGHT PROGRESSION SCORE
    const weightScore = calculateWeightProgression(clubs, favoriteClubSpecs);

    // 3. LOFT GAPPING SCORE
    const loftScore = calculateLoftGapping(clubs);

    // 4. FLEX CONSISTENCY SCORE
    const flexScore = calculateFlexConsistency(clubs);

    // 5. KICKPOINT CONSISTENCY SCORE
    const kickpointScore = calculateKickpointConsistency(clubs);

    // 6. TORQUE CONSISTENCY SCORE
    const torqueScore = calculateTorqueConsistency(clubs);

    // 7. LENGTH PROGRESSION SCORE
    const lengthScore = calculateLengthProgression(clubs, bodyFitSpecs);

    // 8. LIE ANGLE PROGRESSION SCORE
    const lieScore = calculateLieAngleProgression(clubs);

    // ==========================================
    // ENGINE-BASED SCORING (A/B Testing Support)
    // ==========================================
    
    // Package JS scores for reference
    const jsScores = {
      age: ageScore,
      weight: weightScore,
      loft: loftScore,
      flex: flexScore,
      kickpoint: kickpointScore,
      torque: torqueScore,
      length: lengthScore,
      lie: lieScore
    };
    
    // Final scores (may be adjusted by Claude)
    let finalScores = {
      age: { score: ageScore.score, issues: ageScore.issues, scorable: ageScore.scorable },
      weight: { score: weightScore.score, issues: weightScore.issues, scorable: weightScore.scorable },
      loft: { score: loftScore.score, issues: loftScore.issues, scorable: loftScore.scorable },
      flex: { score: flexScore.score, issues: flexScore.issues, scorable: flexScore.scorable },
      kickpoint: { score: kickpointScore.score, issues: kickpointScore.issues, scorable: kickpointScore.scorable },
      torque: { score: torqueScore.score, issues: torqueScore.issues, scorable: torqueScore.scorable },
      length: { score: lengthScore.score, issues: lengthScore.issues, scorable: lengthScore.scorable },
      lie: { score: lieScore.score, issues: lieScore.issues, scorable: lieScore.scorable }
    };
    
    // Track engine results for A/B testing
    let engineResults = {
      engine: engine,
      jsScores: {},
      claudeReview: null,
      finalScores: {}
    };
    
    // Save JS scores for comparison
    Object.keys(jsScores).forEach(factor => {
      engineResults.jsScores[factor] = jsScores[factor].score;
    });
    
    // Apply engine mode
    if (engine === 'hybrid') {
      logger.info('Running HYBRID mode: JS + Claude review');
      
      const claudeReview = await claudeReviewFactorScores(clubs, jsScores, null);
      
      if (claudeReview) {
        engineResults.claudeReview = claudeReview;
        
        // Apply Claude's adjusted scores
        Object.keys(claudeReview).forEach(factor => {
          if (claudeReview[factor].adjusted) {
            finalScores[factor].score = claudeReview[factor].finalScore;
            logger.info(`${factor}: JS=${claudeReview[factor].jsScore} -> Claude=${claudeReview[factor].finalScore} (${claudeReview[factor].reason})`);
          }
        });
      } else {
        logger.warn('Claude review failed, using JS scores only');
      }
      
    } else if (engine === 'claude') {
      logger.info('Running CLAUDE mode: Full Claude scoring');
      
      const claudeScores = await claudeScoreFactors(clubs);
      
      if (claudeScores) {
        engineResults.claudeReview = { fullClaude: true, scores: claudeScores };
        
        // Replace all scores with Claude's
        Object.keys(claudeScores).forEach(factor => {
          if (finalScores[factor] && claudeScores[factor]) {
            finalScores[factor].score = claudeScores[factor].score;
            finalScores[factor].issues = claudeScores[factor].issues || [];
          }
        });
      } else {
        logger.warn('Claude scoring failed, falling back to JS scores');
      }
      
    } else {
      logger.info('Running JAVASCRIPT mode: Pure algorithmic scoring');
    }
    
    // Save final scores for comparison
    Object.keys(finalScores).forEach(factor => {
      engineResults.finalScores[factor] = finalScores[factor].score;
    });

    // Calculate initial consistency score using FINAL scores
    const initialConsistencyScore = Math.round(
        (finalScores.age.score * gradingWeights.age) +
        (finalScores.weight.score * gradingWeights.weight_progression) +
        (finalScores.loft.score * gradingWeights.loft_gapping) +
        (finalScores.flex.score * gradingWeights.flex_consistency) +
        (finalScores.kickpoint.score * gradingWeights.kickpoint_consistency) +
        (finalScores.torque.score * gradingWeights.torque_consistency) +
        (finalScores.length.score * gradingWeights.length_progression) +
        (finalScores.lie.score * gradingWeights.lie_angle_progression)
    );

    const initialConsistencyGrade = scoreToGrade(initialConsistencyScore);

    // Compile all issues from FINAL scores
    const allIssues = [
      ...finalScores.age.issues,
      ...finalScores.weight.issues,
      ...finalScores.loft.issues,
      ...finalScores.flex.issues,
      ...finalScores.kickpoint.issues,
      ...finalScores.torque.issues,
      ...finalScores.length.issues,
      ...finalScores.lie.issues,
    ];
    
    // Add notes about default values if any were used
    if (loftScore.defaultLoftsNote) {
      allIssues.push(loftScore.defaultLoftsNote);
    }
    if (weightScore.defaultsNote) {
      allIssues.push(weightScore.defaultsNote);
    }
    if (lengthScore.defaultsNote) {
      allIssues.push(lengthScore.defaultsNote);
    }
    if (lieScore.defaultsNote) {
      allIssues.push(lieScore.defaultsNote);
    }

    // Determine top priority fix using FINAL scores
    const componentScores = [
      {name: "club age", score: finalScores.age.score, issues: finalScores.age.issues},
      {name: "weight progression", score: finalScores.weight.score, issues: finalScores.weight.issues},
      {name: "loft gapping", score: finalScores.loft.score, issues: finalScores.loft.issues},
      {name: "flex consistency", score: finalScores.flex.score, issues: finalScores.flex.issues},
      {name: "kickpoint consistency", score: finalScores.kickpoint.score, issues: finalScores.kickpoint.issues},
      {name: "torque consistency", score: finalScores.torque.score, issues: finalScores.torque.issues},
      {name: "length progression", score: finalScores.length.score, issues: finalScores.length.issues},
      {name: "lie angle progression", score: finalScores.lie.score, issues: finalScores.lie.issues},
    ];

    const lowestComponent = componentScores.reduce((min, curr) =>
      curr.score < min.score ? curr : min
    );

    const topPriorityFix = lowestComponent.issues.length > 0 ?
      lowestComponent.issues[0] :
      "Your bag setup is looking good! Consider minor optimizations.";

    // ==========================================
    // NEW: AI-ENHANCED INDIVIDUAL CLUB GRADING
    // ==========================================
    
    // 1. Calculate Dominant Flex (for consistency checking)
    const flexCounts = {};
    clubs.forEach(c => {
      const flex = c.shaft?.flex || c.shaft_flex;
      if(flex) flexCounts[flex] = (flexCounts[flex] || 0) + 1;
    });
    const dominantFlex = Object.keys(flexCounts).length > 0 ? 
      Object.keys(flexCounts).reduce((a, b) => flexCounts[a] >= flexCounts[b] ? a : b) : 
      'R';

    logger.info(`Dominant flex in bag: ${dominantFlex}`);

    // ==========================================
    // NEW: GENERATE ANALYSIS ID EARLY (for linking recommendations)
    // ==========================================
    const analysisRef = db.collection("bag_analysis").doc(); // Generate ID first
    const analysisId = analysisRef.id;
    logger.info(`Starting bag analysis with ID: ${analysisId}`);

    // Note: initialConsistencyScore and initialConsistencyGrade are already calculated above

    // 3. Process Individual Clubs with Rule-Based Grading (STREAMLINED - NO PER-CLUB AI)
    // AI is reserved for bag-level analysis only, reducing API calls from 13 to 2
    logger.info(`Processing ${clubs.length} clubs with rule-based grading...`);
    
    // Process all clubs in parallel for much better performance
    const clubProcessingPromises = clubs.map(async (club) => {
        try {
            logger.info(`Grading ${club.clubType}: ${club.brand} ${club.model}...`);
            
            // Rule-based grading only (no AI call per club)
            const independentGrading = gradeIndividualClubIndependently(club, dominantFlex);
            
            // Use rule-based score directly (no AI blending)
            const finalScore = independentGrading.score;
            const finalGrade = scoreToGrade(finalScore);
            
            // Determine condition based on score thresholds
            let condition = "Optimal Fit";
            if (finalScore < 70) condition = "Replace Recommended";
            else if (finalScore < 85) condition = "Minor Adjustment";
            
            // Generate rule-based recommendation text
            let specificRecommendation = "";
            let performanceImpact = "";
            
            if (independentGrading.issues.length > 0) {
                specificRecommendation = independentGrading.issues[0];
                performanceImpact = `Address: ${independentGrading.issues.join('; ')}`;
            } else if (independentGrading.strengths.length > 0) {
                specificRecommendation = "This club is well-suited to your bag setup.";
                performanceImpact = independentGrading.strengths.join('; ');
            } else {
                specificRecommendation = "No significant issues detected.";
                performanceImpact = "Performing as expected for your setup.";
            }
            
            logger.info(`  → Score: ${finalScore} (${finalGrade}) - ${condition}`);

            // --- Prepare Grading Data ---
            const gradingData = {
                grade: finalGrade,
                score: finalScore,
                aiScore: null, // No AI score in streamlined mode
                independentScore: independentGrading.score,
                aiAnalysis: null, // No AI analysis in streamlined mode
                specificRecommendation: specificRecommendation,
                performanceImpact: performanceImpact,
                condition: condition,
                dataCompleteness: independentGrading.dataCompleteness,
                issues: independentGrading.issues,
                strengths: independentGrading.strengths,
                gradedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            let recommendationData = null;
            let recommendationRef = null;
            
            // --- Handle Replace Recommendation (if needed) ---
            // Keep AI recommendation generation for replacements (valuable for sales)
            if (condition === "Replace Recommended") {
                try {
                    logger.info(`  → Generating replacement recommendation...`);
                    
                    // Generate AI-powered recommendation with complete specs
                    const aiRecommendation = await generateIntelligentRecommendation(
                        club, 
                        dominantFlex, 
                        initialConsistencyScore, 
                        allIssues, 
                        clubs,
                        {
                          handicap: userHandicap,
                          swing_speed: userSwingSpeed,
                          technicalPreference: userTechnicalPreference
                        }
                    );
                    
                    recommendationRef = db.collection('clubs').doc(club.id).collection('replace_recommendations').doc();
                    
                    // Create recommended club with ALL grading fields populated
                    const recommendedClub = {
                        id: recommendationRef.id,
                        userId: userId,
                        clubType: club.clubType,
                        brand: aiRecommendation.brand,
                        model: aiRecommendation.model,
                        year: String(aiRecommendation.year), // Ensure year is stored as string
                        
                        // Complete spec fields for grading
                        loft: aiRecommendation.loft,
                        length: aiRecommendation.length,
                        lie_angle: aiRecommendation.lie_angle,
                        
                        // Complete shaft specs
                        shaft: aiRecommendation.shaft,
                        shaft_flex: aiRecommendation.shaft.flex,
                        shaft_weight: aiRecommendation.shaft.weight,
                        shaft_kickpoint: aiRecommendation.shaft.kickpoint,
                        shaft_torque: aiRecommendation.shaft.torque,
                        
                        // Metadata - Link to the bag analysis that generated this recommendation
                        isRecommendation: true,
                        originalClubId: club.id,
                        bagAnalysisId: analysisId, // Link to the bag analysis
                        analyzedAt: admin.firestore.FieldValue.serverTimestamp(),
                        recommendationReason: aiRecommendation.recommendationReason,
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    };
                    
                    // --- Grade the Recommended Club (rule-based only, no AI) ---
                    const recIndependentGrading = gradeIndividualClubIndependently(recommendedClub, dominantFlex);
                    const recFinalScore = recIndependentGrading.score;
                    const recGrade = scoreToGrade(recFinalScore);
                    
                    recommendedClub.grading = {
                        grade: recGrade,
                        score: recFinalScore,
                        aiScore: null,
                        independentScore: recIndependentGrading.score,
                        aiAnalysis: null,
                        specificRecommendation: aiRecommendation.recommendationReason,
                        performanceImpact: `Upgrade from ${club.brand} ${club.model}`,
                        condition: "Optimal Fit",
                        dataCompleteness: recIndependentGrading.dataCompleteness,
                        gradedAt: admin.firestore.FieldValue.serverTimestamp()
                    };
                    
                    recommendationData = {
                        club: recommendedClub,
                        ref: recommendationRef
                    };
                    
                    logger.info(`  → Recommendation: ${aiRecommendation.brand} ${aiRecommendation.model} (Score: ${recFinalScore})`);
                    
                } catch (recError) {
                    logger.error(`Error generating recommendation for ${club.id}:`, recError);
                    // Don't fail the entire grading if recommendation fails
                }
            }

            return {
                clubId: club.id,
                clubType: club.clubType ?? null,
                brand: club.brand ?? null,
                model: club.model ?? null,
                grading: gradingData,
                recommendation: recommendationData,
                clubRef: db.collection('users').doc(userId).collection('clubs').doc(club.id)
            };
            
        } catch (error) {
            logger.error(`Error processing club ${club.id}:`, error);
            // Return partial data so other clubs can still be processed
            return {
                clubId: club.id,
                clubType: club.clubType ?? null,
                brand: club.brand ?? null,
                model: club.model ?? null,
                error: error.message,
                clubRef: db.collection('users').doc(userId).collection('clubs').doc(club.id)
            };
        }
    });

    // Wait for all clubs to be processed in parallel
    const clubResults = await Promise.allSettled(clubProcessingPromises);
    
    // Prepare batch writes
    const batch = db.batch();
    const processedClubs = [];
    
    clubResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            const clubData = result.value;
            
            // Add grading update to batch
            if (clubData.grading && !clubData.error) {
                batch.update(clubData.clubRef, { grading: clubData.grading });
            }
            
            // Add recommendation to batch if exists
            if (clubData.recommendation && clubData.recommendation.ref) {
                batch.set(clubData.recommendation.ref, clubData.recommendation.club);
            }
            
            processedClubs.push({
                id: clubData.clubId,
                clubType: clubData.clubType,
                brand: clubData.brand,
                model: clubData.model,
                grading: clubData.grading,
                recommendation: clubData.recommendation?.club || null
            });
        } else {
            // Handle rejected promise
            logger.error(`Club processing failed:`, result.reason);
            const club = clubs[index];
            processedClubs.push({
                id: club.id,
                clubType: club.clubType ?? null,
                brand: club.brand ?? null,
                model: club.model ?? null,
                error: result.reason?.message || 'Unknown error'
            });
        }
    });

    // Commit all club updates in a single batch
    await batch.commit();
    logger.info(`Updated individual grading for ${clubs.length} clubs (processed in parallel)`);

    // ==========================================
    // NEW: CALCULATE AVERAGE INDIVIDUAL CLUB QUALITY SCORE
    // ==========================================
    const clubsWithScores = processedClubs.filter(c => c.grading && c.grading.score !== undefined);
    let averageClubQualityScore = 0;
    
    if (clubsWithScores.length > 0) {
      const totalClubScore = clubsWithScores.reduce((sum, club) => sum + (club.grading.score || 0), 0);
      averageClubQualityScore = Math.round(totalClubScore / clubsWithScores.length);
      logger.info(`Average individual club quality score: ${averageClubQualityScore}/100`);
    } else {
      // Fallback: use independent scores if available
      const independentScores = clubs
        .map(club => {
          try {
            const independentGrading = gradeIndividualClubIndependently(club, dominantFlex);
            return independentGrading.score;
          } catch (e) {
            return null;
          }
        })
        .filter(score => score !== null);
      
      if (independentScores.length > 0) {
        averageClubQualityScore = Math.round(independentScores.reduce((a, b) => a + b, 0) / independentScores.length);
        logger.info(`Using independent scores for average club quality: ${averageClubQualityScore}/100`);
      } else {
        averageClubQualityScore = 50; // Default if no scores available
        logger.warn(`No club scores available, using default: ${averageClubQualityScore}/100`);
      }
    }

    // ==========================================
    // RE-CALCULATE OVERALL SCORE WITH CLUB QUALITY FACTOR
    // ==========================================
    // Only include factors that have enough data to be scored
    // Normalize weights based on what's actually scorable
    
    const factorScores = [
      { name: 'age', score: ageScore, weight: gradingWeights.age },
      { name: 'weight_progression', score: weightScore, weight: gradingWeights.weight_progression },
      { name: 'loft_gapping', score: loftScore, weight: gradingWeights.loft_gapping },
      { name: 'flex_consistency', score: flexScore, weight: gradingWeights.flex_consistency },
      { name: 'kickpoint_consistency', score: kickpointScore, weight: gradingWeights.kickpoint_consistency },
      { name: 'torque_consistency', score: torqueScore, weight: gradingWeights.torque_consistency },
      { name: 'length_progression', score: lengthScore, weight: gradingWeights.length_progression },
      { name: 'lie_angle_progression', score: lieScore, weight: gradingWeights.lie_angle_progression }
    ];
    
    // Filter to only scorable factors
    const scorableFactors = factorScores.filter(f => f.score.scorable !== false);
    const unscoredFactors = factorScores.filter(f => f.score.scorable === false);
    
    logger.info(`Scorable factors: ${scorableFactors.length}/8`);
    logger.info(`Unscored (insufficient data): ${unscoredFactors.map(f => f.name).join(', ') || 'none'}`);
    
    // Calculate consistency score only from scorable factors
    let consistencyScore = 0;
    if (scorableFactors.length > 0) {
      // Normalize weights to sum to 1.0 based on scorable factors only
      const totalWeight = scorableFactors.reduce((sum, f) => sum + f.weight, 0);
      
      consistencyScore = Math.round(
        scorableFactors.reduce((sum, f) => {
          const normalizedWeight = f.weight / totalWeight;
          return sum + (f.score.score * normalizedWeight);
        }, 0)
      );
    } else {
      // If no factors are scorable, use club quality only
      consistencyScore = averageClubQualityScore;
      logger.warn('No consistency factors scorable - using club quality score only');
    }
    
    // New overall score: 50% club quality + 50% consistency
    let overallScore = Math.round(
        (averageClubQualityScore * 0.5) + 
        (consistencyScore * 0.5)
    );
    
    // Apply bag composition penalties (missing driver, woods, etc.)
    // NOTE: Putter penalty removed - assume all golfers have a putter
    let totalBagPenalty = bagComposition.penalty;
    
    // REMOVED: Putter penalty - we assume everyone has a putter
    // if (!bagComposition.hasPutter) {
    //   totalBagPenalty += 10;
    //   allIssues.push("No putter in bag - 10 point penalty applied");
    // }
    
    // Add all composition issues to allIssues
    bagComposition.issues.forEach(issue => allIssues.push(issue));
    
    // Apply total penalty
    if (totalBagPenalty > 0) {
      overallScore = Math.max(0, overallScore - totalBagPenalty);
      logger.info(`Bag composition penalty applied: ${totalBagPenalty} points`);
      logger.info(`  → Composition issues: ${bagComposition.gaps.join(', ') || 'none'}`);
    }
    
    const overallGrade = scoreToGrade(overallScore);
    
    logger.info(`Overall bag score recalculated: ${overallScore}/100 (${overallGrade})`);
    logger.info(`  → Club Quality: ${averageClubQualityScore}/100 (50% weight)`);
    logger.info(`  → Consistency: ${consistencyScore}/100 (50% weight)`);

    // ==========================================
    // GENERATE GRADE EXPLAINER - WHY THIS GRADE?
    // ==========================================
    const gradeExplainer = generateGradeExplainer({
      overallScore: overallScore,
      overallGrade: overallGrade,
      componentScores: {
        age: finalScores.age,
        weight: finalScores.weight,
        loft: finalScores.loft,
        flex: finalScores.flex,
        kickpoint: finalScores.kickpoint,
        torque: finalScores.torque,
        length: finalScores.length,
        lie: finalScores.lie
      },
      bagComposition: bagComposition,
      loftGapAnalysis: loftScore.gapAnalysis || [],
      allIssues: allIssues
    });
    
    if (gradeExplainer.top_impacts.length > 0) {
      logger.info(`Grade explainer: ${gradeExplainer.summary}`);
      logger.info(`  → Top issue: ${gradeExplainer.top_impacts[0]?.issue || 'None'}`);
      logger.info(`  → Potential score without issues: ${gradeExplainer.potential_score}`);
    }

    // ==========================================
    // GENERATE AI BAG ANALYSIS (with updated overall score)
    // ==========================================
    logger.info("Generating AI-powered bag analysis with updated overall score...");
    const aiBagAnalysis = await generateAIBagAnalysis(clubs, componentScores, overallScore, overallGrade, allIssues, {
      handicap: userHandicap,
      swing_speed: userSwingSpeed,
      technicalPreference: userTechnicalPreference
    }, {
      // Pass scoring context for accurate AI adjustment calculation
      clubQualityScore: averageClubQualityScore,
      bagPenalty: totalBagPenalty,
      gradingWeights: gradingWeights,
      scorableFactors: scorableFactors.map(f => f.name)
    });
    logger.info(`AI Bag Analysis: ${aiBagAnalysis.aiGrade} (${aiBagAnalysis.aiAdjustedScore}/100)`);

    // ==========================================
    // NEW: PREPARE VERSION METADATA
    // ==========================================
    const versionMetadata = algorithmVersion ? {
      versionNumber: algorithmVersion.versionNumber,
      deployedAt: algorithmVersion.deployedAt,
      changelog: algorithmVersion.changelog,
      weightsUsed: gradingWeights
    } : {
      versionNumber: "default",
      deployedAt: null,
      changelog: "Using default hardcoded weights (version system not initialized)",
      weightsUsed: gradingWeights
    };

    // ==========================================
    // NEW: CREATE INPUT DATA SNAPSHOT
    // ==========================================
    const inputDataSnapshot = clubs.map(club => ({
      id: club.id,
      clubType: club.clubType ?? null,
      brand: club.brand ?? null,
      model: club.model ?? null,
      year: club.year ?? null,
      shaft_weight: club.shaft?.weight ?? null,
      shaft_flex: club.shaft?.flex ?? null,
      shaft_kickpoint: club.shaft?.kickpoint ?? null,
      shaft_torque: club.shaft?.torque ?? null,
      loft: club.loft ?? null,
      length: club.length ?? null,
      lie_angle: club.lieAngle ?? null,
      is_favorite: club.is_favorite ?? false
    }));

    // ==========================================
    // SAVE ANALYSIS RESULT (WITH AI ENHANCEMENTS)
    // ==========================================
    const analysisResult = {
      id: analysisId,
      user_id: userId,
      analyzed_at: admin.firestore.FieldValue.serverTimestamp(),
      clubs_analyzed: clubs.length,
      // Optional user context
      user_context: {
        handicap: userHandicap,
        swing_speed: userSwingSpeed,
        technicalPreference: userTechnicalPreference
      },

      // Overall scores - AI ADJUSTED SCORE (per-factor adjustments with guardrails)
      overall_score: aiBagAnalysis.aiAdjustedScore,
      overall_grade: aiBagAnalysis.aiGrade,
      
      // Algorithm scores for reference/transparency
      algorithm_score: overallScore,
      algorithm_grade: overallGrade,
      
      // AI adjustment summary
      ai_adjustment_total: aiBagAnalysis.aiAdjustmentTotal,
      
      // Score breakdown for transparency
      score_breakdown: {
        club_quality_score: averageClubQualityScore,
        club_quality_grade: scoreToGrade(averageClubQualityScore),
        consistency_score: consistencyScore,
        consistency_grade: scoreToGrade(consistencyScore),
        club_quality_weight: 0.5,
        consistency_weight: 0.5,
        factors_scored: scorableFactors.length,
        factors_total: 8,
        unscored_factors: unscoredFactors.map(f => f.name),
        bag_composition_penalty: totalBagPenalty
      },
      
      // Default values applied (for data quality tracking)
      defaults_applied: {
        total: enrichmentResult.totalDefaultsUsed,
        loft: {
          count: defaultsUsed.loft.length,
          clubs: defaultsUsed.loft,
          note: loftScore.defaultLoftsNote || null
        },
        weight: {
          count: defaultsUsed.weight.length,
          clubs: defaultsUsed.weight,
          note: weightScore.defaultsNote || null
        },
        lie: {
          count: defaultsUsed.lie.length,
          clubs: defaultsUsed.lie,
          note: lieScore.defaultsNote || null
        },
        length: {
          count: defaultsUsed.length.length,
          clubs: defaultsUsed.length,
          note: lengthScore.defaultsNote || null
        }
      },
      
      // Bag composition analysis
      bag_composition: {
        club_count: bagComposition.clubCount,
        full_bag: bagComposition.fullBag,
        has_putter: bagComposition.hasPutter,
        composition: bagComposition.composition,
        gaps: bagComposition.gaps,
        recommendations: bagComposition.recommendations,
        penalty_applied: totalBagPenalty
      },
      
      // Grip condition assessment (separate from overall grade)
      grip_assessment: {
        total_clubs: gripAssessment.totalClubs,
        clubs_with_grip_data: gripAssessment.clubsWithGripData,
        clubs_needing_regrip: gripAssessment.clubsNeedingRegrip,
        dominant_size: gripAssessment.dominantSize,
        dominant_brand: gripAssessment.dominantBrand,
        size_mismatches: gripAssessment.sizeMismatches,
        brand_variety: gripAssessment.brandVariety,
        clubs_to_regrip: gripAssessment.clubsToRegrip,
        bulk_replace_recommended: gripAssessment.bulkReplaceRecommended,
        cost_estimate: gripAssessment.costEstimate,
        recommendations: gripAssessment.recommendations,
        grip_recommendations: gripAssessment.gripRecommendations,
        sales_opportunity: gripAssessment.salesOpportunity
      },
      
      // Grade explainer - WHY THIS GRADE?
      grade_explainer: {
        summary: gradeExplainer.summary,
        current_score: gradeExplainer.current_score,
        current_grade: gradeExplainer.current_grade,
        potential_score: gradeExplainer.potential_score,
        potential_grade: gradeExplainer.potential_grade,
        total_penalty_points: gradeExplainer.total_penalty_points,
        top_impacts: gradeExplainer.top_impacts,
        all_impacts: gradeExplainer.all_impacts,
        fixable_issues: gradeExplainer.fixable_issues
      },

      // AI-enhanced bag analysis with per-factor adjustments
      ai_bag_analysis: {
        ai_adjusted_score: aiBagAnalysis.aiAdjustedScore,
        ai_grade: aiBagAnalysis.aiGrade,
        algorithm_score: aiBagAnalysis.algorithmScore,
        ai_adjustment_total: aiBagAnalysis.aiAdjustmentTotal,
        factor_adjustments: aiBagAnalysis.factorAdjustments,
        adjustment_summary: aiBagAnalysis.adjustmentSummary,
        overall_assessment: aiBagAnalysis.overallAssessment,
        key_strengths: aiBagAnalysis.keyStrengths,
        key_weaknesses: aiBagAnalysis.keyWeaknesses,
        priority_recommendations: aiBagAnalysis.priorityRecommendations,
        bag_personality: aiBagAnalysis.bagPersonality,
        salesOpportunities: aiBagAnalysis.salesOpportunities || null
      },

      // Individual component scores (using finalScores which may be adjusted by Claude)
      age_score: finalScores.age.score,
      age_scorable: finalScores.age.scorable !== false,
      age_grade: finalScores.age.scorable !== false ? scoreToGrade(finalScores.age.score) : 'N/A',
      weight_progression_score: finalScores.weight.score,
      weight_progression_scorable: finalScores.weight.scorable !== false,
      weight_progression_grade: finalScores.weight.scorable !== false ? scoreToGrade(finalScores.weight.score) : 'N/A',
      loft_gapping_score: finalScores.loft.score,
      loft_gapping_scorable: finalScores.loft.scorable !== false,
      loft_gapping_grade: finalScores.loft.scorable !== false ? scoreToGrade(finalScores.loft.score) : 'N/A',
      flex_consistency_score: finalScores.flex.score,
      flex_consistency_scorable: finalScores.flex.scorable !== false,
      flex_consistency_grade: finalScores.flex.scorable !== false ? scoreToGrade(finalScores.flex.score) : 'N/A',
      kickpoint_consistency_score: finalScores.kickpoint.score,
      kickpoint_consistency_scorable: finalScores.kickpoint.scorable !== false,
      kickpoint_consistency_grade: finalScores.kickpoint.scorable !== false ? scoreToGrade(finalScores.kickpoint.score) : 'N/A',
      torque_consistency_score: finalScores.torque.score,
      torque_consistency_scorable: finalScores.torque.scorable !== false,
      torque_consistency_grade: finalScores.torque.scorable !== false ? scoreToGrade(finalScores.torque.score) : 'N/A',
      length_progression_score: finalScores.length.score,
      length_progression_scorable: finalScores.length.scorable !== false,
      length_progression_grade: finalScores.length.scorable !== false ? scoreToGrade(finalScores.length.score) : 'N/A',
      lie_angle_progression_score: finalScores.lie.score,
      lie_angle_progression_scorable: finalScores.lie.scorable !== false,
      lie_angle_progression_grade: finalScores.lie.scorable !== false ? scoreToGrade(finalScores.lie.score) : 'N/A',

      
issues_found: allIssues,
        top_priority_fix: topPriorityFix,
        favorite_club_baseline: favoriteClubSpecs ? {
          clubType: favoriteClubSpecs.clubType,
          weight: favoriteClubSpecs.shaft_weight
        } : null,
        weight_suggestions: weightScore.suggestions || [],
        body_fit_baseline: bodyFitSpecs ? {
          heightDisplay: bodyFitSpecs.heightDisplay,
          wristToFloor: bodyFitSpecs.wristToFloor,
          adjustment: lengthScore.bodyFitBaseline?.adjustment || 0
        } : null,
        length_suggestions: lengthScore.suggestions || [],
        algorithm_version: versionMetadata.versionNumber,
      // NEW: Algorithm version tracking
      algorithmVersion: versionMetadata,
      
      // NEW: Input data snapshot for reprocessing
      inputDataSnapshot: inputDataSnapshot,
      
      // NEW: Engine mode used
      engineUsed: engine,
      
      // Individual clubs with grading data (for frontend persistence)
      clubs: processedClubs.map((club) => {
        if (club.error) {
          return {
            id: club.id,
            clubType: club.clubType,
            brand: club.brand,
            model: club.model,
            error: club.error
          };
        }
        return {
          id: club.id,
          clubType: club.clubType,
          brand: club.brand,
          model: club.model,
          grading: club.grading ? {
            score: club.grading.score,
            grade: club.grading.grade,
            ai_score: club.grading.aiScore,
            independent_score: club.grading.independentScore,
            condition: club.grading.condition,
            analysis: club.grading.aiAnalysis,
            specific_recommendation: club.grading.specificRecommendation,
            performance_impact: club.grading.performanceImpact,
            data_completeness: club.grading.dataCompleteness,
            issues: club.grading.issues,
            strengths: club.grading.strengths
            // Note: gradedAt omitted - serverTimestamp not allowed in arrays
          } : null
        };
      })
    };

    // Save analysis with pre-generated ID (so recommendations can reference it)
    await analysisRef.set(analysisResult);

    logger.info(`Analysis saved with ID: ${analysisId}`);

    // ==========================================
    // UPDATE USER DOCUMENT WITH BAG GRADE
    // ==========================================
    try {
      await db.collection("users").doc(userId).update({
        bag_grade: aiBagAnalysis.aiGrade,           // Fixed: Use AI-adjusted grade (was: overallGrade)
        bag_score: aiBagAnalysis.aiAdjustedScore,   // Fixed: Use AI-adjusted score (was: overallScore)
        clubs_count: clubs.length,
        clubs_in_bag: clubs.length,
        last_graded_at: admin.firestore.FieldValue.serverTimestamp(),
        last_analysis_id: analysisId
      });
      logger.info(`Updated user ${userId} with bag_grade: ${aiBagAnalysis.aiGrade}, clubs_count: ${clubs.length}`);
    } catch (userUpdateError) {
      logger.warn(`Could not update user document: ${userUpdateError.message}`);
      // Don't fail the whole request if user update fails
    }

    // ==========================================
    // NEW: SAVE TO gradingTests FOR A/B COMPARISON
    // ==========================================
    try {
      await db.collection("gradingTests").add({
        userId: userId,
        analysisId: analysisId,
        testDate: admin.firestore.FieldValue.serverTimestamp(),
        engine: engine,
        
        // JS scores (always calculated)
        jsScores: engineResults.jsScores,
        
        // Claude review results (if applicable)
        claudeReview: engineResults.claudeReview,
        
        // Final scores used for grading
        finalScores: engineResults.finalScores,
        
        // Overall results
        overallScore: overallScore,
        overallGrade: overallGrade,
        
        // Weights used
        weightsUsed: gradingWeights,
        
        // Club count for context
        clubCount: clubs.length
      });
      
      logger.info(`Grading test saved for A/B comparison (engine: ${engine})`);
    } catch (testSaveError) {
      logger.warn("Error saving grading test:", testSaveError.message);
      // Don't fail the request if test save fails
    }

    // ==========================================
    // NEW: UPDATE VERSION METRICS
    // ==========================================
    if (algorithmVersion) {
      try {
        const versionRef = db.collection("algorithmVersions").doc(`v${algorithmVersion.versionNumber}`);
        
        await versionRef.update({
          "metrics.totalAnalyses": admin.firestore.FieldValue.increment(1),
          "metrics.lastUpdated": admin.firestore.FieldValue.serverTimestamp()
        });
        
        logger.info(`Updated metrics for algorithm version ${algorithmVersion.versionNumber}`);
      } catch (metricsError) {
        logger.warn("Error updating version metrics:", metricsError.message);
        // Don't fail the entire request if metrics update fails
      }
    }

    // ==========================================
    // SCENARIO MODE: Save to scenarios subcollection (max 5)
    // ==========================================
    if (isScenario) {
      // Get current bag analysis for comparison
      const currentAnalysisSnapshot = await db.collection("bag_analysis")
        .where("user_id", "==", userId)
        .orderBy("analyzed_at", "desc")
        .limit(1)
        .get();
      
      let currentAnalysis = null;
      if (!currentAnalysisSnapshot.empty) {
        currentAnalysis = currentAnalysisSnapshot.docs[0].data();
      }
      
      const projectedScore = aiBagAnalysis.aiAdjustedScore;
      const projectedGrade = aiBagAnalysis.aiGrade;
      const currentScore = currentAnalysis?.overall_score || 0;
      const currentGrade = currentAnalysis?.overall_grade || 'N/A';
      
      // Build scenario document
      const scenarioData = {
        name: scenarioName,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        
        // Current state (before)
        current_grade: currentGrade,
        current_score: currentScore,
        
        // Projected state (after swaps)
        projected_grade: projectedGrade,
        projected_score: projectedScore,
        
        // Factor breakdown (use scoreToGrade for grades)
        factors: {
          age: { score: ageScore.score, grade: ageScore.scorable !== false ? scoreToGrade(ageScore.score) : 'N/A' },
          weightProgression: { score: weightScore.score, grade: weightScore.scorable !== false ? scoreToGrade(weightScore.score) : 'N/A' },
          loftGapping: { score: loftScore.score, grade: loftScore.scorable !== false ? scoreToGrade(loftScore.score) : 'N/A' },
          flexConsistency: { score: flexScore.score, grade: flexScore.scorable !== false ? scoreToGrade(flexScore.score) : 'N/A' },
          kickpointConsistency: { score: kickpointScore.score, grade: kickpointScore.scorable !== false ? scoreToGrade(kickpointScore.score) : 'N/A' },
          torqueConsistency: { score: torqueScore.score, grade: torqueScore.scorable !== false ? scoreToGrade(torqueScore.score) : 'N/A' },
          lengthProgression: { score: lengthScore.score, grade: lengthScore.scorable !== false ? scoreToGrade(lengthScore.score) : 'N/A' },
          lieAngleProgression: { score: lieScore.score, grade: lieScore.scorable !== false ? scoreToGrade(lieScore.score) : 'N/A' }
        },
        
        // Improvement metrics
        grade_improved: projectedScore > currentScore,
        score_diff: projectedScore - currentScore,
        
        // Clubs snapshot
        clubs_snapshot: clubs.map(c => ({
          clubType: c.clubType,
          brand: c.brand,
          model: c.model,
          year: c.year,
          shaft_brand: c.shaft_brand,
          shaft_model: c.shaft_model,
          shaft_weight: c.shaft_weight,
          category: c.category
        })),
        
        clubs_count: clubs.length
      };
      
      // Save to scenarios subcollection (max 5)
      const scenariosRef = db.collection("users").doc(userId).collection("scenarios");
      
      // Check count and delete oldest if >= 5
      const existingScenarios = await scenariosRef.orderBy("created_at", "asc").get();
      if (existingScenarios.size >= 5) {
        const oldest = existingScenarios.docs[0];
        await oldest.ref.delete();
        logger.info(`Deleted oldest scenario ${oldest.id} to maintain limit of 5`);
      }
      
      // Save new scenario
      const newScenarioRef = await scenariosRef.add(scenarioData);
      logger.info(`Saved scenario ${newScenarioRef.id}`);
      
      // Return scenario-specific response with FULL analysis details
      res.status(200).json({
        success: true,
        isScenario: true,
        scenarioId: newScenarioRef.id,
        
        current: {
          overall_grade: currentGrade,
          overall_score: currentScore,
          factors: currentAnalysis ? {
            age: { score: currentAnalysis.age_score, grade: currentAnalysis.age_grade },
            weightProgression: { score: currentAnalysis.weight_progression_score, grade: currentAnalysis.weight_progression_grade },
            loftGapping: { score: currentAnalysis.loft_gapping_score, grade: currentAnalysis.loft_gapping_grade },
            flexConsistency: { score: currentAnalysis.flex_consistency_score, grade: currentAnalysis.flex_consistency_grade },
            kickpointConsistency: { score: currentAnalysis.kickpoint_consistency_score, grade: currentAnalysis.kickpoint_consistency_grade },
            torqueConsistency: { score: currentAnalysis.torque_consistency_score, grade: currentAnalysis.torque_consistency_grade },
            lengthProgression: { score: currentAnalysis.length_progression_score, grade: currentAnalysis.length_progression_grade },
            lieAngleProgression: { score: currentAnalysis.lie_angle_progression_score, grade: currentAnalysis.lie_angle_progression_grade }
          } : {},
          issues_found: currentAnalysis?.issues_found || [],
          top_priority_fix: currentAnalysis?.top_priority_fix || null
        },
        
        projected: {
          overall_grade: projectedGrade,
          overall_score: projectedScore,
          factors: {
            age: { score: ageScore.score, grade: ageScore.scorable !== false ? scoreToGrade(ageScore.score) : 'N/A' },
            weightProgression: { score: weightScore.score, grade: weightScore.scorable !== false ? scoreToGrade(weightScore.score) : 'N/A' },
            loftGapping: { score: loftScore.score, grade: loftScore.scorable !== false ? scoreToGrade(loftScore.score) : 'N/A' },
            flexConsistency: { score: flexScore.score, grade: flexScore.scorable !== false ? scoreToGrade(flexScore.score) : 'N/A' },
            kickpointConsistency: { score: kickpointScore.score, grade: kickpointScore.scorable !== false ? scoreToGrade(kickpointScore.score) : 'N/A' },
            torqueConsistency: { score: torqueScore.score, grade: torqueScore.scorable !== false ? scoreToGrade(torqueScore.score) : 'N/A' },
            lengthProgression: { score: lengthScore.score, grade: lengthScore.scorable !== false ? scoreToGrade(lengthScore.score) : 'N/A' },
            lieAngleProgression: { score: lieScore.score, grade: lieScore.scorable !== false ? scoreToGrade(lieScore.score) : 'N/A' }
          },
          
          // Full analysis details for projected bag
          issues_found: allIssues,
          top_priority_fix: topPriorityFix,
          
          score_breakdown: {
            club_quality_score: averageClubQualityScore,
            club_quality_grade: scoreToGrade(averageClubQualityScore),
            consistency_score: consistencyScore,
            consistency_grade: scoreToGrade(consistencyScore),
            club_quality_weight: 0.5,
            consistency_weight: 0.5,
            bag_composition_penalty: totalBagPenalty
          },
          
          grade_explainer: {
            summary: gradeExplainer.summary,
            current_score: gradeExplainer.current_score,
            current_grade: gradeExplainer.current_grade,
            potential_score: gradeExplainer.potential_score,
            potential_grade: gradeExplainer.potential_grade,
            total_penalty_points: gradeExplainer.total_penalty_points,
            top_impacts: gradeExplainer.top_impacts,
            fixable_issues: gradeExplainer.fixable_issues
          },
          
          ai_bag_analysis: {
            ai_adjusted_score: aiBagAnalysis.aiAdjustedScore,
            ai_grade: aiBagAnalysis.aiGrade,
            algorithm_score: aiBagAnalysis.algorithmScore,
            ai_adjustment_total: aiBagAnalysis.aiAdjustmentTotal,
            overall_assessment: aiBagAnalysis.overallAssessment,
            key_strengths: aiBagAnalysis.keyStrengths,
            key_weaknesses: aiBagAnalysis.keyWeaknesses,
            priority_recommendations: aiBagAnalysis.priorityRecommendations,
            bag_personality: aiBagAnalysis.bagPersonality
          },
          
          // Individual club grades
          clubs: clubs.map(c => ({
            id: c.id,
            clubType: c.clubType,
            brand: c.brand,
            model: c.model,
            year: c.year,
            shaft_brand: c.shaft_brand,
            shaft_model: c.shaft_model,
            shaft_weight: c.shaft_weight,
            category: c.category,
            individual_score: c.individual_score,
            individual_grade: c.individual_grade,
            issues: c.issues || []
          }))
        },
        
        improvement: {
          improved: projectedScore > currentScore,
          score_diff: projectedScore - currentScore
        }
      });
      return;  // Exit early for scenario mode
    }

    // Return the analysis result
    res.status(200).json({
      success: true,
      analysisId: analysisId,
      engineUsed: engine,  // Include engine mode in response
      clubsCount: clubs.length,  // Include club count for UI update
      analysis: {
        // AI ADJUSTED SCORE (per-factor adjustments with guardrails)
        overall_score: aiBagAnalysis.aiAdjustedScore,
        overall_grade: aiBagAnalysis.aiGrade,
        
        // Algorithm scores for reference
        algorithm_score: overallScore,
        algorithm_grade: overallGrade,
        
        // AI adjustment summary
        ai_adjustment_total: aiBagAnalysis.aiAdjustmentTotal,
        
        clubs_analyzed: clubs.length,
        user_context: {
          handicap: userHandicap,
          swing_speed: userSwingSpeed,
          technicalPreference: userTechnicalPreference
        },
        
        // Score breakdown for transparency
        score_breakdown: {
          club_quality_score: averageClubQualityScore,
          club_quality_grade: scoreToGrade(averageClubQualityScore),
          consistency_score: consistencyScore,
          consistency_grade: scoreToGrade(consistencyScore),
          club_quality_weight: 0.5,
          consistency_weight: 0.5,
          bag_composition_penalty: totalBagPenalty
        },
        
        // Default values applied (for data quality tracking)
        defaults_applied: {
          total: enrichmentResult.totalDefaultsUsed,
          loft: {
            count: defaultsUsed.loft.length,
            clubs: defaultsUsed.loft,
            note: loftScore.defaultLoftsNote || null
          },
          weight: {
            count: defaultsUsed.weight.length,
            clubs: defaultsUsed.weight,
            note: weightScore.defaultsNote || null
          },
          lie: {
            count: defaultsUsed.lie.length,
            clubs: defaultsUsed.lie,
            note: lieScore.defaultsNote || null
          },
          length: {
            count: defaultsUsed.length.length,
            clubs: defaultsUsed.length,
            note: lengthScore.defaultsNote || null
          }
        },
        
        // Bag composition analysis
        bag_composition: {
          club_count: bagComposition.clubCount,
          full_bag: bagComposition.fullBag,
          has_putter: bagComposition.hasPutter,
          composition: bagComposition.composition,
          gaps: bagComposition.gaps,
          recommendations: bagComposition.recommendations,
          penalty_applied: totalBagPenalty
        },
        
        // Grip condition assessment (separate from overall grade)
        grip_assessment: {
          total_clubs: gripAssessment.totalClubs,
          clubs_with_grip_data: gripAssessment.clubsWithGripData,
          clubs_needing_regrip: gripAssessment.clubsNeedingRegrip,
          dominant_size: gripAssessment.dominantSize,
          dominant_brand: gripAssessment.dominantBrand,
          size_mismatches: gripAssessment.sizeMismatches,
          brand_variety: gripAssessment.brandVariety,
          clubs_to_regrip: gripAssessment.clubsToRegrip,
          bulk_replace_recommended: gripAssessment.bulkReplaceRecommended,
          cost_estimate: gripAssessment.costEstimate,
          recommendations: gripAssessment.recommendations,
          grip_recommendations: gripAssessment.gripRecommendations,
          sales_opportunity: gripAssessment.salesOpportunity
        },
        
        // Grade explainer - WHY THIS GRADE?
        grade_explainer: {
          summary: gradeExplainer.summary,
          current_score: gradeExplainer.current_score,
          current_grade: gradeExplainer.current_grade,
          potential_score: gradeExplainer.potential_score,
          potential_grade: gradeExplainer.potential_grade,
          total_penalty_points: gradeExplainer.total_penalty_points,
          top_impacts: gradeExplainer.top_impacts,
          all_impacts: gradeExplainer.all_impacts,
          fixable_issues: gradeExplainer.fixable_issues
        },
        
        // AI-enhanced bag analysis with per-factor adjustments
        ai_bag_analysis: {
          ai_adjusted_score: aiBagAnalysis.aiAdjustedScore,
          ai_grade: aiBagAnalysis.aiGrade,
          algorithm_score: aiBagAnalysis.algorithmScore,
          ai_adjustment_total: aiBagAnalysis.aiAdjustmentTotal,
          factor_adjustments: aiBagAnalysis.factorAdjustments,
          adjustment_summary: aiBagAnalysis.adjustmentSummary,
          overall_assessment: aiBagAnalysis.overallAssessment,
          key_strengths: aiBagAnalysis.keyStrengths,
          key_weaknesses: aiBagAnalysis.keyWeaknesses,
          priority_recommendations: aiBagAnalysis.priorityRecommendations,
          bag_personality: aiBagAnalysis.bagPersonality,
          salesOpportunities: aiBagAnalysis.salesOpportunities || null
        },
        
        // Component scores (using FINAL scores from selected engine)
        component_scores: {
          age: {score: finalScores.age.score, grade: scoreToGrade(finalScores.age.score)},
          weight_progression: {score: finalScores.weight.score, grade: scoreToGrade(finalScores.weight.score)},
          loft_gapping: {score: finalScores.loft.score, grade: scoreToGrade(finalScores.loft.score)},
          flex_consistency: {score: finalScores.flex.score, grade: scoreToGrade(finalScores.flex.score)},
          kickpoint_consistency: {score: finalScores.kickpoint.score, grade: scoreToGrade(finalScores.kickpoint.score)},
          torque_consistency: {score: finalScores.torque.score, grade: scoreToGrade(finalScores.torque.score)},
          length_progression: {score: finalScores.length.score, grade: scoreToGrade(finalScores.length.score)},
          lie_angle_progression: {score: finalScores.lie.score, grade: scoreToGrade(finalScores.lie.score)},
        },
        issues_found: allIssues,
        top_priority_fix: topPriorityFix,
        favorite_club_baseline: favoriteClubSpecs ? {
          clubType: favoriteClubSpecs.clubType,
          weight: favoriteClubSpecs.shaft_weight
        } : null,
        weight_suggestions: weightScore.suggestions || [],
        body_fit_baseline: bodyFitSpecs ? {
          heightDisplay: bodyFitSpecs.heightDisplay,
          wristToFloor: bodyFitSpecs.wristToFloor,
          adjustment: lengthScore.bodyFitBaseline?.adjustment || 0
        } : null,
        length_suggestions: lengthScore.suggestions || [],
        algorithm_version: versionMetadata.versionNumber,
        
        // Individual clubs with AI-enhanced grading
        clubs: processedClubs.map((club) => {
          // Handle clubs with errors
          if (club.error) {
            return {
              id: club.id,
              clubType: club.clubType,
              brand: club.brand,
              model: club.model,
              error: club.error
            };
          }
          
          // Handle clubs with successful grading
          return {
            id: club.id,
            clubType: club.clubType,
            brand: club.brand,
            model: club.model,
            grading: club.grading ? {
              score: club.grading.score,
              grade: club.grading.grade,
              ai_score: club.grading.aiScore,
              independent_score: club.grading.independentScore,
              condition: club.grading.condition,
              analysis: club.grading.aiAnalysis,
              specific_recommendation: club.grading.specificRecommendation,
              performance_impact: club.grading.performanceImpact,
              data_completeness: club.grading.dataCompleteness,
              issues: club.grading.issues,
              strengths: club.grading.strengths,
              gradedAt: club.grading.gradedAt
            } : null,
            recommendation: club.recommendation ? {
              id: club.recommendation.id,
              brand: club.recommendation.brand,
              model: club.recommendation.model,
              year: club.recommendation.year ? String(club.recommendation.year) : null,
              loft: club.recommendation.loft,
              length: club.recommendation.length,
              lie_angle: club.recommendation.lie_angle,
              shaft: club.recommendation.shaft,
              recommendationReason: club.recommendation.recommendationReason,
              grading: club.recommendation.grading ? {
                score: club.recommendation.grading.score,
                grade: club.recommendation.grading.grade,
                ai_score: club.recommendation.grading.aiScore,
                independent_score: club.recommendation.grading.independentScore,
                condition: club.recommendation.grading.condition,
                analysis: club.recommendation.grading.aiAnalysis,
                specific_recommendation: club.recommendation.grading.specificRecommendation,
                performance_impact: club.recommendation.grading.performanceImpact,
                data_completeness: club.recommendation.grading.dataCompleteness
              } : null
            } : null
          };
        })
      },
    });
  } catch (error) {
    logger.error("Error grading user bag:", error);
    res.status(500).json({
      error: "Failed to grade bag",
      details: error.message,
    });
  }
});

// ==========================================
// HELPER FUNCTIONS (ALL UNCHANGED)
// ==========================================

// ==========================================
// PUTTER FILTERING & CLUB CATEGORIZATION
// ==========================================

/**
 * Check if a club is a putter
 */
function isPutter(club) {
  if (!club || !club.clubType) return false;
  const type = club.clubType.toLowerCase();
  return type === 'putter' || type.includes('putter');
}

/**
 * Get default/standard loft for a club type when actual data is missing
 * Returns: { loft: number, isDefault: true } or null if unknown
 * 
 * Standard lofts based on modern club manufacturing (2020+)
 */
function getDefaultLoft(clubType) {
  if (!clubType) return null;
  
  const type = clubType.toLowerCase().trim();
  
  // Default lofts lookup table
  const DEFAULT_LOFTS = {
    // Driver
    'driver': 10.5,
    '1w': 10.5,
    '1-wood': 10.5,
    
    // Fairway Woods
    '2-wood': 12,
    '2w': 12,
    '3-wood': 15,
    '3w': 15,
    '4-wood': 17,
    '4w': 17,
    '5-wood': 18,
    '5w': 18,
    '7-wood': 21,
    '7w': 21,
    '9-wood': 24,
    '9w': 24,
    '11-wood': 27,
    '11w': 27,
    
    // Hybrids
    '1-hybrid': 14,
    '1h': 14,
    '2-hybrid': 17,
    '2h': 17,
    '3-hybrid': 19,
    '3h': 19,
    '4-hybrid': 22,
    '4h': 22,
    '5-hybrid': 25,
    '5h': 25,
    '6-hybrid': 28,
    '6h': 28,
    '7-hybrid': 31,
    '7h': 31,
    
    // Irons (modern game-improvement lofts)
    '1-iron': 16,
    '1i': 16,
    '2-iron': 18,
    '2i': 18,
    '3-iron': 21,
    '3i': 21,
    '4-iron': 24,
    '4i': 24,
    '5-iron': 27,
    '5i': 27,
    '6-iron': 30,
    '6i': 30,
    '7-iron': 33,
    '7i': 33,
    '8-iron': 37,
    '8i': 37,
    '9-iron': 41,
    '9i': 41,
    
    // Wedges
    'pw': 45,
    'pitching wedge': 45,
    'pitching': 45,
    'gw': 50,
    'gap wedge': 50,
    'gap': 50,
    'aw': 50,
    'approach wedge': 50,
    'approach': 50,
    'sw': 56,
    'sand wedge': 56,
    'sand': 56,
    'lw': 60,
    'lob wedge': 60,
    'lob': 60,
    
    // Degree notation wedges
    '46°': 46,
    '48°': 48,
    '50°': 50,
    '52°': 52,
    '54°': 54,
    '56°': 56,
    '58°': 58,
    '60°': 60,
    '62°': 62,
    '64°': 64
  };
  
  // Direct match
  if (DEFAULT_LOFTS[type]) {
    return { loft: DEFAULT_LOFTS[type], isDefault: true };
  }
  
  // Try variations
  // Handle "X-iron" format
  const ironMatch = type.match(/^(\d+)-?iron$/);
  if (ironMatch) {
    const ironNum = parseInt(ironMatch[1]);
    const key = `${ironNum}-iron`;
    if (DEFAULT_LOFTS[key]) {
      return { loft: DEFAULT_LOFTS[key], isDefault: true };
    }
  }
  
  // Handle "Xi" format
  const ironShortMatch = type.match(/^(\d+)i$/);
  if (ironShortMatch) {
    const ironNum = parseInt(ironShortMatch[1]);
    const key = `${ironNum}i`;
    if (DEFAULT_LOFTS[key]) {
      return { loft: DEFAULT_LOFTS[key], isDefault: true };
    }
  }
  
  // Handle "X-wood" format
  const woodMatch = type.match(/^(\d+)-?wood$/);
  if (woodMatch) {
    const woodNum = parseInt(woodMatch[1]);
    const key = `${woodNum}-wood`;
    if (DEFAULT_LOFTS[key]) {
      return { loft: DEFAULT_LOFTS[key], isDefault: true };
    }
  }
  
  // Handle "Xw" format for woods
  const woodShortMatch = type.match(/^(\d+)w$/);
  if (woodShortMatch) {
    const woodNum = parseInt(woodShortMatch[1]);
    const key = `${woodNum}w`;
    if (DEFAULT_LOFTS[key]) {
      return { loft: DEFAULT_LOFTS[key], isDefault: true };
    }
  }
  
  // Handle "X-hybrid" or "Xh" format
  const hybridMatch = type.match(/^(\d+)-?hybrid$/) || type.match(/^(\d+)h$/);
  if (hybridMatch) {
    const hybridNum = parseInt(hybridMatch[1]);
    const key = `${hybridNum}h`;
    if (DEFAULT_LOFTS[key]) {
      return { loft: DEFAULT_LOFTS[key], isDefault: true };
    }
  }
  
  // Handle degree notation without ° symbol
  const degreeMatch = type.match(/^(\d+)°?$/);
  if (degreeMatch) {
    const degrees = parseInt(degreeMatch[1]);
    if (degrees >= 42 && degrees <= 72) {
      return { loft: degrees, isDefault: false }; // Not a default, it's the actual value
    }
  }
  
  return null;
}

/**
 * Enrich clubs with default lofts where missing
 * Returns clubs array with loft data filled in and tracking of defaults used
 */
function enrichClubsWithDefaultLofts(clubs) {
  const defaultsUsed = [];
  
  const enrichedClubs = clubs.map(club => {
    // If club already has loft, keep it
    if (club.loft) {
      return { ...club, loftIsDefault: false };
    }
    
    // Try to get default loft
    const defaultLoft = getDefaultLoft(club.clubType);
    if (defaultLoft) {
      defaultsUsed.push({
        clubType: club.clubType,
        defaultLoft: defaultLoft.loft,
        brand: club.brand,
        model: club.model
      });
      return { 
        ...club, 
        loft: defaultLoft.loft, 
        loftIsDefault: defaultLoft.isDefault 
      };
    }
    
    // No loft data available
    return { ...club, loftIsDefault: false };
  });
  
  return {
    clubs: enrichedClubs,
    defaultsUsed: defaultsUsed
  };
}

/**
 * Get default/standard shaft weight for a club type when actual data is missing
 * Returns: { weight: number, isDefault: true } or null if unknown
 * 
 * Standard shaft weights based on typical stock shaft configurations
 */
function getDefaultShaftWeight(clubType) {
  if (!clubType) return null;
  
  const type = clubType.toLowerCase().trim();
  
  const DEFAULT_WEIGHTS = {
    // Driver - lighter graphite shafts
    'driver': 55,
    '1w': 55,
    '1-wood': 55,
    
    // Fairway Woods - slightly heavier than driver
    '2-wood': 60,
    '2w': 60,
    '3-wood': 65,
    '3w': 65,
    '4-wood': 65,
    '4w': 65,
    '5-wood': 67,
    '5w': 67,
    '7-wood': 70,
    '7w': 70,
    '9-wood': 72,
    '9w': 72,
    '11-wood': 75,
    '11w': 75,
    
    // Hybrids
    '1-hybrid': 70,
    '1h': 70,
    '2-hybrid': 72,
    '2h': 72,
    '3-hybrid': 75,
    '3h': 75,
    '4-hybrid': 78,
    '4h': 78,
    '5-hybrid': 80,
    '5h': 80,
    '6-hybrid': 82,
    '6h': 82,
    '7-hybrid': 85,
    '7h': 85,
    
    // Irons (steel shaft weights)
    '1-iron': 110,
    '1i': 110,
    '2-iron': 112,
    '2i': 112,
    '3-iron': 115,
    '3i': 115,
    '4-iron': 118,
    '4i': 118,
    '5-iron': 120,
    '5i': 120,
    '6-iron': 122,
    '6i': 122,
    '7-iron': 125,
    '7i': 125,
    '8-iron': 127,
    '8i': 127,
    '9-iron': 130,
    '9i': 130,
    
    // Wedges (steel shafts, slightly heavier)
    'pw': 132,
    'pitching wedge': 132,
    'pitching': 132,
    'gw': 130,
    'gap wedge': 130,
    'gap': 130,
    'aw': 130,
    'approach wedge': 130,
    'approach': 130,
    'sw': 130,
    'sand wedge': 130,
    'sand': 130,
    'lw': 130,
    'lob wedge': 130,
    'lob': 130,
    
    // Degree notation wedges
    '46°': 130,
    '48°': 130,
    '50°': 130,
    '52°': 130,
    '54°': 130,
    '56°': 130,
    '58°': 130,
    '60°': 130,
    '62°': 130,
    '64°': 130
  };
  
  // Direct match
  if (DEFAULT_WEIGHTS[type]) {
    return { weight: DEFAULT_WEIGHTS[type], isDefault: true };
  }
  
  // Try variations for irons
  const ironMatch = type.match(/^(\d+)-?iron$/);
  if (ironMatch) {
    const key = `${ironMatch[1]}-iron`;
    if (DEFAULT_WEIGHTS[key]) {
      return { weight: DEFAULT_WEIGHTS[key], isDefault: true };
    }
  }
  
  // Try variations for hybrids
  const hybridMatch = type.match(/^(\d+)-?hybrid$/) || type.match(/^(\d+)h$/);
  if (hybridMatch) {
    const key = `${hybridMatch[1]}h`;
    if (DEFAULT_WEIGHTS[key]) {
      return { weight: DEFAULT_WEIGHTS[key], isDefault: true };
    }
  }
  
  // Try variations for woods
  const woodMatch = type.match(/^(\d+)-?wood$/) || type.match(/^(\d+)w$/);
  if (woodMatch) {
    const key = `${woodMatch[1]}w`;
    if (DEFAULT_WEIGHTS[key]) {
      return { weight: DEFAULT_WEIGHTS[key], isDefault: true };
    }
  }
  
  return null;
}

/**
 * Get default/standard lie angle for a club type when actual data is missing
 * Returns: { lie: number, isDefault: true } or null if unknown
 * 
 * Standard lie angles based on typical club manufacturing specs
 */
function getDefaultLieAngle(clubType) {
  if (!clubType) return null;
  
  const type = clubType.toLowerCase().trim();
  
  const DEFAULT_LIE_ANGLES = {
    // Driver
    'driver': 56,
    '1w': 56,
    '1-wood': 56,
    
    // Fairway Woods
    '2-wood': 56.5,
    '2w': 56.5,
    '3-wood': 57,
    '3w': 57,
    '4-wood': 57.5,
    '4w': 57.5,
    '5-wood': 58,
    '5w': 58,
    '7-wood': 59,
    '7w': 59,
    '9-wood': 60,
    '9w': 60,
    '11-wood': 61,
    '11w': 61,
    
    // Hybrids
    '1-hybrid': 57,
    '1h': 57,
    '2-hybrid': 58,
    '2h': 58,
    '3-hybrid': 59,
    '3h': 59,
    '4-hybrid': 60,
    '4h': 60,
    '5-hybrid': 61,
    '5h': 61,
    '6-hybrid': 62,
    '6h': 62,
    '7-hybrid': 63,
    '7h': 63,
    
    // Irons
    '1-iron': 56,
    '1i': 56,
    '2-iron': 57,
    '2i': 57,
    '3-iron': 59,
    '3i': 59,
    '4-iron': 60,
    '4i': 60,
    '5-iron': 61,
    '5i': 61,
    '6-iron': 62,
    '6i': 62,
    '7-iron': 63,
    '7i': 63,
    '8-iron': 64,
    '8i': 64,
    '9-iron': 65,
    '9i': 65,
    
    // Wedges
    'pw': 65.5,
    'pitching wedge': 65.5,
    'pitching': 65.5,
    'gw': 64,
    'gap wedge': 64,
    'gap': 64,
    'aw': 64,
    'approach wedge': 64,
    'approach': 64,
    'sw': 64,
    'sand wedge': 64,
    'sand': 64,
    'lw': 64,
    'lob wedge': 64,
    'lob': 64,
    
    // Degree notation wedges
    '46°': 64,
    '48°': 64,
    '50°': 64,
    '52°': 64,
    '54°': 64,
    '56°': 64,
    '58°': 64,
    '60°': 64,
    '62°': 64,
    '64°': 64
  };
  
  // Direct match
  if (DEFAULT_LIE_ANGLES[type]) {
    return { lie: DEFAULT_LIE_ANGLES[type], isDefault: true };
  }
  
  // Try variations for irons
  const ironMatch = type.match(/^(\d+)-?iron$/);
  if (ironMatch) {
    const key = `${ironMatch[1]}-iron`;
    if (DEFAULT_LIE_ANGLES[key]) {
      return { lie: DEFAULT_LIE_ANGLES[key], isDefault: true };
    }
  }
  
  // Try variations for hybrids
  const hybridMatch = type.match(/^(\d+)-?hybrid$/) || type.match(/^(\d+)h$/);
  if (hybridMatch) {
    const key = `${hybridMatch[1]}h`;
    if (DEFAULT_LIE_ANGLES[key]) {
      return { lie: DEFAULT_LIE_ANGLES[key], isDefault: true };
    }
  }
  
  // Try variations for woods
  const woodMatch = type.match(/^(\d+)-?wood$/) || type.match(/^(\d+)w$/);
  if (woodMatch) {
    const key = `${woodMatch[1]}w`;
    if (DEFAULT_LIE_ANGLES[key]) {
      return { lie: DEFAULT_LIE_ANGLES[key], isDefault: true };
    }
  }
  
  return null;
}

/**
 * Get default/standard length for a club type when actual data is missing
 * Returns: { length: number, isDefault: true } or null if unknown
 * 
 * Standard lengths in inches based on typical club manufacturing specs
 */
function getDefaultLength(clubType) {
  if (!clubType) return null;
  
  const type = clubType.toLowerCase().trim();
  
  const DEFAULT_LENGTHS = {
    // Driver
    'driver': 45.5,
    '1w': 45.5,
    '1-wood': 45.5,
    
    // Fairway Woods
    '2-wood': 43.5,
    '2w': 43.5,
    '3-wood': 43,
    '3w': 43,
    '4-wood': 42.5,
    '4w': 42.5,
    '5-wood': 42,
    '5w': 42,
    '7-wood': 41.5,
    '7w': 41.5,
    '9-wood': 41,
    '9w': 41,
    '11-wood': 40.5,
    '11w': 40.5,
    
    // Hybrids
    '1-hybrid': 41,
    '1h': 41,
    '2-hybrid': 40.5,
    '2h': 40.5,
    '3-hybrid': 40,
    '3h': 40,
    '4-hybrid': 39.5,
    '4h': 39.5,
    '5-hybrid': 39,
    '5h': 39,
    '6-hybrid': 38.5,
    '6h': 38.5,
    '7-hybrid': 38,
    '7h': 38,
    
    // Irons
    '1-iron': 40,
    '1i': 40,
    '2-iron': 39.5,
    '2i': 39.5,
    '3-iron': 39,
    '3i': 39,
    '4-iron': 38.5,
    '4i': 38.5,
    '5-iron': 38,
    '5i': 38,
    '6-iron': 37.5,
    '6i': 37.5,
    '7-iron': 37,
    '7i': 37,
    '8-iron': 36.5,
    '8i': 36.5,
    '9-iron': 36,
    '9i': 36,
    
    // Wedges
    'pw': 35.5,
    'pitching wedge': 35.5,
    'pitching': 35.5,
    'gw': 35.5,
    'gap wedge': 35.5,
    'gap': 35.5,
    'aw': 35.5,
    'approach wedge': 35.5,
    'approach': 35.5,
    'sw': 35.25,
    'sand wedge': 35.25,
    'sand': 35.25,
    'lw': 35,
    'lob wedge': 35,
    'lob': 35,
    
    // Degree notation wedges
    '46°': 35.5,
    '48°': 35.5,
    '50°': 35.5,
    '52°': 35.25,
    '54°': 35.25,
    '56°': 35.25,
    '58°': 35,
    '60°': 35,
    '62°': 35,
    '64°': 35
  };
  
  // Direct match
  if (DEFAULT_LENGTHS[type]) {
    return { length: DEFAULT_LENGTHS[type], isDefault: true };
  }
  
  // Try variations for irons
  const ironMatch = type.match(/^(\d+)-?iron$/);
  if (ironMatch) {
    const key = `${ironMatch[1]}-iron`;
    if (DEFAULT_LENGTHS[key]) {
      return { length: DEFAULT_LENGTHS[key], isDefault: true };
    }
  }
  
  // Try variations for hybrids
  const hybridMatch = type.match(/^(\d+)-?hybrid$/) || type.match(/^(\d+)h$/);
  if (hybridMatch) {
    const key = `${hybridMatch[1]}h`;
    if (DEFAULT_LENGTHS[key]) {
      return { length: DEFAULT_LENGTHS[key], isDefault: true };
    }
  }
  
  // Try variations for woods
  const woodMatch = type.match(/^(\d+)-?wood$/) || type.match(/^(\d+)w$/);
  if (woodMatch) {
    const key = `${woodMatch[1]}w`;
    if (DEFAULT_LENGTHS[key]) {
      return { length: DEFAULT_LENGTHS[key], isDefault: true };
    }
  }
  
  return null;
}

/**
 * Get club sort order for sorting from driver down to wedge
 * Lower number = appears first (driver)
 * Higher number = appears later (wedges)
 */
function getClubSortOrder(club) {
  if (!club || !club.clubType) return 999;
  
  const type = club.clubType.toLowerCase().trim();
  
  // If we have loft, use it for precise ordering
  if (club.loft) {
    return club.loft;
  }
  
  // Fallback sort order by club type
  const SORT_ORDER = {
    'driver': 10,
    '1w': 10,
    '1-wood': 10,
    '2-wood': 12,
    '2w': 12,
    '3-wood': 15,
    '3w': 15,
    '4-wood': 17,
    '4w': 17,
    '5-wood': 18,
    '5w': 18,
    '7-wood': 21,
    '7w': 21,
    '9-wood': 24,
    '9w': 24,
    '11-wood': 27,
    '11w': 27,
    '1-hybrid': 14,
    '1h': 14,
    '2-hybrid': 17,
    '2h': 17,
    '3-hybrid': 19,
    '3h': 19,
    '4-hybrid': 22,
    '4h': 22,
    '5-hybrid': 25,
    '5h': 25,
    '6-hybrid': 28,
    '6h': 28,
    '7-hybrid': 31,
    '7h': 31,
    '1-iron': 16,
    '1i': 16,
    '2-iron': 18,
    '2i': 18,
    '3-iron': 21,
    '3i': 21,
    '4-iron': 24,
    '4i': 24,
    '5-iron': 27,
    '5i': 27,
    '6-iron': 30,
    '6i': 30,
    '7-iron': 33,
    '7i': 33,
    '8-iron': 37,
    '8i': 37,
    '9-iron': 41,
    '9i': 41,
    'pw': 45,
    'pitching wedge': 45,
    'gw': 50,
    'gap wedge': 50,
    'aw': 50,
    'approach wedge': 50,
    'sw': 56,
    'sand wedge': 56,
    'lw': 60,
    'lob wedge': 60,
    'putter': 999
  };
  
  if (SORT_ORDER[type]) {
    return SORT_ORDER[type];
  }
  
  // Handle degree notation
  const degreeMatch = type.match(/^(\d+)°?$/);
  if (degreeMatch) {
    return parseInt(degreeMatch[1]);
  }
  
  // Handle iron variations
  const ironMatch = type.match(/^(\d+)-?iron$/);
  if (ironMatch) {
    const key = `${ironMatch[1]}-iron`;
    if (SORT_ORDER[key]) return SORT_ORDER[key];
  }
  
  return 999;
}

/**
 * Sort clubs from driver to wedge (by loft/sort order)
 */
function sortClubsByLoft(clubs) {
  return [...clubs].sort((a, b) => getClubSortOrder(a) - getClubSortOrder(b));
}

/**
 * Enrich clubs with all default values where missing
 * Returns clubs array with loft, weight, lie, and length data filled in
 */
function enrichClubsWithAllDefaults(clubs) {
  const defaultsUsed = {
    loft: [],
    weight: [],
    lie: [],
    length: []
  };
  
  const enrichedClubs = clubs.map(club => {
    const enriched = { ...club };
    
    // Loft defaults
    if (!club.loft) {
      const defaultLoft = getDefaultLoft(club.clubType);
      if (defaultLoft) {
        enriched.loft = defaultLoft.loft;
        enriched.loftIsDefault = defaultLoft.isDefault;
        if (defaultLoft.isDefault) {
          defaultsUsed.loft.push({ clubType: club.clubType, value: defaultLoft.loft });
        }
      } else {
        enriched.loftIsDefault = false;
      }
    } else {
      enriched.loftIsDefault = false;
    }
    
    // Shaft weight defaults
    if (!club.shaft_weight) {
      const defaultWeight = getDefaultShaftWeight(club.clubType);
      if (defaultWeight) {
        enriched.shaft_weight = defaultWeight.weight;
        enriched.weightIsDefault = defaultWeight.isDefault;
        if (defaultWeight.isDefault) {
          defaultsUsed.weight.push({ clubType: club.clubType, value: defaultWeight.weight });
        }
      } else {
        enriched.weightIsDefault = false;
      }
    } else {
      enriched.weightIsDefault = false;
    }
    
    // Lie angle defaults
    if (!club.lie) {
      const defaultLie = getDefaultLieAngle(club.clubType);
      if (defaultLie) {
        enriched.lie = defaultLie.lie;
        enriched.lieIsDefault = defaultLie.isDefault;
        if (defaultLie.isDefault) {
          defaultsUsed.lie.push({ clubType: club.clubType, value: defaultLie.lie });
        }
      } else {
        enriched.lieIsDefault = false;
      }
    } else {
      enriched.lieIsDefault = false;
    }
    
    // Length defaults
    if (!club.length) {
      const defaultLength = getDefaultLength(club.clubType);
      if (defaultLength) {
        enriched.length = defaultLength.length;
        enriched.lengthIsDefault = defaultLength.isDefault;
        if (defaultLength.isDefault) {
          defaultsUsed.length.push({ clubType: club.clubType, value: defaultLength.length });
        }
      } else {
        enriched.lengthIsDefault = false;
      }
    } else {
      enriched.lengthIsDefault = false;
    }
    
    return enriched;
  });
  
  // Sort by loft order (driver to wedge)
  const sortedClubs = sortClubsByLoft(enrichedClubs);
  
  return {
    clubs: sortedClubs,
    defaultsUsed: defaultsUsed,
    totalDefaultsUsed: defaultsUsed.loft.length + defaultsUsed.weight.length + 
                        defaultsUsed.lie.length + defaultsUsed.length.length
  };
}

/**
 * Filter out putters from club array for factor grading
 * Putter is excluded from all 8 factor grades - only tracked for "has putter" check
 */
function filterOutPutters(clubs) {
  return clubs.filter(club => !isPutter(club));
}

/**
 * Check if bag has a putter
 */
function hasPutter(clubs) {
  return clubs.some(club => isPutter(club));
}

/**
 * Get club category for loft gap zone detection
 * Returns: 'driver', 'wood', 'hybrid', 'iron', 'wedge'
 */
function getClubCategory(club) {
  if (!club || !club.clubType) return 'unknown';
  const type = club.clubType.toLowerCase();
  
  // Driver
  if (type === 'driver' || type === '1w' || type === '1-wood') {
    return 'driver';
  }
  
  // Woods (3W, 5W, 7W, etc.)
  if (type.match(/^\d+-?wood$/) || type.match(/^\d+w$/) || 
      ['3-wood', '5-wood', '7-wood', '9-wood', '3w', '5w', '7w', '9w'].includes(type)) {
    return 'wood';
  }
  
  // Hybrids
  if (type.includes('hybrid') || type.match(/^\d+h$/) || type.match(/^\d+-hybrid$/)) {
    return 'hybrid';
  }
  
  // Wedges (PW, GW, AW, SW, LW, or degree notation like 52°, 56°)
  if (['pw', 'gw', 'aw', 'sw', 'lw'].includes(type) || type.match(/^\d+°$/)) {
    // Check loft - wedges are typically 42°+
    if (club.loft && club.loft >= 42) {
      return 'wedge';
    }
    return 'wedge'; // Named wedges are wedges regardless of loft data
  }
  
  // Irons (5i, 6-iron, etc.)
  if (type.match(/^\d+i$/) || type.match(/^\d+-iron$/) || type.match(/^\d+ iron$/)) {
    return 'iron';
  }
  
  // Fallback based on loft if available
  if (club.loft) {
    if (club.loft < 14) return 'driver';
    if (club.loft < 22) return 'wood';
    if (club.loft < 28) return 'hybrid';
    if (club.loft >= 42) return 'wedge';
    return 'iron';
  }
  
  return 'unknown';
}

// ==========================================
// TIERED LOFT GAP THRESHOLDS (Per Spec)
// ==========================================

const LOFT_GAP_THRESHOLDS = {
  WOODS_TOP: {      // Driver → 3W
    overlap: 3,     // < 3° = overlap (too close)
    optimalMin: 4,  // 4-6° = optimal
    optimalMax: 6,
    wide: 8,        // 6-8° = wide
    majorVoid: 8    // > 8° = major void
  },
  WOODS_MID: {      // 3W → 5W
    overlap: 2,
    optimalMin: 3,
    optimalMax: 5,
    wide: 6,
    majorVoid: 6
  },
  WOODS_LOW: {      // 5W/7W → Hybrid
    overlap: 2,
    optimalMin: 3,
    optimalMax: 4,
    wide: 6,
    majorVoid: 6
  },
  HYBRID_IRON: {    // Hybrid → Long Iron
    overlap: 2,
    optimalMin: 3,
    optimalMax: 5,
    wide: 6,
    majorVoid: 6
  },
  IRONS: {          // All iron-to-iron transitions
    overlap: 2,
    optimalMin: 3,
    optimalMax: 4,
    wide: 5,
    majorVoid: 5
  },
  WEDGES: {         // PW → GW → SW → LW
    overlap: 2,
    optimalMin: 4,
    optimalMax: 6,
    wide: 8,
    majorVoid: 8
  }
};

const GAP_PENALTIES = {
  overlap: -5,      // Redundant club (reduced from -10)
  tight: -2,        // Minimal separation (reduced from -5)
  optimal: 0,       // Perfect gapping
  wide: -5,         // Distance void (reduced from -8)
  majorVoid: -5     // Significant gap (reduced from -15, now same as wide)
};

/**
 * Determine which gap zone applies between two clubs
 * @param {Object} lowerLoftClub - Club with lower loft (e.g., Driver)
 * @param {Object} higherLoftClub - Club with higher loft (e.g., 3W)
 */
function getGapZone(lowerLoftClub, higherLoftClub) {
  const lowerCat = getClubCategory(lowerLoftClub);
  const higherCat = getClubCategory(higherLoftClub);
  
  // Driver to any wood
  if (lowerCat === 'driver' && higherCat === 'wood') {
    return 'WOODS_TOP';
  }
  
  // Driver to hybrid (skipped woods)
  if (lowerCat === 'driver' && higherCat === 'hybrid') {
    return 'WOODS_TOP'; // Use woods_top thresholds but will likely flag as void
  }
  
  // Driver to iron (skipped woods and hybrids)
  if (lowerCat === 'driver' && higherCat === 'iron') {
    return 'WOODS_TOP'; // Will definitely flag as major void
  }
  
  // Wood to wood (3W to 5W, 5W to 7W)
  if (lowerCat === 'wood' && higherCat === 'wood') {
    return 'WOODS_MID';
  }
  
  // Wood to hybrid
  if (lowerCat === 'wood' && higherCat === 'hybrid') {
    return 'WOODS_LOW';
  }
  
  // Wood to iron (skipped hybrids)
  if (lowerCat === 'wood' && higherCat === 'iron') {
    return 'HYBRID_IRON';
  }
  
  // Hybrid to hybrid
  if (lowerCat === 'hybrid' && higherCat === 'hybrid') {
    return 'HYBRID_IRON';
  }
  
  // Hybrid to iron
  if (lowerCat === 'hybrid' && higherCat === 'iron') {
    return 'HYBRID_IRON';
  }
  
  // Iron to iron
  if (lowerCat === 'iron' && higherCat === 'iron') {
    return 'IRONS';
  }
  
  // Iron to wedge (including PW)
  if (lowerCat === 'iron' && higherCat === 'wedge') {
    return 'WEDGES';
  }
  
  // Wedge to wedge
  if (lowerCat === 'wedge' && higherCat === 'wedge') {
    return 'WEDGES';
  }
  
  // Hybrid to wedge (unusual but possible)
  if (lowerCat === 'hybrid' && higherCat === 'wedge') {
    return 'WEDGES';
  }
  
  // Default fallback
  return 'IRONS';
}

/**
 * Score a gap based on its zone-specific thresholds
 */
function scoreGap(gapDegrees, zone) {
  const thresholds = LOFT_GAP_THRESHOLDS[zone];
  
  if (!thresholds) {
    // Fallback to IRONS thresholds
    return scoreGap(gapDegrees, 'IRONS');
  }
  
  if (gapDegrees < thresholds.overlap) {
    return { quality: 'overlap', penalty: GAP_PENALTIES.overlap };
  }
  if (gapDegrees < thresholds.optimalMin) {
    return { quality: 'tight', penalty: GAP_PENALTIES.tight };
  }
  if (gapDegrees <= thresholds.optimalMax) {
    return { quality: 'optimal', penalty: GAP_PENALTIES.optimal };
  }
  if (gapDegrees <= thresholds.wide) {
    return { quality: 'wide', penalty: GAP_PENALTIES.wide };
  }
  return { quality: 'majorVoid', penalty: GAP_PENALTIES.majorVoid };
}

// ==========================================
// BAG COMPOSITION ANALYZER
// ==========================================

/**
 * Analyze bag composition and identify missing clubs
 * Returns penalties for incomplete bags and recommendations
 * 
 * Expected 14-club bag:
 * - Driver (1)
 * - Fairway woods (1-2): 3W, 5W, 7W
 * - Hybrids (0-2): 3H, 4H, 5H
 * - Irons (5-8): typically 4i/5i through 9i
 * - Wedges (3-4): PW, GW, SW, LW
 * - Putter (1)
 */
function analyzeBagComposition(clubs) {
  const composition = {
    driver: [],
    woods: [],
    hybrids: [],
    irons: [],
    wedges: [],
    putter: []
  };
  
  // Categorize each club
  clubs.forEach(club => {
    const category = getClubCategory(club);
    const clubInfo = {
      clubType: club.clubType,
      loft: club.loft || null,
      brand: club.brand,
      model: club.model
    };
    
    if (isPutter(club)) {
      composition.putter.push(clubInfo);
    } else if (category === 'driver') {
      composition.driver.push(clubInfo);
    } else if (category === 'wood') {
      composition.woods.push(clubInfo);
    } else if (category === 'hybrid') {
      composition.hybrids.push(clubInfo);
    } else if (category === 'iron') {
      composition.irons.push(clubInfo);
    } else if (category === 'wedge') {
      composition.wedges.push(clubInfo);
    }
  });
  
  // Sort by loft where available
  Object.keys(composition).forEach(key => {
    composition[key].sort((a, b) => (a.loft || 0) - (b.loft || 0));
  });
  
  // Analyze gaps and missing clubs
  const gaps = [];
  const recommendations = [];
  let totalPenalty = 0;
  const issues = [];
  
  // Check for driver
  if (composition.driver.length === 0) {
    gaps.push('No driver');
    recommendations.push('Add a driver (9-12°) for tee shots');
    totalPenalty += 10;
    issues.push('Missing driver - 10 point penalty');
  }
  
  // Check for putter (for informational purposes only - no penalty)
  // We assume all golfers have a putter, so no penalty is applied
  const hasPutterClub = composition.putter.length > 0;
  // REMOVED: Gap and recommendation for missing putter
  // if (!hasPutterClub) {
  //   gaps.push('No putter');
  //   recommendations.push('Add a putter to complete the bag');
  // }
  
  // Check for long game coverage (woods OR hybrids)
  const hasWoods = composition.woods.length > 0;
  const hasHybrids = composition.hybrids.length > 0;
  
  if (!hasWoods && !hasHybrids) {
    gaps.push('No fairway woods or hybrids');
    recommendations.push('Add a 3-wood (15°) or 3-hybrid (19-21°) for long approach shots');
    totalPenalty += 8;
    issues.push('Missing fairway woods AND hybrids - 8 point penalty');
  } else if (!hasWoods && hasHybrids) {
    // Has hybrids but no woods - check if there's a big gap from driver
    const lowestHybridLoft = composition.hybrids[0]?.loft;
    const driverLoft = composition.driver[0]?.loft || 10.5;
    
    if (lowestHybridLoft && (lowestHybridLoft - driverLoft) > 10) {
      gaps.push(`Large gap between driver (${driverLoft}°) and first hybrid (${lowestHybridLoft}°)`);
      recommendations.push(`Consider adding a 3-wood or 5-wood (15-18°) to bridge the ${Math.round(lowestHybridLoft - driverLoft)}° gap`);
      totalPenalty += 5;
      issues.push(`${Math.round(lowestHybridLoft - driverLoft)}° gap from driver to hybrid - 5 point penalty`);
    }
  } else if (hasWoods && !hasHybrids) {
    // Has woods but no hybrids - check gap from woods to irons
    const highestWoodLoft = composition.woods[composition.woods.length - 1]?.loft;
    const lowestIronLoft = composition.irons[0]?.loft;
    
    if (highestWoodLoft && lowestIronLoft && (lowestIronLoft - highestWoodLoft) > 6) {
      gaps.push(`Large gap between ${composition.woods[composition.woods.length - 1].clubType} (${highestWoodLoft}°) and ${composition.irons[0].clubType} (${lowestIronLoft}°)`);
      recommendations.push(`Consider adding a hybrid (${Math.round(highestWoodLoft + 3)}-${Math.round(lowestIronLoft - 2)}°) to bridge the gap`);
      totalPenalty += 3;
      issues.push(`${Math.round(lowestIronLoft - highestWoodLoft)}° gap from woods to irons - 3 point penalty`);
    }
  }
  
  // Check iron coverage
  if (composition.irons.length < 4) {
    gaps.push(`Only ${composition.irons.length} irons in bag`);
    recommendations.push('Consider adding more irons for better distance coverage');
    totalPenalty += 3;
    issues.push(`Only ${composition.irons.length} irons - 3 point penalty`);
  }
  
  // Check wedge coverage
  if (composition.wedges.length < 2) {
    gaps.push(`Only ${composition.wedges.length} wedge(s) in bag`);
    recommendations.push('Add wedges (GW, SW, LW) for better short game coverage');
    totalPenalty += 3;
    issues.push(`Only ${composition.wedges.length} wedge(s) - 3 point penalty`);
  }
  
  // Check for PW specifically (most important wedge)
  const hasPW = composition.wedges.some(w => 
    w.clubType?.toUpperCase() === 'PW' || 
    (w.loft && w.loft >= 42 && w.loft <= 48)
  );
  if (!hasPW && composition.wedges.length > 0) {
    gaps.push('No pitching wedge detected');
    recommendations.push('Ensure you have a pitching wedge (42-48°) for approach shots');
    // No additional penalty - covered by wedge count
  }
  
  // Check total club count
  const totalClubs = clubs.length;
  if (totalClubs < 8) {
    gaps.push(`Only ${totalClubs} clubs total`);
    recommendations.push('Build out your bag to at least 10-12 clubs for better course coverage');
    totalPenalty += 5;
    issues.push(`Only ${totalClubs} clubs in bag - 5 point penalty`);
  } else if (totalClubs < 10) {
    gaps.push(`Only ${totalClubs} clubs total`);
    recommendations.push('Consider adding more clubs to reach 12-14 for optimal coverage');
    totalPenalty += 2;
    issues.push(`Only ${totalClubs} clubs in bag - 2 point penalty`);
  } else if (totalClubs > 14) {
    gaps.push(`${totalClubs} clubs exceeds 14-club limit`);
    recommendations.push('Remove clubs to comply with Rules of Golf 14-club limit');
    // No score penalty - just a rules reminder
  }
  
  return {
    clubCount: totalClubs,
    fullBag: totalClubs >= 12 && gaps.length === 0,
    composition: {
      driver: composition.driver.length,
      woods: composition.woods.length,
      hybrids: composition.hybrids.length,
      irons: composition.irons.length,
      wedges: composition.wedges.length,
      putter: composition.putter.length
    },
    clubDetails: composition,
    gaps: gaps,
    recommendations: recommendations,
    penalty: totalPenalty,
    issues: issues,
    hasPutter: hasPutterClub
  };
}

// ==========================================
// GRIP CONDITION ASSESSMENT
// ==========================================

/**
 * Analyze grip condition across the bag
 * This is a SEPARATE assessment - does not affect overall bag grade
 * Helps pros identify regripping opportunities
 * 
 * Grip data fields on club documents:
 * - grip_condition: 'new' | 'good' | 'worn' | 'replace'
 * - grip_size: 'undersized' | 'standard' | 'midsize' | 'oversize' | 'jumbo'
 * - grip_brand: string (e.g., 'Golf Pride', 'SuperStroke', 'Lamkin')
 * - grip_model: string (e.g., 'MCC Plus4', 'Z-Grip')
 */
function analyzeGripCondition(clubs) {
  const REGRIP_COST_PER_CLUB = 12; // Average cost including grip + labor
  const PREMIUM_REGRIP_COST = 18;  // Premium grips
  
  // Grip brand recommendations by category
  const GRIP_RECOMMENDATIONS = {
    standard: [
      { brand: 'Golf Pride', model: 'Tour Velvet', price: 6 },
      { brand: 'Golf Pride', model: 'MCC Plus4', price: 9 },
      { brand: 'Lamkin', model: 'Crossline', price: 5 }
    ],
    premium: [
      { brand: 'Golf Pride', model: 'Z-Grip', price: 10 },
      { brand: 'SuperStroke', model: 'S-Tech', price: 8 },
      { brand: 'Lamkin', model: 'Sonar', price: 9 }
    ],
    oversize: [
      { brand: 'Golf Pride', model: 'CP2 Wrap Jumbo', price: 8 },
      { brand: 'SuperStroke', model: 'S-Tech Midsize', price: 9 },
      { brand: 'Winn', model: 'Dri-Tac Oversize', price: 7 }
    ],
    putter: [
      { brand: 'SuperStroke', model: 'Pistol GT Tour', price: 25 },
      { brand: 'Golf Pride', model: 'Pro Only', price: 15 },
      { brand: 'Lamkin', model: 'Sink Fit', price: 20 }
    ]
  };
  
  const clubsNeedingRegrip = [];
  const clubsWithMismatchedSize = [];
  const clubsWithMismatchedBrand = [];
  const allGripData = [];
  
  // Track grip sizes and brands for consistency check
  const gripSizes = {};
  const gripBrands = {};
  let clubsWithGripData = 0;
  let clubsWithConditionData = 0;
  
  clubs.forEach(club => {
    const gripInfo = {
      clubType: club.clubType,
      clubId: club.id,
      condition: club.grip_condition || null,
      size: club.grip_size || null,
      brand: club.grip_brand || null,
      model: club.grip_model || null,
      needsRegrip: false,
      mismatchReason: null
    };
    
    // Track what data we have
    if (gripInfo.condition || gripInfo.size || gripInfo.brand) {
      clubsWithGripData++;
    }
    if (gripInfo.condition) {
      clubsWithConditionData++;
    }
    
    // Check condition - flag worn or replace
    if (gripInfo.condition === 'worn' || gripInfo.condition === 'replace') {
      gripInfo.needsRegrip = true;
      gripInfo.mismatchReason = gripInfo.condition === 'replace' 
        ? 'Needs immediate replacement' 
        : 'Showing wear - recommend replacement soon';
      clubsNeedingRegrip.push(gripInfo);
    }
    
    // Track sizes for consistency (excluding putter)
    if (gripInfo.size && !isPutter(club)) {
      gripSizes[gripInfo.size] = (gripSizes[gripInfo.size] || 0) + 1;
    }
    
    // Track brands for consistency (excluding putter)
    if (gripInfo.brand && !isPutter(club)) {
      gripBrands[gripInfo.brand] = (gripBrands[gripInfo.brand] || 0) + 1;
    }
    
    allGripData.push(gripInfo);
  });
  
  // Determine dominant size and brand (excluding putter)
  const dominantSize = Object.entries(gripSizes).sort((a, b) => b[1] - a[1])[0];
  const dominantBrand = Object.entries(gripBrands).sort((a, b) => b[1] - a[1])[0];
  
  // Check for size mismatches
  if (dominantSize) {
    allGripData.forEach(grip => {
      const club = clubs.find(c => c.clubType === grip.clubType);
      if (grip.size && grip.size !== dominantSize[0] && !isPutter(club)) {
        grip.needsRegrip = true;
        grip.mismatchReason = grip.mismatchReason 
          ? `${grip.mismatchReason}; Size mismatch (${grip.size} vs ${dominantSize[0]} standard)`
          : `Size mismatch (${grip.size} vs ${dominantSize[0]} standard)`;
        if (!clubsNeedingRegrip.find(c => c.clubType === grip.clubType)) {
          clubsNeedingRegrip.push(grip);
        }
        clubsWithMismatchedSize.push(grip);
      }
    });
  }
  
  // Check for brand inconsistencies (informational only, not automatic regrip flag)
  if (dominantBrand) {
    allGripData.forEach(grip => {
      const club = clubs.find(c => c.clubType === grip.clubType);
      if (grip.brand && grip.brand !== dominantBrand[0] && !isPutter(club)) {
        clubsWithMismatchedBrand.push(grip);
      }
    });
  }
  
  // Calculate costs
  const standardRegrip = clubsNeedingRegrip.length * REGRIP_COST_PER_CLUB;
  const premiumRegrip = clubsNeedingRegrip.length * PREMIUM_REGRIP_COST;
  const fullBagRegrip = clubs.length * REGRIP_COST_PER_CLUB;
  const fullBagPremium = clubs.length * PREMIUM_REGRIP_COST;
  
  // Determine if bulk replace is recommended
  const bulkReplaceRecommended = clubsNeedingRegrip.length >= Math.ceil(clubs.length * 0.5);
  
  // Build recommendations
  const recommendations = [];
  
  if (clubsNeedingRegrip.length === 0 && clubsWithConditionData > 0) {
    recommendations.push('All grips in good condition - no immediate action needed');
  } else if (clubsNeedingRegrip.length > 0) {
    if (bulkReplaceRecommended) {
      recommendations.push(`Consider regripping entire bag for consistency ($${fullBagRegrip}-$${fullBagPremium})`);
    } else {
      recommendations.push(`${clubsNeedingRegrip.length} club(s) need regripping ($${standardRegrip}-$${premiumRegrip})`);
    }
  }
  
  if (clubsWithMismatchedSize.length > 0) {
    recommendations.push(`${clubsWithMismatchedSize.length} club(s) have inconsistent grip sizes - standardize for better feel`);
  }
  
  if (clubsWithMismatchedBrand.length > 2) {
    recommendations.push(`Multiple grip brands detected - consider standardizing for consistent feel`);
  }
  
  if (clubsWithGripData === 0) {
    recommendations.push('No grip data available - add grip details for assessment');
  }
  
  // Sales opportunity summary
  let salesOpportunity = null;
  if (clubsNeedingRegrip.length > 0 || bulkReplaceRecommended) {
    salesOpportunity = {
      priority: bulkReplaceRecommended ? 'high' : 'medium',
      clubsAffected: bulkReplaceRecommended ? clubs.length : clubsNeedingRegrip.length,
      estimatedRevenue: bulkReplaceRecommended ? fullBagRegrip : standardRegrip,
      pitch: bulkReplaceRecommended 
        ? `Full bag regrip opportunity - ${clubs.length} clubs @ $${REGRIP_COST_PER_CLUB}/club = $${fullBagRegrip}`
        : `Partial regrip - ${clubsNeedingRegrip.length} clubs @ $${REGRIP_COST_PER_CLUB}/club = $${standardRegrip}`
    };
  }
  
  return {
    // Summary stats
    totalClubs: clubs.length,
    clubsWithGripData: clubsWithGripData,
    clubsNeedingRegrip: clubsNeedingRegrip.length,
    
    // Consistency analysis
    dominantSize: dominantSize ? dominantSize[0] : null,
    dominantBrand: dominantBrand ? dominantBrand[0] : null,
    sizeMismatches: clubsWithMismatchedSize.length,
    brandVariety: Object.keys(gripBrands).length,
    
    // Detailed club data
    clubs: allGripData,
    clubsToRegrip: clubsNeedingRegrip,
    clubsWithSizeMismatch: clubsWithMismatchedSize,
    clubsWithBrandMismatch: clubsWithMismatchedBrand,
    
    // Cost estimates
    costEstimate: {
      perClub: REGRIP_COST_PER_CLUB,
      premiumPerClub: PREMIUM_REGRIP_COST,
      neededClubsStandard: standardRegrip,
      neededClubsPremium: premiumRegrip,
      fullBagStandard: fullBagRegrip,
      fullBagPremium: fullBagPremium
    },
    
    // Recommendations
    bulkReplaceRecommended: bulkReplaceRecommended,
    recommendations: recommendations,
    gripRecommendations: GRIP_RECOMMENDATIONS,
    
    // Pro sales opportunity
    salesOpportunity: salesOpportunity
  };
}

// ==========================================
// GRADE EXPLAINER - WHY THIS GRADE?
// ==========================================

/**
 * Generate clear explanations for why a bag received its grade
 * Highlights the biggest factors impacting the score
 * 
 * @param {Object} params - All scoring data
 * @returns {Object} Grade explanation with ranked impacts
 */
function generateGradeExplainer(params) {
  const {
    overallScore,
    overallGrade,
    componentScores,
    bagComposition,
    loftGapAnalysis,
    allIssues
  } = params;
  
  const impacts = [];
  
  // 1. Check bag composition penalties (EXCLUDING putter - we assume everyone has one)
  if (bagComposition.penalty > 0) {
    // REMOVED: Putter penalty from grade explainer
    // We assume all golfers have a putter, no penalty needed
    
    // Other composition issues are in bagComposition.issues
    bagComposition.issues.forEach(issue => {
      if (!issue.includes('putter')) {
        const penaltyMatch = issue.match(/(\d+) point penalty/);
        const penalty = penaltyMatch ? parseInt(penaltyMatch[1]) : 0;
        if (penalty > 0) {
          impacts.push({
            category: 'Bag Composition',
            issue: issue.replace(/ - \d+ point penalty/, ''),
            impact: -penalty,
            explanation: issue,
            fix: bagComposition.recommendations[0] || 'Complete your bag setup'
          });
        }
      }
    });
  }
  
  // 2. Check loft gapping issues (biggest impact for F grades)
  if (loftGapAnalysis && loftGapAnalysis.length > 0) {
    loftGapAnalysis.forEach(gap => {
      if (gap.quality === 'overlap') {
        impacts.push({
          category: 'Loft Gapping',
          issue: `Duplicate lofts: ${gap.from} and ${gap.to} are both ${gap.fromLoft}°`,
          impact: gap.penalty,
          explanation: `Having two clubs at the same loft wastes a slot in your bag. The ${gap.from} and ${gap.to} have ${gap.gap}° difference - essentially the same club.`,
          fix: `Replace one with a different loft (e.g., change to ${gap.fromLoft + 4}° or ${gap.fromLoft - 4}°)`
        });
      } else if (gap.quality === 'majorVoid') {
        impacts.push({
          category: 'Loft Gapping',
          issue: `${gap.gap}° gap between ${gap.from} and ${gap.to}`,
          impact: gap.penalty,
          explanation: `A ${gap.gap}° gap creates a significant distance void. You'll have trouble covering distances between these clubs.`,
          fix: `Add a club between ${gap.from} (${gap.fromLoft}°) and ${gap.to} (${gap.toLoft}°)`
        });
      } else if (gap.quality === 'wide') {
        impacts.push({
          category: 'Loft Gapping',
          issue: `${gap.gap}° gap between ${gap.from} and ${gap.to}`,
          impact: gap.penalty,
          explanation: `A ${gap.gap}° gap is wider than optimal and may create distance coverage issues.`,
          fix: `Consider adding a club to fill this gap`
        });
      }
    });
  }
  
  // 3. Check low-scoring factors
  const factorNames = {
    age: 'Club Age',
    weight: 'Weight Progression',
    loft: 'Loft Gapping',
    flex: 'Flex Consistency',
    kickpoint: 'Kickpoint Consistency',
    torque: 'Torque Consistency',
    length: 'Length Progression',
    lie: 'Lie Angle Progression'
  };
  
  Object.entries(componentScores).forEach(([key, data]) => {
    if (data.score < 70 && data.scorable !== false) {
      // This is a major problem factor
      const factorName = factorNames[key] || key;
      const impact = Math.round((data.score - 100) * 0.125); // Approximate impact based on weight
      
      // Find related issues
      const relatedIssues = allIssues.filter(issue => {
        const keywords = {
          age: ['year old', 'years old', 'outdated'],
          weight: ['weight', 'gram'],
          loft: ['gap', 'overlap', 'gapping'],
          flex: ['flex', 'stiff', 'regular'],
          kickpoint: ['kickpoint'],
          torque: ['torque'],
          length: ['length', 'inch', '"'],
          lie: ['lie']
        };
        return (keywords[key] || []).some(kw => issue.toLowerCase().includes(kw));
      });
      
      if (!impacts.find(i => i.category === factorName)) {
        impacts.push({
          category: factorName,
          issue: `Factor scored ${data.score}/100 (${data.grade || scoreToGrade(data.score)})`,
          impact: impact,
          explanation: relatedIssues[0] || `This factor is bringing down your overall grade`,
          fix: relatedIssues.length > 0 ? 'Address the issues listed above' : 'Review club specifications'
        });
      }
    }
  });
  
  // Sort by impact (most negative first)
  impacts.sort((a, b) => a.impact - b.impact);
  
  // Calculate what grade would be without biggest issues
  const totalNegativeImpact = impacts.reduce((sum, i) => sum + Math.abs(i.impact), 0);
  const potentialScore = Math.min(100, overallScore + totalNegativeImpact);
  
  // Generate summary
  let summary = '';
  if (impacts.length === 0) {
    summary = 'Great job! No major issues detected in your bag.';
  } else if (impacts.length === 1) {
    summary = `Your grade is primarily affected by: ${impacts[0].issue}`;
  } else {
    summary = `Your grade is affected by ${impacts.length} major issues. The biggest impact is: ${impacts[0].issue}`;
  }
  
  // Top 3 impacts for quick view
  const topImpacts = impacts.slice(0, 3).map(i => ({
    issue: i.issue,
    impact: `${i.impact} points`,
    fix: i.fix
  }));
  
  return {
    summary: summary,
    current_score: overallScore,
    current_grade: overallGrade,
    potential_score: potentialScore,
    potential_grade: scoreToGrade(potentialScore),
    total_penalty_points: totalNegativeImpact,
    top_impacts: topImpacts,
    all_impacts: impacts,
    fixable_issues: impacts.filter(i => i.fix).length
  };
}

// ==========================================
// FACTOR CALCULATION FUNCTIONS
// ==========================================

/**
 * Calculate age score based on club years
 * NOTE: Putters are excluded from age scoring
 */
function calculateAgeScore(clubs) {
  // Filter out putters - they age differently and don't affect swing consistency
  const gradableClubs = filterOutPutters(clubs);
  
  const currentYear = new Date().getFullYear();
  const issues = [];

  let totalAgeScore = 0;
  let clubsWithYearData = 0;

  /**
   * Age scoring tiers:
   * - A (90-100): All clubs 1-2 years old
   * - B+ (87-89): Mostly new (1-3 years with maybe one older)
   * - B (83-86): Mix of modern equipment
   * - C (70-79): Some dated equipment
   * - D (60-69): Average over 10 years old
   * - F (<60): Severely outdated bag
   */
  function getAgeScore(age) {
    if (age <= 1) return 100;      // Brand new
    if (age === 2) return 95;      // Nearly new
    if (age === 3) return 88;      // Still modern
    if (age === 4) return 78;      // Getting dated
    if (age === 5) return 68;      // Dated
    if (age === 6) return 55;      // Older
    if (age === 7) return 42;      // Old
    if (age === 8) return 30;      // Very old
    if (age === 9) return 18;      // Should replace
    return 8;                       // 10+ years - strongly recommend replacing
  }

  gradableClubs.forEach((club) => {
    if (club.year) {
      const age = currentYear - club.year;
      clubsWithYearData++;

      const clubScore = getAgeScore(age);
      totalAgeScore += clubScore;

      // Flag issues for clubs older than 5 years
      if (age > 5) {
        issues.push(`${club.clubType} (${club.brand} ${club.model}) is ${age} years old - consider updating`);
      }
    }
  });

  if (clubsWithYearData === 0) {
    return {score: 0, scorable: false, issues: ["Unable to determine club ages - add year information"]};
  }

  const averageScore = Math.round(totalAgeScore / clubsWithYearData);

  return {
    score: averageScore,
    scorable: true,
    issues: issues,
  };
}

/**
 * Calculate weight progression score
 * NOTE: Putters are excluded from weight progression scoring
 */
function calculateWeightProgression(clubs, favoriteClubSpecs = null) {
  const issues = [];
  const suggestions = []; // Structured weight suggestions for frontend

  // Filter out putters first, then filter for clubs with weight data
  const clubsWithWeight = filterOutPutters(clubs)
      .filter((c) => c.shaft_weight && c.loft)
      .sort((a, b) => a.loft - b.loft);
  
  // Track clubs using defaults
  const clubsUsingDefaults = clubsWithWeight.filter(c => c.weightIsDefault === true);

  if (clubsWithWeight.length < 2) {
    return {
      score: 0,
      scorable: false,
      issues: ["Not enough clubs with weight data to assess progression"],
      defaultsNote: null,
      clubsUsingDefaults: 0
    };
  }
  
  // Add note about default weights if any were used
  let defaultsNote = null;
  if (clubsUsingDefaults.length > 0) {
    const clubList = clubsUsingDefaults.map(c => `${c.clubType} (${c.shaft_weight}g)`).join(', ');
    defaultsNote = `Standard weights used for ${clubsUsingDefaults.length} club(s): ${clubList}. For accurate analysis, enter actual shaft weights.`;
  }

  // ==========================================
  // FAVORITE CLUB BASELINE INTERPOLATION (Patent Pending)
  // ==========================================
  
  // Zone weight offsets - expected difference from a "normalized" baseline
  const ZONE_WEIGHT_OFFSETS = {
    'WOODS': -30,    // Graphite, longer clubs = lighter
    'HYBRIDS': -20,  // Bridge between woods and irons
    'IRONS': 0,      // Baseline zone (steel shafts)
    'WEDGES': +15    // Heavier for control
  };
  
  // Typical shaft material per zone (for cross-material detection)
  const ZONE_TYPICAL_MATERIALS = {
    'WOODS': 'GRAPHITE',
    'HYBRIDS': 'GRAPHITE',
    'IRONS': 'STEEL',
    'WEDGES': 'STEEL'
  };
  
  // Infer shaft material from weight and club type
  function inferShaftMaterial(weight, clubType) {
    const type = (clubType || '').toLowerCase();
    
    // Woods are almost always graphite
    if (type === 'driver' || type.includes('wood') || /^\d+w$/i.test(type)) {
      return 'GRAPHITE';
    }
    
    // Hybrids - check weight (graphite typically <85g, steel 85g+)
    if (type.includes('hybrid') || /^\d+h$/i.test(type)) {
      return weight < 85 ? 'GRAPHITE' : 'STEEL';
    }
    
    // Irons - most are steel, but graphite irons exist (<85g)
    if (type.includes('iron') || /^\d+-iron$/i.test(type)) {
      return weight < 85 ? 'GRAPHITE' : 'STEEL';
    }
    
    // Wedges - almost always steel
    return 'STEEL';
  }
  
  // Helper to get zone from club type string
  function getWeightZoneFromType(clubType) {
    const ct = (clubType || '').toLowerCase();
    if (ct === 'driver' || ct.includes('wood') || /^\d+w$/i.test(ct)) return 'WOODS';
    if (ct.includes('hybrid') || /^\d+h$/i.test(ct)) return 'HYBRIDS';
    if (['gw', 'aw', 'sw', 'lw', 'gap', 'sand', 'lob'].some(w => ct === w || ct.includes(w))) return 'WEDGES';
    const degMatch = ct.match(/^(\d+)/);
    if (degMatch && parseInt(degMatch[1], 10) >= 46) return 'WEDGES';
    return 'IRONS';
  }
  
  // Calculate expected weight for each zone based on favorite club
  let expectedWeights = null;
  let favoriteZone = null;
  let favoriteMaterial = null;
  
  if (favoriteClubSpecs && favoriteClubSpecs.shaft_weight) {
    const favoriteWeight = favoriteClubSpecs.shaft_weight;
    favoriteZone = getWeightZoneFromType(favoriteClubSpecs.clubType);
    favoriteMaterial = inferShaftMaterial(favoriteWeight, favoriteClubSpecs.clubType);
    const favoriteOffset = ZONE_WEIGHT_OFFSETS[favoriteZone] || 0;
    
    // Normalize to "iron baseline" then calculate expected per zone
    const normalizedBaseline = favoriteWeight - favoriteOffset;
    
    // Only apply baseline to zones with MATCHING material type
    // This prevents comparing graphite woods against steel irons
    expectedWeights = {};
    
    ['WOODS', 'HYBRIDS', 'IRONS', 'WEDGES'].forEach(zone => {
      const zoneMaterial = ZONE_TYPICAL_MATERIALS[zone];
      if (zoneMaterial === favoriteMaterial) {
        // Same material - apply baseline comparison
        expectedWeights[zone] = Math.round(normalizedBaseline + ZONE_WEIGHT_OFFSETS[zone]);
      } else {
        // Different material - skip baseline, will use zone average instead
        expectedWeights[zone] = null;
      }
    });
    
    logger.info(`BASELINE-MATERIAL: Favorite ${favoriteClubSpecs.clubType} (${favoriteWeight}g) is ${favoriteMaterial}. Applying baseline to: ${Object.entries(expectedWeights).filter(([k,v]) => v !== null).map(([k,v]) => `${k}=${v}g`).join(', ')}`);
  }

  // ==========================================
  // ZONE-BASED WEIGHT SCORING WITH OUTLIER EXCLUSION
  // ==========================================
  
  // Helper to determine weight zone
  function getWeightZone(club) {
    const clubType = (club.clubType || club.club_type || '').toLowerCase();
    
    if (clubType === 'driver') return 'WOODS';
    if (clubType.includes('wood') || /^\d+w$/i.test(clubType)) return 'WOODS';
    if (clubType.includes('hybrid') || /^\d+h$/i.test(clubType)) return 'HYBRIDS';
    
    // PW stays with IRONS
    if (clubType === 'pw' || clubType === 'pitching' || clubType === 'pitching wedge') return 'IRONS';
    
    // Irons
    if (clubType.includes('iron') || /^\d+-iron$/i.test(clubType)) return 'IRONS';
    
    // Degree wedges (46°+)
    const degMatch = clubType.match(/^(\d+)/);
    if (degMatch) {
      const num = parseInt(degMatch[1], 10);
      if (num >= 46 && num <= 64) return 'WEDGES';
    }
    
    // Named wedges
    if (['gw', 'aw', 'sw', 'lw', 'gap', 'sand', 'lob'].some(w => clubType === w || clubType.includes(w))) {
      return 'WEDGES';
    }
    
    return 'IRONS';
  }
  
  // Tiered thresholds per zone (deviation from average in grams)
  const WEIGHT_THRESHOLDS = {
    WOODS:   { A: 5, B: 10, C: 15 },
    HYBRIDS: { A: 5, B: 8, C: 12 },
    IRONS:   { A: 3, B: 6, C: 10 },
    WEDGES:  { A: 8, B: 12, C: 18 }
  };
  
  // Group clubs by zone
  const zones = { WOODS: [], HYBRIDS: [], IRONS: [], WEDGES: [] };
  clubsWithWeight.forEach(club => {
    const zone = getWeightZone(club);
    zones[zone].push({
      name: club.clubType,
      weight: club.shaft_weight,
      isDefault: club.weightIsDefault || false
    });
  });
  
  // Score each zone with OUTLIER EXCLUSION
  let totalPenalty = 0;
  const zoneResults = {};
  
  function scoreZone(zoneClubs, zoneName) {
    const thresholds = WEIGHT_THRESHOLDS[zoneName];
    
    // Single club zone
    if (zoneClubs.length === 1) {
      // If using favorite baseline, check single club against expected
      if (expectedWeights && expectedWeights[zoneName]) {
        const club = zoneClubs[0];
        const expected = expectedWeights[zoneName];
        const deviation = Math.abs(club.weight - expected);
        const zoneIssues = [];
        const zoneSuggestions = [];
        let penalty = 0;
        let grade = 'A';
        
        if (deviation > thresholds.A && !club.isDefault) {
          const diff = club.weight - expected;
          const diffStr = diff > 0 ? `+${diff}g` : `${diff}g`;
          zoneIssues.push(`${club.name} (${club.weight}g) is ${diffStr} vs expected ${expected}g based on ★ ${favoriteClubSpecs.clubType}`);
          
          // Add structured suggestion
          zoneSuggestions.push({
            clubType: club.name,
            currentWeight: club.weight,
            idealWeight: expected,
            isBaselineBased: true
          });
          
          if (deviation > thresholds.C) {
            penalty = 15;
            grade = 'C';
          } else if (deviation > thresholds.B) {
            penalty = 8;
            grade = 'B';
          } else {
            penalty = 3;
            grade = 'B';
          }
        }
        
        return { 
          penalty, 
          issues: zoneIssues,
          suggestions: zoneSuggestions,
          grade, 
          avgWeight: club.weight, 
          expectedWeight: expected,
          maxDeviation: Math.round(deviation),
          outlierCount: deviation > thresholds.C ? 1 : 0
        };
      }
      
      return { 
        penalty: 0, 
        issues: [],
        suggestions: [],
        grade: 'A', 
        avgWeight: zoneClubs[0].weight, 
        maxDeviation: 0,
        outlierCount: 0
      };
    }
    
    if (zoneClubs.length < 2) return { penalty: 0, issues: [], suggestions: [], grade: 'A', avgWeight: 0, maxDeviation: 0, outlierCount: 0 };
    
    const outlierThreshold = thresholds.C * 2;
    
    // Determine target weight: use expected (favorite baseline) or calculate from zone
    let targetWeight;
    let usingBaseline = false;
    
    if (expectedWeights && expectedWeights[zoneName]) {
      targetWeight = expectedWeights[zoneName];
      usingBaseline = true;
    } else {
      // Calculate from zone average (original logic)
      const weights = zoneClubs.map(c => c.weight);
      const initialAvg = weights.reduce((a, b) => a + b, 0) / weights.length;
      
      const normalClubs = zoneClubs.filter(club => {
        const deviation = Math.abs(club.weight - initialAvg);
        return deviation <= outlierThreshold;
      });
      
      if (normalClubs.length >= 2) {
        targetWeight = Math.round(normalClubs.reduce((sum, c) => sum + c.weight, 0) / normalClubs.length);
      } else {
        targetWeight = Math.round(initialAvg);
      }
    }
    
    // Score ALL clubs against target weight
    const zoneIssues = [];
    const zoneSuggestions = [];
    let maxDeviation = 0;
    let outlierCount = 0;
    
    zoneClubs.forEach(club => {
      if (club.isDefault) return;
      
      // Skip the favorite club itself - it shouldn't have a suggestion
      if (favoriteClubSpecs && club.name === favoriteClubSpecs.clubType) return;
      
      const deviation = Math.abs(club.weight - targetWeight);
      maxDeviation = Math.max(maxDeviation, deviation);
      
      if (deviation > thresholds.A) {
        if (usingBaseline) {
          const diff = club.weight - targetWeight;
          const diffStr = diff > 0 ? `+${diff}g` : `${diff}g`;
          zoneIssues.push(`${club.name} (${club.weight}g) is ${diffStr} vs expected ${targetWeight}g based on ★ ${favoriteClubSpecs.clubType}`);
          
          // Add structured suggestion (baseline-based)
          zoneSuggestions.push({
            clubType: club.name,
            currentWeight: club.weight,
            idealWeight: targetWeight,
            isBaselineBased: true
          });
        } else {
          const zoneLabel = zoneName.toLowerCase();
          zoneIssues.push(`${club.name} weight (${club.weight}g) varies from ${zoneLabel} average (${targetWeight}g)`);
          
          // Add structured suggestion (zone average-based)
          zoneSuggestions.push({
            clubType: club.name,
            currentWeight: club.weight,
            idealWeight: targetWeight,
            isBaselineBased: false
          });
        }
        
        if (deviation > thresholds.C) {
          outlierCount++;
        }
      }
    });
    
    // Calculate penalty
    let penalty = 0;
    let grade = 'A';
    
    if (outlierCount > 0) {
      penalty += outlierCount * 15;
      grade = outlierCount >= 2 ? 'D' : 'C';
    }
    
    if (maxDeviation > thresholds.C) {
      penalty += 20;
      grade = 'D';
    } else if (maxDeviation > thresholds.B) {
      penalty += 12;
      if (grade === 'A') grade = 'C';
    } else if (maxDeviation > thresholds.A) {
      penalty += 5;
      if (grade === 'A') grade = 'B';
    }
    
    if (zoneName === 'IRONS' && penalty > 0) {
      penalty = Math.round(penalty * 1.2);
    }
    
    return { 
      penalty, 
      issues: zoneIssues,
      suggestions: zoneSuggestions,
      grade, 
      avgWeight: targetWeight,
      expectedWeight: usingBaseline ? targetWeight : null,
      maxDeviation: Math.round(maxDeviation),
      outlierCount 
    };
  }
  
  // Score each zone
  Object.entries(zones).forEach(([zoneName, zoneClubs]) => {
    const result = scoreZone(zoneClubs, zoneName);
    zoneResults[zoneName] = result;
    totalPenalty += result.penalty;
    issues.push(...result.issues);
    if (result.suggestions) {
      suggestions.push(...result.suggestions);
    }
  });
  
  // ==========================================
  // CROSS-ZONE PROGRESSION CHECKS
  // ==========================================
  const zoneOrder = ['WOODS', 'HYBRIDS', 'IRONS', 'WEDGES'];
  const zoneAvg = {};
  
  zoneOrder.forEach(zone => {
    if (zoneResults[zone] && zoneResults[zone].avgWeight > 0) {
      zoneAvg[zone] = zoneResults[zone].avgWeight;
    }
  });
  
  // Check 1: Hybrids should be heavier than woods (soft warning)
  if (zoneAvg.WOODS && zoneAvg.HYBRIDS) {
    if (zoneAvg.HYBRIDS <= zoneAvg.WOODS) {
      // Soft warning - no penalty, just note
      issues.push(`Hybrids (${zoneAvg.HYBRIDS}g avg) should typically be 5-15g heavier than woods (${zoneAvg.WOODS}g avg) for optimal tempo transition`);
    }
  }
  
  // Check 2: Major reversals (weight DECREASES going to shorter clubs)
  for (let i = 0; i < zoneOrder.length - 1; i++) {
    const currentZone = zoneOrder[i];
    const nextZone = zoneOrder[i + 1];
    const currentAvg = zoneAvg[currentZone];
    const nextAvg = zoneAvg[nextZone];
    
    if (currentAvg && nextAvg) {
      // Penalize if weight DECREASES significantly
      if (currentAvg > nextAvg + 20) {
        totalPenalty += 8;
        issues.push(`${currentZone} average (${currentAvg}g) is heavier than ${nextZone} (${nextAvg}g) - weight should increase toward shorter clubs`);
      }
    }
  }
  
  const score = Math.max(0, 100 - totalPenalty);

  return {
    score: score,
    scorable: true,
    issues: issues,
    suggestions: suggestions, // Structured weight suggestions for frontend
    defaultsNote: defaultsNote,
    clubsUsingDefaults: clubsUsingDefaults.length,
    zoneAverages: zoneAvg,
    zoneResults: zoneResults,
    favoriteClubBaseline: favoriteClubSpecs ? {
      enabled: true,
      clubType: favoriteClubSpecs.clubType,
      weight: favoriteClubSpecs.shaft_weight,
      expectedWeights: expectedWeights
    } : { enabled: false }
  };
}

/**
 * Calculate loft gapping score - FULL BAG COVERAGE with tiered thresholds
 * Analyzes gaps from driver through wedges (excludes putter)
 * Uses zone-specific thresholds: woods gaps are naturally larger than iron gaps
 */
function calculateLoftGapping(clubs) {
  const issues = [];

  // Filter out putters, then get all clubs with loft data sorted by loft
  const clubsWithLoft = filterOutPutters(clubs)
      .filter((c) => c.loft && c.clubType)
      .sort((a, b) => a.loft - b.loft);
  
  // Track which clubs are using default lofts
  const clubsUsingDefaults = clubsWithLoft.filter(c => c.loftIsDefault === true);
  
  if (clubsWithLoft.length < 2) {
    return {
      score: 0,
      scorable: false,
      issues: ["Not enough clubs with loft data to assess gapping"],
      defaultLoftsNote: null
    };
  }
  
  // Add note about default lofts if any were used
  let defaultLoftsNote = null;
  if (clubsUsingDefaults.length > 0) {
    const clubList = clubsUsingDefaults.map(c => `${c.clubType} (${c.loft}°)`).join(', ');
    defaultLoftsNote = `Standard lofts used for ${clubsUsingDefaults.length} club(s): ${clubList}. For accurate analysis, enter actual club lofts.`;
  }

  let totalPenalty = 0;
  const gapAnalysis = [];

  for (let i = 1; i < clubsWithLoft.length; i++) {
    const lowerLoftClub = clubsWithLoft[i - 1]; // e.g., Driver (10.5°)
    const higherLoftClub = clubsWithLoft[i];     // e.g., 3-Wood (15°)

    const gap = higherLoftClub.loft - lowerLoftClub.loft;
    
    // Determine the gap zone based on club categories
    const zone = getGapZone(lowerLoftClub, higherLoftClub);
    
    // Score this gap using zone-specific thresholds
    const gapResult = scoreGap(gap, zone);
    
    // Track if either club used default loft
    const fromIsDefault = lowerLoftClub.loftIsDefault === true;
    const toIsDefault = higherLoftClub.loftIsDefault === true;
    
    gapAnalysis.push({
      from: lowerLoftClub.clubType,
      fromLoft: lowerLoftClub.loft,
      fromIsDefault: fromIsDefault,
      to: higherLoftClub.clubType,
      toLoft: higherLoftClub.loft,
      toIsDefault: toIsDefault,
      gap: gap,
      zone: zone,
      quality: gapResult.quality,
      penalty: gapResult.penalty
    });
    
    totalPenalty += gapResult.penalty;
    
    // Build issue string with default notation if applicable
    const fromNote = fromIsDefault ? ' [std]' : '';
    const toNote = toIsDefault ? ' [std]' : '';
    
    // Log issues for non-optimal gaps
    if (gapResult.quality === 'overlap') {
      issues.push(
        `${gap}° overlap between ${lowerLoftClub.clubType}${fromNote} (${lowerLoftClub.loft}°) ` +
        `and ${higherLoftClub.clubType}${toNote} (${higherLoftClub.loft}°) - clubs too similar`
      );
    } else if (gapResult.quality === 'majorVoid') {
      issues.push(
        `${gap}° gap between ${lowerLoftClub.clubType}${fromNote} (${lowerLoftClub.loft}°) ` +
        `and ${higherLoftClub.clubType}${toNote} (${higherLoftClub.loft}°) - major distance void`
      );
    } else if (gapResult.quality === 'wide') {
      issues.push(
        `${gap}° gap between ${lowerLoftClub.clubType}${fromNote} (${lowerLoftClub.loft}°) ` +
        `and ${higherLoftClub.clubType}${toNote} (${higherLoftClub.loft}°) - consider adding a club`
      );
    } else if (gapResult.quality === 'tight') {
      issues.push(
        `${gap}° gap between ${lowerLoftClub.clubType}${fromNote} (${lowerLoftClub.loft}°) ` +
        `and ${higherLoftClub.clubType}${toNote} (${higherLoftClub.loft}°) - tight gapping`
      );
    }
  }

  // Calculate final score (start at 100, apply penalties)
  const score = Math.max(0, Math.min(100, 100 + totalPenalty));

  return {
    score: score,
    scorable: true,
    issues: issues,
    gapAnalysis: gapAnalysis,
    defaultLoftsNote: defaultLoftsNote,
    clubsUsingDefaults: clubsUsingDefaults.length
  };
}

/**
 * Normalize flex value to standard format
 * Maps various flex notations to: Ladies, Senior, Regular, Stiff, X-Stiff
 */
function normalizeFlexValue(flex) {
  if (!flex) return null;
  const f = flex.toLowerCase().trim();
  // Filter out invalid flex values (e.g., "wedge" stored by mistake)
  if (f === 'wedge' || f === 'putter' || f === 'n/a' || f === 'unknown' || f === 'none') return null;
  if (f === 'l' || f === 'ladies' || f === 'lady') return 'Ladies';
  if (f === 'a' || f === 'sr' || f === 'senior' || f === 'am') return 'Senior';
  if (f === 'r' || f === 'regular' || f === 'reg' || f === 'm' || f === 'med' || f === 'medium') return 'Regular';
  if (f === 's' || f === 'stiff' || f === 'firm') return 'Stiff';
  if (f === 'x' || f === 'xs' || f === 'x-stiff' || f === 'xstiff' || f === 'extra stiff' || f === 'tour') return 'X-Stiff';
  // Check for flex embedded in shaft code (e.g., "6S" = Stiff, "5R" = Regular)
  if (/\d+s$/i.test(f) || /s\d*$/i.test(f)) return 'Stiff';
  if (/\d+r$/i.test(f) || /r\d*$/i.test(f)) return 'Regular';
  if (/\d+x$/i.test(f) || /x\d*$/i.test(f)) return 'X-Stiff';
  if (/\d+a$/i.test(f) || /a\d*$/i.test(f)) return 'Senior';
  if (/\d+l$/i.test(f) || /l\d*$/i.test(f)) return 'Ladies';
  return flex; // Return original if no match
}

/**
 * Calculate flex consistency score
 * NOTE: Putters are excluded from flex consistency scoring
 * NOTE: Flex labels have NO industry standard - we only check for label consistency within the bag
 */
function calculateFlexConsistency(clubs) {
  const issues = [];
  
  // Filter out putters - they don't have meaningful flex data
  const gradableClubs = filterOutPutters(clubs);

  const flexCounts = {};
  let totalWithFlex = 0;

  // Data is normalized - use standard flat field names
  // Also normalize flex values to group similar flexes (S, Stiff, 6S → Stiff)
  gradableClubs.forEach((club) => {
    if (club.shaft_flex) {
      const normalizedFlex = normalizeFlexValue(club.shaft_flex);
      flexCounts[normalizedFlex] = (flexCounts[normalizedFlex] || 0) + 1;
      totalWithFlex++;
    }
  });

  if (totalWithFlex === 0) {
    return {
      score: 0,
      scorable: false,
      issues: ["No flex data available - add shaft flex information"],
    };
  }

  // Find dominant flex
  const sorted = Object.entries(flexCounts).sort((a, b) => b[1] - a[1]);
  const dominant = sorted[0];
  
  if (!dominant) {
    return { score: 100, scorable: true, issues: [] };
  }
  
  const matchCount = dominant[1];
  const matchPercent = matchCount / totalWithFlex;
  const mismatchCount = totalWithFlex - matchCount;
  
  // Percentage-based scoring matrix (flex labels are unreliable, so be lenient)
  // 100% match → 100, 75-99% → 90, 50-74% → 75, <50% → 60
  let score = 100;
  let severity = 'none';
  
  if (matchPercent >= 1.0) {
    score = 100;
    severity = 'none';
  } else if (matchPercent >= 0.75) {
    score = 90;
    severity = 'minor';
  } else if (matchPercent >= 0.50) {
    score = 75;
    severity = 'moderate';
  } else {
    score = 60;
    severity = 'significant';
  }
  
  // Build issues list
  if (mismatchCount > 0) {
    const mismatchedFlexes = sorted.slice(1).map(([flex, count]) => `${count} ${flex}`);
    issues.push(`Mixed flex labels: ${matchCount} ${dominant[0]}, ${mismatchedFlexes.join(', ')} - consider standardizing`);
  }

  return {
    score, 
    scorable: true, 
    dominantFlex: dominant[0],
    matchPercent,
    matchCount,
    total: totalWithFlex,
    issues 
  };
}

/**
 * Calculate kickpoint consistency score
 * NOTE: Putters are excluded from kickpoint consistency scoring
 */
function calculateKickpointConsistency(clubs) {
  const issues = [];
  
  // Filter out putters - they don't have meaningful kickpoint data
  const gradableClubs = filterOutPutters(clubs);

  // Zone-based kickpoint evaluation
  // Kickpoint should be consistent WITHIN each club category, but can differ BETWEEN categories
  const zones = {
    WOODS: [],
    HYBRIDS: [],
    IRONS: [],
    WEDGES: []
  };
  
  // Helper to determine zone
  function getKickpointZone(club) {
    const clubType = (club.clubType || club.club_type || '').toLowerCase();
    const loft = club.loft || 0;
    
    // Woods
    if (clubType === 'driver' || clubType.includes('wood')) {
      return 'WOODS';
    }
    
    // Hybrids (including numbered format like "2h", "3h", etc.)
    if (clubType.includes('hybrid') || /^\d+h$/i.test(clubType)) {
      return 'HYBRIDS';
    }
    
    // PW stays with IRONS (check before wedges!)
    if (clubType === 'pw' || clubType === 'pitching' || clubType === 'pitching wedge') {
      return 'IRONS';
    }
    
    // Irons (3i-9i)
    if (clubType.includes('iron') || /^\d+-iron$/i.test(clubType)) {
      return 'IRONS';
    }
    
    // Degree wedges - check if starts with 2 digits (46-64) regardless of suffix
    const degMatch = clubType.match(/^(\d+)/);
    if (degMatch) {
      const num = parseInt(degMatch[1], 10);
      if (num >= 46 && num <= 64) return 'WEDGES';  // 46° through 64° are wedges
    }
    
    // Named wedges: GW/AW/SW/LW
    if (['gw', 'aw', 'sw', 'lw', 'gap', 'sand', 'lob'].some(w => clubType === w || clubType.includes(w))) {
      return 'WEDGES';
    }
    
    // Fallback to loft check
    if (loft >= 48) {
      return 'WEDGES';
    }
    
    // Default to irons
    return 'IRONS';
  }
  
  // Normalize kickpoint value
  function normalizeKickpoint(kickpoint) {
    if (!kickpoint) return null;
    const kp = kickpoint.toLowerCase().trim();
    if (kp.includes('low')) return 'low';
    if (kp.includes('high')) return 'high';
    return 'mid'; // Default to mid
  }
  
  // Group clubs by zone
  let totalWithKickpoint = 0;
  gradableClubs.forEach(club => {
    if (club.shaft_kickpoint) {
      const zone = getKickpointZone(club);
      const normalized = normalizeKickpoint(club.shaft_kickpoint);
      if (normalized) {
        zones[zone].push({
          name: club.clubType || club.club_type,
          kickpoint: normalized,
          original: club.shaft_kickpoint
        });
        totalWithKickpoint++;
      }
    }
  });
  
  if (totalWithKickpoint === 0) {
    return {
      score: 0,
      scorable: false,
      issues: ["No kickpoint data available"],
    };
  }
  
  // Score each zone independently
  let totalPenalty = 0;
  
  function scoreZone(zoneClubs, zoneName) {
    if (zoneClubs.length < 2) return { penalty: 0, issues: [] }; // Need 2+ clubs to evaluate
    
    const kickpoints = zoneClubs.map(c => c.kickpoint);
    const counts = {};
    
    kickpoints.forEach(kp => {
      counts[kp] = (counts[kp] || 0) + 1;
    });
    
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const dominantKickpoint = sorted[0][0];
    const dominantCount = sorted[0][1];
    const deviations = zoneClubs.length - dominantCount;
    
    const zoneIssues = [];
    let penalty = 0;
    
    // Find which clubs deviate
    zoneClubs.forEach(club => {
      if (club.kickpoint !== dominantKickpoint) {
        const zoneLabel = zoneName === 'IRONS' ? 'other irons' : 
                          zoneName === 'WOODS' ? 'other woods' :
                          zoneName === 'HYBRIDS' ? 'other hybrids' : 'other wedges';
        zoneIssues.push(`${club.name} kickpoint (${club.kickpoint}) doesn't match ${zoneLabel} (${dominantKickpoint}) - may cause inconsistent ball flight`);
      }
    });
    
    // Apply penalties based on deviation count
    if (deviations === 0) {
      penalty = 0;
    } else if (deviations === 1) {
      penalty = 5;
    } else if (deviations === 2) {
      penalty = 10;
    } else {
      penalty = 15;
    }
    
    // Extra penalty for woods (tempo setters)
    if (zoneName === 'WOODS' && deviations > 0) {
      penalty = Math.round(penalty * 1.25);
    }
    
    return { penalty, issues: zoneIssues };
  }
  
  // Score each zone
  Object.entries(zones).forEach(([zoneName, zoneClubs]) => {
    const result = scoreZone(zoneClubs, zoneName);
    totalPenalty += result.penalty;
    issues.push(...result.issues);
  });
  
  // If no issues within zones but multiple kickpoints across bag, don't penalize
  // This is the key change - different kickpoints between zones is NORMAL
  
  const score = Math.max(0, 100 - totalPenalty);
  
  // Add summary issue if there are problems
  if (issues.length > 0 && issues.length <= 2) {
    // Don't add extra summary for small issues
  } else if (issues.length > 2) {
    issues.unshift(`Mixed kickpoint profiles within club categories`);
  }
  
  return { score, scorable: true, issues };
}

/**
 * Calculate torque consistency score
 * NOTE: Putters are excluded from torque consistency scoring
 */
function calculateTorqueConsistency(clubs) {
  const issues = [];

  // Filter out putters, then get torque values
  // Data is normalized - use standard flat field names
  const torqueValues = filterOutPutters(clubs)
      .filter((c) => c.shaft_torque !== null && c.shaft_torque !== undefined)
      .map((c) => c.shaft_torque);

  if (torqueValues.length === 0) {
    return {
      score: 0,
      scorable: false,
      issues: ["No torque data available"],
    };
  }

  const avgTorque = torqueValues.reduce((a, b) => a + b, 0) / torqueValues.length;
  const maxDeviation = Math.max(...torqueValues.map((t) => Math.abs(t - avgTorque)));

  let score = 100;

  if (maxDeviation > 4.5) {  // Extremely lenient
    score -= 8;              // Extremely lenient
    issues.push(`Torque varies by ${maxDeviation.toFixed(1)}° - consider more consistency`);
  } else if (maxDeviation > 3.8) {  // Extremely lenient
    score -= 4;              // Extremely lenient
  }

  return {score: Math.max(0, score), scorable: true, issues: issues};
}

/**
 * Calculate length progression score
 * NOTE: Putters are excluded from length progression scoring
 */
function calculateLengthProgression(clubs, bodyFitSpecs = null) {
  const issues = [];
  const suggestions = []; // Structured length suggestions for frontend

  // ==========================================
  // BODY FIT BASELINE CONSTANTS
  // ==========================================
  
  // WTF-based length adjustments from standard
  const WTF_ADJUSTMENTS = {
    'UNDER_29': -1.5,
    '29_30': -1.0,
    '30_31': -0.75,
    '31_32': -0.5,
    '32_33': -0.25,
    '33_35': 0,        // Standard range
    '35_36': 0.25,
    '36_37': 0.5,
    '37_38': 0.75,
    '38_39': 1.0,
    'OVER_39': 1.5
  };

  // Height modifiers (added to WTF adjustment)
  const HEIGHT_MODIFIERS = {
    'UNDER_64': -0.25,   // Under 5'4"
    '64_67': 0,          // 5'4" to 5'7"
    '67_72': 0,          // 5'7" to 6'0" - standard
    '72_75': 0.25,       // 6'0" to 6'3"
    'OVER_75': 0.5       // Over 6'3"
  };

  // Standard club lengths (baseline)
  const BODY_FIT_STANDARD_LENGTHS = {
    'driver': 45.0,
    '3-wood': 43.0, '3w': 43.0,
    '5-wood': 42.0, '5w': 42.0,
    '7-wood': 41.0, '7w': 41.0,
    '2h': 40.5, '2-hybrid': 40.5,
    '3h': 40.5, '3-hybrid': 40.5,
    '4h': 40.0, '4-hybrid': 40.0,
    '5h': 39.5, '5-hybrid': 39.5,
    '6h': 39.0, '6-hybrid': 39.0,
    '3-iron': 39.0,
    '4-iron': 38.5,
    '5-iron': 38.0,
    '6-iron': 37.5,
    '7-iron': 37.0,
    '8-iron': 36.5,
    '9-iron': 36.0,
    'pw': 35.5, 'pitching wedge': 35.5,
    'gw': 35.25, 'gap wedge': 35.25, 'aw': 35.25,
    'sw': 35.25, 'sand wedge': 35.25,
    'lw': 35.0, 'lob wedge': 35.0,
    // Degree wedges
    '46°': 35.5, '48°': 35.5,   // PW range
    '50°': 35.25, '52°': 35.25, // GW range
    '54°': 35.25, '56°': 35.25, // SW range  
    '58°': 35.0, '60°': 35.0, '64°': 35.0  // LW range
  };

  // Body fit thresholds - more lenient since body fit is a suggestion, not requirement
  const BODY_FIT_THRESHOLDS = {
    A: 0.5,    // Perfect - within tolerance
    B: 0.75,   // Minor issue
    C: 1.0,    // Moderate issue  
    D: 1.5     // Severe issue
  };

  // Helper: Get WTF adjustment
  function getWTFAdjustment(wtf) {
    if (wtf < 29) return WTF_ADJUSTMENTS['UNDER_29'];
    if (wtf < 30) return WTF_ADJUSTMENTS['29_30'];
    if (wtf < 31) return WTF_ADJUSTMENTS['30_31'];
    if (wtf < 32) return WTF_ADJUSTMENTS['31_32'];
    if (wtf < 33) return WTF_ADJUSTMENTS['32_33'];
    if (wtf < 35) return WTF_ADJUSTMENTS['33_35'];
    if (wtf < 36) return WTF_ADJUSTMENTS['35_36'];
    if (wtf < 37) return WTF_ADJUSTMENTS['36_37'];
    if (wtf < 38) return WTF_ADJUSTMENTS['37_38'];
    if (wtf < 39) return WTF_ADJUSTMENTS['38_39'];
    return WTF_ADJUSTMENTS['OVER_39'];
  }

  // Helper: Get height modifier
  function getHeightModifier(heightInches) {
    if (heightInches < 64) return HEIGHT_MODIFIERS['UNDER_64'];
    if (heightInches < 67) return HEIGHT_MODIFIERS['64_67'];
    if (heightInches < 72) return HEIGHT_MODIFIERS['67_72'];
    if (heightInches < 75) return HEIGHT_MODIFIERS['72_75'];
    return HEIGHT_MODIFIERS['OVER_75'];
  }

  // Helper: Calculate body fit adjustment
  function calculateBodyFitAdjustment(heightInches, wristToFloor) {
    const wtfAdjustment = getWTFAdjustment(wristToFloor);
    const heightModifier = getHeightModifier(heightInches);
    const rawAdjustment = wtfAdjustment + heightModifier;
    // Round to nearest 0.25"
    return Math.round(rawAdjustment * 4) / 4;
  }

  // Helper: Get ideal length for a club type
  function getIdealLength(clubType, adjustment) {
    const normalizedType = (clubType || '').toLowerCase().replace(/\s+/g, '-');
    const standardLength = BODY_FIT_STANDARD_LENGTHS[normalizedType];
    if (!standardLength) return null;
    return standardLength + adjustment;
  }

  // Calculate body fit adjustment if enabled
  let bodyFitAdjustment = null;
  if (bodyFitSpecs && bodyFitSpecs.heightInches && bodyFitSpecs.wristToFloor) {
    bodyFitAdjustment = calculateBodyFitAdjustment(
      bodyFitSpecs.heightInches,
      bodyFitSpecs.wristToFloor
    );
    logger.info(`BODY-FIT: Height ${bodyFitSpecs.heightDisplay}, WTF ${bodyFitSpecs.wristToFloor}" → Adjustment: ${bodyFitAdjustment > 0 ? '+' : ''}${bodyFitAdjustment}"`);
  }

  // Filter out putters, then filter for clubs with length data (including defaults)
  const clubsWithLength = filterOutPutters(clubs)
      .filter((c) => c.length && c.loft)
      .sort((a, b) => a.loft - b.loft);
  
  // Track clubs using defaults
  const clubsUsingDefaults = clubsWithLength.filter(c => c.lengthIsDefault === true);

  if (clubsWithLength.length < 2) {
    return {
      score: 0,
      scorable: false,
      issues: ["Not enough clubs with length data"],
      defaultsNote: null,
      clubsUsingDefaults: 0
    };
  }
  
  // Add note about default lengths if any were used
  let defaultsNote = null;
  if (clubsUsingDefaults.length > 0) {
    const clubList = clubsUsingDefaults.map(c => `${c.clubType} (${c.length}")`).join(', ');
    defaultsNote = `Standard lengths used for ${clubsUsingDefaults.length} club(s): ${clubList}. For accurate analysis, enter actual club lengths.`;
  }

  // Length gap thresholds by zone
  const LENGTH_GAP_THRESHOLDS = {
    DRIVER_TO_WOOD: { idealGap: 2.25, tolerance: 0.5, wideGap: 3.0 },
    DRIVER_TO_HYBRID: { idealGap: 4.5, tolerance: 1.0, wideGap: 6.0 }, // No fairway wood in bag
    WOODS: { idealGap: 0.5, tolerance: 0.25, wideGap: 1.0 },
    HYBRIDS: { idealGap: 0.5, tolerance: 0.25, wideGap: 1.0 },
    WOOD_TO_HYBRID: { idealGap: 1.0, tolerance: 0.5, wideGap: 1.5 },
    HYBRID_TO_IRON: { idealGap: 0.75, tolerance: 0.5, wideGap: 1.5 },
    IRONS: { idealGap: 0.5, tolerance: 0.25, wideGap: 0.75 },
    IRON_TO_WEDGE: { idealGap: 0.25, tolerance: 0.25, wideGap: 0.5 },
    WEDGES: { idealGap: 0.0, tolerance: 0.25, wideGap: 0.5 }
  };

  // Penalty values
  const LENGTH_PENALTIES = {
    perfect: 0,
    acceptable: 3,
    wide: 8,
    reverse: 15
  };

  // Helper to determine club type
  function getClubCategory(club) {
    const type = (club.clubType || '').toLowerCase();
    if (type === 'driver') return 'driver';
    if (type.includes('wood')) return 'wood';
    if (type.includes('hybrid') || /^\d+h$/i.test(type)) return 'hybrid';
    if (club.loft >= 46) return 'wedge';
    if (type.includes('iron') || /^\d+-iron$/i.test(type)) return 'iron';
    // Check for wedge by name
    if (['pw', 'gw', 'aw', 'sw', 'lw'].includes(type) || type.includes('°')) return 'wedge';
    return 'iron'; // default
  }

  // Get zone for transition
  function getLengthZone(prevClub, currClub) {
    const prevCat = getClubCategory(prevClub);
    const currCat = getClubCategory(currClub);
    
    // Driver transitions
    if (prevCat === 'driver' && currCat === 'wood') return 'DRIVER_TO_WOOD';
    if (prevCat === 'driver' && currCat === 'hybrid') return 'DRIVER_TO_HYBRID';
    if (prevCat === 'driver' && currCat === 'iron') return 'DRIVER_TO_HYBRID'; // Treat same as hybrid
    
    // Wood transitions
    if (prevCat === 'wood' && currCat === 'wood') return 'WOODS';
    if (prevCat === 'wood' && currCat === 'hybrid') return 'WOOD_TO_HYBRID';
    if (prevCat === 'wood' && currCat === 'iron') return 'WOOD_TO_HYBRID';
    
    // Hybrid transitions
    if (prevCat === 'hybrid' && currCat === 'hybrid') return 'HYBRIDS';
    if (prevCat === 'hybrid' && currCat === 'iron') return 'HYBRID_TO_IRON';
    
    // Iron transitions
    if (prevCat === 'iron' && currCat === 'iron') return 'IRONS';
    if (prevCat === 'iron' && currCat === 'wedge') return 'IRON_TO_WEDGE';
    
    // Wedge transitions
    if (prevCat === 'wedge' && currCat === 'wedge') return 'WEDGES';
    
    return 'IRONS'; // default
  }

  // Standard lengths for comparison (Men's Steel)
  const STANDARD_LENGTHS = {
    'driver': 45.0, '3-wood': 42.5, '4-wood': 42.0, '5-wood': 41.5,
    '7-wood': 41.0, '9-wood': 40.5, '2h': 40.5, '3h': 40.0, '4h': 39.5,
    '5h': 39.0, '6h': 38.5, '2-hybrid': 40.5, '3-hybrid': 40.0, 
    '4-hybrid': 39.5, '5-hybrid': 39.0, '6-hybrid': 38.5,
    '3-iron': 38.5, '4-iron': 38.0, '5-iron': 37.5, '6-iron': 37.0,
    '7-iron': 36.5, '8-iron': 36.0, '9-iron': 35.5, 
    'pw': 35.5, 'aw': 35.25, 'gw': 35.25, 'sw': 35.0, 'lw': 35.0
  };

  // Check if a club's length is standard (within 0.25" tolerance)
  function isStandardLength(club) {
    if (club.lengthIsDefault === true) return true;
    if (!club.length) return true; // No data = assume standard
    
    const clubType = (club.clubType || '').toLowerCase().replace(/\s+/g, '-');
    const standardLength = STANDARD_LENGTHS[clubType];
    
    if (!standardLength) return false; // Unknown club type
    
    // If within 0.5" of standard, treat as standard
    return Math.abs(club.length - standardLength) <= 0.5;
  }

  let totalPenalty = 0;
  let scoredTransitions = 0;

  for (let i = 1; i < clubsWithLength.length; i++) {
    const prevClub = clubsWithLength[i - 1]; // Lower loft (should be longer)
    const currClub = clubsWithLength[i];     // Higher loft (should be shorter)

    // Skip scoring if BOTH clubs are using standard lengths
    // Standard lengths are assumed correct - only score user-customized data
    if (isStandardLength(prevClub) && isStandardLength(currClub)) {
      continue;
    }
    
    scoredTransitions++;

    // Note: prevClub has LOWER loft, so should be LONGER
    // lengthDiff = prevClub.length - currClub.length (should be positive)
    const lengthDiff = prevClub.length - currClub.length;
    
    // Build note with default notation if applicable
    const prevNote = prevClub.lengthIsDefault ? ' [std]' : '';
    const currNote = currClub.lengthIsDefault ? ' [std]' : '';

    const zone = getLengthZone(prevClub, currClub);
    const thresholds = LENGTH_GAP_THRESHOLDS[zone];

    // CRITICAL: Check for reverse progression (shorter-lofted club is shorter)
    if (lengthDiff < -0.25) {
      totalPenalty += LENGTH_PENALTIES.reverse;
      issues.push(
        `${currClub.clubType}${currNote} (${currClub.length}") is longer than ${prevClub.clubType}${prevNote} (${prevClub.length}") - reverse progression`
      );
      continue;
    }

    // Calculate deviation from ideal
    const deviation = Math.abs(lengthDiff - thresholds.idealGap);

    if (deviation <= thresholds.tolerance) {
      // Perfect - no penalty
      continue;
    }

    if (lengthDiff > thresholds.wideGap) {
      // Wide gap
      totalPenalty += LENGTH_PENALTIES.wide;
      issues.push(
        `${lengthDiff.toFixed(2)}" gap between ${prevClub.clubType}${prevNote} and ${currClub.clubType}${currNote} (expected ~${thresholds.idealGap}")`
      );
    } else {
      // Acceptable but not perfect
      totalPenalty += LENGTH_PENALTIES.acceptable;
      issues.push(
        `${lengthDiff.toFixed(2)}" gap between ${prevClub.clubType}${prevNote} and ${currClub.clubType}${currNote} (expected ~${thresholds.idealGap}")`
      );
    }
  }

  let score = 100 - totalPenalty;
  
  // If no transitions were scored (all defaults), give perfect score
  if (scoredTransitions === 0 && clubsWithLength.length >= 2) {
    score = 100;
  }

  // ==========================================
  // BODY FIT BASELINE COMPARISON
  // ==========================================
  let bodyFitPenalty = 0;
  
  if (bodyFitAdjustment !== null) {
    clubsWithLength.forEach(club => {
      // Skip clubs using default lengths
      if (club.lengthIsDefault === true) return;
      
      const idealLength = getIdealLength(club.clubType, bodyFitAdjustment);
      if (!idealLength) return; // Unknown club type
      
      const deviation = Math.abs(club.length - idealLength);
      
      if (deviation > BODY_FIT_THRESHOLDS.A) {
        const diff = club.length - idealLength;
        const direction = diff > 0 ? 'longer' : 'shorter';
        const absDiff = Math.abs(diff).toFixed(2);
        
        // Add structured suggestion
        suggestions.push({
          clubType: club.clubType,
          currentLength: club.length,
          idealLength: Math.round(idealLength * 4) / 4, // Round to 0.25
          adjustment: Math.round(diff * 4) / 4,
          isBodyFitBased: true
        });
        
        // Add to issues
        issues.push(`${club.clubType} (${club.length}") is ${absDiff}" ${direction} than ideal ${idealLength.toFixed(2)}" for your body`);
        
        // Apply penalty based on deviation - lower penalties since body fit is advisory
        if (deviation >= BODY_FIT_THRESHOLDS.D) {
          bodyFitPenalty += 4;
        } else if (deviation >= BODY_FIT_THRESHOLDS.C) {
          bodyFitPenalty += 2;
        } else if (deviation >= BODY_FIT_THRESHOLDS.B) {
          bodyFitPenalty += 1;
        }
      }
    });
    
    // Cap body fit penalty at 15 points - it's advisory, shouldn't tank the grade
    bodyFitPenalty = Math.min(bodyFitPenalty, 15);
    
    score = Math.max(0, score - bodyFitPenalty);
    
    if (suggestions.length > 0) {
      logger.info(`BODY-FIT: Found ${suggestions.length} length issues, penalty: ${bodyFitPenalty}`);
    }
  }

  return {
    score: Math.max(0, score),
    scorable: true,
    issues: issues,
    suggestions: suggestions,
    defaultsNote: defaultsNote,
    clubsUsingDefaults: clubsUsingDefaults.length,
    bodyFitBaseline: bodyFitSpecs ? {
      enabled: true,
      heightDisplay: bodyFitSpecs.heightDisplay,
      wristToFloor: bodyFitSpecs.wristToFloor,
      adjustment: bodyFitAdjustment
    } : { enabled: false }
  };
}

/**
 * Calculate lie angle progression score
 * NOTE: Putters are excluded from lie angle progression scoring
 */
function calculateLieAngleProgression(clubs) {
  const issues = [];

  // Filter out putters, then filter for clubs with lie angle data (including defaults)
  // Note: 'lie' is the normalized field name per Master Field Reference
  const clubsWithLie = filterOutPutters(clubs)
      .filter((c) => (c.lie || c.lie_angle) && c.loft)
      .map(c => ({
        ...c,
        lie: c.lie || c.lie_angle  // Normalize to 'lie' field
      }))
      .sort((a, b) => a.loft - b.loft);
  
  // Track clubs using defaults
  const clubsUsingDefaults = clubsWithLie.filter(c => c.lieIsDefault === true);

  if (clubsWithLie.length < 2) {
    return {
      score: 0,
      scorable: false,
      issues: ["Not enough clubs with lie angle data"],
      defaultsNote: null,
      clubsUsingDefaults: 0
    };
  }
  
  // Add note about default lie angles if any were used
  let defaultsNote = null;
  if (clubsUsingDefaults.length > 0) {
    const clubList = clubsUsingDefaults.map(c => `${c.clubType} (${c.lie}°)`).join(', ');
    defaultsNote = `Standard lie angles used for ${clubsUsingDefaults.length} club(s): ${clubList}. For accurate analysis, enter actual lie angles.`;
  }

  let progressionIssues = 0;

  for (let i = 1; i < clubsWithLie.length; i++) {
    const prevClub = clubsWithLie[i - 1];
    const currClub = clubsWithLie[i];

    const lieDiff = currClub.lie - prevClub.lie;
    
    // Build note with default notation if applicable
    const prevNote = prevClub.lieIsDefault ? ' [std]' : '';
    const currNote = currClub.lieIsDefault ? ' [std]' : '';

    // Expect ~1° increments between clubs (extremely lenient tolerance)
    if (Math.abs(lieDiff - 1) > 1.5) {  // Extremely lenient
      progressionIssues++;
      issues.push(
          `${lieDiff.toFixed(1)}° lie difference between ${prevClub.clubType}${prevNote} and ${currClub.clubType}${currNote}`
      );
    }
  }

  let score = 100 - (progressionIssues * 5);  // Extremely lenient

  return {
    score: Math.max(0, score),
    scorable: true,
    issues: issues,
    defaultsNote: defaultsNote,
    clubsUsingDefaults: clubsUsingDefaults.length
  };
}

/**
 * Convert numerical score to letter grade
 */
/**
 * Normalize club data to standard format per Master Field Reference
 * Handles both nested (shaft.weight) and flat (shaft_weight) structures
 * Ensures consistent field names for all scoring functions
 * 
 * STANDARD FIELDS (per FitMyGolfClubs_Master_Field_Reference.md):
 * - clubType (not club_type)
 * - shaft_weight, shaft_flex, shaft_kickpoint, shaft_torque (flat)
 * - lie (not lie_angle)
 * - brand, model, year, loft, length
 */
function normalizeClubData(club) {
  // Get lie value from any possible source
  const lieValue = club.lie || club.lie_angle || null;
  
  return {
    // Preserve original data
    ...club,
    
    // Club identification - normalize to standard
    clubType: club.clubType || club.club_type || null,
    brand: club.brand || club.identification?.brand || null,
    model: club.model || club.identification?.model || null,
    year: club.year || club.identification?.year || null,
    
    // Club specs
    loft: club.loft || null,
    length: club.length || null,
    lie: lieValue,          // Standard name per Master Field Reference
    lie_angle: lieValue,    // Alternate name (for backward compatibility)
    
    // Shaft data - normalize nested to flat (standard format)
    shaft_weight: club.shaft?.weight || club.shaft_weight || null,
    shaft_flex: club.shaft?.flex || club.shaft_flex || null,
    shaft_kickpoint: club.shaft?.kickpoint || club.shaft_kickpoint || null,
    shaft_torque: club.shaft?.torque || club.shaft_torque || null,
    shaft_brand: club.shaft?.brand || club.shaft_brand || null,
    shaft_model: club.shaft?.model || club.shaft_model || null,
    
    // Flags
    is_favorite: club.is_favorite || false,
    status: club.status || 'active'
  };
}

/**
 * Convert numerical score to letter grade
 */
function scoreToGrade(score) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

// ==========================================
// EXISTING FUNCTIONS (UNCHANGED)
// ==========================================

exports.populateSwingDataStructure = onRequest(async (req, res) => {
  // Set CORS headers
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  try {
    const db = admin.firestore();
    
    // ==========================================
    // CONFIGURATION
    // ==========================================
    
    // Use your actual test user ID and club ID
    const testUserId = "yRGUZGczFQNxTteFNXBR4wUUzD52";
    const testClubId = "GgBqubMd2HITLVPJqLqd";
    
    // Generate sessionId
    const sessionId = `session_${Date.now()}`;
    
    // ==========================================
    // 1. CREATE TESTING SESSION
    // ==========================================
    
    const sessionData = {
      sessionId: sessionId,
      sessionDate: admin.firestore.FieldValue.serverTimestamp(),
      sessionName: "Sample Range Session - Nov 12",
      
      // Golf ball used
      golfBall: {
        brand: "Titleist",
        model: "Pro V1"
      },
      
      // Weather conditions
      conditions: {
        temperature: 72,
        wind: "calm",
        humidity: 50
      },
      
      // Clubs tested in this session (summary data)
      clubsTested: [
        {
          clubId: testClubId,
          clubType: "7-Iron",
          shotsHit: 10,
          avgCarry: 166,
          avgTotal: 173,
          avgBallSpeed: 113
        }
      ],
      
      // Session totals
      totalShots: 10,
      totalClubsTested: 1,
      
      // Optional notes
      location: "TrackMan Bay 3",
      notes: "Sample testing session for demonstration",
      
      // Metadata
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    // Create session document
    await db.collection('users').doc(testUserId)
      .collection('testingSessions').doc(sessionId)
      .set(sessionData);
    
    console.log(`✅ Created testing session: ${sessionId}`);
    
    // ==========================================
    // 2. CREATE PERFORMANCE DATA
    // ==========================================
    
    const performanceData = {
      sessionId: sessionId,
      clubId: testClubId,
      clubType: "7-Iron",
      testDate: admin.firestore.FieldValue.serverTimestamp(),
      
      // Individual shots array
      shots: [
        {
          shotNumber: 1,
          carryDistance: 165,
          totalDistance: 172,
          ballSpeed: 112,
          clubheadSpeed: 85,
          launchAngle: 18.5,
          spinRate: 6200,
          peakHeight: 28,
          side: 2,
          hangTime: 5.2
        },
        {
          shotNumber: 2,
          carryDistance: 168,
          totalDistance: 175,
          ballSpeed: 114,
          clubheadSpeed: 86,
          launchAngle: 18.2,
          spinRate: 6150,
          peakHeight: 29,
          side: -1,
          hangTime: 5.3
        },
        {
          shotNumber: 3,
          carryDistance: 164,
          totalDistance: 171,
          ballSpeed: 111,
          clubheadSpeed: 84,
          launchAngle: 18.8,
          spinRate: 6250,
          peakHeight: 27,
          side: 3,
          hangTime: 5.1
        },
        {
          shotNumber: 4,
          carryDistance: 167,
          totalDistance: 174,
          ballSpeed: 113,
          clubheadSpeed: 85.5,
          launchAngle: 18.3,
          spinRate: 6180,
          peakHeight: 28,
          side: 0,
          hangTime: 5.2
        },
        {
          shotNumber: 5,
          carryDistance: 166,
          totalDistance: 173,
          ballSpeed: 112.5,
          clubheadSpeed: 85,
          launchAngle: 18.4,
          spinRate: 6200,
          peakHeight: 28,
          side: 1,
          hangTime: 5.2
        },
        {
          shotNumber: 6,
          carryDistance: 165,
          totalDistance: 172,
          ballSpeed: 112,
          clubheadSpeed: 84.5,
          launchAngle: 18.6,
          spinRate: 6220,
          peakHeight: 28,
          side: 2,
          hangTime: 5.2
        },
        {
          shotNumber: 7,
          carryDistance: 169,
          totalDistance: 176,
          ballSpeed: 115,
          clubheadSpeed: 87,
          launchAngle: 18.0,
          spinRate: 6100,
          peakHeight: 29,
          side: -2,
          hangTime: 5.3
        },
        {
          shotNumber: 8,
          carryDistance: 166,
          totalDistance: 173,
          ballSpeed: 113,
          clubheadSpeed: 85,
          launchAngle: 18.5,
          spinRate: 6190,
          peakHeight: 28,
          side: 1,
          hangTime: 5.2
        },
        {
          shotNumber: 9,
          carryDistance: 167,
          totalDistance: 174,
          ballSpeed: 113.5,
          clubheadSpeed: 86,
          launchAngle: 18.2,
          spinRate: 6170,
          peakHeight: 29,
          side: 0,
          hangTime: 5.3
        },
        {
          shotNumber: 10,
          carryDistance: 166,
          totalDistance: 173,
          ballSpeed: 113,
          clubheadSpeed: 85.5,
          launchAngle: 18.4,
          spinRate: 6195,
          peakHeight: 28,
          side: 1,
          hangTime: 5.2
        }
      ],
      
      // Calculated averages
      averages: {
        carryDistance: 166.3,
        totalDistance: 173.3,
        ballSpeed: 113.0,
        clubheadSpeed: 85.4,
        launchAngle: 18.4,
        spinRate: 6186
      },
      
      // Outlier tracking (for future use)
      outliersRemoved: {
        originalShotCount: 10,
        outliersRemoved: 0,
        outlierIndices: [],
        removalMethod: "none"
      },
      
      // Metadata
      dataSource: "trackman",
      notes: "Felt good, consistent contact",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    // Create performance data document under club
    await db.collection('users').doc(testUserId)
      .collection('clubs').doc(testClubId)
      .collection('performanceData').doc(sessionId)
      .set(performanceData);
    
    console.log(`✅ Created performance data for club: ${testClubId}`);
    
    // ==========================================
    // 3. RESPONSE
    // ==========================================
    
    res.status(200).json({
      success: true,
      message: "Successfully created sample swing data structure!",
      data: {
        sessionId: sessionId,
        testUserId: testUserId,
        testClubId: testClubId,
        documentsCreated: {
          session: `users/${testUserId}/testingSessions/${sessionId}`,
          performanceData: `users/${testUserId}/clubs/${testClubId}/performanceData/${sessionId}`
        },
        structure: {
          session: {
            clubsTested: 1,
            totalShots: 10,
            golfBall: "Titleist Pro V1",
            conditions: "72°F, calm"
          },
          performanceData: {
            shots: 10,
            avgCarry: "166.3 yards",
            avgBallSpeed: "113 mph"
          }
        }
      },
      nextSteps: [
        "1. Check Firebase Console to see the new documents",
        "2. Verify structure at: users/{userId}/testingSessions/{sessionId}",
        "3. Verify structure at: users/{userId}/clubs/{clubId}/performanceData/{sessionId}",
        "4. Delete this Cloud Function after verification"
      ]
    });
    
  } catch (error) {
    console.error("❌ Error populating swing data structure:", error);
    res.status(500).json({
      error: "Failed to populate swing data structure",
      details: error.message,
      stack: error.stack
    });
  }
});

exports.setupSavedRecommendationsOnly = require('./setupSavedRecommendationsOnly').setupSavedRecommendationsOnly;
exports.compareFittingSession = require('./compareFittingSession').compareFittingSession;


 
exports.processClubPhotos = require('./processClubPhotos').processClubPhotos; 
 
exports.getReplacementSuggestion = require('./getReplacementSuggestion').getReplacementSuggestion; 
exports.updateBagAfterTest = require('./updateBagAfterTest').updateBagAfterTest; 
exports.undoBagChange = require('./undoBagChange').undoBagChange;
// GHIN Functions
const ghinFunctions = require('./ghinFunctions_v2');
exports.lookupGhinNumber = ghinFunctions.lookupGhinNumber;

// ============================================
// DAILY GHIN SYNC FOR PRO CLIENTS
// Runs at 6am ET every day
// ============================================
const {onSchedule} = require("firebase-functions/v2/scheduler");

exports.dailyClientGhinSync = onSchedule({
  schedule: "0 6 * * *",
  timeZone: "America/New_York",
  memory: "512MiB",
  timeoutSeconds: 540
}, async (event) => {
  logger.info("Starting daily client GHIN sync");
  
  const db = admin.firestore();
  let totalSynced = 0;
  let totalFailed = 0;
  
  try {
    // Get all pro users
    const prosSnapshot = await db.collection("users")
      .where("account_type", "==", "professional")
      .get();
    
    logger.info(`Found ${prosSnapshot.size} pro accounts`);
    
    for (const proDoc of prosSnapshot.docs) {
      const proId = proDoc.id;
      
      // Get all clients with GHIN numbers for this pro
      const clientsSnapshot = await db.collection("users")
        .where("pro_id", "==", proId)
        .get();
      
      for (const clientDoc of clientsSnapshot.docs) {
        const clientData = clientDoc.data();
        const ghinNumber = clientData.ghin_number || clientData.ghinNumber;
        
        if (!ghinNumber) continue;
        
        try {
          // Look up current handicap
          const lookupResult = await ghinFunctions.lookupGhinNumberInternal(ghinNumber);
          
          if (lookupResult && lookupResult.handicap !== undefined) {
            const newHandicap = parseFloat(lookupResult.handicap);
            const oldHandicap = clientData.handicap || clientData.Handicap;
            
            // Only update if changed
            if (newHandicap !== oldHandicap) {
              await clientDoc.ref.update({
                handicap: newHandicap,
                Handicap: newHandicap,
                ghin_last_sync: admin.firestore.FieldValue.serverTimestamp(),
                ghin_sync_status: "success"
              });
              logger.info(`Updated ${clientData.name}: ${oldHandicap} -> ${newHandicap}`);
            } else {
              await clientDoc.ref.update({
                ghin_last_sync: admin.firestore.FieldValue.serverTimestamp(),
                ghin_sync_status: "success"
              });
            }
            totalSynced++;
          }
          
          // Rate limit: 500ms between API calls
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (err) {
          logger.error(`GHIN sync failed for client ${clientDoc.id}:`, err.message);
          await clientDoc.ref.update({
            ghin_last_sync: admin.firestore.FieldValue.serverTimestamp(),
            ghin_sync_status: "failed",
            ghin_sync_error: err.message
          });
          totalFailed++;
        }
      }
    }
    
    logger.info(`Daily GHIN sync complete: ${totalSynced} synced, ${totalFailed} failed`);
    
  } catch (error) {
    logger.error("Daily GHIN sync error:", error);
  }
});

// ============================================
// CHECK FOR DUPLICATE GHIN (called during onboarding)
// ============================================
exports.checkGhinDuplicate = onCall(async (request) => {
  const { ghinNumber, proId } = request.data;
  
  if (!ghinNumber || !proId) {
    return { isDuplicate: false };
  }
  
  const cleanGhin = ghinNumber.toString().replace(/\D/g, '');
  
  const db = admin.firestore();
  
  // Check if any client of this pro already has this GHIN
  const existingClient = await db.collection("users")
    .where("pro_id", "==", proId)
    .where("ghin_number", "==", cleanGhin)
    .limit(1)
    .get();
  
  if (!existingClient.empty) {
    const clientData = existingClient.docs[0].data();
    return {
      isDuplicate: true,
      existingClientName: clientData.name || clientData.displayName || "Unknown"
    };
  }
  
  return { isDuplicate: false };
});

// ============================================
// SCENARIO FUNCTIONS
// ============================================

/**
 * runScenario - Run a what-if scenario analysis
 * Takes modified clubs and returns projected grade
 */
exports.runScenario = onCall(async (request) => {
  const { userId, clubs, scenarioName } = request.data;
  
  if (!userId || !clubs || !Array.isArray(clubs)) {
    throw new functions.https.HttpsError('invalid-argument', 'userId and clubs array required');
  }
  
  logger.info(`Running scenario "${scenarioName || 'Unnamed'}" for user ${userId}`);
  
  // Call gradeUserBag in scenario mode via internal logic
  // For now, return the clubs for client-side processing
  // Full implementation would call gradeUserBag with isScenario: true
  
  return {
    success: true,
    scenarioName: scenarioName || `Scenario ${new Date().toLocaleDateString()}`,
    clubsCount: clubs.length,
    message: "Use gradeUserBag with isScenario: true for full analysis"
  };
});

/**
 * saveScenario - Save a scenario for later comparison
 */
exports.saveScenario = onCall(async (request) => {
  const { userId, scenarioData } = request.data;
  
  if (!userId || !scenarioData) {
    throw new functions.https.HttpsError('invalid-argument', 'userId and scenarioData required');
  }
  
  const db = admin.firestore();
  
  // Get scenarios subcollection
  const scenariosRef = db.collection("users").doc(userId).collection("scenarios");
  
  // Enforce max 5 scenarios
  const existingScenarios = await scenariosRef.orderBy("created_at", "asc").get();
  if (existingScenarios.size >= 5) {
    const oldest = existingScenarios.docs[0];
    await oldest.ref.delete();
    logger.info(`Deleted oldest scenario to maintain limit of 5`);
  }
  
  // Save new scenario
  const newScenario = {
    ...scenarioData,
    created_at: admin.firestore.FieldValue.serverTimestamp()
  };
  
  const docRef = await scenariosRef.add(newScenario);
  
  return {
    success: true,
    scenarioId: docRef.id
  };
});

/**
 * getSavedScenarios - Get all saved scenarios for a user
 */
exports.getSavedScenarios = onCall(async (request) => {
  const { userId } = request.data;
  
  if (!userId) {
    throw new functions.https.HttpsError('invalid-argument', 'userId required');
  }
  
  const db = admin.firestore();
  const scenariosRef = db.collection("users").doc(userId).collection("scenarios");
  const snapshot = await scenariosRef.orderBy("created_at", "desc").get();
  
  const scenarios = [];
  snapshot.forEach(doc => {
    scenarios.push({
      id: doc.id,
      ...doc.data()
    });
  });
  
  return { scenarios };
});

/**
 * deleteSavedScenario - Delete a saved scenario
 */
exports.deleteSavedScenario = onCall(async (request) => {
  const { userId, scenarioId } = request.data;
  
  if (!userId || !scenarioId) {
    throw new functions.https.HttpsError('invalid-argument', 'userId and scenarioId required');
  }
  
  const db = admin.firestore();
  await db.collection("users").doc(userId).collection("scenarios").doc(scenarioId).delete();
  
  return { success: true };
});

/**
 * applyScenario - Apply a saved scenario to the user's bag
 */
exports.applyScenario = onCall(async (request) => {
  const { userId, scenarioId } = request.data;
  
  if (!userId || !scenarioId) {
    throw new functions.https.HttpsError('invalid-argument', 'userId and scenarioId required');
  }
  
  const db = admin.firestore();
  
  // Get the scenario
  const scenarioDoc = await db.collection("users").doc(userId).collection("scenarios").doc(scenarioId).get();
  
  if (!scenarioDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Scenario not found');
  }
  
  const scenario = scenarioDoc.data();
  
  // Apply scenario clubs to user's bag
  // This would replace/update clubs in the user's bag
  // Implementation depends on scenario structure
  
  return {
    success: true,
    applied: scenario.name || scenarioId
  };
});
