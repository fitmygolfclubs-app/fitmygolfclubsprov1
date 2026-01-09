/**
 * FitMyGolfClubs Pro - Scenario Functions
 * 
 * All scenario-related Cloud Functions in one file:
 * - runScenario: Grade current vs virtual bag
 * - saveScenario: Save scenario (max 5)
 * - getSavedScenarios: List saved scenarios
 * - deleteSavedScenario: Delete a scenario
 * - applyScenario: Apply swaps to real bag
 * 
 * Date: January 7, 2026
 */

const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { sanitizeUserId, sanitizeText } = require("./sanitization");

// ==========================================
// CONSTANTS
// ==========================================

const MAX_SWAPS = 7;
const MAX_SAVED_SCENARIOS = 5;
const CREDIT_COST = 1;

const DEFAULT_WEIGHTS = {
  age: 0.20,
  weight_progression: 0.20,
  loft_gapping: 0.20,
  flex_consistency: 0.05,
  kickpoint_consistency: 0.10,
  torque_consistency: 0.05,
  length_progression: 0.10,
  lie_angle_progression: 0.10
};

const CLUB_ORDER = {
  'driver': 1,
  '3wood': 2, '3-wood': 2,
  '5wood': 3, '5-wood': 3,
  '7wood': 4, '7-wood': 4,
  '2hybrid': 5, '2-hybrid': 5,
  '3hybrid': 6, '3-hybrid': 6,
  '4hybrid': 7, '4-hybrid': 7,
  '5hybrid': 8, '5-hybrid': 8,
  '6hybrid': 9, '6-hybrid': 9,
  '2iron': 10, '2-iron': 10,
  '3iron': 11, '3-iron': 11,
  '4iron': 12, '4-iron': 12,
  '5iron': 13, '5-iron': 13,
  '6iron': 14, '6-iron': 14,
  '7iron': 15, '7-iron': 15,
  '8iron': 16, '8-iron': 16,
  '9iron': 17, '9-iron': 17,
  'pw': 18, 'pitching wedge': 18,
  'gw': 19, 'gap wedge': 19, 'aw': 19,
  'sw': 20, 'sand wedge': 20,
  'lw': 21, 'lob wedge': 21,
  'putter': 22
};

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function normalizeClubData(club) {
  const lieValue = club.lie || club.lie_angle || null;
  return {
    ...club,
    clubType: club.clubType || club.club_type || null,
    brand: club.brand || club.identification?.brand || null,
    model: club.model || club.identification?.model || null,
    year: club.year || club.identification?.year || null,
    loft: club.loft || null,
    length: club.length || null,
    lie: lieValue,
    shaft_weight: club.shaft?.weight || club.shaft_weight || null,
    shaft_flex: club.shaft?.flex || club.shaft_flex || null,
    shaft_kickpoint: club.shaft?.kickpoint || club.shaft_kickpoint || null,
    shaft_torque: club.shaft?.torque || club.shaft_torque || null,
    shaft_brand: club.shaft?.brand || club.shaft_brand || null,
    shaft_model: club.shaft?.model || club.shaft_model || null,
    is_favorite: club.is_favorite || false,
    status: club.status || 'active'
  };
}

function sortClubsByType(clubs) {
  return [...clubs].sort((a, b) => {
    const aType = (a.clubType || '').toLowerCase().replace(/[\s-]/g, '');
    const bType = (b.clubType || '').toLowerCase().replace(/[\s-]/g, '');
    return (CLUB_ORDER[aType] || 99) - (CLUB_ORDER[bType] || 99);
  });
}

function scoreToGrade(score) {
  if (score >= 97) return "A+";
  if (score >= 93) return "A";
  if (score >= 90) return "A-";
  if (score >= 87) return "B+";
  if (score >= 83) return "B";
  if (score >= 80) return "B-";
  if (score >= 77) return "C+";
  if (score >= 73) return "C";
  if (score >= 70) return "C-";
  if (score >= 67) return "D+";
  if (score >= 65) return "D";
  return "F";
}

