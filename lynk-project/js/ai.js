// ============================================================
// LYNK By Legends — AI Study Assistant Module (Phase 3)
// ============================================================

import { auth, db } from './firebase-config.js';
import { ThemeManager } from './theme.js';
import {
  doc, getDoc, setDoc, updateDoc, addDoc, collection,
  serverTimestamp, increment, query, where, getDocs, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { onAuthStateChanged, signOut as firebaseSignOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { initFCM, notifyAILimitReached } from './notifications-fcm.js';

ThemeManager.init();

let currentUser = null;
let currentUserData = null;
let currentMode = 'chat';
let chatHistory = [];
let aiSettings = null;
let uploadedFileContent = '';
let isPremium = false;
let userCredits = 0;
let isAdminUser = false;
let flutterwaveKey = null;
const NEW_USER_CREDITS   = 100;
const REFILL_CREDITS     = 100;
const REFILL_DAYS        = 15;

const MODE_CONFIG = {
  chat:       { title: 'Ask Anything',       subtitle: 'Your AI-powered study assistant',                icon: '🤖' },
  summarize:  { title: 'Summarize Notes',    subtitle: 'Upload notes or paste text to get a summary',   icon: '📄' },
  flashcards: { title: 'Flashcard Generator',subtitle: 'Generate flashcards from your study material',  icon: '🃏' },
  quiz:       { title: 'Practice Quiz',      subtitle: 'Generate quiz questions from your notes',        icon: '❓' },
  career:     { title: 'Career Assistant',   subtitle: 'CV writing, interview prep, and career guidance',icon: '💼' },
  studyplan:  { title: 'Study Planner',      subtitle: 'Create a personalised study schedule',           icon: '📅' },
  writing:    { title: 'Writing Assistant',  subtitle: 'Get help with essays, reports, and academic writing', icon: '✍️' },
};

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'auth.html'; return; }
  currentUser = user;
  const snap = await getDoc(doc(db, 'users', user.uid));
  currentUserData = snap.data() || {};

  const navAvatar = document.getElementById('nav-avatar');
  if (navAvatar) navAvatar.src = currentUserData.photoURL || `https://ui-avatars.com/api/?name=U&background=a855f7&color=fff`;

  if (currentUserData.role === 'admin' || currentUserData.adminRole) {
    document.getElementById('admin-link')?.classList.remove('hidden');
  }

  await checkPremiumStatus();
  await loadAISettings();
  await loadCredits();
  updateUsageUI();
  initFCM(user.uid).catch(() => {});
  try {
    const fwSnap = await getDoc(doc(db, 'settings', 'payments'));
    const fwData = fwSnap.data() || {};
    flutterwaveKey = fwData.flutterwavePublicKey || fwData.fw_public_key || null;
  } catch {}
});

async function checkPremiumStatus() {
  if (currentUserData.role === 'admin' || currentUserData.adminRole) {
    isPremium   = true;
    isAdminUser = true;
    userCredits = Infinity;
    return;
  }
  try {
    const snap = await getDoc(doc(db, 'premiumSubscriptions', currentUser.uid));
    if (snap.exists()) {
      const d = snap.data();
      isPremium = d.status === 'active' && d.expiresAt?.toDate?.() > new Date();
    }
  } catch (e) { console.warn('Premium check:', e.message); }
}

