// ─── PWA ──────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// ─── STATE ────────────────────────────────────────────────
let meetings = JSON.parse(localStorage.getItem('meetings') || '[]');
let completedActions = JSON.parse(localStorage.getItem('completedActions') || '{}');
let profiles = JSON.parse(localStorage.getItem('profiles') || '[{"name":"Suhail","id":"default"}]');
let currentProfile = localStorage.getItem('currentProfile') || 'default';
let customTags = JSON.parse(localStorage.getItem('customTags') || '[]');
let currentAgenda = null;
let transcript = '';
let recognition = null;
let isRecording = false;
let timerInterval = null;
let seconds = 0;
let currentMeetingId = null;
let currentSummaryData = null;
let currentMoMData = null;
let pinBuffer = '';
let calendarDate = new Date();
let obStep = 0;
let sentimentFilter = '';
let wakeLock = null;
let heartbeatInterval = null;
let speakerSegments = [];
let lastSpeechTime = Date.now();
let currentSpeaker = 1;
let speakerTranscript = '';
let isPaused = false;
let mediaRecorder = null;
let audioChunks = [];
let meetingMode = 'online';
let audioStream = null;
let audioContext = null;
let audioAnalyser = null;
let audioLevelInterval = null;

// ─── INIT ─────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const savedKey = localStorage.getItem('gemini-api-key');
  if (savedKey) {
    document.getElementById('api-key').value = savedKey;
    const settingsKey = document.getElementById('settings-api-key');
    if (settingsKey) settingsKey.value = savedKey;
  }
  const savedLang = localStorage.getItem('default-lang') || 'en-US';
  const langSelect = document.getElementById('lang-select');
  const settingsLang = document.getElementById('settings-lang');
  if (langSelect) langSelect.value = savedLang;
  if (settingsLang) settingsLang.value = savedLang;
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeBtn(savedTheme);
  const apiKeyEl = document.getElementById('api-key');
  if (apiKeyEl) {
    apiKeyEl.addEventListener('change', e => {
      localStorage.setItem('gemini-api-key', e.target.value.trim());
      const settingsKey = document.getElementById('settings-api-key');
      if (settingsKey) settingsKey.value = e.target.value.trim();
    });
  }
  checkPIN();
  updateDashboard();
  renderCustomTags();
  updateProfileUI();
  if (!localStorage.getItem('onboarding-done')) startOnboarding();
});

// ─── ONBOARDING ───────────────────────────────────────────
function startOnboarding() {
  obStep = 0;
  document.getElementById('onboarding').classList.remove('hidden');
  updateObStep();
}

function obNext() {
  if (obStep < 4) { obStep++; updateObStep(); }
  else finishOnboarding();
}

function updateObStep() {
  document.querySelectorAll('.onboarding-step').forEach((s, i) => s.classList.toggle('active', i === obStep));
  document.querySelectorAll('.ob-dot').forEach((d, i) => d.classList.toggle('active', i === obStep));
  document.getElementById('ob-next-btn').textContent = obStep === 4 ? "Let's Go! 🚀" : 'Next →';
}

function finishOnboarding() {
  document.getElementById('onboarding').classList.add('hidden');
  localStorage.setItem('onboarding-done', '1');
}

// ─── PIN ──────────────────────────────────────────────────
function checkPIN() {
  if (localStorage.getItem('app-pin')) document.getElementById('pin-screen').classList.remove('hidden');
}

function pinPress(val) {
  if (val === 'clear') { pinBuffer = ''; updatePinDots(); return; }
  if (val === 'del') { pinBuffer = pinBuffer.slice(0, -1); updatePinDots(); return; }
  if (pinBuffer.length >= 4) return;
  pinBuffer += val; updatePinDots();
  if (pinBuffer.length === 4) {
    setTimeout(() => {
      if (pinBuffer === localStorage.getItem('app-pin')) {
        document.getElementById('pin-screen').classList.add('hidden');
        pinBuffer = ''; updatePinDots();
      } else {
        document.getElementById('pin-label').textContent = '❌ Wrong PIN. Try again.';
        pinBuffer = ''; updatePinDots();
      }
    }, 200);
  }
}

function updatePinDots() {
  document.querySelectorAll('.pin-dots span').forEach((d, i) => d.classList.toggle('filled', i < pinBuffer.length));
}

function savePIN() {
  const pin = document.getElementById('pin-input').value.trim();
  if (pin.length !== 4 || isNaN(pin)) { alert('Please enter a valid 4-digit PIN!'); return; }
  localStorage.setItem('app-pin', pin); alert('✅ PIN set!');
}

function removePIN() { localStorage.removeItem('app-pin'); alert('PIN removed.'); }

// ─── THEME ────────────────────────────────────────────────
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next); updateThemeBtn(next);
}

function updateThemeBtn(theme) {
  const btn = document.getElementById('theme-btn');
  if (btn) btn.innerHTML = theme === 'dark' ? '<i class="fa-solid fa-moon"></i> Dark Mode' : '<i class="fa-solid fa-sun"></i> Light Mode';
}

// ─── MOBILE SIDEBAR ───────────────────────────────────────
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}

// ─── PROFILES ─────────────────────────────────────────────
function updateProfileUI() {
  const profile = profiles.find(p => p.id === currentProfile) || profiles[0];
  const nameEl = document.getElementById('sidebar-profile-name');
  const avatarEl = document.getElementById('sidebar-avatar');
  if (nameEl) nameEl.textContent = profile.name;
  if (avatarEl) avatarEl.textContent = profile.name.charAt(0).toUpperCase();
}

function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  renderProfilesList();
}

function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function renderProfilesList() {
  const list = document.getElementById('profiles-list');
  if (!list) return;
  list.innerHTML = profiles.map(p => `
    <div class="profile-item ${p.id === currentProfile ? 'active' : ''}" onclick="switchProfile('${p.id}')">
      <div class="profile-avatar">${p.name.charAt(0).toUpperCase()}</div>
      <span style="font-size:0.9rem;font-weight:500">${p.name}</span>
      ${p.id !== 'default' ? `<button class="profile-delete" onclick="event.stopPropagation();deleteProfile('${p.id}')"><i class="fa-solid fa-trash"></i></button>` : ''}
    </div>`).join('');
}

function switchProfile(id) {
  currentProfile = id;
  localStorage.setItem('currentProfile', id);
  updateProfileUI();
  closeModal('profile-modal');
}

function addProfile() {
  const name = document.getElementById('new-profile-name').value.trim();
  if (!name) return;
  const profile = { name, id: Date.now().toString() };
  profiles.push(profile);
  localStorage.setItem('profiles', JSON.stringify(profiles));
  document.getElementById('new-profile-name').value = '';
  renderProfilesList();
}

function deleteProfile(id) {
  profiles = profiles.filter(p => p.id !== id);
  localStorage.setItem('profiles', JSON.stringify(profiles));
  if (currentProfile === id) switchProfile('default');
  else renderProfilesList();
}

// ─── NAVIGATION ───────────────────────────────────────────
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const target = document.getElementById('page-' + page);
  if (!target) { console.error('Page not found: page-' + page); return; }
  target.classList.add('active');

  // Match nav item by onclick attribute instead of index
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.getAttribute('onclick') === `showPage('${page}')`) {
      n.classList.add('active');
    }
  });

  if (page === 'dashboard') updateDashboard();
  if (page === 'meetings') renderMeetings();
  if (page === 'analytics') renderAnalytics();
  if (page === 'actions') renderAllActions();
  if (page === 'calendar') renderCalendar();
  if (window.innerWidth <= 768) toggleSidebar();
}


