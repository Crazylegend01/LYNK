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
let usageToday = 0;
const FREE_LIMIT_MINUTES = 30;

const MODE_CONFIG = {
  chat: { title: 'Ask Anything', subtitle: 'Your AI-powered study assistant', icon: '🤖' },
  summarize: { title: 'Summarize Notes', subtitle: 'Upload notes or paste text to get a summary', icon: '📄' },
  flashcards: { title: 'Flashcard Generator', subtitle: 'Generate flashcards from your study material', icon: '🃏' },
  quiz: { title: 'Practice Quiz', subtitle: 'Generate quiz questions from your notes', icon: '❓' },
  career: { title: 'Career Assistant', subtitle: 'CV writing, interview prep, and career guidance', icon: '💼' },
  studyplan: { title: 'Study Planner', subtitle: 'Create a personalised study schedule', icon: '📅' },
  writing: { title: 'Writing Assistant', subtitle: 'Get help with essays, reports, and academic writing', icon: '✍️' },
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
  await loadUsageToday();
  updateUsageUI();
  initFCM(user.uid).catch(() => {});
});

async function checkPremiumStatus() {
  // Admins and super admins always have premium access for free
  if (currentUserData.role === 'admin' || currentUserData.adminRole) {
    isPremium = true;
    return;
  }
  const snap = await getDoc(doc(db, 'premiumSubscriptions', currentUser.uid));
  if (snap.exists()) {
    const d = snap.data();
    isPremium = d.status === 'active' && d.expiresAt?.toDate?.() > new Date();
  }
}

async function loadAISettings() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'ai'));
    aiSettings = snap.data() || {};
  } catch { aiSettings = {}; }
}

async function loadUsageToday() {
  const today = new Date().toISOString().slice(0, 10);
  const usageRef = doc(db, 'aiUsage', `${currentUser.uid}_${today}`);
  const snap = await getDoc(usageRef);
  usageToday = snap.exists() ? (snap.data().minutes || 0) : 0;
}

function updateUsageUI() {
  const bar = document.getElementById('ai-usage-bar');
  const text = document.getElementById('ai-usage-text');
  const badge = document.getElementById('ai-usage-badge');
  const status = document.getElementById('ai-sidebar-status');
  const paywall = document.getElementById('ai-paywall');

  if (isPremium) {
    if (bar) bar.style.width = '100%';
    if (bar) bar.style.background = 'linear-gradient(135deg,#22c55e,#10b981)';
    if (text) text.textContent = 'Unlimited queries';
    if (badge) badge.textContent = '⭐ Premium — Unlimited';
    if (status) status.textContent = '⭐ Premium Active';
    if (paywall) paywall.classList.add('hidden');
  } else {
    const pct = Math.min(100, (usageToday / FREE_LIMIT_MINUTES) * 100);
    if (bar) bar.style.width = pct + '%';
    if (text) text.textContent = `${Math.max(0, FREE_LIMIT_MINUTES - usageToday)} min left today`;
    if (badge) badge.textContent = `Free: ${usageToday}/${FREE_LIMIT_MINUTES} min`;
    if (status) status.textContent = `Free tier: ${usageToday}/${FREE_LIMIT_MINUTES} min used today`;

    if (usageToday >= FREE_LIMIT_MINUTES) {
      if (paywall) paywall.classList.remove('hidden');
      const input = document.getElementById('ai-input');
      const sendBtn = document.getElementById('ai-send-btn');
      if (input) input.disabled = true;
      if (sendBtn) sendBtn.disabled = true;
      // Notify user their limit is reached (shows toast + queues push)
      if (usageToday === FREE_LIMIT_MINUTES && currentUser) {
        notifyAILimitReached({ toUid: currentUser.uid }).catch(() => {});
      }
    }
  }
}

async function trackUsage() {
  const today = new Date().toISOString().slice(0, 10);
  const usageRef = doc(db, 'aiUsage', `${currentUser.uid}_${today}`);
  await setDoc(usageRef, {
    uid: currentUser.uid,
    date: today,
    minutes: increment(1)
  }, { merge: true });
  usageToday = Math.min(usageToday + 1, FREE_LIMIT_MINUTES + 1);
  updateUsageUI();
}

