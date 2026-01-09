/**
 * processClubPhotos - Extract golf club specifications from photos
 * 
 * Two-tier approach:
 * 1. Gemini 2.5 Flash (primary) - 85-90% of cases
 * 2. Claude Sonnet 4 (backup) - 10-15% of cases when Gemini struggles
 * 
 * Cost: ~$0.004 per club average
 * Speed: 3-5 seconds (Gemini) or 5-8 seconds (with Claude backup)
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');

// Initialize APIs
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

exports.processClubPhotos = functions
  .runWith({ 
    timeoutSeconds: 60, 
    memory: '512MB',
    maxInstances: 100
  })
  .https.onCall(async (data, context) => {
    const startTime = Date.now();
    
    // 1. AUTHENTICATION
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'User must be authenticated'
      );
    }
    
    // 2. VALIDATE INPUT
    const { clubId, userId, clubType, photos } = data;
    
    if (!photos || !photos.head_primary || !photos.shaft_primary) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Both head_primary and shaft_primary photos required'
      );
    }
    
    const validClubTypes = ['driver', 'fairway', 'hybrid', 'iron', 'wedge', 'putter'];
    if (!validClubTypes.includes(clubType)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `Invalid clubType. Must be one of: ${validClubTypes.join(', ')}`
      );
    }
    
    console.log(`Processing club ${clubId} (${clubType}) for user ${userId}`);
    
    try {
      // 3. COLLECT ALL PHOTO URLS
      const photoUrls = [];
      const photosProcessed = {};
      
      ['head_primary', 'head_secondary', 'shaft_primary', 'shaft_secondary'].forEach(key => {
        if (photos[key]) {
          photoUrls.push(photos[key]);
          photosProcessed[key] = true;
        } else {
          photosProcessed[key] = false;
        }
      });
      
      console.log(`Processing ${photoUrls.length} photos`);
      
      // 4. DOWNLOAD & ENCODE PHOTOS
      const encodedPhotos = await Promise.all(
        photoUrls.map(url => downloadAndEncode(url))
      );
      
      // 5. CALL GEMINI (PRIMARY)
      let geminiResult;
      let geminiCalls = 0;
      
      try {
        geminiResult = await callGeminiAPI(encodedPhotos, clubType);
        geminiCalls = 1;
        console.log('Gemini extraction successful');
      } catch (error) {
        console.error('Gemini API failed:', error);
        geminiResult = null;
      }
      
      // 6. DETERMINE IF CLAUDE BACKUP NEEDED
      const needsClaudeBackup = shouldTriggerClaudeBackup(geminiResult, clubType);
      
      let finalSpecs, finalConfidence, source, claudeCalls = 0;
      
      if (needsClaudeBackup && geminiResult) {
        console.log('Triggering Claude backup - low confidence or missing specs');
        try {
          const claudeResult = await callClaudeAPI(
            encodedPhotos,
            clubType,
            geminiResult.specs,
            geminiResult.confidence
          );
          finalSpecs = claudeResult.specs;
          finalConfidence = claudeResult.confidence;
          source = 'claude_backup';
          claudeCalls = 1;
        } catch (error) {
          console.error('Claude backup also failed:', error);
          // Use Gemini results as fallback
          finalSpecs = geminiResult.specs;
          finalConfidence = geminiResult.confidence;
          source = 'gemini';
        }
      } else if (geminiResult) {
        // Gemini was good enough
        finalSpecs = geminiResult.specs;
        finalConfidence = geminiResult.confidence;
        source = 'gemini';
      } else {
        // Both failed - return error
        throw new functions.https.HttpsError(
          'internal',
          'Failed to extract club specifications from photos'
        );
      }
      
      // 7. CALCULATE OVERALL CONFIDENCE
      const overallConfidence = calculateOverallConfidence(finalConfidence);
      
      const processingTime = Date.now() - startTime;
      
      // 8. SAVE TO FIRESTORE
      if (clubId) {
        await admin.firestore().collection('clubs').doc(clubId).update({
          extractedSpecs: finalSpecs,
          extractionConfidence: finalConfidence,
          extractionSource: source,
          extractionTimestamp: admin.firestore.FieldValue.serverTimestamp(),
          photosProcessed: photosProcessed,
          processingTimeMs: processingTime,
          overallConfidence: overallConfidence,
          apiCalls: {
            gemini: geminiCalls,
            claude: claudeCalls
          }
        });
      }
      
      // 9. RETURN RESULT
      return {
        success: true,
        specs: finalSpecs,
        confidence: finalConfidence,
        overallConfidence,
        source,
        photosProcessed,
        processingTimeMs: processingTime,
        apiCalls: {
          gemini: geminiCalls,
          claude: claudeCalls
        }
      };
      
    } catch (error) {
      console.error('processClubPhotos error:', error);
      throw new functions.https.HttpsError(
        'internal',
        `Failed to process photos: ${error.message}`
      );
    }
  });

// ==========================================
// HELPER FUNCTIONS
// ==========================================

/**
 * Download photo from Firebase Storage and encode to base64
 */
