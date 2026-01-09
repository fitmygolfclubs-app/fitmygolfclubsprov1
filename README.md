# Firebase Migration Script

Copies Firestore collections from `fitmygolfclubs` (production) to `fitmygolfclubs-pro-dev` (sandbox).

## Safety Guarantees

- ✅ Production database is READ-ONLY
- ✅ No delete operations anywhere
- ✅ No modifications to production data
- ✅ Can be stopped at any time (Ctrl+C)

## Collections Copied

- validationRanges
- config
- aiRecommendationRules
- ai_recommendations
- algorithmVersions
- clubTypeReference
- autocomplete
- clubHeadSpecs (large)
- shaftSpecDatabase (large)

## Setup Instructions

1. **Place service account files in this folder:**
   - Rename production key to: `fitmygolfclubs-prod.json`
   - Rename sandbox key to: `fitmygolfclubs-sandbox.json`

2. **Install dependencies:**
   ```
   npm install
   ```

3. **Run migration:**
   ```
   node migrate.js
   ```

## Expected Output

```
═══════════════════════════════════════════════════════
  Firebase Migration: Production → Sandbox
  Source: fitmygolfclubs (READ-ONLY)
  Target: fitmygolfclubs-pro-dev
═══════════════════════════════════════════════════════

📂 Starting: validationRanges
   📖 Reading 29 documents from production...
   ✅ Completed: 29 documents copied

📂 Starting: clubHeadSpecs
   📖 Reading 1500 documents from production...
   ✅ Committed batch: 500 documents so far
   ✅ Committed batch: 1000 documents so far
   ✅ Completed: 1500 documents copied

... (continues for all collections)

═══════════════════════════════════════════════════════
  ✅ Migration Complete!
  📊 Total documents copied: XXXX
  ⏱️  Duration: XX.X seconds
═══════════════════════════════════════════════════════
```

## Troubleshooting

**"Cannot find module './fitmygolfclubs-prod.json'"**
- Make sure you renamed the service account files correctly

**"Permission denied"**
- Check that the service account has Firestore access

**Script hangs on large collection**
- This is normal for clubHeadSpecs (thousands of documents)
- Wait for batch commits to appear in the log