// ===== SEND AI MESSAGE =====
window.sendAIMessage = async () => {
  if (!isPremium && usageToday >= FREE_LIMIT_MINUTES) return;

  const input = document.getElementById('ai-input');
  const message = input?.value.trim();
  if (!message && !uploadedFileContent) return;

  const fullMessage = uploadedFileContent
    ? `${message}\n\n--- UPLOADED DOCUMENT ---\n${uploadedFileContent.slice(0, 8000)}`
    : message;

  input.value = '';
  autoResizeAI(input);
  uploadedFileContent = '';

  appendUserMessage(message);
  chatHistory.push({ role: 'user', content: fullMessage });
  showTypingIndicator();

  const response = await callAI(fullMessage, currentMode);
  hideTypingIndicator();
  appendBotMessage(response);
  chatHistory.push({ role: 'assistant', content: response });

  if (!isPremium) await trackUsage();

  await addDoc(collection(db, 'aiUsageLogs'), {
    uid: currentUser.uid,
    mode: currentMode,
    messageLength: fullMessage.length,
    responseLength: response.length,
    createdAt: serverTimestamp()
  });
};

async function callAI(message, mode) {
  const systemPrompts = {
    chat: `You are LYNK AI, a helpful academic assistant for university students in Nigeria. You help with academic questions, explain concepts clearly, solve problems, and provide study advice. Be encouraging, clear, and thorough.`,
    summarize: `You are LYNK AI. Summarize the provided text/notes into: 1) A concise summary, 2) Key points (bullet list), 3) Important terms/definitions, 4) Suggested revision questions. Be thorough but clear.`,
    flashcards: `You are LYNK AI. Generate 10 flashcards from the provided content. Format each as: FRONT: [question/term] | BACK: [answer/definition]. Separate each card with a newline.`,
    quiz: `You are LYNK AI. Generate 10 multiple-choice questions from the provided content. For each question: Q: [question]\nA) [option] B) [option] C) [option] D) [option]\nAnswer: [letter]\nExplanation: [brief explanation]`,
    career: `You are LYNK AI Career Assistant, specialized in helping Nigerian university students with career development, CV writing, interview preparation, and professional growth. Be practical and encouraging.`,
    studyplan: `You are LYNK AI Study Planner. Create detailed, practical study plans for students. Break down topics by week and day. Include breaks, revision sessions, and practice tests.`,
    writing: `You are LYNK AI Writing Assistant. Help students improve their academic writing — essays, reports, research papers, and emails. Check grammar, suggest improvements, and provide examples.`,
  };

  try {
    // Try OpenAI first, then Gemini, then fallback
    const apiKey = aiSettings?.openaiKey || aiSettings?.openai_key;
    if (apiKey && apiKey.startsWith('sk-')) {
      return await callOpenAI(message, mode, systemPrompts[mode] || systemPrompts.chat, apiKey);
    }

    const geminiKey = aiSettings?.geminiKey || aiSettings?.gemini_key;
    if (geminiKey) {
      return await callGemini(message, mode, systemPrompts[mode] || systemPrompts.chat, geminiKey);
    }

    // Fallback: Smart local responses
    return generateLocalResponse(message, mode);
  } catch (err) {
    console.warn('AI API error:', err.message);
    return generateLocalResponse(message, mode);
  }
}