function normalizeFlexValue(flex) {
  if (!flex) return null;
  const f = String(flex).toLowerCase().trim();
  if (f.includes('x') && f.includes('stiff')) return 'X';
  if (f === 'x' || f === 'extra stiff') return 'X';
  if (f === 's' || f === 'stiff') return 'S';
  if (f === 'r' || f === 'regular') return 'R';
  if (f === 'a' || f === 'senior') return 'A';
  if (f === 'l' || f === 'ladies') return 'L';
  return f.toUpperCase();
}

function normalizeKickpoint(kp) {
  if (!kp) return null;
  const k = String(kp).toLowerCase().trim();
  if (k.includes('low')) return 'low';
  if (k.includes('mid')) return 'mid';
  if (k.includes('high')) return 'high';
  return k;
}

// ==========================================
// SCORING FUNCTIONS
// ==========================================

function calculateAgeScore(clubs) {
  const currentYear = new Date().getFullYear();
  let totalScore = 0;
  let clubsWithYear = 0;
  const issues = [];
  
  clubs.forEach(club => {
    const year = club.year;
    if (year && !isNaN(year)) {
      clubsWithYear++;
      const age = currentYear - year;
      let clubScore = Math.max(50, 100 - (age * 5));
      totalScore += clubScore;
      if (age > 7) {
        issues.push(`${club.clubType}: ${age} years old - consider updating`);
      }
    }
  });
  
  return {
    score: clubsWithYear > 0 ? Math.round(totalScore / clubsWithYear) : 75,
    issues,
    scorable: clubsWithYear > 0
  };
}

function calculateWeightProgression(clubs, favoriteClubSpecs = null) {
  const clubsWithWeight = clubs.filter(c => c.shaft_weight && c.shaft_weight > 0);
  const issues = [];
  
  if (clubsWithWeight.length < 2) {
    return { score: 75, issues: [], scorable: false };
  }
  
  const sorted = sortClubsByType(clubsWithWeight);
  let totalPenalty = 0;
  
  for (let i = 1; i < sorted.length; i++) {
    const prevWeight = sorted[i - 1].shaft_weight;
    const currWeight = sorted[i].shaft_weight;
    const gap = currWeight - prevWeight;
    
    if (gap < -5) {
      totalPenalty += Math.abs(gap) * 2;
      issues.push(`${sorted[i].clubType} shaft (${currWeight}g) lighter than ${sorted[i-1].clubType} (${prevWeight}g)`);
    } else if (gap > 25) {
      totalPenalty += (gap - 15);
      issues.push(`Large weight gap: ${sorted[i-1].clubType} to ${sorted[i].clubType}`);
    }
  }
  
  return {
    score: Math.round(Math.max(0, Math.min(100, 100 - totalPenalty))),
    issues,
    scorable: true
  };
}

function calculateLoftGapping(clubs) {
  const clubsWithLoft = clubs.filter(c => c.loft && c.loft > 0);
  const issues = [];
  
  if (clubsWithLoft.length < 2) {
    return { score: 75, issues: [], scorable: false };
  }
  
  const sorted = [...clubsWithLoft].sort((a, b) => a.loft - b.loft);
  let totalPenalty = 0;
  
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].loft - sorted[i - 1].loft;
    if (gap < 2) {
      totalPenalty += 2;
    } else if (gap > 6) {
      totalPenalty += (gap - 4) * 3;
      issues.push(`Large loft gap: ${sorted[i-1].clubType} (${sorted[i-1].loft}°) to ${sorted[i].clubType} (${sorted[i].loft}°)`);
    }
  }
  
  return {
    score: Math.round(Math.max(0, Math.min(100, 100 - totalPenalty))),
    issues,
    scorable: true
  };
}