async function loadAISettings() {
  aiSettings = {};
  try {
    const pubSnap = await getDoc(doc(db, 'settings', 'ai_keys'));
    if (pubSnap.exists()) {
      const d = pubSnap.data();
      if (d.openai_key) aiSettings.openaiKey = d.openai_key;
      if (d.gemini_key) aiSettings.geminiKey = d.gemini_key;
      if (d.claude_key) aiSettings.claudeKey = d.claude_key;
      if (d.grok_key) {
        if (d.grok_key.startsWith('gsk_')) aiSettings.groqKey    = d.grok_key;
        else                               aiSettings.grokXAIKey = d.grok_key;
      }
      if (Object.keys(aiSettings).length > 0) return;
    }
  } catch (e) { console.warn('AI public key read:', e.message); }

  try {
    const settingSnap = await getDoc(doc(db, 'admin_config', 'ai_settings'));
    const defaultProvider = settingSnap.exists() ? (settingSnap.data().defaultProvider || 'openai') : 'openai';
    const providers = [defaultProvider, ...['openai','gemini','claude','grok'].filter(p => p !== defaultProvider)];
    for (const provider of providers) {
      try {
        const snap = await getDoc(doc(db, 'admin_config', 'ai_' + provider));
        if (!snap.exists()) continue;
        const data = snap.data();
        if (data.enabled === false) continue;
        const key = data.key1 || data.key2 || data.key3 || data.key4 || data.key5 || null;
        if (!key) continue;
        if (provider === 'openai') { aiSettings.openaiKey  = key; break; }
        if (provider === 'gemini') { aiSettings.geminiKey  = key; break; }
        if (provider === 'claude') { aiSettings.claudeKey  = key; break; }
        if (provider === 'grok') {
          if (key.startsWith('gsk_')) aiSettings.groqKey    = key;
          else                        aiSettings.grokXAIKey = key;
          break;
        }
      } catch (e) { console.warn('AI provider fallback:', provider, e.message); }
    }
  } catch (e) { console.warn('AI settings fallback failed:', e.message); }
}

async function loadCredits() {
  if (isAdminUser) {
    try { localStorage.setItem('lynk_ai_credits', 'unlimited'); } catch {}
    return;
  }
  try {
    const today   = new Date().toISOString().slice(0, 10);
    const userRef = doc(db, 'users', currentUser.uid);
    const snap    = await getDoc(userRef);
    const data    = snap.data() || {};
    let credits        = data.aiCredits ?? null;
    const lastRefill   = data.aiCreditsLastRefill || null;
    if (credits === null || !data.aiCreditsEverReceived) {
      credits = NEW_USER_CREDITS;
      await updateDoc(userRef, { aiCredits: NEW_USER_CREDITS, aiCreditsLastRefill: today, aiCreditsEverReceived: true });
    } else {
      const daysSince = lastRefill
        ? Math.floor((Date.now() - new Date(lastRefill).getTime()) / 86400000)
        : 999;
      if (daysSince >= REFILL_DAYS) {
        credits = Math.max(credits, 0) + REFILL_CREDITS;
        await updateDoc(userRef, { aiCredits: credits, aiCreditsLastRefill: today });
      }
    }
    userCredits = credits;
    try { localStorage.setItem('lynk_ai_credits', credits); } catch {}
  } catch (e) {
    console.warn('loadCredits error:', e.message);
    if (userCredits <= 0) userCredits = NEW_USER_CREDITS;
  }
}

function updateUsageUI() {
  const bar       = document.getElementById('ai-usage-bar');
  const text      = document.getElementById('ai-usage-text');
  const badge     = document.getElementById('ai-usage-badge');
  const status    = document.getElementById('ai-sidebar-status');
  const paywall   = document.getElementById('ai-paywall');
  const lowBanner = document.getElementById('ai-low-credit-banner');
  const lowText   = document.getElementById('ai-low-credit-text');
  const input     = document.getElementById('ai-input');
  const sendBtn   = document.getElementById('ai-send-btn');
  try { localStorage.setItem('lynk_ai_premium', isPremium ? '1' : '0'); } catch {}
  if (isPremium) {
    if (bar) { bar.style.width = '100%'; bar.style.background = 'linear-gradient(135deg,#22c55e,#10b981)'; }
    if (text)   text.textContent   = isAdminUser ? 'Admin — Unlimited' : 'Unlimited queries';
    if (badge)  badge.textContent  = isAdminUser ? '🛡️ Admin' : '⭐ Premium — Unlimited';
    if (status) status.textContent = isAdminUser ? '🛡️ Admin — Unlimited' : '⭐ Premium Active';
    if (paywall)   paywall.classList.add('hidden');
    if (lowBanner) lowBanner.classList.add('hidden');
    if (input)   input.disabled   = false;
    if (sendBtn) sendBtn.disabled = false;
  } else {
    const pct = Math.min(100, (userCredits / 100) * 100);
    if (bar) { bar.style.width = pct + '%'; bar.style.background = ''; }
    if (text)   text.textContent   = `${userCredits.toLocaleString()} credits remaining`;
    if (badge)  badge.textContent  = `💳 ${userCredits.toLocaleString()} credits`;
    if (status) status.textContent = `${userCredits.toLocaleString()} credits left`;
    if (userCredits <= 0) {
      if (paywall)   paywall.classList.remove('hidden');
      if (lowBanner) lowBanner.classList.add('hidden');
      if (input)   input.disabled   = true;
      if (sendBtn) sendBtn.disabled = true;
      notifyAILimitReached({ toUid: currentUser.uid }).catch(() => {});
    } else if (userCredits <= 20) {
      if (paywall)   paywall.classList.add('hidden');
      if (lowBanner) lowBanner.classList.remove('hidden');
      if (lowText)   lowText.textContent = `Only ${userCredits} credit${userCredits === 1 ? '' : 's'} left — top up to keep chatting`;
      if (input)   input.disabled   = false;
      if (sendBtn) sendBtn.disabled = false;
    } else {
      if (paywall)   paywall.classList.add('hidden');
      if (lowBanner) lowBanner.classList.add('hidden');
      if (input)   input.disabled   = false;
      if (sendBtn) sendBtn.disabled = false;
    }
  }
}

