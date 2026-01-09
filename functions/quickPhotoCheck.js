/**
 * Quick Photo Quality Check Function
 * Analyzes 2-4 club photos and provides immediate feedback
 * 
 * CORRECTED VERSION - clubId is OPTIONAL
 * Called BEFORE club document is created
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(functions.config().gemini.api_key);

exports.quickPhotoCheck = functions
  .runWith({ 
    timeoutSeconds: 10, 
    memory: '256MB',
    maxInstances: 100
  })
  .https.onCall(async (data, context) => {
    const startTime = Date.now();
    
    // 1. AUTHENTICATION & VALIDATION
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'User must be authenticated'
      );
    }
    
    const { userId, clubType, photos, clubId } = data;  // clubId is OPTIONAL
    
    // Validate required fields
    if (!clubType) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'clubType is required'
      );
    }
    
    if (!photos || !photos.head || !photos.shaft) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Both head and shaft photos required'
      );
    }
    
    // Build photo array (2-4 photos possible)
    const photoUrls = [photos.head, photos.shaft];
    if (photos.head_secondary) photoUrls.push(photos.head_secondary);
    if (photos.shaft_secondary) photoUrls.push(photos.shaft_secondary);
    
    console.log(`Quick check for ${photoUrls.length} photos, clubType: ${clubType}`);
    
    try {
      // 2. DOWNLOAD & ENCODE PHOTOS
      const encodedPhotos = await Promise.all(
        photoUrls.map(url => downloadAndEncode(url))
      );
      
      // 3. CALL GEMINI FOR QUICK CHECK
      const feedback = await callGeminiQuickCheck(
        encodedPhotos,
        photoUrls.length,
        clubType
      );
      
      // 4. DETERMINE OVERALL QUALITY
      const overallScore = (feedback.headPhoto.quality + feedback.shaftPhoto.quality) / 2;
      let overallQuality;
      if (overallScore >= 0.75) {
        overallQuality = 'good';
      } else if (overallScore >= 0.50) {
        overallQuality = 'needs_improvement';
      } else {
        overallQuality = 'poor';
      }
      
      // 5. DETERMINE RECOMMENDED RETAKES
      const recommendRetake = [];
      if (feedback.headPhoto.quality < 0.60) recommendRetake.push('head');
      if (feedback.shaftPhoto.quality < 0.60) recommendRetake.push('shaft');
      
      const processingTime = Date.now() - startTime;
      
      // 6. LOG ANALYTICS (only if clubId provided)
      if (clubId) {
        try {
          await admin.firestore().collection('photo_feedback_analytics').add({
            userId: userId || context.auth.uid,
            clubId: clubId,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            overallQuality,
            overallScore,
            headPhotoQuality: feedback.headPhoto.quality,
            shaftPhotoQuality: feedback.shaftPhoto.quality,
            photoCount: photoUrls.length,
            processingTimeMs: processingTime
          });
        } catch (error) {
          console.error('Analytics logging failed (non-critical):', error);
          // Don't fail the whole function if analytics fails
        }
      }
      
      // 7. RETURN FEEDBACK
      return {
        success: true,
        overallQuality,
        overallScore,
        headPhoto: feedback.headPhoto,
        shaftPhoto: feedback.shaftPhoto,
        recommendRetake,
        estimatedConfidence: overallScore,
        processingTimeMs: processingTime
      };
      
    } catch (error) {
      console.error('Quick photo check error:', error);
      throw new functions.https.HttpsError(
        'internal',
        'Failed to analyze photos: ' + error.message
      );
    }
  });

// HELPER: Download photo from Storage and encode to base64
async function downloadAndEncode(storageUrl) {
  try {
    // Extract file path from Storage URL
    // URL format: https://firebasestorage.googleapis.com/v0/b/PROJECT/o/PATH?token=...
    const filePath = storageUrl.split('/o/')[1].split('?')[0];
    const decodedPath = decodeURIComponent(filePath);
    
    // Download file
    const bucket = admin.storage().bucket();
    const file = bucket.file(decodedPath);
    const [buffer] = await file.download();
    
    // Convert to base64
    return buffer.toString('base64');
  } catch (error) {
    console.error('Error downloading photo:', storageUrl, error);
    throw new Error('Failed to download photo from Storage');
  }
}

// HELPER: Call Gemini API for quick quality check
async function callGeminiQuickCheck(encodedPhotos, photoCount, clubType) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
  
  const prompt = buildQuickCheckPrompt(clubType, photoCount);
  
  // Build content array with prompt + all photos
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
  
  // Parse JSON response
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  
  try {
    const parsed = JSON.parse(cleaned);
    return parsed;
  } catch (error) {
    console.error('Failed to parse Gemini response:', text);
    throw new Error('Invalid JSON response from Gemini');
  }
}

// HELPER: Build Gemini prompt for quality check
function buildQuickCheckPrompt(clubType, photoCount) {
  const criticalSpecs = getCriticalSpecs(clubType);
  
  return `You are a golf equipment photo quality checker. Quickly assess if these ${photoCount} photos are good enough to extract club specifications.

CONTEXT:
- You will receive ${photoCount} photos (2-4 photos)
- Required: At least 1 club head photo and 1 shaft photo
- Optional: Additional angles of head or shaft for better coverage
- Club Type: ${clubType}

CRITICAL SPECS NEEDED:
${criticalSpecs}

TASK:
Analyze ALL ${photoCount} photos together. If you see multiple head or shaft photos, use the BEST information from any of them.

For each photo type (head and shaft), assess:
1. Is text readable and in focus in ANY of the photos?
2. Is lighting adequate in the best photo?
3. Can you identify critical specifications from the set?
4. What specific improvements would help?

**IMPORTANT:** When multiple photos show the same component (e.g., 2 shaft photos), evaluate based on the BEST photo of that type. Your feedback should reflect the best available information.

RESPOND WITH VALID JSON ONLY (no markdown, no extra text):
{
  "headPhoto": {
    "quality": 0.85,
    "canReadBrand": true,
    "canReadModel": true,
    "canReadLoft": true,
    "issues": [],
    "suggestions": ["Specific actionable tip"]
  },
  "shaftPhoto": {
    "quality": 0.45,
    "canReadBrand": true,
    "canReadFlex": false,
    "canReadWeight": false,
    "issues": ["flex_not_visible", "low_lighting"],
    "suggestions": ["Get 6 inches closer", "Turn on flash"]
  }
}

GUIDELINES FOR QUALITY SCORE:
- 0.9-1.0: Perfect, all specs clearly visible
- 0.75-0.89: Good, minor issues but acceptable
- 0.50-0.74: Needs improvement, missing some specs
- 0.0-0.49: Poor, major issues, strong retake recommended

GUIDELINES FOR SUGGESTIONS:
- Be specific and actionable ("Move 6 inches closer" not "Get closer")
- Be encouraging ("Almost perfect!" when close)
- Limit to 2-3 suggestions per photo
- Focus on biggest issue first

BE HONEST BUT ENCOURAGING. Your goal is to help the user get great results!`;
}

// HELPER: Get critical specs for each club type
function getCriticalSpecs(clubType) {
  const specs = {
    driver: '- Club Head: brand, model, loft\n- Shaft: brand, flex, weight (if visible)',
    fairway: '- Club Head: brand, model, loft\n- Shaft: brand, flex, weight (if visible)',
    hybrid: '- Club Head: brand, model, loft OR number\n- Shaft: brand, flex',
    iron: '- Club Head: brand, model, number\n- Shaft: brand, flex',
    wedge: '- Club Head: brand, model, loft, bounce\n- Shaft: brand, flex',
    putter: '- Club Head: brand, model\n- Shaft: (putters often have minimal shaft specs)'
  };
  
  return specs[clubType] || specs.iron;
}