// ─── DASHBOARD ────────────────────────────────────────────
function updateDashboard() {
  document.getElementById('stat-total').textContent = meetings.length;
  document.getElementById('stat-actions').textContent = meetings.reduce((s, m) => s + (m.actions?.length || 0), 0);
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  document.getElementById('stat-week').textContent = meetings.filter(m => new Date(m.date).getTime() > oneWeekAgo).length;
  document.getElementById('stat-summaries').textContent = meetings.filter(m => m.summary).length;
  const list = document.getElementById('recent-meetings-list');
  if (!list) return;
  if (!meetings.length) {
    list.innerHTML = `<div class="empty-state"><i class="fa-solid fa-calendar-xmark"></i><p>No meetings yet. Start recording!</p></div>`;
    return;
  }
  list.innerHTML = [...meetings].reverse().slice(0, 5).map(m => meetingCardHTML(m)).join('');
}

// ─── MEETING MODE ─────────────────────────────────────────
function setMeetingMode(mode) {
  meetingMode = mode;
  document.getElementById('mode-online').classList.toggle('active', mode === 'online');
  document.getElementById('mode-inperson').classList.toggle('active', mode === 'inperson');
}

// ─── AUDIO LEVEL ──────────────────────────────────────────
async function startAudioLevelMonitor(stream) {
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    audioAnalyser = audioContext.createAnalyser();
    audioAnalyser.fftSize = 256;
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(audioAnalyser);
    const dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
    const bar = document.getElementById('audio-level-bar');
    const fill = document.getElementById('audio-level-fill');
    const status = document.getElementById('audio-level-status');
    if (bar) bar.classList.remove('hidden');
    audioLevelInterval = setInterval(() => {
      audioAnalyser.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      const pct = Math.min(100, avg * 2.5);
      if (fill) { fill.style.width = pct + '%'; fill.style.background = pct > 60 ? 'var(--green)' : pct > 30 ? 'var(--orange)' : 'var(--red)'; }
      if (status) status.textContent = pct > 30 ? '🟢 Audio detected!' : '🔴 No audio — check source';
    }, 100);
  } catch (err) { console.warn('Audio monitor error:', err); }
}

function stopAudioLevelMonitor() {
  if (audioLevelInterval) clearInterval(audioLevelInterval);
  if (audioContext) audioContext.close();
  const bar = document.getElementById('audio-level-bar');
  const fill = document.getElementById('audio-level-fill');
  if (bar) bar.classList.add('hidden');
  if (fill) fill.style.width = '0%';
}

// ─── RECORDING ────────────────────────────────────────────
function startRecording() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { alert('Please use Microsoft Edge or Google Chrome!'); return; }

  let finalTranscript = '';

  function createRecognition() {
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 3;
    r.lang = document.getElementById('lang-select').value;

    r.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        let best = result[0].transcript;
        for (let j = 0; j < result.length; j++) {
          if (result[j].confidence > 0.6) { best = result[j].transcript; break; }
        }
        if (result.isFinal) {
          finalTranscript += best + ' ';
        } else {
          interim += best;
        }
      }
      transcript = finalTranscript;
      const box = document.getElementById('transcript-box');
      if (box) {
        box.innerHTML = `<span>${transcript}</span><span style="color:var(--text-muted);font-style:italic">${interim}</span>`;
        box.scrollTop = box.scrollHeight;
      }
    };

    r.onerror = e => {
      console.error('Speech error:', e.error);
      if (isRecording && !isPaused) {
        setTimeout(() => { if (isRecording && !isPaused) { recognition = createRecognition(); recognition.start(); } }, 300);
      }
    };

    r.onend = () => {
      if (isRecording && !isPaused) {
        setTimeout(() => { if (isRecording && !isPaused) { recognition = createRecognition(); recognition.start(); } }, 200);
      }
    };

    return r;
  }

  recognition = createRecognition();
  const box = document.getElementById('transcript-box');
  if (box) box.innerHTML = '';
  transcript = '';
  finalTranscript = '';

  recognition.start();
  isRecording = true;
  isPaused = false;

  heartbeatInterval = setInterval(() => {
    if (isRecording && !isPaused) {
      const timeSinceLastSpeech = Date.now() - lastSpeechTime;
      const status = document.getElementById('rec-status-dot');
      if (status) {
        if (timeSinceLastSpeech > 10000) {
          status.style.background = 'var(--red)';
          try { recognition.stop(); } catch(e) {}
        } else if (timeSinceLastSpeech > 3000) {
          status.style.background = 'var(--orange)';
        } else {
          status.style.background = 'var(--green)';
        }
      }
    }
  }, 2000);

  requestWakeLock();

  document.getElementById('btn-start').classList.add('hidden');
  document.getElementById('btn-stop').classList.remove('hidden');
  document.getElementById('btn-pause').classList.remove('hidden');
  document.getElementById('pulse-ring').classList.add('active');
  document.getElementById('mic-icon').style.color = 'var(--accent)';
  document.getElementById('record-label').textContent = 'Recording...';
  document.getElementById('summary-section').classList.add('hidden');
  document.getElementById('mom-section').classList.add('hidden');
  document.getElementById('btn-mom').style.display = 'none';
  const statusDot = document.getElementById('rec-status-dot');
  if (statusDot) statusDot.style.background = 'var(--green)';

  seconds = 0;
  timerInterval = setInterval(() => {
    seconds++;
    document.getElementById('timer').textContent = `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  }, 1000);
}


// ─── SPEAKER TRANSCRIPT ───────────────────────────────────
function renderTranscriptWithSpeakers(interim) {
  const box = document.getElementById('transcript-box');
  if (!box) return;
  box.innerHTML = `<span>${transcript}</span><span style="color:var(--text-muted);font-style:italic">${interim}</span>`;
  box.scrollTop = box.scrollHeight;
}



// ─── PAUSE / RESUME ───────────────────────────────────────
function togglePause() {
  if (!isRecording) return;
  isPaused = !isPaused;
  const btn = document.getElementById('btn-pause');
  if (isPaused) {
    recognition.stop();
    clearInterval(timerInterval);
    document.getElementById('pulse-ring').classList.remove('active');
    document.getElementById('record-label').textContent = '⏸️ Paused';
    if (btn) { btn.innerHTML = '<i class="fa-solid fa-play"></i> Resume'; btn.style.background = 'var(--green)'; }
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.pause();
  } else {
    recognition.start();
    document.getElementById('pulse-ring').classList.add('active');
    document.getElementById('record-label').textContent = 'Recording...';
    if (btn) { btn.innerHTML = '<i class="fa-solid fa-pause"></i> Pause'; btn.style.background = 'var(--orange)'; }
    if (mediaRecorder && mediaRecorder.state === 'paused') mediaRecorder.resume();
    timerInterval = setInterval(() => {
      seconds++;
      document.getElementById('timer').textContent = `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
    }, 1000);
  }
}