async function downloadAndEncode(storageUrl) {
  try {
    const filePath = storageUrl.split('/o/')[1].split('?')[0];
    const decodedPath = decodeURIComponent(filePath);
    
    const bucket = admin.storage().bucket();
    const file = bucket.file(decodedPath);
    const [buffer] = await file.download();
    
    return buffer.toString('base64');
  } catch (error) {
    console.error('Error downloading photo:', storageUrl, error);
    throw new Error('Failed to download photo from Storage');
  }
}

/**
 * Call Gemini API for primary extraction
 */
async function callGeminiAPI(encodedPhotos, clubType) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
  
  const prompt = buildGeminiPrompt(clubType, encodedPhotos.length);
  
  // Build content array
  const content = [prompt];
  for (const photoBase64 of encodedPhotos) {
    content.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: photoBase64
      }
    });
  }
  
  const result = await model.generateContent(content);
  const response = await result.response;
  const text = response.text();
  
  // Parse JSON
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const parsed = JSON.parse(cleaned);
  
  return parsed;
}

/**
 * Build Gemini prompt
 */
function buildGeminiPrompt(clubType, photoCount) {
  const criticalSpecs = getCriticalSpecs(clubType);
  
  return `You are a golf equipment expert analyzing ${photoCount} photo(s) of a ${clubType}.

CRITICAL SPECIFICATIONS REQUIRED:
${criticalSpecs}

TASK:
Extract ALL visible specifications from the photos. Analyze all photos together - if information appears in multiple photos, use the clearest reading.

RESPOND WITH VALID JSON ONLY (no markdown, no extra text):
{
  "specs": {
    "brand": "value or null",
    "model": "value or null",
    "loft": "value or null",
    "adjustability": "yes/no or null",
    "shaft_brand": "value or null",
    "shaft_model": "value or null",
    "shaft_flex": "value or null",
    "shaft_weight": "value or null",
    "bounce": "value or null",
    "number": "value or null",
    "lie": "value or null",
    "shaft_torque": "value or null",
    "shaft_kickpoint": "value or null"
  },
  "confidence": {
    "brand": 0.95,
    "model": 0.90,
    "loft": 0.85
    // Include all extracted specs
  },
  "notes": "Brief summary of what you could/couldn't read"
}

CONFIDENCE SCORING:
- 0.9-1.0: Text clearly visible and certain
- 0.7-0.89: Visible but slightly unclear
- 0.5-0.69: Partially visible or inferred
- 0.3-0.49: Educated guess from context
- 0.0-0.29: Cannot determine

BE ACCURATE. If you cannot see a specification, mark it as null with low confidence rather than guessing.`;
}

/**
 * Call Claude API as backup
 */
async function callClaudeAPI(encodedPhotos, clubType, geminiSpecs, geminiConfidence) {
  const prompt = buildClaudePrompt(clubType, geminiSpecs, geminiConfidence, encodedPhotos.length);
  
  // Build content array
  const content = [];
  
  // Add all photos first
  for (const photoBase64 of encodedPhotos) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: photoBase64
      }
    });
  }
  
  // Add text prompt
  content.push({
    type: 'text',
    text: prompt
  });
  
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [{ role: 'user', content: content }]
  });
  
  const responseText = message.content[0].text;
  const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const parsed = JSON.parse(cleaned);
  
  return parsed;
}

/**
 * Build Claude backup prompt
 */
