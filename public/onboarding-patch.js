/**
 * Client Onboarding Patch
 * Enhances the Add/Invite Client modal to:
 * 1. Create client record in Firestore when proceeding from step 1
 * 2. Offer "Send Invite" vs "Add Bag Now" choice in step 2
 * 
 * Load after firebase-auth.js
 */

(function() {
  'use strict';

  // Extended onboarding state
  let onboardingState = {
    step: 1,
    clientName: '',
    clientEmail: '',
    clientGhin: '',
    clientHandicap: null,
    inviteCode: '',
    clientId: null  // New: stores created client ID
  };

  /**
   * Enhanced goToOnboardStep - creates client on step 1->2 transition
   */
  window.goToOnboardStep = async function(step) {
    // Validate current step before proceeding
    if (step > onboardingState.step) {
      if (onboardingState.step === 1) {
        const name = document.getElementById('onboard-name').value.trim();
        const email = document.getElementById('onboard-email').value.trim();
        
        if (!name) {
          alert('Please enter the client\'s name');
          return;
        }
        if (!email || !email.includes('@')) {
          alert('Please enter a valid email address');
          return;
        }
        
        onboardingState.clientName = name;
        onboardingState.clientEmail = email;
        onboardingState.clientGhin = document.getElementById('onboard-ghin').value.trim();
        
        // Show loading state
        const continueBtn = document.querySelector('#onboard-step-1 .btn-primary');
        if (continueBtn) {
          continueBtn.disabled = true;
          continueBtn.textContent = 'Creating...';
        }
        
        try {
          // Create client in Firestore
          const result = await createClientRecord({
            name: onboardingState.clientName,
            email: onboardingState.clientEmail,
            ghin: onboardingState.clientGhin,
            handicap: onboardingState.clientHandicap
          });
          
          onboardingState.clientId = result.id;
          onboardingState.inviteCode = result.inviteCode;
          
          // Update invite display
          document.getElementById('invite-code').textContent = result.inviteCode;
          document.getElementById('invite-link').value = `https://fitmygolfclubs.com/join/${result.inviteCode}`;
          
          // Update step 2 client name display
          const step2ClientName = document.getElementById('onboard-step2-client-name');
          if (step2ClientName) {
            step2ClientName.textContent = onboardingState.clientName;
          }
          
          if (typeof showToast === 'function') {
            showToast('Client created!', 'success');
          }
          
        } catch (error) {
          console.error('Error creating client:', error);
          alert('Error creating client: ' + error.message);
          if (continueBtn) {
            continueBtn.disabled = false;
            continueBtn.textContent = 'Continue →';
          }
          return;
        }
        
        // Reset button
        if (continueBtn) {
          continueBtn.disabled = false;
          continueBtn.textContent = 'Continue →';
        }
      }
    }
    
    // Update steps visibility
    document.querySelectorAll('.onboarding-step').forEach(s => s.classList.remove('active'));
    document.getElementById('onboard-step-' + step).classList.add('active');
    
    // Update progress dots
    document.querySelectorAll('.onboarding-dot').forEach((dot, i) => {
      dot.classList.remove('active', 'complete');
      if (i + 1 < step) {
        dot.classList.add('complete');
      } else if (i + 1 === step) {
        dot.classList.add('active');
      }
    });
    
    onboardingState.step = step;
  };

  /**
   * Add bag now - closes modal and opens BagOnboarding
   */
  window.addBagNowFromOnboarding = function() {
    if (!onboardingState.clientId) {
      alert('Client not created yet');
      return;
    }
    
    const clientId = onboardingState.clientId;
    const clientName = onboardingState.clientName;
    
    // Close the onboarding modal
    closeModal('onboarding-modal');
    resetOnboarding();
    
    // Start bag onboarding for this client
    if (typeof BagOnboarding !== 'undefined' && BagOnboarding.start) {
      BagOnboarding.start({
        userId: clientId,
        onComplete: async (bagData) => {
          console.log('✅ Bag added for new client:', bagData);
          if (typeof showToast === 'function') {
            showToast(`Bag added for ${clientName}`, 'success');
          }
          
          // Refresh clients list
          const currentUser = firebase.auth().currentUser;
          if (currentUser) {
            await fetchClients(currentUser.uid);
          }
          
          // Navigate to view the client
          if (typeof viewClient === 'function') {
            viewClient(clientId);
          }
        },
        onCancel: () => {
          console.log('Bag onboarding cancelled');
        }
      });
    } else {
      alert('Bag onboarding not available. Client has been created - you can add their bag later.');
    }
  };

  /**
   * Send invite only - keeps original behavior
   */
  window.sendInviteOnly = function() {
    // Go to confirmation step
    goToOnboardStep(3);
  };

  /**
   * Reset onboarding state
   */
  window.resetOnboarding = function() {
    onboardingState = {
      step: 1,
      clientName: '',
      clientEmail: '',
      clientGhin: '',
      clientHandicap: null,
      inviteCode: '',
      clientId: null
    };
    
    // Clear form
    const nameInput = document.getElementById('onboard-name');
    const emailInput = document.getElementById('onboard-email');
    const ghinInput = document.getElementById('onboard-ghin');
    const ghinResult = document.getElementById('ghin-lookup-result');
    
    if (nameInput) nameInput.value = '';
    if (emailInput) emailInput.value = '';
    if (ghinInput) ghinInput.value = '';
    if (ghinResult) ghinResult.style.display = 'none';
    
    // Reset step visibility
    document.querySelectorAll('.onboarding-step').forEach(s => s.classList.remove('active'));
    document.getElementById('onboard-step-1')?.classList.add('active');
    
    // Reset progress dots
    document.querySelectorAll('.onboarding-dot').forEach((dot, i) => {
      dot.classList.remove('active', 'complete');
      if (i === 0) dot.classList.add('active');
    });
  };

  /**
   * Finish onboarding - close modal
   */
  window.finishOnboarding = function() {
    closeModal('onboarding-modal');
    resetOnboarding();
    
    if (typeof showToast === 'function') {
      showToast('Client added successfully!', 'success');
    }
  };

  /**
   * Add another client
   */
  window.addAnotherClient = function() {
    resetOnboarding();
    goToOnboardStep(1);
  };

  /**
   * GHIN lookup with handicap extraction
   */
  window.lookupGHIN = async function() {
    const ghinInput = document.getElementById('onboard-ghin').value.trim();
    const resultDiv = document.getElementById('ghin-lookup-result');
    
    if (!ghinInput || ghinInput.length < 7) {
      alert('Please enter a valid GHIN number (7-8 digits)');
      return;
    }
    
    // Show loading
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<div style="color: var(--text-muted);">Looking up GHIN...</div>';
    
    try {
      // Call GHIN lookup function if available
      if (typeof lookupGhinNumber === 'function') {
        const ghinData = await lookupGhinNumber(ghinInput);
        if (ghinData && ghinData.name) {
          resultDiv.innerHTML = `
            <div class="ghin-lookup-result" style="background: var(--green-dim); padding: 10px; border-radius: 8px; margin-top: 8px;">
              <div style="color: var(--green); font-weight: 600;">✓ Found: ${ghinData.name}</div>
              <div style="color: var(--text-secondary); font-size: 12px;">Handicap Index: ${ghinData.handicap || 'N/A'} • ${ghinData.club || ''}</div>
            </div>
          `;
          
          // Auto-fill name if empty
          const nameInput = document.getElementById('onboard-name');
          if (nameInput && !nameInput.value.trim()) {
            nameInput.value = ghinData.name;
          }
          
          // Store handicap
          onboardingState.clientHandicap = ghinData.handicap;
          return;
        }
      }
      
      // Fallback: simulated response
      resultDiv.innerHTML = `
        <div class="ghin-lookup-result" style="background: var(--yellow-dim); padding: 10px; border-radius: 8px; margin-top: 8px;">
          <div style="color: var(--yellow); font-weight: 600;">⚠️ Could not verify GHIN</div>
          <div style="color: var(--text-secondary); font-size: 12px;">Client can link their GHIN after signing up</div>
        </div>
      `;
      
    } catch (error) {
      console.error('GHIN lookup error:', error);
      resultDiv.innerHTML = `
        <div style="background: var(--red-dim); padding: 10px; border-radius: 8px; margin-top: 8px;">
          <div style="color: var(--red);">Error looking up GHIN</div>
        </div>
      `;
    }
  };

  /**
   * Copy invite link
   */
  window.copyInviteLink = function() {
    const linkInput = document.getElementById('invite-link');
    linkInput.select();
    document.execCommand('copy');
    
    // Show feedback
    const copyBtn = event.target;
    const originalText = copyBtn.textContent;
    copyBtn.textContent = 'Copied!';
    copyBtn.style.background = 'var(--green)';
    
    setTimeout(() => {
      copyBtn.textContent = originalText;
      copyBtn.style.background = '';
    }, 2000);
  };

  /**
   * Share via email
   */
  window.shareViaEmail = function() {
    const subject = encodeURIComponent('Join me on FitMyGolfClubs');
    const body = encodeURIComponent(`Hi ${onboardingState.clientName || 'there'},\n\nI'd like to invite you to join FitMyGolfClubs so I can help analyze and optimize your golf equipment.\n\nUse this link to sign up: https://fitmygolfclubs.com/join/${onboardingState.inviteCode}\n\nOr enter code: ${onboardingState.inviteCode}\n\nLooking forward to helping you improve your game!\n\nBest,\nYour Golf Pro`);
    
    window.open(`mailto:${onboardingState.clientEmail}?subject=${subject}&body=${body}`);
  };

  /**
   * Share via SMS
   */
  window.shareViaSMS = function() {
    const body = encodeURIComponent(`Hi! Join me on FitMyGolfClubs to get your equipment analyzed. Sign up here: https://fitmygolfclubs.com/join/${onboardingState.inviteCode}`);
    window.open(`sms:?body=${body}`);
  };

  console.log('✅ Onboarding patch loaded');

})();