async function deductCredits(wordCount) {
  const cost = Math.max(1, wordCount);
  userCredits = Math.max(0, userCredits - cost);
  try { await updateDoc(doc(db, 'users', currentUser.uid), { aiCredits: userCredits }); } catch {}
  updateUsageUI();
}

// ===== SEND AI MESSAGE =====
window.sendAIMessage = async () => {
  const input   = document.getElementById('ai-input');
  const sendBtn = document.getElementById('ai-send-btn');
  const message = input?.value.trim();
  if (!message && !uploadedFileContent) return;

  const wordCount = (message || '').split(/\s+/).filter(Boolean).length || 1;
  if (!isPremium) {
    if (userCredits <= 0) { showCreditWarning(wordCount, 0); return; }
    if (wordCount > userCredits) { showCreditWarning(wordCount, userCredits); return; }
  }

  const fullMessage = uploadedFileContent
    ? `${message}\n\n--- UPLOADED DOCUMENT ---\n${uploadedFileContent.slice(0, 8000)}`
    : message;

  input.value = '';
  autoResizeAI(input);
  clearCreditWarning();
  updateLiveWordCount(input);
  uploadedFileContent = '';
  if (sendBtn) sendBtn.classList.add('loading');

  appendUserMessage(message);
  chatHistory.push({ role: 'user', content: fullMessage });
  showTypingIndicator();

  const response = await callAI(fullMessage, currentMode);
  hideTypingIndicator();
  if (sendBtn) sendBtn.classList.remove('loading');
  await appendBotMessageStream(response);
  chatHistory.push({ role: 'assistant', content: response });

  if (!isPremium) await deductCredits(wordCount);

  try {
    await addDoc(collection(db, 'aiUsageLogs'), {
      uid: currentUser.uid,
      mode: currentMode,
      messageLength: fullMessage.length,
      responseLength: response.length,
      createdAt: serverTimestamp()
    });
  } catch {}
};

