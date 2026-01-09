/**
 * Input Sanitization Library for FitMyGolfClubs
 * CRITICAL SECURITY: Use these functions to sanitize ALL user input
 */

function sanitizeText(text, maxLength = 100) {
  if (!text || typeof text !== 'string') return '';
  return text.trim().slice(0, maxLength)
    .replace(/<[^>]*>/g, '')
    .replace(/[<>"'`]/g, '')
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '');
}

function sanitizeNumber(value, min = 0, max = 999999) {
  const num = parseFloat(value);
  if (isNaN(num)) return null;
  if (num < min || num > max) return null;
  return num;
}

function sanitizeInteger(value, min = 0, max = 999999) {
  const num = parseInt(value, 10);
  if (isNaN(num)) return null;
  if (num < min || num > max) return null;
  return num;
}

function sanitizeUserId(userId) {
  if (!userId || typeof userId !== 'string') {
    throw new Error('Invalid userId');
  }
  const sanitized = userId.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  if (sanitized.length < 20 || sanitized.length > 128) {
    throw new Error('Invalid userId format');
  }
  return sanitized;
}

function sanitizeClubType(type) {
  const validTypes = ['driver', '3-wood', '5-wood', '7-wood', '9-wood',
    '2-hybrid', '3-hybrid', '4-hybrid', '5-hybrid', '6-hybrid',
    '1-iron', '2-iron', '3-iron', '4-iron', '5-iron', '6-iron',
    '7-iron', '8-iron', '9-iron', 'pitching-wedge', 'gap-wedge',
    'sand-wedge', 'lob-wedge', 'putter'];
  if (!type || typeof type !== 'string') return null;
  const normalized = type.toLowerCase().trim();
  return validTypes.includes(normalized) ? normalized : null;
}

function sanitizeShaftFlex(flex) {
  const validFlex = ['L', 'A', 'R', 'S', 'X', 'XS', 'TX'];
  if (!flex || typeof flex !== 'string') return null;
  const normalized = flex.toUpperCase().trim();
  return validFlex.includes(normalized) ? normalized : null;
}

function sanitizeYear(year) {
  return sanitizeInteger(year, 1990, 2026);
}

function sanitizeShaftWeight(weight) {
  return sanitizeNumber(weight, 30, 200);
}

function sanitizeLoft(loft) {
  return sanitizeNumber(loft, 0, 90);
}

function sanitizeLength(length) {
  return sanitizeNumber(length, 30, 50);
}

function sanitizeHandicap(handicap) {
  return sanitizeNumber(handicap, -10, 54);
}

function sanitizeSwingSpeed(speed) {
  return sanitizeNumber(speed, 50, 150);
}

function sanitizeClubData(clubData) {
  if (!clubData.userId || !clubData.clubType) {
    throw new Error('Missing required fields: userId and clubType');
  }
  const sanitized = {
    userId: sanitizeUserId(clubData.userId),
    clubType: sanitizeClubType(clubData.clubType),
    brand: sanitizeText(clubData.brand, 50),
    model: sanitizeText(clubData.model, 50),
    year: clubData.year ? sanitizeYear(clubData.year) : null,
    shaftWeight: clubData.shaftWeight ? sanitizeShaftWeight(clubData.shaftWeight) : null,
    shaftFlex: clubData.shaftFlex ? sanitizeShaftFlex(clubData.shaftFlex) : null,
    loft: clubData.loft ? sanitizeLoft(clubData.loft) : null,
    length: clubData.length ? sanitizeLength(clubData.length) : null,
    createdAt: clubData.createdAt || new Date(),
    updatedAt: new Date()
  };
  Object.keys(sanitized).forEach(key => {
    if (sanitized[key] === null) delete sanitized[key];
  });
  return sanitized;
}

module.exports = {
  sanitizeText,
  sanitizeNumber,
  sanitizeInteger,
  sanitizeUserId,
  sanitizeYear,
  sanitizeClubType,
  sanitizeShaftFlex,
  sanitizeShaftWeight,
  sanitizeLoft,
  sanitizeLength,
  sanitizeHandicap,
  sanitizeSwingSpeed,
  sanitizeClubData
};