async function callOpenAI(message, mode, systemPrompt, apiKey) {
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

  if (!res.ok) throw new Error(`OpenAI error: ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callGemini(message, mode, systemPrompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`;
  const fullPrompt = `${systemPrompt}\n\nUser: ${message}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }] })
  });

  if (!res.ok) throw new Error(`Gemini error: ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.';
}

function generateLocalResponse(message, mode) {
  const responses = {
    chat: [
      "That's a great academic question! To give you the best answer, I'd recommend breaking this topic down into key concepts first. Could you share more context about which course or subject this is for?",
      "Excellent question! This topic connects several important ideas. Let me explain it step by step: \n\n1. First, understand the foundational concept\n2. Then apply it to practical examples\n3. Finally, test your understanding with practice questions\n\nWould you like me to dive deeper into any of these steps?",
      "I can help you with that! Based on academic best practices, here's what you should know about this topic. Remember, the key to mastering any subject is consistent practice and understanding the core principles.",
    ],
    summarize: "**Summary of Your Notes:**\n\n📌 **Key Points:**\n• [Main concept 1 from your text]\n• [Main concept 2 from your text]\n• [Key terminology and definitions]\n\n📝 **Core Ideas:**\nYour notes cover several important topics. The main theme revolves around understanding fundamental principles and their practical applications.\n\n❓ **Suggested Practice Questions:**\n1. What is the main concept discussed?\n2. How does this apply in practice?\n3. What are the key differences between the terms mentioned?\n\n*Note: Configure an AI API key in admin settings for precise summaries of your actual content.*",
    flashcards: "FRONT: What is the primary purpose of this concept? | BACK: It serves to explain the relationship between variables in the system\n\nFRONT: Define the key term | BACK: A fundamental unit that describes a specific property or behavior\n\nFRONT: What are the main applications? | BACK: Used in analysis, research, and practical problem-solving\n\n*Upload your actual notes and configure an API key for accurate flashcards!*",
    quiz: "**Practice Quiz — Generated from your request:**\n\nQ1: Which of the following best describes the concept?\nA) Option relating to theory\nB) Option relating to practice\nC) Option relating to application ✓\nD) None of the above\nAnswer: C\nExplanation: The practical application is the most direct use case.\n\n*Configure an OpenAI or Gemini API key in the admin dashboard for real quiz generation from your notes!*",
    career: "**Career Guidance for Nigerian University Students:**\n\n🎯 **Top Tips:**\n\n1. **Build your portfolio early** — Start projects in your field\n2. **Network on LinkedIn** — Connect with professionals in Nigeria\n3. **Internships** — Apply to companies like MTN, Flutterwave, Andela, Access Bank\n4. **Certifications** — Get industry-relevant certificates (Google, Coursera, etc.)\n5. **Soft skills** — Communication and leadership matter a lot\n\nWhat specific area would you like help with? (CV, interview prep, job search, salary negotiation)",
    studyplan: "**Personalized Study Plan:**\n\n📅 **2-Week Study Schedule:**\n\n**Week 1:** Foundation\n- Days 1-2: Review core concepts and textbook chapters\n- Days 3-4: Practice problems and exercises\n- Days 5-6: Group study and discussion\n- Day 7: Rest and light review\n\n**Week 2:** Deep Practice\n- Days 8-9: Past exam questions\n- Days 10-11: Weak areas focus\n- Days 12-13: Full mock exams\n- Day 14: Final review and rest\n\n💡 **Tips:** Study for 45-min sessions with 15-min breaks (Pomodoro technique). Stay hydrated!",
    writing: "**Writing Assistance:**\n\nHere are key principles for strong academic writing:\n\n✏️ **Structure:** Introduction → Body → Conclusion\n📖 **Clarity:** Use simple, clear language. Avoid jargon unless necessary.\n🔗 **Coherence:** Connect ideas with transition words (However, Furthermore, Therefore)\n📚 **Citations:** Always reference your sources properly (APA, MLA, or Chicago style)\n✅ **Revision:** Always proofread — grammar, spelling, and flow\n\nShare your draft or topic and I'll provide specific feedback!",
  };

  const modeResponses = responses[mode] || responses.chat;
  return modeResponses[Math.floor(Math.random() * modeResponses.length)];
}

// ===== UI HELPERS =====
function appendUserMessage(text) {
  const container = document.getElementById('ai-messages');
  const el = document.createElement('div');
  el.className = 'ai-message-user fade-in self-end';
  el.textContent = text;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function appendBotMessage(text) {
  const container = document.getElementById('ai-messages');
  const el = document.createElement('div');
  el.className = 'ai-message-bot fade-in';

  // Format markdown-like text
  const formatted = text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');

  el.innerHTML = formatted;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

let _aiTimerInterval = null;
let _aiTimerStart   = null;

function showTypingIndicator() {
  const container = document.getElementById('ai-messages');
  const el = document.createElement('div');
  el.id = 'ai-typing';
  el.className = 'ai-typing-indicator fade-in';
  el.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div><span id="ai-timer-label" class="text-xs ml-2" style="color:var(--text-muted)">LYNK AI is thinking… 0.0s</span>';
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  _aiTimerStart = Date.now();
  _aiTimerInterval = setInterval(() => {
    const label = document.getElementById('ai-timer-label');
    if (label) label.textContent = 'LYNK AI is thinking… ' + ((Date.now() - _aiTimerStart) / 1000).toFixed(1) + 's';
  }, 100);
}

function hideTypingIndicator() {
  clearInterval(_aiTimerInterval);
  _aiTimerInterval = null;
  _aiTimerStart    = null;
  document.getElementById('ai-typing')?.remove();
}

window.clearChat = () => {
  chatHistory = [];
  uploadedFileContent = '';
  const container = document.getElementById('ai-messages');
  container.innerHTML = `
    <div class="ai-message-bot fade-in">
      <p class="font-semibold mb-2">👋 Hi! I'm LYNK AI. How can I help you today?</p>
      <div class="flex flex-wrap gap-2 mt-2">
        <span class="ai-tool-chip" onclick="sendQuickPrompt('Explain a concept to me')">💡 Explain concepts</span>
        <span class="ai-tool-chip" onclick="switchAIMode('summarize')">📄 Summarize notes</span>
        <span class="ai-tool-chip" onclick="switchAIMode('flashcards')">🃏 Make flashcards</span>
        <span class="ai-tool-chip" onclick="switchAIMode('career')">💼 Career advice</span>
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

  // Update sidebar
  Object.keys(MODE_CONFIG).forEach(m => {
    const btn = document.getElementById(`mode-${m}`);
    if (btn) btn.classList.toggle('active', m === mode);
  });

  const config = MODE_CONFIG[mode] || MODE_CONFIG.chat;
  const title = document.getElementById('ai-mode-title');
  const subtitle = document.getElementById('ai-mode-subtitle');
  if (title) title.textContent = config.title;
  if (subtitle) subtitle.textContent = config.subtitle;

  // Show/hide panels
  const views = ['flashcards-view', 'quiz-view', 'career-view', 'studyplan-view', 'chat-view'];
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

    // Update quick prompts based on mode
    updateQuickPrompts(mode);
  }
};

function updateQuickPrompts(mode) {
  const prompts = {
    summarize: [
      { label: '📄 Summarize my notes', prompt: 'Please summarize the notes I uploaded and extract the key points.' },
      { label: '🔑 Extract key terms', prompt: 'Extract and define all key terms and concepts from my notes.' },
      { label: '❓ Generate questions', prompt: 'Generate 10 revision questions from my notes to test my understanding.' },
    ],
    writing: [
      { label: '📝 Essay outline', prompt: 'Help me create an essay outline for my topic.' },
      { label: '✅ Check my grammar', prompt: 'Check the grammar and clarity of this text:' },
      { label: '📚 Improve my writing', prompt: 'How can I make this paragraph more academic?' },
    ],
    chat: [
      { label: '🌱 Photosynthesis', prompt: 'Explain the concept of photosynthesis' },
      { label: '📐 Math Help', prompt: 'Help me solve a quadratic equation step by step' },
      { label: '📄 CV Writing', prompt: 'Write a professional introduction for my CV' },
      { label: '❓ Quiz Me', prompt: "Create 5 practice questions on Newton's laws" },
    ],
  };

  const container = document.getElementById('quick-prompts');
  const modePrompts = prompts[mode] || prompts.chat;
  container.innerHTML = modePrompts.map(p =>
    `<button class="ai-tool-chip" onclick="sendQuickPrompt('${p.prompt.replace(/'/g, "\\'")}'">${p.label}</button>`
  ).join('');
}

window.handleAIKeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendAIMessage();
  }
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
    const text = await file.text();
    uploadedFileContent = text;
    if (fileNameEl) { fileNameEl.textContent = `📎 ${file.name} ready`; fileNameEl.classList.remove('hidden'); }
  } else if (file.type === 'application/pdf') {
    uploadedFileContent = `[PDF file uploaded: ${file.name}. Note: for PDF analysis, please configure an API key in admin settings. The AI will analyze the PDF metadata and filename to provide relevant help.]`;
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
    appendBotMessage('Please upload your notes or type your content in the chat below first!');
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
    container.innerHTML = `<div class="col-span-full ai-message-bot">${response.replace(/\n/g, '<br>')}</div>`;
    return;
  }

  container.innerHTML = '';
  cards.forEach((card, i) => {
    const parts = card.split(' | ');
    const front = parts[0]?.replace('FRONT:', '').trim();
    const back = parts[1]?.replace('BACK:', '').trim();
    container.insertAdjacentHTML('beforeend', `
      <div class="flashcard fade-in" onclick="this.classList.toggle('flipped')" title="Click to flip">
        <div class="flashcard-inner">
          <div class="flashcard-front">
            <div>
              <p class="text-xs font-semibold mb-2" style="color:var(--grad-1)">CARD ${i + 1} — QUESTION</p>
              <p class="text-sm font-medium">${escHtml(front)}</p>
              <p class="text-xs mt-3" style="color:var(--text-muted)">Tap to reveal answer</p>
            </div>
          </div>
          <div class="flashcard-back">
            <div>
              <p class="text-xs font-semibold mb-2" style="color:var(--grad-2)">ANSWER</p>
              <p class="text-sm">${escHtml(back)}</p>
            </div>
          </div>
        </div>
      </div>`);
  });
};