async function callAI(message, mode) {
  const systemPrompts = {
    chat:       `You are LYNK AI, a helpful academic assistant for university students in Nigeria. Help with academic questions, explain concepts clearly, solve problems, and provide study advice. Be encouraging, clear, and thorough. Format responses with Markdown — use **bold**, bullet points, numbered lists, and code blocks where appropriate.`,
    summarize:  `You are LYNK AI. Summarize the provided text/notes into: 1) A concise summary, 2) Key points (bullet list), 3) Important terms/definitions, 4) Suggested revision questions. Use Markdown formatting.`,
    flashcards: `You are LYNK AI. Generate 10 flashcards from the provided content. Format each as: FRONT: [question/term] | BACK: [answer/definition]. Separate each card with a newline.`,
    quiz:       `You are LYNK AI. Generate 10 multiple-choice questions. For each: Q: [question]\nA) [option] B) [option] C) [option] D) [option]\nAnswer: [letter]\nExplanation: [brief explanation]`,
    career:     `You are LYNK AI Career Assistant, specialized in helping Nigerian university students with career development. Use Markdown to structure your response with headers and bullet points.`,
    studyplan:  `You are LYNK AI Study Planner. Create detailed, practical study plans. Break down topics by week and day. Use Markdown tables and lists for clarity.`,
    writing:    `You are LYNK AI Writing Assistant. Help students improve academic writing. Check grammar, suggest improvements, and provide examples. Use Markdown formatting.`,
  };

  const systemPrompt = systemPrompts[mode] || systemPrompts.chat;

  const queue = [];
  if (aiSettings?.openaiKey?.startsWith('sk-'))
    queue.push({ name: 'OpenAI',   fn: () => callOpenAI(message, systemPrompt, aiSettings.openaiKey) });
  if (aiSettings?.groqKey?.startsWith('gsk_'))
    queue.push({ name: 'Groq',     fn: () => callGroq(message, systemPrompt, aiSettings.groqKey) });
  if (aiSettings?.geminiKey)
    queue.push({ name: 'Gemini',   fn: () => callGemini(message, systemPrompt, aiSettings.geminiKey) });
  if (aiSettings?.grokXAIKey?.startsWith('xai-'))
    queue.push({ name: 'Grok xAI', fn: () => callGrokXAI(message, systemPrompt, aiSettings.grokXAIKey) });

  if (queue.length === 0) {
    console.warn('LYNK AI: no API keys configured.');
    return '⚠️ **LYNK AI is not configured.** Please ask an admin to add API keys in the admin panel, then refresh this page.';
  }

  const errors = [];
  for (const provider of queue) {
    try {
      const result = await provider.fn();
      return result;
    } catch (err) {
      console.warn(`LYNK AI: ${provider.name} failed —`, err.message);
      errors.push(`${provider.name}: ${err.message}`);
    }
  }

  return `⚠️ **LYNK AI couldn't reach any provider right now.** This is usually a temporary API issue or an invalid key.\n\n*Details (for admin):* ${errors.join(' | ')}`;
}

async function callOpenAI(message, systemPrompt, apiKey) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...chatHistory.slice(-6),
    { role: 'user', content: message }
  ];
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'gpt-3.5-turbo', messages, max_tokens: 1500, temperature: 0.7 })
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callGroq(message, systemPrompt, apiKey) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...chatHistory.slice(-6),
    { role: 'user', content: message }
  ];
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'llama3-8b-8192', messages, max_tokens: 1500, temperature: 0.7 })
  });
  if (!res.ok) throw new Error(`Groq ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callGemini(message, systemPrompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const fullPrompt = `${systemPrompt}\n\nUser: ${message}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }] })
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.';
}