// ─── STOP RECORDING ───────────────────────────────────────
function stopRecording() {
  if (recognition) recognition.stop();
  if (audioStream) { audioStream.getTracks().forEach(t => t.stop()); audioStream = null; }
  stopAudioLevelMonitor();
  clearInterval(heartbeatInterval);
  isRecording = false;
  isPaused = false;
  releaseWakeLock();
  clearInterval(timerInterval);
  document.getElementById('btn-start').classList.remove('hidden');
  document.getElementById('btn-stop').classList.add('hidden');
  document.getElementById('btn-pause').classList.add('hidden');
  document.getElementById('pulse-ring').classList.remove('active');
  document.getElementById('mic-icon').style.color = 'var(--text-muted)';
  document.getElementById('record-label').textContent = 'Recording Stopped';
  const statusDot = document.getElementById('rec-status-dot');
  if (statusDot) statusDot.style.background = 'var(--border)';
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  if (speakerTranscript) transcript = speakerTranscript;
}

// ─── CLEAR TRANSCRIPT ─────────────────────────────────────
function clearTranscript() {
  transcript = '';
  speakerTranscript = '';
  speakerSegments = [];
  currentSpeaker = 1;
  const box = document.getElementById('transcript-box');
  if (box) box.innerHTML = '<p class="transcript-placeholder">Transcript will appear here as you speak...</p>';
  document.getElementById('summary-section').classList.add('hidden');
  document.getElementById('mom-section').classList.add('hidden');
  document.getElementById('btn-mom').style.display = 'none';
  document.getElementById('timer').textContent = '00:00';
  document.getElementById('record-label').textContent = 'Ready to Record';
  const statusDot = document.getElementById('rec-status-dot');
  if (statusDot) statusDot.style.background = 'var(--border)';
}

// ─── VOICE RECORDING ──────────────────────────────────────
function startVoiceRecording() {
  const consent = confirm(
    `⚠️ GDPR CONSENT REQUIRED\n\n` +
    `Before recording, you must:\n` +
    `✅ Inform ALL participants this meeting will be recorded\n` +
    `✅ Obtain verbal or written consent from everyone\n` +
    `✅ Confirm recording is for internal use only\n\n` +
    `Under GDPR Article 6, recording without consent is illegal.\n\n` +
    `Do you confirm all participants have consented?`
  );
  if (!consent) { alert('Recording cancelled.'); return; }
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `meeting_recording_${new Date().toLocaleDateString('en-GB').replace(/\//g,'-')}.webm`;
        a.click();
        URL.revokeObjectURL(url);
        const btn = document.getElementById('btn-voice-record');
        if (btn) { btn.innerHTML = '<i class="fa-solid fa-circle-dot"></i> Voice Record'; btn.style.background = 'var(--red)'; }
        showToast('✅ Voice recording saved!');
      };
      mediaRecorder.start();
      const btn = document.getElementById('btn-voice-record');
      if (btn) { btn.innerHTML = '<i class="fa-solid fa-stop"></i> Stop Voice Rec'; btn.style.background = 'var(--purple)'; }
    })
    .catch(() => alert('Could not access microphone!'));
}

function toggleVoiceRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') startVoiceRecording();
  else mediaRecorder.stop();
}

// ─── WAKE LOCK ────────────────────────────────────────────
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      showToast('🔆 Screen will stay on during recording');
    }
  } catch (err) { console.warn('Wake lock failed:', err); }
}

async function releaseWakeLock() {
  try { if (wakeLock) { await wakeLock.release(); wakeLock = null; } }
  catch (err) { console.warn('Wake lock release failed:', err); }
}

// ─── GEMINI ───────────────────────────────────────────────
async function callGemini(prompt) {
  const apiKey = localStorage.getItem('gemini-api-key') || document.getElementById('api-key').value.trim();
  if (!apiKey) throw new Error('No API key');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) }
  );
  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
}

// ─── SUMMARIZE ────────────────────────────────────────────
async function summarizeWithGemini() {
  const apiKey = localStorage.getItem('gemini-api-key') || document.getElementById('api-key').value.trim();
  if (!apiKey) { alert('Please set your Gemini API key in Settings!'); return; }
  if (!transcript.trim()) { alert('No transcript found. Please record first!'); return; }
  const btn = document.getElementById('btn-summarize');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-brain"></i> <span class="loading-dots">Summarizing</span>';
  const allTags = ['Project Update','Team Standup','Client Call','Review','Planning','General', ...customTags].join(', ');
  const prompt = `Analyze this meeting transcript and respond in this exact JSON format:
{
  "title": "concise meeting title max 8 words",
  "tag": "one of: ${allTags}",
  "summary": "clear summary in 3-5 sentences",
  "actions": ["action item 1", "action item 2"],
  "topics": ["topic1", "topic2", "topic3"],
  "sentiment": "one of: Positive, Neutral, Negative, Tense",
  "followup": ["follow-up question 1", "follow-up question 2", "follow-up question 3"]
}
Transcript: ${transcript}`;
  try {
    const raw = await callGemini(prompt);
    const result = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
    currentSummaryData = result;
    document.getElementById('summary-title').textContent = result.title || 'Untitled Meeting';
    document.getElementById('summary-tag').textContent = result.tag || 'General';
    document.getElementById('summary-text').textContent = result.summary || '—';
    const al = document.getElementById('action-items-list');
    al.innerHTML = result.actions?.length ? result.actions.map(a => `<li>${a}</li>`).join('') : '<li>No action items identified.</li>';
    const sb = document.getElementById('sentiment-badge');
    sb.textContent = result.sentiment || '';
    sb.className = `sentiment-badge sentiment-${(result.sentiment||'neutral').toLowerCase()}`;
    document.getElementById('topics-row').innerHTML = (result.topics||[]).map(t => `<span class="topic-chip">${t}</span>`).join('');
    if (result.followup?.length) {
      document.getElementById('followup-list').innerHTML = result.followup.map(f => `<li>${f}</li>`).join('');
      document.getElementById('followup-section').classList.remove('hidden');
    }
    document.getElementById('summary-section').classList.remove('hidden');
    document.getElementById('btn-mom').style.display = 'flex';
    setTimeout(() => { if (currentSummaryData) { saveMeeting(true); showToast('✅ Meeting auto-saved!'); } }, 1000);
  } catch (err) { alert('Error calling Gemini API. Check your API key in Settings!'); console.error(err); }
  btn.disabled = false;
  btn.innerHTML = '<i class="fa-solid fa-brain"></i> Summarize with AI';
}

// ─── TRANSLATE ────────────────────────────────────────────
async function translateSummary() {
  const lang = document.getElementById('translate-lang').value;
  if (!lang) { alert('Please select a language!'); return; }
  const summary = document.getElementById('summary-text').textContent;
  const box = document.getElementById('translated-summary');
  box.classList.remove('hidden'); box.textContent = 'Translating...';
  try { box.textContent = await callGemini(`Translate this text to ${lang}. Only return the translated text:\n\n${summary}`); }
  catch { box.textContent = 'Translation failed. Check your API key.'; }
}

