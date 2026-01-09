// FIX-ALL.js - Run in firebase-migration folder
// node fix-all.js

const admin = require('firebase-admin');
const serviceAccount = require('./fitmygolfclubs-pro-dev-firebase-adminsdk-fbsvc-3d49f98ae0.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const SEAN_AUTH_UID = '9MPT02omALRJgZpQKMoFTkeH9Cc2';

async function fixAll() {
  console.log('\n=== FIXING FITMYGOLFCLUBS PRO DATA ===\n');
  
  // 1. Create Pro user document with Sean's Auth UID
  console.log('1. Creating Pro user document...');
  await db.collection('users').doc(SEAN_AUTH_UID).set({
    user_id: SEAN_AUTH_UID,
    name: 'Sean Morrissey',
    display_name: 'Sean Morrissey',
    email: 'sean@test.com',
    account_type: 'professional',
    subscription_tier: 'premium',
    onboarded: true,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log('   ✅ Pro document created');

  // 2. Update all clients to point to Sean's Auth UID
  console.log('\n2. Updating client pro_id references...');
  const clients = await db.collection('users').where('account_type', '==', 'client').get();
  
  let count = 0;
  for (const doc of clients.docs) {
    await doc.ref.update({ pro_id: SEAN_AUTH_UID });
    console.log(`   ✅ ${doc.data().name}`);
    count++;
  }
  
  console.log(`\n=== DONE! ${count} clients linked to your account ===`);
  console.log('\nRefresh https://fitmygolfclubs-pro-dev.web.app/ and you should see them!\n');
}

fixAll().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