function buildClaudePrompt(clubType, geminiSpecs, geminiConfidence, photoCount) {
  const criticalSpecs = getCriticalSpecs(clubType);
  
  return `You are reviewing golf club photo analysis that needs verification. A primary AI attempted extraction but confidence was low or specs were missing.

CLUB TYPE: ${clubType}
PHOTOS: ${photoCount} images attached

CRITICAL SPECS NEEDED:
${criticalSpecs}

PREVIOUS EXTRACTION (Gemini):
Specs: ${JSON.stringify(geminiSpecs, null, 2)}
Confidence: ${JSON.stringify(geminiConfidence, null, 2)}

YOUR TASK:
1. Verify or correct the existing specs
2. Fill in any missing critical specifications
3. Use your golf equipment knowledge to infer specs when appropriate (e.g., "Titleist TSR2 drivers typically come with adjustable hosels")
4. Provide confidence scores

RESPOND WITH VALID JSON ONLY:
{
  "specs": {
    "brand": "value or null",
    "model": "value or null",
    // ... all specs
  },
  "confidence": {
    "brand": 0.95,
    // ... confidence for each spec
  },
  "notes": "Explanation of corrections/inferences made"
}

CONFIDENCE GUIDELINES:
- 1.0: Clearly visible in photos
- 0.8: Visible but unclear
- 0.6: Inferred from brand/model knowledge
- 0.4: Educated guess
- 0.0: Cannot determine

USE YOUR GOLF KNOWLEDGE to fill gaps when reasonable.`;
}

/**
 * Get critical specs for each club type
 */
function getCriticalSpecs(clubType) {
  const specs = {
    driver: '- Brand, Model, Loft\n- Shaft: Brand, Flex, Weight',
    fairway: '- Brand, Model, Loft\n- Shaft: Brand, Flex, Weight',
    hybrid: '- Brand, Model, Loft OR Number\n- Shaft: Brand, Flex',
    iron: '- Brand, Model, Number\n- Shaft: Brand, Flex',
    wedge: '- Brand, Model, Loft, Bounce\n- Shaft: Brand, Flex',
    putter: '- Brand, Model\n- Shaft: (minimal specs typical for putters)'
  };
  
  return specs[clubType] || specs.iron;
}

/**
 * Determine if Claude backup is needed
 */
function shouldTriggerClaudeBackup(geminiResult, clubType) {
  if (!geminiResult) return true;
  
  // Calculate overall confidence
  const overallConfidence = calculateOverallConfidence(geminiResult.confidence);
  
  if (overallConfidence < 0.60) {
    console.log(`Low overall confidence: ${overallConfidence}`);
    return true;
  }
  
  // Check for missing critical specs
  const criticalFields = getCriticalFields(clubType);
  const missingSpecs = [];
  
  for (const field of criticalFields) {
    if (!geminiResult.specs[field]) {
      missingSpecs.push(field);
    }
  }
  
  // Special case for hybrids - need loft OR number
  if (clubType === 'hybrid' && !geminiResult.specs.loft && !geminiResult.specs.number) {
    missingSpecs.push('loft_or_number');
  }
  
  if (missingSpecs.length > 0) {
    console.log(`Missing critical specs: ${missingSpecs.join(', ')}`);
    return true;
  }
  
  return false;
}

/**
 * Get critical fields for each club type
 */
function getCriticalFields(clubType) {
  const fields = {
    driver: ['brand', 'model', 'loft', 'shaft_brand', 'shaft_flex'],
    fairway: ['brand', 'model', 'loft', 'shaft_brand', 'shaft_flex'],
    hybrid: ['brand', 'model', 'shaft_brand', 'shaft_flex'], // loft OR number checked separately
    iron: ['brand', 'model', 'number', 'shaft_brand', 'shaft_flex'],
    wedge: ['brand', 'model', 'loft', 'bounce', 'shaft_brand', 'shaft_flex'],
    putter: ['brand', 'model']
  };
  
  return fields[clubType] || fields.iron;
}

/**
 * Calculate overall confidence score
 */
function calculateOverallConfidence(confidenceScores) {
  const values = Object.values(confidenceScores).filter(v => v !== null && v !== undefined);
  if (values.length === 0) return 0;
  
  const sum = values.reduce((a, b) => a + b, 0);
  return sum / values.length;
}