async function callGrokXAI(message, systemPrompt, apiKey) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...chatHistory.slice(-6),
    { role: 'user', content: message }
  ];
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'grok-beta', messages, max_tokens: 1500, temperature: 0.7 })
  });
  if (!res.ok) throw new Error(`Grok ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

// ===== MARKDOWN RENDERER (uses marked.js loaded in HTML) =====
function renderMarkdown(text) {
  try {
    if (typeof marked !== 'undefined') {
      marked.setOptions({
        breaks: true,
        gfm: true,
        sanitize: false,
      });
      return marked.parse(text);
    }
  } catch {}
  // Fallback: basic formatting
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/\n/g, '<br>');
}

// ===== CHAT UI HELPERS =====
function appendUserMessage(text) {
  const container = document.getElementById('ai-messages');
  const el = document.createElement('div');
  el.className = 'ai-msg-user-wrap fade-in';
  el.innerHTML = `
    <div class="ai-msg-user">
      <div class="ai-msg-avatar ai-msg-avatar-user">
        <img src="${currentUserData?.photoURL || `https://ui-avatars.com/api/?name=U&background=a855f7&color=fff`}" alt="You" />
      </div>
      <div class="ai-msg-bubble ai-msg-bubble-user">${escHtml(text)}</div>
    </div>`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

// Streaming word-by-word effect
function appendBotMessageStream(text) {
  return new Promise((resolve) => {
    const container = document.getElementById('ai-messages');
    const wrapper = document.createElement('div');
    wrapper.className = 'ai-msg-bot-wrap fade-in';

    const html = renderMarkdown(text);
    // We'll do a character-level streaming effect on a span overlay
    wrapper.innerHTML = `
      <div class="ai-msg-bot">
        <div class="ai-msg-avatar ai-msg-avatar-bot">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </div>
        <div class="ai-msg-bubble ai-msg-bubble-bot">
          <div class="ai-msg-content" id="ai-stream-content-${Date.now()}"></div>
          <div class="ai-msg-actions">
            <button class="ai-copy-btn" title="Copy" data-text="${escAttr(text)}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              Copy
            </button>
          </div>
        </div>
      </div>`;

    container.appendChild(wrapper);
    container.scrollTop = container.scrollHeight;

    // Wire up copy button
    wrapper.querySelector('.ai-copy-btn')?.addEventListener('click', function() {
      const rawText = this.getAttribute('data-text');
      navigator.clipboard.writeText(rawText).then(() => {
        this.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
        this.style.color = '#22c55e';
        setTimeout(() => {
          this.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
          this.style.color = '';
        }, 2000);
      }).catch(() => {
        this.textContent = 'Failed';
        setTimeout(() => { this.textContent = 'Copy'; }, 2000);
      });
    });

    // Streaming animation: reveal the parsed HTML word by word
    const contentEl = wrapper.querySelector('[id^="ai-stream-content-"]');
    if (!contentEl) { resolve(); return; }

    // Extract plain text tokens from the rendered HTML to drive the animation
    // We render a hidden full version and progressively reveal characters
    const words = text.split(/(\s+)/);
    let currentText = '';
    let idx = 0;
    const WORD_DELAY = 18; // ms per word — fast, ChatGPT-like

    function revealNext() {
      if (idx >= words.length) {
        // Final render with full markdown
        contentEl.innerHTML = html;
        container.scrollTop = container.scrollHeight;
        resolve();
        return;
      }
      currentText += words[idx++];
      // For streaming preview, use simple markdown so it's fast
      contentEl.innerHTML = renderMarkdown(currentText) + '<span class="ai-cursor">▍</span>';
      container.scrollTop = container.scrollHeight;
      setTimeout(revealNext, WORD_DELAY);
    }
    revealNext();
  });
}

window.copyAIMessage = (btn, text) => {
  navigator.clipboard.writeText(text).then(() => {
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
    btn.style.color = '#22c55e';
    setTimeout(() => {
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
      btn.style.color = '';
    }, 2000);
  }).catch(() => { btn.textContent = 'Failed'; setTimeout(() => { btn.textContent = 'Copy'; }, 2000); });
};

let _aiTimerInterval = null;
let _aiTimerStart   = null;

function showTypingIndicator() {
  const container = document.getElementById('ai-messages');
  const el = document.createElement('div');
  el.id = 'ai-typing';
  el.className = 'ai-msg-bot-wrap fade-in';
  el.innerHTML = `
    <div class="ai-msg-bot">
      <div class="ai-msg-avatar ai-msg-avatar-bot">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      </div>
      <div class="ai-msg-bubble ai-msg-bubble-bot ai-typing-bubble">
        <div class="ai-typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
        <span id="ai-timer-label" class="ai-typing-label">LYNK AI is thinking…</span>
      </div>
    </div>`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  _aiTimerStart = Date.now();
  _aiTimerInterval = setInterval(() => {
    const label = document.getElementById('ai-timer-label');
    const secs = ((Date.now() - _aiTimerStart) / 1000).toFixed(1);
    if (label) label.textContent = `LYNK AI is thinking… ${secs}s`;
  }, 100);
}

function hideTypingIndicator() {
  clearInterval(_aiTimerInterval);
  _aiTimerInterval = null;
  _aiTimerStart    = null;
  document.getElementById('ai-typing')?.remove();
}

// ===== CREDIT HELPERS =====
function showCreditWarning(cost, remaining) {
  const el = document.getElementById('ai-credit-warning');
  if (!el) return;
  if (remaining <= 0) {
    el.textContent = '⚠️ You have no credits left. Buy more credits to keep chatting.';
  } else {
    el.textContent = `⚠️ Your message needs ${cost} credit${cost !== 1 ? 's' : ''} but you only have ${remaining} left. Shorten it, or buy more credits.`;
  }
  el.classList.remove('hidden');
}

function clearCreditWarning() {
  document.getElementById('ai-credit-warning')?.classList.add('hidden');
}

window.updateLiveWordCount = (el) => {
  const cost     = (el.value.trim().split(/\s+/).filter(Boolean)).length;
  const credDisp = document.getElementById('ai-credits-display');
  if (credDisp) {
    if (isPremium) {
      credDisp.style.color = '#22c55e';
      credDisp.textContent = isAdminUser ? '🛡️ Unlimited' : '⭐ Unlimited';
    } else if (cost > userCredits && userCredits > 0) {
      credDisp.style.color = '#ef4444';
      credDisp.textContent = `⚠️ Not enough credits`;
    } else if (cost > 0 && userCredits > 0) {
      credDisp.style.color = 'var(--text-muted)';
      credDisp.textContent = `${(userCredits - cost).toLocaleString()} credits after send`;
    } else {
      credDisp.style.color = 'var(--text-muted)';
      credDisp.textContent = `${userCredits.toLocaleString()} credits`;
    }
  }
};

// ===== BUY CREDITS =====
window.openBuyCredits = () => {
  document.getElementById('buy-credits-modal')?.classList.remove('hidden');
};

window.closeBuyCredits = (e) => {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('buy-credits-modal')?.classList.add('hidden');
};

window.updateCreditPreview = () => {
  const amt = Math.max(200, parseInt(document.getElementById('buy-credits-amount')?.value) || 200);
  const el = document.getElementById('credits-preview');
  if (el) el.textContent = amt.toLocaleString();
};

window.processBuyCredits = async () => {
  const amountEl = document.getElementById('buy-credits-amount');
  const amount = Math.max(200, parseInt(amountEl?.value) || 200);
  if (!flutterwaveKey) { alert('Payment not configured. Please contact admin.'); return; }
  const txRef = `LYNK_CREDITS_${currentUser.uid}_${Date.now()}`;
  FlutterwaveCheckout({
    public_key: flutterwaveKey,
    tx_ref: txRef,
    amount,
    currency: 'NGN',
    payment_options: 'card,banktransfer,ussd',
    customer: { email: currentUser.email, name: currentUserData.displayName || 'LYNK User' },
    customizations: {
      title: 'LYNK AI Credits',
      description: `${amount.toLocaleString()} AI Credits`,
      logo: window.location.origin + '/assets/logo.jpg',
    },
    callback: async (response) => {
      if (response.status === 'successful' || response.status === 'completed') {
        const newCredits = (userCredits || 0) + amount;
        try {
          await updateDoc(doc(db, 'users', currentUser.uid), { aiCredits: newCredits });
          await addDoc(collection(db, 'paymentLogs'), {
            uid: currentUser.uid, type: 'ai_credits', amount, credits: amount, currency: 'NGN',
            txRef, transactionId: response.transaction_id, status: 'success', createdAt: serverTimestamp()
          });
        } catch {}
        userCredits = newCredits;
        updateUsageUI();
        document.getElementById('buy-credits-modal')?.classList.add('hidden');
        clearCreditWarning();
        const input   = document.getElementById('ai-input');
        const sendBtn = document.getElementById('ai-send-btn');
        if (input)   input.disabled   = false;
        if (sendBtn) sendBtn.disabled = false;
        alert(`🎉 ${amount.toLocaleString()} credits added! You now have ${newCredits.toLocaleString()} credits.`);
      } else {
        alert('Payment was not completed. Please try again.');
      }
    },
    onclose: () => {},
  });
};

window.clearChat = () => {
  chatHistory = [];
  uploadedFileContent = '';
  const container = document.getElementById('ai-messages');
  container.innerHTML = `
    <div class="ai-msg-bot-wrap fade-in">
      <div class="ai-msg-bot">
        <div class="ai-msg-avatar ai-msg-avatar-bot">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </div>
        <div class="ai-msg-bubble ai-msg-bubble-bot">
          <div class="ai-msg-content">
            <p class="font-semibold mb-2">👋 Hi! I'm LYNK AI. How can I help you today?</p>
            <div class="flex flex-wrap gap-2 mt-2">
              <span class="ai-tool-chip" onclick="sendQuickPrompt('Explain a concept to me')">💡 Explain concepts</span>
              <span class="ai-tool-chip" onclick="switchAIMode('summarize')">📄 Summarize notes</span>
              <span class="ai-tool-chip" onclick="switchAIMode('flashcards')">🃏 Make flashcards</span>
              <span class="ai-tool-chip" onclick="switchAIMode('career')">💼 Career advice</span>
            </div>
          </div>
        </div>
      </div>
    </div>`;
};

window.sendQuickPrompt = (prompt) => {
  const input = document.getElementById('ai-input');
  if (input) {
    input.value = prompt;
    autoResizeAI(input);
    sendAIMessage();
  }
};

window.switchAIMode = (mode) => {
  currentMode = mode;
  uploadedFileContent = '';
  Object.keys(MODE_CONFIG).forEach(m => {
    const btn = document.getElementById(`mode-${m}`);
    if (btn) btn.classList.toggle('active', m === mode);
  });
  const config = MODE_CONFIG[mode] || MODE_CONFIG.chat;
  const title    = document.getElementById('ai-mode-title');
  const subtitle = document.getElementById('ai-mode-subtitle');
  if (title)    title.textContent    = config.title;
  if (subtitle) subtitle.textContent = config.subtitle;

  const views = ['flashcards-view', 'quiz-view', 'career-view', 'studyplan-view'];
  views.forEach(v => document.getElementById(v)?.classList.add('hidden'));
  document.getElementById('ai-upload-panel')?.classList.add('hidden');

  if (mode === 'flashcards') {
    document.getElementById('flashcards-view').classList.remove('hidden');
    document.getElementById('ai-upload-panel').classList.remove('hidden');
  } else if (mode === 'quiz') {
    document.getElementById('quiz-view').classList.remove('hidden');
    document.getElementById('ai-upload-panel').classList.remove('hidden');
  } else if (mode === 'career') {
    document.getElementById('career-view').classList.remove('hidden');
  } else if (mode === 'studyplan') {
    document.getElementById('studyplan-view').classList.remove('hidden');
  } else {
    document.getElementById('chat-view').classList.remove('hidden');
    if (mode === 'summarize' || mode === 'writing') {
      document.getElementById('ai-upload-panel').classList.remove('hidden');
    }
    updateQuickPrompts(mode);
  }
};

function updateQuickPrompts(mode) {
  const prompts = {
    summarize: [
      { label: '📄 Summarize my notes', prompt: 'Please summarize the notes I uploaded and extract the key points.' },
      { label: '🔑 Extract key terms',   prompt: 'Extract and define all key terms and concepts from my notes.' },
      { label: '❓ Generate questions',  prompt: 'Generate 10 revision questions from my notes to test my understanding.' },
    ],
    writing: [
      { label: '📝 Essay outline',    prompt: 'Help me create an essay outline for my topic.' },
      { label: '✅ Check my grammar', prompt: 'Check the grammar and clarity of this text:' },
      { label: '📚 Improve writing',  prompt: 'How can I make this paragraph more academic?' },
    ],
    chat: [
      { label: '🌱 Photosynthesis', prompt: 'Explain the concept of photosynthesis' },
      { label: '📐 Math Help',      prompt: 'Help me solve a quadratic equation step by step' },
      { label: '📄 CV Writing',     prompt: 'Write a professional introduction for my CV' },
      { label: '❓ Quiz Me',        prompt: "Create 5 practice questions on Newton's laws" },
    ],
  };
  const container = document.getElementById('quick-prompts');
  const modePrompts = prompts[mode] || prompts.chat;
  container.innerHTML = modePrompts.map(p =>
    `<button class="ai-tool-chip" onclick="sendQuickPrompt('${p.prompt.replace(/'/g, "\\'")}')">${p.label}</button>`
  ).join('');
}

