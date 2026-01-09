/**
 * Firebase Migration Script
 * Copies collections from fitmygolfclubs (production) to fitmygolfclubs-pro-dev (sandbox)
 * 
 * SAFETY: Production database is READ-ONLY - no deletes, no modifications
 */

const admin = require('firebase-admin');

// Initialize Production (SOURCE) - READ ONLY
const prodApp = admin.initializeApp({
  credential: admin.credential.cert(require('./fitmygolfclubs-prod.json'))
}, 'production');

// Initialize Sandbox (TARGET) - WRITE
const sandboxApp = admin.initializeApp({
  credential: admin.credential.cert(require('./fitmygolfclubs-sandbox.json'))
}, 'sandbox');

const prodDb = prodApp.firestore();
const sandboxDb = sandboxApp.firestore();

// Collections to copy
const COLLECTIONS_TO_COPY = [
  'validationRanges',
  'config',
  'aiRecommendationRules',
  'ai_recommendations',
  'algorithmVersions',
  'clubTypeReference',
  'autocomplete',
  'clubHeadSpecs',        // Large - will batch
  'shaftSpecDatabase',    // Large - will batch
];

// Batch size for large collections
const BATCH_SIZE = 500;

/**
 * Copy a single collection from production to sandbox
 */
async function copyCollection(collectionName) {
  console.log(`\n📂 Starting: ${collectionName}`);
  
  let docCount = 0;
  let batch = sandboxDb.batch();
  let batchCount = 0;
  
  try {
    // READ from production
    const snapshot = await prodDb.collection(collectionName).get();
    
    if (snapshot.empty) {
      console.log(`   ⚠️  Collection ${collectionName} is empty, skipping`);
      return 0;
    }
    
    console.log(`   📖 Reading ${snapshot.size} documents from production...`);
    
    for (const doc of snapshot.docs) {
      // WRITE to sandbox
      const targetRef = sandboxDb.collection(collectionName).doc(doc.id);
      batch.set(targetRef, doc.data());
      
      docCount++;
      batchCount++;
      
      // Commit batch when it reaches BATCH_SIZE
      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        console.log(`   ✅ Committed batch: ${docCount} documents so far`);
        batch = sandboxDb.batch();
        batchCount = 0;
      }
    }
    
    // Commit remaining documents
    if (batchCount > 0) {
      await batch.commit();
    }
    
    console.log(`   ✅ Completed: ${docCount} documents copied`);
    return docCount;
    
  } catch (error) {
    console.error(`   ❌ Error copying ${collectionName}:`, error.message);
    return 0;
  }
}

/**
 * Copy subcollections (for users/clubs if needed later)
 */
async function copyCollectionWithSubcollections(collectionName, subcollectionNames) {
  console.log(`\n📂 Starting: ${collectionName} (with subcollections)`);
  
  let totalDocs = 0;
  
  try {
    const snapshot = await prodDb.collection(collectionName).get();
    
    if (snapshot.empty) {
      console.log(`   ⚠️  Collection ${collectionName} is empty, skipping`);
      return 0;
    }
    
    console.log(`   📖 Found ${snapshot.size} parent documents`);
    
    for (const doc of snapshot.docs) {
      // Copy parent document
      await sandboxDb.collection(collectionName).doc(doc.id).set(doc.data());
      totalDocs++;
      
      // Copy subcollections
      for (const subName of subcollectionNames) {
        const subSnapshot = await prodDb
          .collection(collectionName)
          .doc(doc.id)
          .collection(subName)
          .get();
        
        if (!subSnapshot.empty) {
          let batch = sandboxDb.batch();
          let batchCount = 0;
          
          for (const subDoc of subSnapshot.docs) {
            const targetRef = sandboxDb
              .collection(collectionName)
              .doc(doc.id)
              .collection(subName)
              .doc(subDoc.id);
            
            batch.set(targetRef, subDoc.data());
            batchCount++;
            totalDocs++;
            
            if (batchCount >= BATCH_SIZE) {
              await batch.commit();
              batch = sandboxDb.batch();
              batchCount = 0;
            }
          }
          
          if (batchCount > 0) {
            await batch.commit();
          }
        }
      }
      
      // Progress indicator for large collections
      if (totalDocs % 100 === 0) {
        console.log(`   📝 Progress: ${totalDocs} documents...`);
      }
    }
    
    console.log(`   ✅ Completed: ${totalDocs} total documents copied`);
    return totalDocs;
    
  } catch (error) {
    console.error(`   ❌ Error:`, error.message);
    return 0;
  }
}

/**
 * Main migration function
 */
async function migrate() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Firebase Migration: Production → Sandbox');
  console.log('  Source: fitmygolfclubs (READ-ONLY)');
  console.log('  Target: fitmygolfclubs-pro-dev');
  console.log('═══════════════════════════════════════════════════════');
  
  const startTime = Date.now();
  let totalDocuments = 0;
  
  // Copy each collection
  for (const collectionName of COLLECTIONS_TO_COPY) {
    const count = await copyCollection(collectionName);
    totalDocuments += count;
  }
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  ✅ Migration Complete!`);
  console.log(`  📊 Total documents copied: ${totalDocuments}`);
  console.log(`  ⏱️  Duration: ${duration} seconds`);
  console.log('═══════════════════════════════════════════════════════');
  
  // Clean up
  await prodApp.delete();
  await sandboxApp.delete();
  
  process.exit(0);
}

// Run migration
migrate().catch(error => {
  console.error('Migration failed:', error);
  process.exit(1);
});