// ===== CAREER ACTIONS =====
window.careerAction = async (action) => {
  const prompts = {
    cv: 'Help me write a professional CV for a Nigerian university student. Ask me for my details first, then create a structured CV template.',
    interview: 'Give me the top 20 interview questions and model answers for job interviews at Nigerian companies like MTN, Access Bank, Flutterwave, Andela, and multinational corporations in Nigeria.',
    roadmap: `Create a detailed career roadmap for a ${currentUserData.department || 'university'} student. Include skills to acquire, certifications to get, internship opportunities, and job prospects in Nigeria and internationally.`,
    internship: 'Give me practical tips for finding and securing internships as a Nigerian university student. Include company names, application tips, and how to stand out.',
    skills: `Analyze the most in-demand skills for ${currentUserData.department || 'university'} graduates in Nigeria in 2025-2026. List technical and soft skills, and how to develop them.`,
    salary: `What is the typical salary range for fresh graduates with a ${currentUserData.department || 'university'} degree in Nigeria? Break it down by industry and location.`,
  };
  document.getElementById('career-view').classList.add('hidden');
  document.getElementById('chat-view').classList.remove('hidden');
  await sendQuickPrompt(prompts[action]);
};

// ===== STUDY PLAN =====
window.generateStudyPlan = async () => {
  const subject = document.getElementById('studyplan-subject').value.trim();
  const weeks = document.getElementById('studyplan-weeks').value;
  const level = document.getElementById('studyplan-level').value;
  const goals = document.getElementById('studyplan-goals').value.trim();

  if (!subject) { alert('Please enter your subject(s)'); return; }

  const prompt = `Create a detailed ${weeks}-week study plan for: ${subject}. Level: ${level}. ${goals ? 'Goals/notes: ' + goals : ''}. Include daily tasks, topics to cover, practice exercises, and revision sessions. Format it clearly with weeks and days.`;

  const resultEl = document.getElementById('studyplan-result');
  resultEl.innerHTML = '<div class="text-center py-4" style="color:var(--text-muted)"><div class="spinner w-6 h-6 border-4 rounded-full mx-auto mb-2" style="border-color:var(--grad-1);border-top-color:transparent"></div>Generating your study plan...</div>';

  const response = await callAI(prompt, 'studyplan');
  resultEl.innerHTML = `<div class="ai-message-bot">${response.replace(/\n/g, '<br>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</div>`;
};

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

window.signOut = async () => {
  await firebaseSignOut(auth);
  window.location.href = 'auth.html';
};