function calculateFlexConsistency(clubs) {
  const flexMap = {};
  const issues = [];
  
  clubs.forEach(club => {
    const flex = normalizeFlexValue(club.shaft_flex);
    if (flex) flexMap[flex] = (flexMap[flex] || 0) + 1;
  });
  
  const flexTypes = Object.keys(flexMap);
  if (flexTypes.length === 0) return { score: 75, issues: [], scorable: false };
  if (flexTypes.length === 1) return { score: 100, issues: [], scorable: true };
  
  let maxCount = Math.max(...Object.values(flexMap));
  const totalClubs = Object.values(flexMap).reduce((a, b) => a + b, 0);
  const penalty = (totalClubs - maxCount) * 15;
  
  if (flexTypes.length > 1) {
    issues.push(`Mixed flex: ${flexTypes.length} different flex ratings in bag`);
  }
  
  return {
    score: Math.round(Math.max(0, 100 - penalty)),
    issues,
    scorable: true
  };
}

function calculateKickpointConsistency(clubs) {
  const kpMap = {};
  const issues = [];
  
  clubs.forEach(club => {
    const kp = normalizeKickpoint(club.shaft_kickpoint);
    if (kp) kpMap[kp] = (kpMap[kp] || 0) + 1;
  });
  
  const kpTypes = Object.keys(kpMap);
  if (kpTypes.length === 0) return { score: 75, issues: [], scorable: false };
  if (kpTypes.length === 1) return { score: 100, issues: [], scorable: true };
  
  const penalty = (kpTypes.length - 1) * 20;
  if (kpTypes.length > 1) issues.push(`Mixed kickpoints: ${kpTypes.join(', ')}`);
  
  return {
    score: Math.round(Math.max(0, 100 - penalty)),
    issues,
    scorable: true
  };
}

function calculateTorqueConsistency(clubs) {
  const torqueValues = clubs.filter(c => c.shaft_torque > 0).map(c => c.shaft_torque);
  
  if (torqueValues.length < 2) return { score: 75, issues: [], scorable: false };
  
  const avg = torqueValues.reduce((a, b) => a + b, 0) / torqueValues.length;
  const variance = torqueValues.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / torqueValues.length;
  const stdDev = Math.sqrt(variance);
  
  const issues = [];
  if (stdDev > 1) issues.push(`Torque variation: ${stdDev.toFixed(1)}° std dev`);
  
  return {
    score: Math.round(Math.max(0, Math.min(100, 100 - stdDev * 10))),
    issues,
    scorable: true
  };
}

function calculateLengthProgression(clubs) {
  const clubsWithLength = clubs.filter(c => c.length && c.length > 0);
  const issues = [];
  
  if (clubsWithLength.length < 2) return { score: 75, issues: [], scorable: false };
  
  const sorted = sortClubsByType(clubsWithLength);
  let totalPenalty = 0;
  
  for (let i = 1; i < sorted.length; i++) {
    const diff = sorted[i - 1].length - sorted[i].length;
    if (diff < -0.5) {
      totalPenalty += Math.abs(diff) * 15;
      issues.push(`${sorted[i].clubType} longer than ${sorted[i-1].clubType}`);
    } else if (diff > 1.5) {
      totalPenalty += (diff - 0.5) * 5;
    }
  }
  
  return {
    score: Math.round(Math.max(0, Math.min(100, 100 - totalPenalty))),
    issues,
    scorable: true
  };
}

function calculateLieAngleProgression(clubs) {
  const clubsWithLie = clubs.filter(c => c.lie && c.lie > 0);
  const issues = [];
  
  if (clubsWithLie.length < 2) return { score: 75, issues: [], scorable: false };
  
  const sorted = sortClubsByType(clubsWithLie);
  let totalPenalty = 0;
  
  for (let i = 1; i < sorted.length; i++) {
    const diff = sorted[i].lie - sorted[i - 1].lie;
    if (diff < -1) {
      totalPenalty += Math.abs(diff) * 5;
      issues.push(`Lie angle drops: ${sorted[i-1].clubType} to ${sorted[i].clubType}`);
    }
  }
  
  return {
    score: Math.round(Math.max(0, Math.min(100, 100 - totalPenalty))),
    issues,
    scorable: true
  };
}