// ─── CLEAN TRANSCRIPT ─────────────────────────────────────
async function cleanTranscript() {
  if (!transcript.trim()) { alert('No transcript to clean!'); return; }
  const btn = document.getElementById('btn-clean');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> <span class="loading-dots">Cleaning</span>';
  try {
    const cleaned = await callGemini(`Clean up this speech-to-text transcript by fixing missing words, correcting grammar, removing filler words, and formatting into proper sentences. Keep ALL original content and meaning intact. Return ONLY the cleaned transcript.\n\nRaw transcript:\n${transcript}`);
    transcript = cleaned;
    const box = document.getElementById('transcript-box');
    if (box) box.innerHTML = `<span>${cleaned}</span>`;
    showToast('✅ Transcript cleaned by AI!');
  } catch (err) { alert('Error cleaning transcript. Check your API key!'); console.error(err); }
  btn.disabled = false;
  btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Clean';
}

// ─── PASTE TRANSCRIPT ─────────────────────────────────────
function togglePasteMode() {
  const pasteBox = document.getElementById('paste-transcript-box');
  const isVisible = !pasteBox.classList.contains('hidden');
  pasteBox.classList.toggle('hidden', isVisible);
  document.getElementById('btn-paste-mode').innerHTML = isVisible
    ? '<i class="fa-solid fa-paste"></i> Paste Transcript'
    : '<i class="fa-solid fa-xmark"></i> Cancel Paste';
}

function usePastedTranscript() {
  const text = document.getElementById('paste-textarea').value.trim();
  if (!text) { alert('Please paste a transcript first!'); return; }
  transcript = text;
  speakerTranscript = text;
  const box = document.getElementById('transcript-box');
  if (box) box.innerHTML = `<span>${text}</span>`;
  document.getElementById('paste-transcript-box').classList.add('hidden');
  document.getElementById('btn-paste-mode').innerHTML = '<i class="fa-solid fa-paste"></i> Paste Transcript';
  showToast('✅ Transcript loaded! Now click Summarize with AI');
}

