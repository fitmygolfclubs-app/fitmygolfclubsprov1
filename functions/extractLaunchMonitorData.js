/**
 * extractLaunchMonitorData.js
 * 
 * Cloud Function for extracting performance metrics from launch monitor photos
 * Uses Google Cloud Vision API for OCR
 * 
 * Supports: TrackMan, FlightScope, Garmin R10, SkyTrak, Foresight, Rapsodo
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const vision = require('@google-cloud/vision');

// Initialize Vision client
const visionClient = new vision.ImageAnnotatorClient();

// Validation ranges for sanity checking
const VALIDATION_RANGES = {
  ballSpeed: { min: 50, max: 220, unit: 'mph' },
  carry: { min: 50, max: 400, unit: 'yds' },
  totalDistance: { min: 50, max: 450, unit: 'yds' },
  launchAngle: { min: -10, max: 50, unit: '°' },
  launchDirection: { min: -30, max: 30, unit: '°' },
  spinRate: { min: 500, max: 15000, unit: 'rpm' },
  spinAxis: { min: -50, max: 50, unit: '°' },
  height: { min: 10, max: 200, unit: 'ft' },
  landingAngle: { min: 20, max: 70, unit: '°' },
  hangTime: { min: 2, max: 10, unit: 's' },
  curve: { min: -100, max: 100, unit: 'yds' },
  clubSpeed: { min: 40, max: 150, unit: 'mph' },
  attackAngle: { min: -15, max: 15, unit: '°' },
  clubPath: { min: -15, max: 15, unit: '°' },
  faceAngle: { min: -15, max: 15, unit: '°' },
  faceToPath: { min: -15, max: 15, unit: '°' },
  dynamicLoft: { min: 5, max: 60, unit: '°' },
  spinLoft: { min: 5, max: 60, unit: '°' },
  smashFactor: { min: 1.0, max: 1.55, unit: '' },
  lowPoint: { min: -6, max: 6, unit: 'in' }
};

// Metric label variations across devices
const METRIC_LABELS = {
  ballSpeed: ['ball speed', 'ball spd', 'ballspeed', 'ball velocity'],
  carry: ['carry', 'carry dist', 'carry distance', 'carry yds'],
  totalDistance: ['total', 'total dist', 'total distance', 'total yds', 'distance'],
  launchAngle: ['launch', 'launch angle', 'launch ang', 'v launch', 'vla'],
  launchDirection: ['launch dir', 'launch direction', 'h launch', 'hla', 'side'],
  spinRate: ['spin', 'spin rate', 'total spin', 'backspin'],
  spinAxis: ['spin axis', 'axis', 'tilt'],
  height: ['height', 'apex', 'max height', 'peak height'],
  landingAngle: ['land', 'landing', 'land angle', 'descent'],
  hangTime: ['hang', 'hang time', 'flight time', 'air time'],
  curve: ['curve', 'side', 'offline'],
  clubSpeed: ['club speed', 'club spd', 'clubspeed', 'swing speed'],
  attackAngle: ['attack', 'attack angle', 'aoa', 'angle of attack'],
  clubPath: ['path', 'club path', 'swing path'],
  faceAngle: ['face', 'face angle', 'face ang'],
  faceToPath: ['face to path', 'ftp', 'face/path'],
  dynamicLoft: ['dyn loft', 'dynamic loft', 'delivered loft'],
  spinLoft: ['spin loft'],
  smashFactor: ['smash', 'smash factor', 'efficiency'],
  lowPoint: ['low point', 'low pt']
};

/**
 * Main Cloud Function - Extract launch monitor data from photo
 */