// ==========================================
// CORE GRADING FUNCTION
// ==========================================

function gradeClubsArray(clubs, weights = DEFAULT_WEIGHTS) {
  const normalizedClubs = clubs.map(club => normalizeClubData(club));
  const sortedClubs = sortClubsByType(normalizedClubs);
  
  const scores = {
    age: calculateAgeScore(sortedClubs),
    weight: calculateWeightProgression(sortedClubs),
    loft: calculateLoftGapping(sortedClubs),
    flex: calculateFlexConsistency(sortedClubs),
    kickpoint: calculateKickpointConsistency(sortedClubs),
    torque: calculateTorqueConsistency(sortedClubs),
    length: calculateLengthProgression(sortedClubs),
    lie: calculateLieAngleProgression(sortedClubs)
  };
  
  const overallScore = Math.round(
    (scores.age.score * weights.age) +
    (scores.weight.score * weights.weight_progression) +
    (scores.loft.score * weights.loft_gapping) +
    (scores.flex.score * weights.flex_consistency) +
    (scores.kickpoint.score * weights.kickpoint_consistency) +
    (scores.torque.score * weights.torque_consistency) +
    (scores.length.score * weights.length_progression) +
    (scores.lie.score * weights.lie_angle_progression)
  );
  
  return {
    overall_score: overallScore,
    overall_grade: scoreToGrade(overallScore),
    component_scores: {
      age: { score: scores.age.score, grade: scoreToGrade(scores.age.score) },
      weight_progression: { score: scores.weight.score, grade: scoreToGrade(scores.weight.score) },
      loft_gapping: { score: scores.loft.score, grade: scoreToGrade(scores.loft.score) },
      flex_consistency: { score: scores.flex.score, grade: scoreToGrade(scores.flex.score) },
      kickpoint_consistency: { score: scores.kickpoint.score, grade: scoreToGrade(scores.kickpoint.score) },
      torque_consistency: { score: scores.torque.score, grade: scoreToGrade(scores.torque.score) },
      length_progression: { score: scores.length.score, grade: scoreToGrade(scores.length.score) },
      lie_angle_progression: { score: scores.lie.score, grade: scoreToGrade(scores.lie.score) }
    },
    issues: [
      ...scores.age.issues, ...scores.weight.issues, ...scores.loft.issues,
      ...scores.flex.issues, ...scores.kickpoint.issues, ...scores.torque.issues,
      ...scores.length.issues, ...scores.lie.issues
    ]
  };
}

function applySwapsToClubs(clubs, swaps) {
  const virtualClubs = clubs.map(club => ({ ...club }));
  
  swaps.forEach(swap => {
    const index = virtualClubs.findIndex(c => c.id === swap.club_id);
    if (index !== -1) {
      const original = virtualClubs[index];
      virtualClubs[index] = {
        id: original.id,
        clubType: swap.replacement.clubType || original.clubType,
        ...swap.replacement
      };
    }
  });
  
  return virtualClubs;
}

function calculateFactorChanges(current, projected) {
  const factors = ['age', 'weight_progression', 'loft_gapping', 'flex_consistency',
    'kickpoint_consistency', 'torque_consistency', 'length_progression', 'lie_angle_progression'];
  
  return factors.map(factor => {
    const fromScore = current.component_scores[factor]?.score || 0;
    const toScore = projected.component_scores[factor]?.score || 0;
    let status = 'same';
    if (toScore > fromScore + 2) status = 'improved';
    else if (toScore < fromScore - 2) status = 'declined';
    
    return {
      factor,
      from_score: fromScore,
      to_score: toScore,
      from_grade: current.component_scores[factor]?.grade || 'N/A',
      to_grade: projected.component_scores[factor]?.grade || 'N/A',
      status
    };
  });
}