window.handleAIKeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAIMessage(); }
};

window.autoResizeAI = (el) => {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
};

window.handleInlineFileUpload = async (input) => {
  const file = input.files[0];
  if (!file) return;
  const fileNameEl = document.getElementById('ai-file-name');
  if (file.type === 'text/plain') {
    uploadedFileContent = await file.text();
    if (fileNameEl) { fileNameEl.textContent = `📎 ${file.name} ready`; fileNameEl.classList.remove('hidden'); }
  } else if (file.type === 'application/pdf') {
    uploadedFileContent = `[PDF file uploaded: ${file.name}]`;
    if (fileNameEl) { fileNameEl.textContent = `📎 ${file.name} (PDF) ready`; fileNameEl.classList.remove('hidden'); }
  } else {
    uploadedFileContent = `[File uploaded: ${file.name}]`;
    if (fileNameEl) { fileNameEl.textContent = `📎 ${file.name} ready`; fileNameEl.classList.remove('hidden'); }
  }
};
window.handleAIFileUpload = window.handleInlineFileUpload;

// ===== FLASHCARDS =====
window.generateFlashcards = async () => {
  if (!uploadedFileContent) {
    appendUserMessage('');
    await appendBotMessageStream('Please upload your notes or type your content in the chat below first!');
    document.getElementById('chat-view').classList.remove('hidden');
    document.getElementById('flashcards-view').classList.add('hidden');
    return;
  }
  const prompt = `Generate 10 flashcards from this content:\n\n${uploadedFileContent}`;
  showTypingIndicator();
  const response = await callAI(prompt, 'flashcards');
  hideTypingIndicator();
  const cards = response.split('\n').filter(line => line.includes('FRONT:') && line.includes('BACK:'));
  const container = document.getElementById('flashcards-container');
  if (cards.length === 0) {
    container.innerHTML = `<div class="col-span-full ai-msg-bubble ai-msg-bubble-bot"><div class="ai-msg-content">${renderMarkdown(response)}</div></div>`;
    return;
  }
  container.innerHTML = '';
  cards.forEach((card, i) => {
    const parts = card.split(' | ');
    const front = parts[0]?.replace('FRONT:', '').trim();
    const back  = parts[1]?.replace('BACK:', '').trim();
    container.insertAdjacentHTML('beforeend', `
      <div class="flashcard fade-in" onclick="this.classList.toggle('flipped')" title="Click to flip">
        <div class="flashcard-inner">
          <div class="flashcard-front"><div>
            <p class="text-xs font-semibold mb-2" style="color:var(--grad-1)">CARD ${i + 1} — QUESTION</p>
            <p class="text-sm font-medium">${escHtml(front)}</p>
            <p class="text-xs mt-3" style="color:var(--text-muted)">Tap to reveal answer</p>
          </div></div>
          <div class="flashcard-back"><div>
            <p class="text-xs font-semibold mb-2" style="color:var(--grad-2)">ANSWER</p>
            <p class="text-sm">${escHtml(back)}</p>
          </div></div>
        </div>
      </div>`);
  });
};