exports.extractLaunchMonitorData = functions
  .runWith({ 
    timeoutSeconds: 30,
    memory: '1GB'
  })
  .https.onCall(async (data, context) => {
    
    const { imageBase64, imageUrl, deviceType, expectedClubType, userId } = data;
    
    // Debug logging
    console.log('extractLaunchMonitorData called');
    console.log('imageBase64 length:', imageBase64 ? imageBase64.length : 'null');
    
    if (!imageBase64 && !imageUrl) {
      throw new functions.https.HttpsError(
        'invalid-argument', 
        'Must provide imageBase64 or imageUrl'
      );
    }
    
    try {
      // Prepare image for Vision API
      let request;
      if (imageBase64) {
        // Strip data URL prefix if present (handles various image types)
        let base64Data = imageBase64;
        if (base64Data.includes('base64,')) {
          base64Data = base64Data.split('base64,')[1];
        }
        
        console.log('Stripped base64 length:', base64Data ? base64Data.length : 'null');
        
        if (!base64Data || base64Data.length < 100) {
          throw new Error('Base64 data is empty or too short after stripping prefix');
        }
        
        // Convert to Buffer for Vision API
        const imageBuffer = Buffer.from(base64Data, 'base64');
        console.log('Image buffer size:', imageBuffer.length, 'bytes');
        
        request = {
          image: { content: imageBuffer }
        };
      } else {
        request = {
          image: { source: { imageUri: imageUrl } }
        };
      }
      
      // Call Vision API for text detection
      console.log('Calling Vision API for text detection...');
      const [result] = await visionClient.textDetection(request);
      
      if (!result.textAnnotations || result.textAnnotations.length === 0) {
        return {
          success: false,
          error: 'No text detected in image',
          metrics: null
        };
      }
      
      const fullText = result.textAnnotations[0].description;
      const textBlocks = result.textAnnotations.slice(1);
      
      console.log('Raw OCR text:', fullText.substring(0, 500) + '...');
      
      // Detect device type if not provided
      const detectedDevice = deviceType || detectDeviceType(fullText);
      console.log('Detected device:', detectedDevice);
      
      // Parse metrics based on device type
      let metrics, confidence, warnings;
      
      switch (detectedDevice) {
        case 'trackman':
          ({ metrics, confidence, warnings } = parseTrackMan(fullText, textBlocks));
          break;
        case 'flightscope':
        case 'mevo':
          ({ metrics, confidence, warnings } = parseFlightScope(fullText, textBlocks));
          break;
        case 'garmin':
          ({ metrics, confidence, warnings } = parseGarmin(fullText, textBlocks));
          break;
        case 'skytrak':
          ({ metrics, confidence, warnings } = parseSkyTrak(fullText, textBlocks));
          break;
        default:
          ({ metrics, confidence, warnings } = parseGeneric(fullText, textBlocks));
      }
      
      // Validate extracted values
      const { validatedMetrics, validationWarnings } = validateMetrics(metrics, expectedClubType);
      warnings = [...warnings, ...validationWarnings];
      
      // Calculate field-level confidence
      const fieldConfidence = calculateFieldConfidence(validatedMetrics, fullText);
      
      // Log for analytics
      if (userId) {
        await logExtraction(userId, detectedDevice, Object.keys(validatedMetrics).length, confidence);
      }
      
      return {
        success: true,
        metrics: validatedMetrics,
        confidence,
        detectedDevice,
        rawText: fullText,
        warnings,
        fieldConfidence
      };
      
    } catch (error) {
      console.error('OCR extraction error:', error);
      throw new functions.https.HttpsError(
        'internal',
        'Failed to extract data: ' + error.message
      );
    }
  });

/**
 * Detect which launch monitor produced the image
 */