function generateScenarioSummary(currentResult, projectedResult, factorChanges) {
  const scoreDiff = projectedResult.overall_score - currentResult.overall_score;
  const improved = factorChanges.filter(c => c.status === 'improved');
  const declined = factorChanges.filter(c => c.status === 'declined');
  
  let summary = '';
  
  if (scoreDiff > 5) {
    summary += `Significant improvement (+${scoreDiff} points): ${currentResult.overall_grade} → ${projectedResult.overall_grade}. `;
  } else if (scoreDiff > 0) {
    summary += `Modest improvement (+${scoreDiff} points). `;
  } else if (scoreDiff < -5) {
    summary += `This would decrease your grade (${scoreDiff} points). Consider a different approach. `;
  } else if (scoreDiff < 0) {
    summary += `Slight decrease (${scoreDiff} points). `;
  } else {
    summary += `Minimal impact on overall grade. `;
  }
  
  if (improved.length > 0) {
    summary += `Improved: ${improved.map(f => f.factor.replace(/_/g, ' ')).join(', ')}. `;
  }
  if (declined.length > 0) {
    summary += `Note: ${declined.map(f => f.factor.replace(/_/g, ' ')).join(', ')} would decline. `;
  }
  
  return summary;
}

// ==========================================
// CLOUD FUNCTION: runScenario
// ==========================================

exports.runScenario = onRequest({
  timeoutSeconds: 60,
  memory: "512MiB",
  cors: true
}, async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  try {
    const rawUserId = req.body.user_id;
    const swaps = req.body.swaps;
    
    if (!rawUserId || typeof rawUserId !== 'string') {
      res.status(400).json({ error: 'Missing or invalid user_id' });
      return;
    }
    
    const userId = sanitizeUserId(rawUserId);
    
    if (!swaps || !Array.isArray(swaps) || swaps.length === 0) {
      res.status(400).json({ error: 'Missing or invalid swaps array' });
      return;
    }
    
    if (swaps.length > MAX_SWAPS) {
      res.status(400).json({ error: `Maximum ${MAX_SWAPS} swaps allowed per scenario` });
      return;
    }
    
    for (let i = 0; i < swaps.length; i++) {
      if (!swaps[i].club_id || !swaps[i].replacement) {
        res.status(400).json({ error: `Swap ${i + 1}: Missing club_id or replacement` });
        return;
      }
    }
    
    logger.info(`Running scenario for user ${userId} with ${swaps.length} swap(s)`);
    
    const db = admin.firestore();
    const clubsSnapshot = await db.collection("users").doc(userId).collection("clubs").get();
    
    if (clubsSnapshot.empty) {
      res.status(404).json({ error: 'No clubs found for this user' });
      return;
    }
    
    const clubs = [];
    clubsSnapshot.forEach(doc => clubs.push({ id: doc.id, ...doc.data() }));
    
    // Validate swap club_ids exist
    for (const swap of swaps) {
      if (!clubs.some(c => c.id === swap.club_id)) {
        res.status(400).json({ error: `Club ${swap.club_id} not found in user's bag` });
        return;
      }
    }
    
    // Fetch grading weights
    let gradingWeights = DEFAULT_WEIGHTS;
    try {
      const versionsSnapshot = await db.collection("algorithmVersions")
        .where("status", "==", "active").where("isDefault", "==", true).limit(1).get();
      if (!versionsSnapshot.empty) {
        gradingWeights = versionsSnapshot.docs[0].data().config?.gradingWeights || DEFAULT_WEIGHTS;
      }
    } catch (e) { logger.warn('Using default weights'); }
    
    // Grade current and virtual bags
    const currentResult = gradeClubsArray(clubs, gradingWeights);
    const virtualClubs = applySwapsToClubs(clubs, swaps);
    const projectedResult = gradeClubsArray(virtualClubs, gradingWeights);
    
    const factorChanges = calculateFactorChanges(currentResult, projectedResult);
    const aiSummary = generateScenarioSummary(currentResult, projectedResult, factorChanges);
    
    logger.info(`Scenario complete: ${currentResult.overall_grade} → ${projectedResult.overall_grade}`);
    
    res.status(200).json({
      success: true,
      credit_used: CREDIT_COST,
      current: {
        overall_score: currentResult.overall_score,
        overall_grade: currentResult.overall_grade,
        component_scores: currentResult.component_scores
      },
      projected: {
        overall_score: projectedResult.overall_score,
        overall_grade: projectedResult.overall_grade,
        component_scores: projectedResult.component_scores
      },
      factor_changes: factorChanges,
      ai_summary: aiSummary,
      swaps_applied: swaps.length
    });
    
  } catch (error) {
    logger.error("Error running scenario:", error);
    res.status(500).json({ error: "Failed to run scenario", details: error.message });
  }
});