// ===== CAREER ACTIONS =====
window.careerAction = async (action) => {
  const prompts = {
    cv:         'Help me write a professional CV for a Nigerian university student. Ask me for my details first, then create a structured CV template.',
    interview:  'Give me the top 20 interview questions and model answers for job interviews at Nigerian companies like MTN, Access Bank, Flutterwave, Andela, and multinationals.',
    roadmap:    `Create a detailed career roadmap for a ${currentUserData.department || 'university'} student. Include skills, certifications, internship opportunities, and job prospects.`,
    internship: 'Give me practical tips for finding and securing internships as a Nigerian university student. Include company names, application tips, and how to stand out.',
    skills:     `Analyze the most in-demand skills for ${currentUserData.department || 'university'} graduates in Nigeria in 2025-2026.`,
    salary:     `What is the typical salary range for fresh graduates with a ${currentUserData.department || 'university'} degree in Nigeria? Break it down by industry and location.`,
  };
  document.getElementById('career-view').classList.add('hidden');
  document.getElementById('chat-view').classList.remove('hidden');
  await sendQuickPrompt(prompts[action]);
};

// ===== STUDY PLAN =====
window.generateStudyPlan = async () => {
  const subject = document.getElementById('studyplan-subject').value.trim();
  const weeks   = document.getElementById('studyplan-weeks').value;
  const level   = document.getElementById('studyplan-level').value;
  const goals   = document.getElementById('studyplan-goals').value.trim();
  if (!subject) { alert('Please enter your subject(s)'); return; }
  const prompt = `Create a detailed ${weeks}-week study plan for: ${subject}. Level: ${level}. ${goals ? 'Goals/notes: ' + goals : ''} Include daily tasks, topics, practice exercises, and revision sessions. Format with Markdown tables and lists.`;
  const resultEl = document.getElementById('studyplan-result');
  resultEl.innerHTML = '<div class="text-center py-4" style="color:var(--text-muted)"><div class="spinner w-6 h-6 border-4 rounded-full mx-auto mb-2" style="border-color:var(--grad-1);border-top-color:transparent"></div>Generating your study plan...</div>';
  const response = await callAI(prompt, 'studyplan');
  resultEl.innerHTML = `<div class="ai-msg-bubble ai-msg-bubble-bot"><div class="ai-msg-content">${renderMarkdown(response)}</div></div>`;
};

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escAttr(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

window.signOut = async () => {
  await firebaseSignOut(auth);
  window.location.href = 'auth.html';
};