function detectDeviceType(text) {
  const textLower = text.toLowerCase();
  
  // TrackMan detection - look for distinctive elements
  if (textLower.includes('trackman') || 
      textLower.includes('shot analysis') ||
      (textLower.includes('smash fac') && textLower.includes('club path')) ||
      (textLower.includes('attack ang') && textLower.includes('face ang'))) {
    return 'trackman';
  }
  if (textLower.includes('flightscope') || textLower.includes('mevo')) {
    return 'flightscope';
  }
  if (textLower.includes('garmin') || textLower.includes('r10')) {
    return 'garmin';
  }
  if (textLower.includes('skytrak') || textLower.includes('sky trak')) {
    return 'skytrak';
  }
  if (textLower.includes('foresight') || textLower.includes('gcquad') || textLower.includes('gc3')) {
    return 'foresight';
  }
  if (textLower.includes('rapsodo') || textLower.includes('mlm')) {
    return 'rapsodo';
  }
  
  return 'unknown';
}

/**
 * Parse TrackMan display format
 * TrackMan shows data in a table with headers and an AVG row
 * Column order: ORDER, CARRY, TOTAL, SPIN RATE, CLUB SPEED, BALL SPEED, SMASH FAC, CLUB PATH, FACE ANG, ATTACK ANG, HEIGHT, LAUNCH ANG
 */