// ==========================================
// CLOUD FUNCTION: saveScenario
// ==========================================

exports.saveScenario = onRequest({
  timeoutSeconds: 30,
  memory: "256MiB",
  cors: true
}, async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  try {
    const userId = sanitizeUserId(req.body.user_id);
    const name = sanitizeText(req.body.name || 'Unnamed Scenario', 100);
    const swaps = req.body.swaps;
    
    if (!swaps || !Array.isArray(swaps) || swaps.length === 0) {
      res.status(400).json({ error: 'Missing or invalid swaps' });
      return;
    }
    
    const db = admin.firestore();
    const existingSnapshot = await db.collection("users").doc(userId)
      .collection("scenarios").orderBy("created_at", "desc").get();
    
    if (existingSnapshot.size >= MAX_SAVED_SCENARIOS) {
      res.status(400).json({ 
        error: `Maximum ${MAX_SAVED_SCENARIOS} saved scenarios allowed`,
        scenarios_count: existingSnapshot.size
      });
      return;
    }
    
    const swapSummaries = swaps.map(swap => ({
      club_id: swap.club_id,
      club_summary: swap.club_summary || `Club ${swap.club_id}`,
      replacement_summary: swap.replacement ? 
        `${swap.replacement.brand || ''} ${swap.replacement.model || ''}`.trim() || 'New Club' : 'New Club'
    }));
    
    const docRef = await db.collection("users").doc(userId).collection("scenarios").add({
      name,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      swaps: swapSummaries,
      swaps_count: swaps.length,
      current_grade: req.body.current_grade,
      current_score: req.body.current_score,
      projected_grade: req.body.projected_grade,
      projected_score: req.body.projected_score,
      grade_improved: (req.body.projected_score || 0) > (req.body.current_score || 0)
    });
    
    res.status(200).json({
      success: true,
      scenario_id: docRef.id,
      scenarios_count: existingSnapshot.size + 1,
      max_scenarios: MAX_SAVED_SCENARIOS
    });
    
  } catch (error) {
    logger.error("Error saving scenario:", error);
    res.status(500).json({ error: "Failed to save scenario", details: error.message });
  }
});

// ==========================================
// CLOUD FUNCTION: getSavedScenarios
// ==========================================

exports.getSavedScenarios = onRequest({
  timeoutSeconds: 30,
  memory: "256MiB",
  cors: true
}, async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  try {
    const rawUserId = req.body.user_id || req.query.user_id;
    const userId = sanitizeUserId(rawUserId);
    
    const db = admin.firestore();
    const snapshot = await db.collection("users").doc(userId)
      .collection("scenarios").orderBy("created_at", "desc").get();
    
    const scenarios = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      scenarios.push({
        id: doc.id,
        name: data.name || 'Unnamed Scenario',
        created_at: data.created_at?.toDate?.()?.toISOString() || null,
        swaps_count: data.swaps_count || data.swaps?.length || 0,
        swaps: data.swaps || [],
        current_grade: data.current_grade,
        current_score: data.current_score,
        projected_grade: data.projected_grade,
        projected_score: data.projected_score,
        grade_improved: data.grade_improved
      });
    });
    
    res.status(200).json({
      success: true,
      scenarios,
      count: scenarios.length,
      max_allowed: MAX_SAVED_SCENARIOS,
      can_save_more: scenarios.length < MAX_SAVED_SCENARIOS
    });
    
  } catch (error) {
    logger.error("Error fetching scenarios:", error);
    res.status(500).json({ error: "Failed to fetch scenarios", details: error.message });
  }
});