// ─── MoM ──────────────────────────────────────────────────
async function generateMoM() {
  if (!transcript.trim()) { alert('No transcript found!'); return; }
  const btn = document.getElementById('btn-mom');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-file-lines"></i> <span class="loading-dots">Generating MoM</span>';
  const attendees = document.getElementById('attendees-input').value || 'Not specified';
  const date = new Date().toLocaleDateString('en-GB', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const prompt = `Generate formal Minutes of Meeting from this transcript. Respond in this exact JSON format:
{
  "title": "meeting title",
  "date": "${date}",
  "attendees": "${attendees}",
  "agenda": ["point 1"],
  "discussion": ["point 1"],
  "decisions": ["decision 1"],
  "actions": [{"item": "action", "owner": "TBD", "deadline": "TBD"}],
  "nextMeeting": "TBD"
}
Transcript: ${transcript}`;
  try {
    const raw = await callGemini(prompt);
    const mom = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
    currentMoMData = mom;
    document.getElementById('mom-title').textContent = mom.title || 'Minutes of Meeting';
    document.getElementById('mom-content').innerHTML = `
      <div class="mom-content-block"><h4>📅 Date</h4><p>${mom.date}</p></div>
      <div class="mom-content-block"><h4>👥 Attendees</h4><p>${mom.attendees}</p></div>
      <div class="mom-content-block"><h4>📋 Agenda</h4><ul>${(mom.agenda||[]).map(a=>`<li>${a}</li>`).join('')}</ul></div>
      <div class="mom-content-block"><h4>💬 Discussion</h4><ul>${(mom.discussion||[]).map(d=>`<li>${d}</li>`).join('')}</ul></div>
      <div class="mom-content-block"><h4>✅ Decisions</h4><ul>${(mom.decisions||[]).map(d=>`<li>${d}</li>`).join('')}</ul></div>
      <div class="mom-content-block"><h4>⚡ Action Items</h4><ul>${(mom.actions||[]).map(a=>`<li><strong>${a.item}</strong> — Owner: ${a.owner} | Deadline: ${a.deadline}</li>`).join('')}</ul></div>
      <div class="mom-content-block"><h4>📅 Next Meeting</h4><p>${mom.nextMeeting}</p></div>`;
    document.getElementById('mom-section').classList.remove('hidden');
  } catch (err) { alert('Error generating MoM!'); console.error(err); }
  btn.disabled = false;
  btn.innerHTML = '<i class="fa-solid fa-file-lines"></i> Generate MoM';
}

// ─── EMAIL MoM ────────────────────────────────────────────
function emailMoM() {
  if (!currentMoMData) { alert('Generate MoM first!'); return; }
  const m = currentMoMData;
  const subject = encodeURIComponent(`Minutes of Meeting: ${m.title}`);
  const body = encodeURIComponent(`MINUTES OF MEETING\n\nTitle: ${m.title}\nDate: ${m.date}\nAttendees: ${m.attendees}\n\nAGENDA:\n${(m.agenda||[]).map(a=>`• ${a}`).join('\n')}\n\nDISCUSSION:\n${(m.discussion||[]).map(d=>`• ${d}`).join('\n')}\n\nDECISIONS:\n${(m.decisions||[]).map(d=>`• ${d}`).join('\n')}\n\nACTION ITEMS:\n${(m.actions||[]).map(a=>`• ${a.item} — Owner: ${a.owner} | Deadline: ${a.deadline}`).join('\n')}\n\nNext Meeting: ${m.nextMeeting}\n\nGenerated by MeetNotes by Suhail`);
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
}

// ─── SAVE MEETING ─────────────────────────────────────────
function saveMeeting(silent = false) {
  if (!currentSummaryData) return;
  const tagColors = { 'Project Update':'#4f8ef7','Team Standup':'#4ecca3','Client Call':'#f7a94f','Review':'#b06cf7','Planning':'#6c63ff','General':'#8b8fa8' };
  const tag = currentSummaryData.tag || 'General';
  const attendees = document.getElementById('attendees-input').value || 'Not specified';
  const meeting = {
    id: Date.now(),
    title: currentSummaryData.title || 'Untitled',
    tag, tagColor: tagColors[tag] || '#6c63ff',
    summary: currentSummaryData.summary || '',
    actions: currentSummaryData.actions || [],
    topics: currentSummaryData.topics || [],
    sentiment: currentSummaryData.sentiment || 'Neutral',
    followup: currentSummaryData.followup || [],
    transcript: speakerTranscript || transcript,
    attendees,
    attendeesList: attendees.split(',').map(a => a.trim()).filter(a => a),
    duration: document.getElementById('timer').textContent,
    mom: currentMoMData || null,
    pinned: false, favorited: false,
    profile: currentProfile,
    date: new Date().toISOString()
  };
  meetings.push(meeting);
  localStorage.setItem('meetings', JSON.stringify(meetings));
  scheduleActionReminders(meeting);
  if (!silent) {
    clearTranscript();
    currentSummaryData = null; currentMoMData = null; currentAgenda = null;
    const agendaReminder = document.getElementById('agenda-reminder');
    if (agendaReminder) agendaReminder.classList.add('hidden');
    showPage('meetings');
  }
  return meeting;
}

// ─── PDF EXPORTS ──────────────────────────────────────────
function exportPDF() {
  const { jsPDF } = window.jspdf; const doc = new jsPDF();
  const title = document.getElementById('summary-title').textContent;
  const tag = document.getElementById('summary-tag').textContent;
  const summary = document.getElementById('summary-text').textContent;
  const actions = [...document.querySelectorAll('#action-items-list li')].map(li => li.textContent);
  doc.setFontSize(20); doc.setTextColor(108,99,255); doc.text('MeetNotes by Suhail', 20, 20);
  doc.setFontSize(14); doc.setTextColor(0,0,0); doc.text(title, 20, 35);
  doc.setFontSize(10); doc.setTextColor(100); doc.text(`Tag: ${tag} | Date: ${new Date().toLocaleDateString()}`, 20, 45);
  doc.setFontSize(11); doc.setTextColor(0); doc.text('Summary:', 20, 58);
  const ss = doc.splitTextToSize(summary, 170); doc.setFontSize(10); doc.text(ss, 20, 66);
  let y = 66 + ss.length * 6 + 10;
  doc.setFontSize(11); doc.text('Action Items:', 20, y); y += 8;
  doc.setFontSize(10); actions.forEach(a => { doc.text(`• ${a}`, 24, y); y += 7; });
  doc.save(`${title.replace(/\s+/g,'_')}_summary.pdf`);
}

function exportMoMPDF() {
  if (!currentMoMData) { alert('Generate MoM first!'); return; }
  const { jsPDF } = window.jspdf; const doc = new jsPDF(); const mom = currentMoMData;
  doc.setFontSize(20); doc.setTextColor(108,99,255); doc.text('Minutes of Meeting', 20, 20);
  doc.setFontSize(14); doc.setTextColor(0); doc.text(mom.title||'Meeting', 20, 32);
  doc.setFontSize(10); doc.setTextColor(100); doc.text(`Date: ${mom.date} | Attendees: ${mom.attendees}`, 20, 42);
  let y = 55;
  const section = (title, items) => {
    if (y > 260) { doc.addPage(); y = 20; }
    doc.setFontSize(11); doc.setTextColor(108,99,255); doc.text(title, 20, y); y += 7;
    doc.setFontSize(10); doc.setTextColor(0);
    (items||[]).forEach(i => { const lines = doc.splitTextToSize(`• ${i}`, 165); doc.text(lines, 24, y); y += lines.length * 6; }); y += 4;
  };
  section('Agenda', mom.agenda); section('Discussion', mom.discussion); section('Decisions', mom.decisions);
  section('Action Items', (mom.actions||[]).map(a=>`${a.item} — Owner: ${a.owner} | Deadline: ${a.deadline}`));
  doc.setFontSize(10); doc.setTextColor(100); doc.text(`Next Meeting: ${mom.nextMeeting}`, 20, y);
  doc.save(`MoM_${(mom.title||'meeting').replace(/\s+/g,'_')}.pdf`);
}

function exportDetailPDF() {
  const m = meetings.find(x => x.id === currentMeetingId); if (!m) return;
  const { jsPDF } = window.jspdf; const doc = new jsPDF();
  doc.setFontSize(20); doc.setTextColor(108,99,255); doc.text('MeetNotes by Suhail', 20, 20);
  doc.setFontSize(14); doc.setTextColor(0); doc.text(m.title, 20, 32);
  doc.setFontSize(10); doc.setTextColor(100); doc.text(`Date: ${new Date(m.date).toLocaleDateString()} | Tag: ${m.tag} | Duration: ${m.duration}`, 20, 42);
  doc.setFontSize(11); doc.setTextColor(0); doc.text('Summary:', 20, 55);
  const ss = doc.splitTextToSize(m.summary, 170); doc.setFontSize(10); doc.text(ss, 20, 63);
  let y = 63 + ss.length * 6 + 8;
  doc.setFontSize(11); doc.text('Action Items:', 20, y); y += 7;
  doc.setFontSize(10); (m.actions||[]).forEach(a => { doc.text(`• ${a}`, 24, y); y += 7; });
  doc.save(`${m.title.replace(/\s+/g,'_')}_detail.pdf`);
}

// ─── PAST MEETINGS ────────────────────────────────────────
function renderMeetings(filter='', tagFilter='', sentFilter='') {
  const list = document.getElementById('meetings-list');
  if (!list) return;
  let filtered = [...meetings].sort((a,b) => (b.pinned?2:0)+(b.favorited?1:0)-((a.pinned?2:0)+(a.favorited?1:0)) || new Date(b.date)-new Date(a.date));
  if (filter) filtered = filtered.filter(m => m.title.toLowerCase().includes(filter.toLowerCase()) || m.tag.toLowerCase().includes(filter.toLowerCase()) || m.summary.toLowerCase().includes(filter.toLowerCase()));
  if (tagFilter) filtered = filtered.filter(m => m.tag === tagFilter);
  if (sentFilter) filtered = filtered.filter(m => m.sentiment === sentFilter);
  if (!filtered.length) { list.innerHTML = `<div class="empty-state"><i class="fa-solid fa-calendar-xmark"></i><p>No meetings found.</p></div>`; return; }
  list.innerHTML = filtered.map(m => meetingCardHTML(m)).join('');
  updateTagFilter();
}

function meetingCardHTML(m) {
  const date = new Date(m.date).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  const color = m.tagColor || '#6c63ff';
  const attendees = m.attendeesList?.length ? m.attendeesList.slice(0,3).map(a => `<span class="attendee-chip">${a.charAt(0).toUpperCase()}</span>`).join('') : '';
  return `<div class="meeting-card" style="border-left-color:${color}" onclick="openMeeting(${m.id})">
    <div class="meeting-card-header">
      <div>
        <p class="meeting-card-title">${m.pinned?'📌 ':''}${m.favorited?'⭐ ':''}${m.title}</p>
        <p class="meeting-card-date"><i class="fa-regular fa-clock"></i> ${date}${m.duration?' · '+m.duration:''}</p>
        ${attendees?`<div class="attendees-chips">${attendees}${m.attendeesList?.length>3?`<span class="attendee-chip">+${m.attendeesList.length-3}</span>`:''}</div>`:''}
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        ${m.sentiment?`<span class="sentiment-badge sentiment-${m.sentiment.toLowerCase()}">${m.sentiment}</span>`:''}
        <span class="meeting-card-tag" style="background:${color}20;color:${color}">${m.tag}</span>
      </div>
    </div>
    <p class="meeting-card-summary">${m.summary}</p>
  </div>`;
}

function updateTagFilter() {
  const tags = [...new Set(meetings.map(m => m.tag))];
  const sel = document.getElementById('tag-filter');
  if (sel) sel.innerHTML = '<option value="">All Tags</option>' + tags.map(t=>`<option value="${t}">${t}</option>`).join('');
}

function searchMeetings(v) { renderMeetings(v, document.getElementById('tag-filter')?.value||'', sentimentFilter); }
function filterByTag(v) { renderMeetings(document.getElementById('meetings-search')?.value||'', v, sentimentFilter); }
function filterBySentiment(v) { sentimentFilter = v; renderMeetings(document.getElementById('meetings-search')?.value||'', document.getElementById('tag-filter')?.value||'', v); }

// ─── MEETING DETAIL ───────────────────────────────────────
function openMeeting(id) {
  const m = meetings.find(x => x.id === id); if (!m) return;
  currentMeetingId = id;
  document.getElementById('detail-title').textContent = m.title;
  document.getElementById('detail-date').textContent = new Date(m.date).toLocaleDateString('en-GB', { weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' });
  document.getElementById('detail-tag').textContent = m.tag;
  document.getElementById('detail-duration').textContent = m.duration || 'N/A';
  document.getElementById('detail-attendees').textContent = m.attendees || 'Not specified';
  document.getElementById('detail-sentiment').textContent = m.sentiment || 'N/A';
  document.getElementById('detail-summary').textContent = m.summary;
  document.getElementById('detail-transcript').textContent = m.transcript || 'No transcript available.';
  const dal = document.getElementById('detail-actions-list');
  dal.innerHTML = (m.actions||[]).map((a,i) => {
    const key = `${m.id}_${i}`; const done = completedActions[key];
    return `<div class="action-item-row"><input type="checkbox" class="action-checkbox" ${done?'checked':''} onchange="toggleAction('${key}', this)"/><span class="action-item-text-inner ${done?'done':''}" id="act-${key}">${a}</span></div>`;
  }).join('') || '<p style="color:var(--text-muted);font-size:0.9rem">No action items.</p>';
  renderWordCloud(m.transcript || '');
  document.getElementById('btn-pin').innerHTML = m.pinned ? '<i class="fa-solid fa-thumbtack"></i> Unpin' : '<i class="fa-solid fa-thumbtack"></i> Pin';
  document.getElementById('btn-fav').innerHTML = m.favorited ? '<i class="fa-solid fa-star"></i> Unfavorite' : '<i class="fa-solid fa-star"></i> Favorite';
  document.getElementById('chat-messages').innerHTML = '<div class="chat-bubble ai">👋 Hi! Ask me anything about this meeting transcript.</div>';
  showPage('detail');
}

function toggleAction(key, checkbox) {
  completedActions[key] = checkbox.checked;
  localStorage.setItem('completedActions', JSON.stringify(completedActions));
  const span = document.getElementById(`act-${key}`);
  if (span) span.className = `action-item-text-inner ${checkbox.checked?'done':''}`;
}

function togglePin() {
  const m = meetings.find(x => x.id === currentMeetingId); if (!m) return;
  m.pinned = !m.pinned; localStorage.setItem('meetings', JSON.stringify(meetings));
  document.getElementById('btn-pin').innerHTML = m.pinned ? '<i class="fa-solid fa-thumbtack"></i> Unpin' : '<i class="fa-solid fa-thumbtack"></i> Pin';
}

function toggleFavorite() {
  const m = meetings.find(x => x.id === currentMeetingId); if (!m) return;
  m.favorited = !m.favorited; localStorage.setItem('meetings', JSON.stringify(meetings));
  document.getElementById('btn-fav').innerHTML = m.favorited ? '<i class="fa-solid fa-star"></i> Unfavorite' : '<i class="fa-solid fa-star"></i> Favorite';
}

function deleteMeeting() {
  if (!confirm('Delete this meeting permanently?')) return;
  meetings = meetings.filter(m => m.id !== currentMeetingId);
  localStorage.setItem('meetings', JSON.stringify(meetings));
  showPage('meetings');
}

// ─── WORD CLOUD ───────────────────────────────────────────
function renderWordCloud(text) {
  const stopWords = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','is','was','are','were','be','been','have','has','had','do','did','will','would','could','should','i','you','we','they','he','she','it','this','that','these','those','my','your','our','their','his','her','its','not','no','so','if','as','by','from','up','about','into','through','during','before','after','above','below','between','out','off','over','under','again','then','once','here','there','when','where','why','how','all','both','each','few','more','most','other','some','such','than','too','very','just','also','back','well','even','still','way','because','while','although','however','therefore','moreover','furthermore','speaker']);
  const words = text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w));
  const freq = {};
  words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  const sorted = Object.entries(freq).sort((a,b) => b[1]-a[1]).slice(0, 30);
  const max = sorted[0]?.[1] || 1;
  const cloud = document.getElementById('word-cloud');
  if (!cloud) return;
  cloud.innerHTML = sorted.map(([word, count]) => {
    const size = 0.7 + (count / max) * 1.1;
    const opacity = 0.5 + (count / max) * 0.5;
    return `<span class="word-chip" style="font-size:${size}rem;opacity:${opacity}">${word}</span>`;
  }).join('');
}

// ─── CHAT ─────────────────────────────────────────────────
function askSuggestion(btn) { document.getElementById('chat-input').value = btn.textContent; sendChat(); }

async function sendChat() {
  const input = document.getElementById('chat-input');
  const question = input.value.trim(); if (!question) return;
  const m = meetings.find(x => x.id === currentMeetingId); if (!m) return;
  const messages = document.getElementById('chat-messages');
  messages.innerHTML += `<div class="chat-bubble user">${question}</div>`;
  messages.innerHTML += `<div class="chat-bubble loading" id="chat-loading"><span class="loading-dots">Thinking</span></div>`;
  messages.scrollTop = messages.scrollHeight;
  input.value = '';
  try {
    const raw = await callGemini(`You are a professional meeting assistant. Answer the question based ONLY on this meeting transcript.

Format your response clearly using:
- Bullet points for lists
- **Bold** for key terms
- Short paragraphs
- Clear headings if needed
- Be concise but thorough

Question: ${question}
Transcript: ${m.transcript}`);

    document.getElementById('chat-loading').remove();
    const formatted = formatAIResponse(raw);
    const id = 'msg-' + Date.now();
    messages.innerHTML += `
      <div class="chat-bubble ai" id="${id}">
        <div class="chat-answer">${formatted}</div>
        <button class="btn-copy-answer" onclick="copyAnswer('${id}')">
          <i class="fa-solid fa-copy"></i> Copy
        </button>
      </div>`;
  } catch {
    document.getElementById('chat-loading').remove();
    messages.innerHTML += `<div class="chat-bubble ai">Sorry, check your API key in Settings.</div>`;
  }
  messages.scrollTop = messages.scrollHeight;
}
// ─── FORMAT AI RESPONSE ───────────────────────────────────
function formatAIResponse(text) {
  return text
    // Bold **text**
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Bullet points starting with -
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Wrap consecutive li items in ul
    .replace(/(<li>.*<\/li>\n?)+/g, match => `<ul>${match}</ul>`)
    // Headings starting with ##
    .replace(/^## (.+)$/gm, '<h4>$1</h4>')
    // Headings starting with #
    .replace(/^# (.+)$/gm, '<h3>$1</h3>')
    // Line breaks
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>')
    // Wrap in paragraph
    .replace(/^(.)/,'<p>$1')
    + '</p>';
}
// ─── COPY ANSWER ──────────────────────────────────────────
function copyAnswer(id) {
  const bubble = document.getElementById(id);
  if (!bubble) return;
  const text = bubble.querySelector('.chat-answer').innerText;
  navigator.clipboard.writeText(text).then(() => {
    const btn = bubble.querySelector('.btn-copy-answer');
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
    btn.style.color = 'var(--green)';
    setTimeout(() => {
      btn.innerHTML = '<i class="fa-solid fa-copy"></i> Copy';
      btn.style.color = '';
    }, 2000);
  });
}


// ─── CALENDAR ─────────────────────────────────────────────
function renderCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  document.getElementById('calendar-month').textContent = calendarDate.toLocaleDateString('en-GB', { month:'long', year:'numeric' });
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const grid = document.getElementById('calendar-grid');
  if (!grid) return;
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let html = days.map(d => `<div class="calendar-day-header">${d}</div>`).join('');
  for (let i = 0; i < firstDay; i++) html += `<div class="calendar-day other-month"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const isToday = date.toDateString() === today.toDateString();
    const dayMeetings = meetings.filter(m => new Date(m.date).toDateString() === date.toDateString());
    html += `<div class="calendar-day ${isToday?'today':''}" onclick="showCalendarDay(${year},${month},${d})">
      <div class="calendar-day-num">${d}</div>
      ${dayMeetings.slice(0,2).map(m=>`<div class="calendar-meeting-dot" style="background:${m.tagColor||'var(--accent)'}">${m.title}</div>`).join('')}
      ${dayMeetings.length > 2 ? `<div style="font-size:0.7rem;color:var(--text-muted)">+${dayMeetings.length-2} more</div>` : ''}
    </div>`;
  }
  grid.innerHTML = html;
  const cml = document.getElementById('calendar-meetings-list');
  if (!cml) return;
  const thisMonthMeetings = meetings.filter(m => { const d = new Date(m.date); return d.getMonth() === month && d.getFullYear() === year; });
  cml.innerHTML = thisMonthMeetings.length ? thisMonthMeetings.sort((a,b)=>new Date(b.date)-new Date(a.date)).map(m=>meetingCardHTML(m)).join('') : `<div class="empty-state"><i class="fa-solid fa-calendar-xmark"></i><p>No meetings this month.</p></div>`;
}

function showCalendarDay(year, month, day) {
  const date = new Date(year, month, day);
  const dayMeetings = meetings.filter(m => new Date(m.date).toDateString() === date.toDateString());
  if (dayMeetings.length === 1) openMeeting(dayMeetings[0].id);
}

function prevMonth() { calendarDate.setMonth(calendarDate.getMonth() - 1); renderCalendar(); }
function nextMonth() { calendarDate.setMonth(calendarDate.getMonth() + 1); renderCalendar(); }

// ─── ANALYTICS ────────────────────────────────────────────
function renderAnalytics() {
  document.getElementById('an-total').textContent = meetings.length;
  document.getElementById('an-actions').textContent = meetings.reduce((s,m)=>s+(m.actions?.length||0),0);
  const durations = meetings.filter(m=>m.duration&&m.duration!=='00:00').map(m=>{ const [mn,s]=m.duration.split(':').map(Number); return mn+s/60; });
  document.getElementById('an-duration').textContent = durations.length ? Math.round(durations.reduce((a,b)=>a+b,0)/durations.length)+'m' : '0m';
  const tagCounts = {}; meetings.forEach(m=>{ tagCounts[m.tag]=(tagCounts[m.tag]||0)+1; });
  const topTag = Object.entries(tagCounts).sort((a,b)=>b[1]-a[1])[0];
  document.getElementById('an-tag').textContent = topTag?topTag[0]:'—';
  const days = [];
  for (let i=6;i>=0;i--) { const d=new Date(); d.setDate(d.getDate()-i); days.push({ label:d.toLocaleDateString('en-GB',{weekday:'short'}), count:meetings.filter(m=>new Date(m.date).toDateString()===d.toDateString()).length }); }
  const max = Math.max(...days.map(d=>d.count),1);
  const barChart = document.getElementById('bar-chart');
  if (barChart) barChart.innerHTML = days.map(d=>`<div class="bar-item"><span class="bar-value">${d.count}</span><div class="bar" style="height:${(d.count/max)*120}px"></div><span class="bar-label">${d.label}</span></div>`).join('');
  const maxCount = Math.max(...Object.values(tagCounts),1);
  const tagChart = document.getElementById('tag-chart');
  if (tagChart) tagChart.innerHTML = Object.entries(tagCounts).sort((a,b)=>b[1]-a[1]).map(([tag,count])=>`<div class="tag-row"><span class="tag-row-label">${tag}</span><div class="tag-bar-bg"><div class="tag-bar-fill" style="width:${(count/maxCount)*100}%"></div></div><span class="tag-row-count">${count}</span></div>`).join('') || '<p style="color:var(--text-muted);font-size:0.85rem">No data yet.</p>';
  const sentiments = {}; meetings.forEach(m=>{ if(m.sentiment) sentiments[m.sentiment]=(sentiments[m.sentiment]||0)+1; });
  const sentColors = {Positive:'var(--green)',Neutral:'var(--blue)',Negative:'var(--red)',Tense:'var(--orange)'};
  const maxS = Math.max(...Object.values(sentiments),1);
  const sentChart = document.getElementById('sentiment-chart');
  if (sentChart) sentChart.innerHTML = Object.entries(sentiments).map(([s,c])=>`<div class="sentiment-row"><span class="sentiment-row-label">${s}</span><div class="sentiment-bar-bg"><div class="sentiment-bar-fill" style="width:${(c/maxS)*100}%;background:${sentColors[s]||'var(--accent)'}"></div></div><span class="tag-row-count">${c}</span></div>`).join('') || '<p style="color:var(--text-muted);font-size:0.85rem">No data yet.</p>';
}

// ─── MONTHLY TRENDS REPORT ────────────────────────────────
async function generateTrendsReport() {
  if (!meetings.length) { alert('No meetings to analyze!'); return; }
  const section = document.getElementById('trends-report-section');
  const content = document.getElementById('trends-report-content');
  if (section) section.classList.remove('hidden');
  if (content) content.innerHTML = '<div class="empty-state"><i class="fa-solid fa-brain"></i><p class="loading-dots">Generating report</p></div>';
  const summary = meetings.slice(-20).map(m=>`- ${m.title} (${m.tag}, ${m.sentiment}, ${new Date(m.date).toLocaleDateString()})`).join('\n');
  try {
    const report = await callGemini(`You are a meeting analyst. Based on these recent meetings, write a concise monthly trends report covering: meeting frequency, common topics, sentiment trends, productivity observations, and recommendations. Keep it under 300 words.\n\nMeetings:\n${summary}`);
    if (content) content.innerHTML = `<p class="trends-report-text">${report}</p>`;
  } catch { if (content) content.innerHTML = '<p style="color:var(--red)">Failed to generate report. Check your API key.</p>'; }
}

// ─── ALL ACTIONS ──────────────────────────────────────────
function renderAllActions() {
  const list = document.getElementById('all-actions-list');
  if (!list) return;
  const all = meetings.flatMap(m=>(m.actions||[]).map((a,i)=>({action:a,meeting:m.title,date:m.date,meetingId:m.id,idx:i})));
  if (!all.length) { list.innerHTML = `<div class="empty-state"><i class="fa-solid fa-list-check"></i><p>No action items yet.</p></div>`; return; }
  const done = all.filter(a=>completedActions[`${a.meetingId}_${a.idx}`]).length;
  const progress = document.getElementById('actions-progress');
  if (progress) progress.textContent = `${done} / ${all.length} completed`;
  list.innerHTML = all.map(a => {
    const key = `${a.meetingId}_${a.idx}`; const isDone = completedActions[key];
    return `<div class="action-card"><input type="checkbox" class="action-checkbox" ${isDone?'checked':''} onchange="toggleActionGlobal('${key}',this)"/><div class="action-card-content"><p class="action-card-text ${isDone?'done':''}" id="gact-${key}">${a.action}</p><p class="action-card-meta">From: ${a.meeting} · ${new Date(a.date).toLocaleDateString()}</p></div></div>`;
  }).join('');
}

function toggleActionGlobal(key, checkbox) {
  completedActions[key] = checkbox.checked;
  localStorage.setItem('completedActions', JSON.stringify(completedActions));
  const span = document.getElementById(`gact-${key}`);
  if (span) span.className = `action-card-text ${checkbox.checked?'done':''}`;
  renderAllActions();
}

// ─── CUSTOM TAGS ──────────────────────────────────────────
function addCustomTag() {
  const val = document.getElementById('new-tag-input').value.trim();
  if (!val) return;
  customTags.push(val);
  localStorage.setItem('customTags', JSON.stringify(customTags));
  document.getElementById('new-tag-input').value = '';
  renderCustomTags();
}

function removeCustomTag(i) {
  customTags.splice(i, 1);
  localStorage.setItem('customTags', JSON.stringify(customTags));
  renderCustomTags();
}

function renderCustomTags() {
  const list = document.getElementById('custom-tags-list');
  if (!list) return;
  list.innerHTML = customTags.map((t,i)=>`<div class="custom-tag-chip"><span>${t}</span><button onclick="removeCustomTag(${i})"><i class="fa-solid fa-xmark"></i></button></div>`).join('');
}

// ─── NOTIFICATIONS ────────────────────────────────────────
function enableNotifications() {
  if (!('Notification' in window)) { alert('Notifications not supported.'); return; }
  Notification.requestPermission().then(p => { if (p==='granted') alert('✅ Notifications enabled!'); else alert('Notifications blocked.'); });
}

function scheduleActionReminders(meeting) {
  if (Notification.permission !== 'granted' || !meeting.actions?.length) return;
  setTimeout(() => {
    new Notification('MeetNotes Reminder 🔔', { body: `${meeting.actions.length} action item(s) from "${meeting.title}"`, icon: 'icon.png' });
  }, 60 * 60 * 1000);
}

// ─── BACKUP ───────────────────────────────────────────────
function exportAllData() {
  const data = { meetings, completedActions, exportDate: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = `meetnotes_backup_${new Date().toLocaleDateString('en-GB').replace(/\//g,'-')}.json`;
  a.click(); URL.revokeObjectURL(url);
}

function importData(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.meetings) { meetings = data.meetings; localStorage.setItem('meetings', JSON.stringify(meetings)); }
      if (data.completedActions) { completedActions = data.completedActions; localStorage.setItem('completedActions', JSON.stringify(completedActions)); }
      alert(`✅ Restored ${meetings.length} meetings!`);
      updateDashboard();
    } catch { alert('Invalid backup file!'); }
  };
  reader.readAsText(file);
}

// ─── SETTINGS ────────────────────────────────────────────
function saveApiKey() {
  const key = document.getElementById('settings-api-key').value.trim();
  localStorage.setItem('gemini-api-key', key);
  document.getElementById('api-key').value = key;
  alert('✅ API Key saved!');
}

function saveApiKeyQuick() {
  const key = document.getElementById('api-key').value.trim();
  if (!key) { alert('Please paste an API key first!'); return; }
  localStorage.setItem('gemini-api-key', key);
  const settingsKey = document.getElementById('settings-api-key');
  if (settingsKey) settingsKey.value = key;
  showToast('✅ API Key saved!');
}

function saveLang() {
  const lang = document.getElementById('settings-lang').value;
  localStorage.setItem('default-lang', lang);
  document.getElementById('lang-select').value = lang;
  alert('✅ Language saved!');
}

function clearAllData() {
  if (!confirm('Delete ALL meetings permanently?')) return;
  meetings = []; completedActions = {};
  localStorage.removeItem('meetings'); localStorage.removeItem('completedActions');
  alert('All data cleared.'); updateDashboard();
}

// ─── TOAST ────────────────────────────────────────────────
function showToast(message) {
  const toast = document.createElement('div');
  toast.style.cssText = `position:fixed;bottom:24px;right:24px;background:var(--green);color:#0f1117;padding:12px 20px;border-radius:10px;font-size:0.9rem;font-weight:600;z-index:9999;animation:fadeIn 0.3s ease;display:flex;align-items:center;gap:8px;`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ─── INIT ────────────────────────────────────────────────
updateDashboard();
// ─── EXPORT TRANSCRIPT JSON ───────────────────────────────
function exportTranscriptJSON() {
  if (!transcript.trim()) { alert('No transcript to export!'); return; }
  const data = {
    transcript,
    date: new Date().toISOString(),
    duration: document.getElementById('timer').textContent,
    attendees: document.getElementById('attendees-input').value || 'Not specified',
    summary: currentSummaryData || null
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `transcript_${new Date().toLocaleDateString('en-GB').replace(/\//g,'-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('✅ Transcript exported as JSON!');
}
// ─── EXPORT TRANSCRIPT PDF ────────────────────────────────
function exportTranscriptPDF() {
  if (!transcript.trim()) { alert('No transcript to export!'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(20); doc.setTextColor(108,99,255);
  doc.text('MeetNotes by Suhail — Full Transcript', 20, 20);
  doc.setFontSize(10); doc.setTextColor(100);
  doc.text(`Date: ${new Date().toLocaleDateString()} | Duration: ${document.getElementById('timer').textContent} | Attendees: ${document.getElementById('attendees-input').value || 'Not specified'}`, 20, 32);
  doc.setFontSize(10); doc.setTextColor(0);
  const lines = doc.splitTextToSize(transcript, 170);
  let y = 45;
  lines.forEach(line => {
    if (y > 270) { doc.addPage(); y = 20; }
    doc.text(line, 20, y);
    y += 6;
  });
  doc.save(`transcript_${new Date().toLocaleDateString('en-GB').replace(/\//g,'-')}.pdf`);
  showToast('✅ Transcript exported as PDF!');
}
// ─── UPLOAD AUDIO & TRANSCRIBE ────────────────────────────
async function uploadAudioTranscribe(event) {
  const file = event.target.files[0];
  if (!file) return;
  const apiKey = localStorage.getItem('gemini-api-key') || document.getElementById('api-key').value.trim();
  if (!apiKey) { alert('Please set your Gemini API key first!'); return; }

  const btn = document.getElementById('btn-upload-audio-label');
  if (btn) btn.textContent = '⏳ Transcribing...';
  showToast('🎵 Transcribing audio file...');

  try {
    // Convert file to base64
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const mimeType = file.type || 'audio/webm';

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: 'Please transcribe this audio recording accurately. Return only the transcript text, nothing else.' },
              { inline_data: { mime_type: mimeType, data: base64 } }
            ]
          }]
        })
      }
    );

    const data = await response.json();
    const transcribed = data.candidates[0].content.parts[0].text;
    transcript = transcribed;
    speakerTranscript = transcribed;

    const box = document.getElementById('transcript-box');
    if (box) box.innerHTML = `<span>${transcribed}</span>`;

    showToast('✅ Audio transcribed successfully!');
    if (btn) btn.textContent = '🎵 Upload Audio';

  } catch (err) {
    alert('Error transcribing audio. Check your API key!');
    console.error(err);
    if (btn) btn.textContent = '🎵 Upload Audio';
  }
}