function parseTrackMan(fullText, textBlocks) {
  const metrics = {};
  const warnings = [];
  let fieldsFound = 0;
  
  // Try to find the AVG row which contains averaged data
  // AVG row format: "AVG 202.5 226.0 2850 88.4 129.1 1.46 3.0 2.4 3.3 79 15.5"
  const avgMatch = fullText.match(/AVG\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
  
  if (avgMatch) {
    console.log('Found TrackMan AVG row:', avgMatch[0]);
    // Map columns: CARRY, TOTAL, SPIN, CLUB_SPEED, BALL_SPEED, SMASH, PATH, FACE, ATTACK, HEIGHT, LAUNCH
    metrics.carry = parseFloat(avgMatch[1]);
    metrics.totalDistance = parseFloat(avgMatch[2]);
    metrics.spinRate = parseFloat(avgMatch[3]);
    metrics.clubSpeed = parseFloat(avgMatch[4]);
    metrics.ballSpeed = parseFloat(avgMatch[5]);
    metrics.smashFactor = parseFloat(avgMatch[6]);
    metrics.clubPath = parseFloat(avgMatch[7]);
    metrics.faceAngle = parseFloat(avgMatch[8]);
    metrics.attackAngle = parseFloat(avgMatch[9]);
    metrics.height = parseFloat(avgMatch[10]);
    metrics.launchAngle = parseFloat(avgMatch[11]);
    fieldsFound = 11;
  } else {
    // Try to find big display format (bottom of screen with large numbers)
    // Format: CARRY 208.3 | TOTAL 236.5 | SPIN RATE 1886 | CLUB SPEED 86.7 | BALL SPEED 128.1 | SMASH FAC. 1.48 | CLUB PATH 1.8
    console.log('No AVG row found, trying big display format...');
    
    // Look for large number displays with labels
    const bigPatterns = {
      carry: /CARRY\s*[\n\r]?\s*(\d+\.?\d*)/i,
      totalDistance: /TOTAL\s*[\n\r]?\s*(\d+\.?\d*)/i,
      spinRate: /SPIN\s*RATE\s*[\n\r]?\s*(\d+\.?\d*)/i,
      clubSpeed: /CLUB\s*SPEED\s*[\n\r]?\s*(\d+\.?\d*)/i,
      ballSpeed: /BALL\s*SPEED\s*[\n\r]?\s*(\d+\.?\d*)/i,
      smashFactor: /SMASH\s*FAC\.?\s*[\n\r]?\s*(\d+\.?\d*)/i,
      clubPath: /CLUB\s*PATH\s*[\n\r]?\s*([-\d]+\.?\d*)/i,
      faceAngle: /FACE\s*ANG\.?\s*[\n\r]?\s*([-\d]+\.?\d*)/i,
      attackAngle: /ATTACK\s*ANG\.?\s*[\n\r]?\s*([-\d]+\.?\d*)/i,
      launchAngle: /LAUNCH\s*ANG\.?\s*[\n\r]?\s*([-\d]+\.?\d*)/i,
      height: /HEIGHT\s*[\n\r]?\s*(\d+\.?\d*)/i
    };
    
    for (const [key, pattern] of Object.entries(bigPatterns)) {
      const match = fullText.match(pattern);
      if (match) {
        const value = parseFloat(match[1]);
        if (!isNaN(value)) {
          metrics[key] = value;
          fieldsFound++;
          console.log(`TrackMan big display: ${key} = ${value}`);
        }
      }
    }
  }
  
  // If still no luck, try generic number extraction with context
  if (fieldsFound < 4) {
    warnings.push('TrackMan format not fully recognized - using generic parser');
    return parseGeneric(fullText, textBlocks);
  }
  
  const expectedFields = 11;
  const confidence = Math.min(fieldsFound / expectedFields, 1.0);
  
  return { metrics, confidence, warnings };
}

/**
 * Parse FlightScope/Mevo display format
 */
function parseFlightScope(fullText, textBlocks) {
  const metrics = {};
  const warnings = [];
  let fieldsFound = 0;
  
  const patterns = {
    ballSpeed: /ball\s*speed[:\s]*(\d+\.?\d*)/i,
    carry: /carry[:\s]*(\d+\.?\d*)/i,
    totalDistance: /(?:total|distance)[:\s]*(\d+\.?\d*)/i,
    launchAngle: /(?:launch|vla)[:\s]*(-?\d+\.?\d*)/i,
    spinRate: /(?:spin|backspin)[:\s]*(\d+\.?\d*)/i,
    height: /(?:height|apex)[:\s]*(\d+\.?\d*)/i,
    clubSpeed: /(?:club|swing)\s*speed[:\s]*(\d+\.?\d*)/i,
    smashFactor: /smash[:\s]*(\d+\.?\d*)/i
  };
  
  for (const [key, pattern] of Object.entries(patterns)) {
    const match = fullText.match(pattern);
    if (match) {
      const value = parseFloat(match[1]);
      if (!isNaN(value)) {
        metrics[key] = value;
        fieldsFound++;
      }
    }
  }
  
  const confidence = Math.min(fieldsFound / 8, 1.0);
  
  return { metrics, confidence, warnings };
}

/**
 * Parse Garmin R10 display format
 */
function parseGarmin(fullText, textBlocks) {
  const metrics = {};
  const warnings = [];
  let fieldsFound = 0;
  
  const patterns = {
    ballSpeed: /ball\s*speed[:\s]*(\d+\.?\d*)/i,
    carry: /carry[:\s]*(\d+\.?\d*)/i,
    totalDistance: /total[:\s]*(\d+\.?\d*)/i,
    launchAngle: /launch[:\s]*(-?\d+\.?\d*)/i,
    spinRate: /spin[:\s]*(\d+\.?\d*)/i,
    clubSpeed: /(?:club|swing)\s*speed[:\s]*(\d+\.?\d*)/i,
    clubPath: /path[:\s]*(-?\d+\.?\d*)/i,
    faceAngle: /face[:\s]*(-?\d+\.?\d*)/i,
    smashFactor: /smash[:\s]*(\d+\.?\d*)/i
  };
  
  for (const [key, pattern] of Object.entries(patterns)) {
    const match = fullText.match(pattern);
    if (match) {
      const value = parseFloat(match[1]);
      if (!isNaN(value)) {
        metrics[key] = value;
        fieldsFound++;
      }
    }
  }
  
  const confidence = Math.min(fieldsFound / 8, 1.0);
  
  return { metrics, confidence, warnings };
}

/**
 * Parse SkyTrak display format
 */
function parseSkyTrak(fullText, textBlocks) {
  const metrics = {};
  const warnings = [];
  let fieldsFound = 0;
  
  const patterns = {
    ballSpeed: /ball\s*speed[:\s]*(\d+\.?\d*)/i,
    carry: /carry[:\s]*(\d+\.?\d*)/i,
    totalDistance: /total[:\s]*(\d+\.?\d*)/i,
    launchAngle: /launch[:\s]*(-?\d+\.?\d*)/i,
    spinRate: /(?:spin|backspin)[:\s]*(\d+\.?\d*)/i,
    spinAxis: /(?:side\s*spin|axis)[:\s]*(-?\d+\.?\d*)/i
  };
  
  for (const [key, pattern] of Object.entries(patterns)) {
    const match = fullText.match(pattern);
    if (match) {
      const value = parseFloat(match[1]);
      if (!isNaN(value)) {
        metrics[key] = value;
        fieldsFound++;
      }
    }
  }
  
  warnings.push('SkyTrak does not measure club delivery data');
  const confidence = Math.min(fieldsFound / 6, 1.0);
  
  return { metrics, confidence, warnings };
}

/**
 * Generic parser for unknown devices
 */
function parseGeneric(fullText, textBlocks) {
  const metrics = {};
  const warnings = ['Device type not detected - using generic parser'];
  let fieldsFound = 0;
  
  for (const [metricKey, labels] of Object.entries(METRIC_LABELS)) {
    for (const label of labels) {
      const pattern = new RegExp(label + '[:\\s]*(-?\\d+\\.?\\d*)', 'i');
      const match = fullText.match(pattern);
      
      if (match && !metrics[metricKey]) {
        const value = parseFloat(match[1]);
        if (!isNaN(value)) {
          metrics[metricKey] = value;
          fieldsFound++;
          break;
        }
      }
    }
  }
  
  const confidence = Math.min(fieldsFound / 10, 1.0) * 0.8;
  
  return { metrics, confidence, warnings };
}

/**
 * Validate extracted metrics against known ranges
 */
function validateMetrics(metrics, clubType) {
  const validatedMetrics = {};
  const warnings = [];
  
  for (const [key, value] of Object.entries(metrics)) {
    const range = VALIDATION_RANGES[key];
    
    if (!range) {
      validatedMetrics[key] = value;
      continue;
    }
    
    if (value < range.min || value > range.max) {
      warnings.push(`${key}: ${value} outside expected range (${range.min}-${range.max} ${range.unit})`);
    }
    validatedMetrics[key] = value;
  }
  
  // Club-type specific validation
  if (clubType) {
    const clubLower = clubType.toLowerCase();
    
    if (clubLower === 'driver') {
      if (validatedMetrics.carry && validatedMetrics.carry < 150) {
        warnings.push('Carry distance seems low for driver');
      }
      if (validatedMetrics.launchAngle && validatedMetrics.launchAngle < 8) {
        warnings.push('Launch angle may be too low for driver');
      }
    }
    
    if (clubLower.includes('wedge')) {
      if (validatedMetrics.spinRate && validatedMetrics.spinRate < 4000) {
        warnings.push('Spin rate seems low for wedge');
      }
    }
  }
  
  return { validatedMetrics, validationWarnings: warnings };
}

/**
 * Calculate confidence for each extracted field
 */
function calculateFieldConfidence(metrics, fullText) {
  const fieldConfidence = {};
  
  for (const key of Object.keys(metrics)) {
    const labels = METRIC_LABELS[key] || [key];
    let found = false;
    
    for (const label of labels) {
      if (fullText.toLowerCase().includes(label)) {
        found = true;
        break;
      }
    }
    
    fieldConfidence[key] = found ? 0.95 : 0.75;
  }
  
  return fieldConfidence;
}

/**
 * Log extraction for analytics
 */
async function logExtraction(userId, deviceType, fieldsExtracted, confidence) {
  try {
    await admin.firestore().collection('ocrExtractions').add({
      userId,
      deviceType,
      fieldsExtracted,
      confidence,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('Failed to log extraction:', error);
  }
}

/**
 * Get validation ranges (for frontend use)
 */
exports.getValidationRanges = functions.https.onCall(async (data, context) => {
  return VALIDATION_RANGES;
});