// ==========================================
// CLOUD FUNCTION: deleteSavedScenario
// ==========================================

exports.deleteSavedScenario = onRequest({
  timeoutSeconds: 30,
  memory: "256MiB",
  cors: true
}, async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, DELETE, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  try {
    const userId = sanitizeUserId(req.body.user_id);
    const scenarioId = sanitizeText(req.body.scenario_id, 50);
    
    const db = admin.firestore();
    const scenarioRef = db.collection("users").doc(userId).collection("scenarios").doc(scenarioId);
    const scenarioDoc = await scenarioRef.get();
    
    if (!scenarioDoc.exists) {
      res.status(404).json({ error: 'Scenario not found' });
      return;
    }
    
    await scenarioRef.delete();
    
    const remainingSnapshot = await db.collection("users").doc(userId).collection("scenarios").get();
    
    res.status(200).json({
      success: true,
      deleted_scenario_id: scenarioId,
      scenarios_remaining: remainingSnapshot.size
    });
    
  } catch (error) {
    logger.error("Error deleting scenario:", error);
    res.status(500).json({ error: "Failed to delete scenario", details: error.message });
  }
});

// ==========================================
// CLOUD FUNCTION: applyScenario
// ==========================================

exports.applyScenario = onRequest({
  timeoutSeconds: 60,
  memory: "256MiB",
  cors: true
}, async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  try {
    const userId = sanitizeUserId(req.body.user_id);
    const swaps = req.body.swaps;
    
    if (!swaps || !Array.isArray(swaps) || swaps.length === 0) {
      res.status(400).json({ error: 'Missing or invalid swaps' });
      return;
    }
    
    const db = admin.firestore();
    const clubsRef = db.collection("users").doc(userId).collection("clubs");
    
    // Verify clubs exist
    for (const swap of swaps) {
      const clubDoc = await clubsRef.doc(swap.club_id).get();
      if (!clubDoc.exists) {
        res.status(404).json({ error: `Club ${swap.club_id} not found` });
        return;
      }
    }
    
    // Apply swaps
    const batch = db.batch();
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const updateResults = [];
    
    for (const swap of swaps) {
      const clubRef = clubsRef.doc(swap.club_id);
      const updateData = { updated_at: timestamp, scenario_applied_at: timestamp };
      
      const fieldMap = {
        brand: 'brand', model: 'model', year: 'year', loft: 'loft', length: 'length', lie: 'lie',
        shaft_weight: 'shaft_weight', shaft_flex: 'shaft_flex', shaft_kickpoint: 'shaft_kickpoint',
        shaft_torque: 'shaft_torque', shaft_brand: 'shaft_brand', shaft_model: 'shaft_model'
      };
      
      Object.entries(fieldMap).forEach(([src, dest]) => {
        if (swap.replacement[src] !== undefined && swap.replacement[src] !== null) {
          updateData[dest] = swap.replacement[src];
        }
      });
      
      batch.update(clubRef, updateData);
      updateResults.push({ club_id: swap.club_id, fields_updated: Object.keys(updateData).length - 2 });
    }
    
    await batch.commit();
    
    // Log change history
    try {
      await db.collection("users").doc(userId).collection("bag_change_history").add({
        change_type: 'scenario_applied',
        swaps_count: swaps.length,
        applied_at: timestamp,
        created_at: timestamp
      });
    } catch (e) { logger.warn('Could not log change history'); }
    
    res.status(200).json({
      success: true,
      clubs_updated: swaps.length,
      updates: updateResults,
      message: `Updated ${swaps.length} club(s). Re-grade your bag to see the new score.`,
      next_step: 'regrade'
    });
    
  } catch (error) {
    logger.error("Error applying scenario:", error);
    res.status(500).json({ error: "Failed to apply scenario", details: error.message });
  }
});
