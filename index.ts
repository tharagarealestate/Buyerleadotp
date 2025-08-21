<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

// --- Firebase config ---
const firebaseConfig = {
  apiKey: "AIzaSyAUNl5bZif51a8b5FC5kKqZs40KlP5lP74",
  authDomain: "tharaga-n.firebaseapp.com",
  projectId: "tharaga-n",
  appId: "1:122537471507:web:346c29119a352cc87059e6"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.languageCode = 'en';

// UTM + referrer capture
const params = new URLSearchParams(window.location.search);
document.getElementById('utm_source').value   = params.get('utm_source')   || '';
document.getElementById('utm_medium').value   = params.get('utm_medium')   || '';
document.getElementById('utm_campaign').value = params.get('utm_campaign') || '';
document.getElementById('referrer').value     = document.referrer || '';

// Elements
const form              = document.getElementById('buyerForm');
const phoneInput        = document.getElementById('phone');
const sendOtpBtn        = document.getElementById('sendOtpBtn');
const otpBlock          = document.getElementById('otpBlock');
const verifyOtpBtn      = document.getElementById('verifyOtpBtn');
const otpStatus         = document.getElementById('otpStatus');
const submitBtn         = document.getElementById('submitBtn');
const otpVerifiedField  = document.getElementById('otp_verified');
const otpInputs         = document.querySelectorAll('.otp-input');

// ---- reCAPTCHA setup ----
function initRecaptcha(){
  if (window.recaptchaVerifier) return;
  window.recaptchaVerifier = new RecaptchaVerifier('otp-recaptcha', { size: 'invisible' }, auth);
  window.recaptchaVerifier.render().then(id => console.log('reCAPTCHA ready:', id));
}
initRecaptcha();

// OTP helpers
function getEnteredOTP(){ return Array.from(otpInputs).map(i => i.value).join(''); }
otpInputs.forEach((input, i) => {
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g,'').slice(0,1); if(input.value && i<otpInputs.length-1) otpInputs[i+1].focus(); });
  input.addEventListener('keydown', (e) => {
    if(e.key==='Backspace' && !input.value && i>0) otpInputs[i-1].focus();
    if(e.key==='ArrowLeft' && i>0) otpInputs[i-1].focus();
    if(e.key==='ArrowRight' && i<otpInputs.length-1) otpInputs[i+1].focus();
  });
});
otpInputs[0].addEventListener('paste', e=>{
  const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g,'').slice(0,6);
  text.split('').forEach((d, idx)=>{ if(otpInputs[idx]) otpInputs[idx].value=d; });
  e.preventDefault();
  if(text.length===6) otpInputs[5].focus();
});

let confirmationResult = null;

// Send OTP
sendOtpBtn.addEventListener('click', async ()=>{
  const raw = phoneInput.value.trim();
  if(!/^[6-9]\d{9}$/.test(raw)){ alert('Enter valid 10-digit mobile number'); return; }
  otpBlock.style.display='block'; otpStatus.textContent='Sending OTP…'; sendOtpBtn.disabled=true;
  try {
    initRecaptcha();
    const e164='+91'+raw;
    confirmationResult=await signInWithPhoneNumber(auth,e164,window.recaptchaVerifier);
    otpStatus.textContent='OTP sent. Please check SMS.';
  } catch(err){
    console.error('send OTP error:', err); otpStatus.textContent='Could not send OTP.';
    try { const id = await window.recaptchaVerifier.render(); if(window.grecaptcha && id) window.grecaptcha.reset(id); } catch(_) {}
  } finally { sendOtpBtn.disabled=false; }
});

// Verify OTP
verifyOtpBtn.addEventListener('click', async ()=>{
  try {
    const code=getEnteredOTP();
    if(code.length!==6){ otpStatus.textContent='Enter all 6 digits'; return; }
    await confirmationResult.confirm(code);
    otpStatus.textContent='Verified ✅'; otpVerifiedField.value='true';
    submitBtn.disabled=false; submitBtn.style.cursor='pointer';
  } catch(err){ console.error(err); otpStatus.textContent='Invalid code. Retry.'; }
});

// --- Submit form and show AI matches ---
form.addEventListener('submit', async e=>{
  e.preventDefault();
  if(otpVerifiedField.value!=='true'){ alert('Verify OTP first'); return; }

  submitBtn.disabled=true; submitBtn.textContent="Processing...";

  const formData={
    name: form.name.value,
    email: form.email.value,
    phone: form.phone.value,
    location: form.location.value,
    budget: form.budget.value,
    property_type: form.property_type.value,
    timeline: form.timeline.value,
    financing: form.financing.value,
    notes: form.notes.value,
    utm_source: form.utm_source.value,
    utm_medium: form.utm_medium.value,
    utm_campaign: form.utm_campaign.value,
    referrer: form.referrer.value,
    otp_verified: otpVerifiedField.value
  };

  try {
    const res = await fetch("/.netlify/functions/buyerMatch",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(formData)
    });
    const result = await res.json();

    if(res.ok){
      showPropertyMatches(result.matches);
    } else {
      alert("Error: "+(result.error||"Something went wrong"));
    }
  } catch(err){
    console.error(err); alert("Failed to submit form. Retry.");
  } finally {
    submitBtn.disabled=false; submitBtn.textContent="Get My Property Matches";
  }
});

// --- Function to render AI property matches ---
function showPropertyMatches(matches){
  let container = document.getElementById('aiMatches');
  if(!container){
    container = document.createElement('div');
    container.id='aiMatches';
    container.style.marginTop='20px';
    container.style.padding='16px';
    container.style.background='#fdf6f0';
    container.style.borderRadius='12px';
    form.parentNode.appendChild(container);
  }
  container.innerHTML="<h4 style='text-align:center; margin-bottom:12px;'>Your AI Matched Properties</h4>";
  if(!matches || matches.length===0){
    container.innerHTML+="<p style='text-align:center;'>No matches found yet.</p>"; return;
  }

  matches.forEach(p=>{
    const card=document.createElement('div');
    card.style.border='1px solid #ddd'; card.style.borderRadius='10px';
    card.style.padding='12px'; card.style.marginBottom='12px'; card.style.background='#fff';
    card.innerHTML=`
      <h5>${p.name || 'Property'}</h5>
      <p>${p.location || ''} | ${p.bhk || ''} BHK | ${p.carpet_area || ''} sqft</p>
      <p>Price: ${p.price || '-'}</p>
      <a href="${p.url || '#'}" target="_blank" style="color:#0e0e0e; font-weight:600;">View Property</a>
    `;
    container.appendChild(card);
  });
}
</script>
