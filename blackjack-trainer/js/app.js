// ===== Blackjack Counting Trainer — main controller =====

window.App = window.App || {};

const SETTINGS_KEY = 'blackjackTrainerSettings';
const DEFAULT_SETTINGS = {
  decks: 6,
  dealerHitsSoft17: false,
  doubleAfterSplit: true,
  doubleRange: 'any',
  surrenderAllowed: true,
  penetration: 0.75,
  useDeviations: false,
  askInsurance: false,
  showCount: true,
  countQuizEvery: 5,
  voiceOut: true,
  voiceIn: true,
  voiceURI: '',
  rate: 1,
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const els = {};
function $(id) { return document.getElementById(id); }

const state = {
  settings: loadSettings(),
  shoe: null,
  running: false,
  paused: false,
  muted: false,
  handsPlayed: 0,
  correctCount: 0,
  handsSinceQuiz: 0,
  choiceToken: 0,
  pendingKind: null,
  resolveChoice: null,
  currentPromptText: '',
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (e) {}
  return { ...DEFAULT_SETTINGS };
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch (e) {}
}

function rulesFromSettings(s) {
  return {
    decks: s.decks,
    dealerHitsSoft17: s.dealerHitsSoft17,
    doubleAfterSplit: s.doubleAfterSplit,
    doubleRange: s.doubleRange,
    surrenderAllowed: s.surrenderAllowed,
    useDeviations: s.useDeviations,
    askInsurance: s.askInsurance,
  };
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  cacheEls();
  App.Voice.init();
  populateVoicesWhenReady();
  applySettingsToForm();
  wireEvents();
  noteVoiceSupport();
});

function cacheEls() {
  [
    'view-settings', 'view-practice', 'settings-form', 'start-btn', 'settings-btn',
    'opt-decks', 'opt-soft17', 'opt-das', 'opt-double-range', 'opt-surrender', 'opt-penetration',
    'opt-deviations', 'opt-insurance', 'opt-show-count', 'opt-count-quiz',
    'opt-voice-out', 'opt-voice-in', 'opt-voice-select', 'opt-rate', 'voice-support-note',
    'stat-hands', 'stat-accuracy', 'stat-running', 'stat-true', 'count-stat-running', 'count-stat-true',
    'dealer-cards', 'player-cards', 'player-total', 'status-pill', 'prompt-text', 'mic-indicator',
    'feedback-banner', 'action-buttons', 'yesno-buttons', 'count-input-row', 'count-answer', 'count-submit',
    'listen-btn', 'pause-btn', 'repeat-btn', 'mute-btn',
  ].forEach(id => { els[id] = $(id); });
}

function noteVoiceSupport() {
  const parts = [];
  parts.push(App.Voice.supportsSynthesis ? 'Spoken feedback is supported in this browser.' : 'This browser cannot speak aloud — feedback will be shown as text.');
  parts.push(App.Voice.supportsRecognition ? 'Voice input is supported — you can answer hands-free.' : 'This browser does not support voice input — use the on-screen buttons to answer (Chrome/Edge recommended for hands-free use).');
  els['voice-support-note'].textContent = parts.join(' ');
  if (!App.Voice.supportsRecognition) {
    els['opt-voice-in'].checked = false;
    els['opt-voice-in'].disabled = true;
  }
}

function populateVoicesWhenReady() {
  const populate = () => {
    const select = els['opt-voice-select'];
    const voices = App.Voice.voices().filter(v => v.lang && v.lang.startsWith('en'));
    select.innerHTML = '<option value="">System default</option>' +
      voices.map(v => `<option value="${v.voiceURI}">${v.name} (${v.lang})</option>`).join('');
    select.value = state.settings.voiceURI || '';
  };
  populate();
  setTimeout(populate, 400);
  setTimeout(populate, 1200);
}

function applySettingsToForm() {
  const s = state.settings;
  els['opt-decks'].value = String(s.decks);
  els['opt-soft17'].value = s.dealerHitsSoft17 ? 'hit' : 'stand';
  els['opt-das'].value = s.doubleAfterSplit ? 'yes' : 'no';
  els['opt-double-range'].value = s.doubleRange;
  els['opt-surrender'].value = s.surrenderAllowed ? 'yes' : 'no';
  els['opt-penetration'].value = String(s.penetration);
  els['opt-deviations'].checked = s.useDeviations;
  els['opt-insurance'].checked = s.askInsurance;
  els['opt-show-count'].checked = s.showCount;
  els['opt-count-quiz'].value = String(s.countQuizEvery);
  els['opt-voice-out'].checked = s.voiceOut;
  els['opt-voice-in'].checked = s.voiceIn && App.Voice.supportsRecognition;
  els['opt-rate'].value = String(s.rate);
}

function readSettingsFromForm() {
  return {
    decks: parseInt(els['opt-decks'].value, 10),
    dealerHitsSoft17: els['opt-soft17'].value === 'hit',
    doubleAfterSplit: els['opt-das'].value === 'yes',
    doubleRange: els['opt-double-range'].value,
    surrenderAllowed: els['opt-surrender'].value === 'yes',
    penetration: parseFloat(els['opt-penetration'].value),
    useDeviations: els['opt-deviations'].checked,
    askInsurance: els['opt-insurance'].checked,
    showCount: els['opt-show-count'].checked,
    countQuizEvery: parseInt(els['opt-count-quiz'].value, 10),
    voiceOut: els['opt-voice-out'].checked,
    voiceIn: els['opt-voice-in'].checked && App.Voice.supportsRecognition,
    voiceURI: els['opt-voice-select'].value,
    rate: parseFloat(els['opt-rate'].value),
  };
}

function wireEvents() {
  els['settings-form'].addEventListener('submit', (e) => {
    e.preventDefault();
    state.settings = readSettingsFromForm();
    saveSettings();
    startPractice();
  });

  els['settings-btn'].addEventListener('click', () => {
    stopPractice();
    showView('settings');
  });

  els['mute-btn'].addEventListener('click', () => {
    state.muted = !state.muted;
    els['mute-btn'].textContent = state.muted ? '🔇' : '🔊';
    if (state.muted) App.Voice.stopSpeaking();
  });

  els['pause-btn'].addEventListener('click', togglePause);

  els['repeat-btn'].addEventListener('click', () => {
    speak(state.currentPromptText);
  });

  els['listen-btn'].addEventListener('click', () => {
    // Aborting the active recognition causes the listening loop to retry immediately.
    if (state.pendingKind && state.settings.voiceIn) App.Voice.stopListening();
  });

  els['action-buttons'].addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || state.pendingKind !== 'action') return;
    submitChoice(btn.dataset.action);
  });

  els['yesno-buttons'].addEventListener('click', (e) => {
    const btn = e.target.closest('[data-yesno]');
    if (!btn || state.pendingKind !== 'yesno') return;
    submitChoice(btn.dataset.yesno);
  });

  els['count-submit'].addEventListener('click', () => {
    if (state.pendingKind !== 'count') return;
    const val = parseInt(els['count-answer'].value, 10);
    if (!Number.isNaN(val)) submitChoice(val);
  });
  els['count-answer'].addEventListener('keydown', (e) => {
    if (e.key === 'Enter') els['count-submit'].click();
  });
}

function showView(name) {
  els['view-settings'].classList.toggle('hidden', name !== 'settings');
  els['view-practice'].classList.toggle('hidden', name !== 'practice');
}

function togglePause() {
  state.paused = !state.paused;
  els['pause-btn'].textContent = state.paused ? 'Resume' : 'Pause';
  setStatus(state.paused ? 'Paused' : 'Practicing');
  if (state.paused) {
    App.Voice.stopSpeaking();
  }
}

// ===== Speech helper that respects mute setting =====
function speak(text, opts = {}) {
  if (!text) return Promise.resolve();
  if (state.muted || !state.settings.voiceOut) return Promise.resolve();
  return App.Voice.speak(text, { rate: state.settings.rate, voiceURI: state.settings.voiceURI, ...opts });
}

// ===== Practice lifecycle =====
function startPractice() {
  state.shoe = new App.Cards.Shoe(state.settings.decks, state.settings.penetration);
  state.handsPlayed = 0;
  state.correctCount = 0;
  state.handsSinceQuiz = 0;
  state.paused = false;
  state.running = true;
  els['pause-btn'].textContent = 'Pause';
  els['mute-btn'].textContent = state.muted ? '🔇' : '🔊';
  els['count-stat-running'].classList.toggle('hidden', !state.settings.showCount);
  els['count-stat-true'].classList.toggle('hidden', !state.settings.showCount);
  updateStats();
  showView('practice');
  clearFeedback();
  setStatus('Get ready…');
  els['prompt-text'].textContent = 'Shuffling the shoe…';
  runLoop();
}

function stopPractice() {
  state.running = false;
  state.choiceToken++;
  state.pendingKind = null;
  App.Voice.stopListening();
  App.Voice.stopSpeaking();
  showMic(false);
}

async function runLoop() {
  await speak('Starting practice. ' + describeRules());
  while (state.running) {
    if (state.paused) { await sleep(250); continue; }
    await playRound();
    if (!state.running) return;
    await sleep(1100);
  }
}

function describeRules() {
  const s = state.settings;
  const bits = [
    `${s.decks} deck${s.decks > 1 ? 's' : ''}`,
    s.dealerHitsSoft17 ? 'dealer hits soft 17' : 'dealer stands on soft 17',
    s.doubleAfterSplit ? 'double after split allowed' : 'no double after split',
    s.surrenderAllowed ? 'late surrender allowed' : 'no surrender',
  ];
  return bits.join(', ') + '.';
}

// ===== One round = one initial-draw decision (no full hand play-out) =====
async function playRound() {
  if (state.shoe.needsReshuffle()) {
    setStatus('Reshuffling');
    els['prompt-text'].textContent = 'The shoe is being reshuffled. Running count resets to zero.';
    await speak('Reshuffling the shoe. The count resets to zero.');
    state.shoe.reshuffle();
    await sleep(600);
  }

  clearFeedback();
  const rules = rulesFromSettings(state.settings);

  const p1 = state.shoe.draw();
  const p2 = state.shoe.draw();
  const dealerUp = state.shoe.draw();
  const playerCards = [p1, p2];

  renderCards(els['dealer-cards'], [dealerUp]);
  renderCards(els['player-cards'], playerCards);
  updateCountDisplay();

  const hand = App.Strategy.classifyHand(playerCards);
  els['player-total'].textContent = describeTotal(hand);

  // Player blackjack: no decision to make.
  if (hand.kind === 'soft' && hand.total === 21) {
    setStatus('Blackjack!');
    const text = `Blackjack! ${cardPhrase(playerCards)} — an automatic win. No decision needed.`;
    els['prompt-text'].textContent = text;
    state.currentPromptText = text;
    await speak(text);
    await sleep(900);
    return;
  }

  const trueCount = state.shoe.trueCount();

  // Optional insurance question when dealer shows an Ace.
  if (App.Strategy.shouldAskInsurance(dealerUp, rules)) {
    await handleInsurance(rules, trueCount);
    if (!state.running) return;
  }

  await handleActionDecision(playerCards, dealerUp, hand, rules, trueCount);
  if (!state.running) return;

  if (state.settings.countQuizEvery > 0 && state.handsSinceQuiz >= state.settings.countQuizEvery) {
    state.handsSinceQuiz = 0;
    await runCountQuiz();
  }
}

function describeTotal(hand) {
  if (hand.kind === 'pair') return `Pair of ${rankPlural(hand.pairRank)}`;
  if (hand.kind === 'soft') return `Soft ${hand.total}`;
  return `Hard ${hand.total}`;
}

function rankPlural(rank) {
  const names = { 'A': 'Aces', 'K': 'Kings', 'Q': 'Queens', 'J': 'Jacks' };
  return names[rank] || `${rank}s`;
}

function cardPhrase(cards) {
  return cards.map(c => c.spoken).join(' and ');
}

// ----- Insurance sub-decision -----
async function handleInsurance(rules, trueCount) {
  setStatus('Insurance?');
  const text = 'The dealer is showing an Ace. Would you like to take insurance?';
  els['prompt-text'].textContent = text;
  state.currentPromptText = text;
  await speak(text);

  showControls('yesno');
  const answer = await waitForChoice('yesno');
  if (!state.running) return;
  hideControls();

  const correct = App.Strategy.correctInsuranceCall(rules, trueCount);
  const playerSaid = answer === 'yes' ? 'insurance' : 'no-insurance';
  const isCorrect = playerSaid === correct;

  let explanation;
  if (correct === 'insurance') {
    explanation = `True count is ${formatCount(trueCount)}. With the count this high, taking insurance is the long-run profitable play.`;
  } else {
    explanation = state.settings.useDeviations
      ? `True count is ${formatCount(trueCount)}, below +3, so basic strategy says decline insurance — it's a losing bet for the player on average.`
      : `Insurance is a side bet that loses money for the player on average — basic strategy always says decline it.`;
  }
  showFeedback(isCorrect, `${isCorrect ? 'Correct.' : 'Not quite.'} The right call was to ${correct === 'insurance' ? 'take' : 'decline'} insurance. ${explanation}`);
  await speak(`${isCorrect ? 'Correct.' : 'Not quite.'} You should ${correct === 'insurance' ? 'take' : 'decline'} insurance here. ${explanation}`);
  await sleep(400);
}

// ----- Main Hit/Stand/Double/Split/Surrender decision -----
async function handleActionDecision(playerCards, dealerUp, hand, rules, trueCount) {
  setStatus('Your move');
  const promptText = buildPrompt(hand, playerCards, dealerUp);
  els['prompt-text'].textContent = promptText;
  state.currentPromptText = promptText;
  await speak(promptText);

  showControls('action');
  const answer = await waitForChoice('action');
  if (!state.running) return;
  hideControls();

  const result = App.Strategy.decide(playerCards, dealerUp, rules, trueCount);
  const isCorrect = answer === result.action;
  state.handsPlayed++;
  state.handsSinceQuiz++;
  if (isCorrect) state.correctCount++;
  updateStats();

  highlightButtons(answer, result.action);

  const feedbackText = buildFeedbackText(isCorrect, answer, result, trueCount);
  showFeedback(isCorrect, feedbackText.banner);
  await speak(feedbackText.spoken);
  await sleep(500);
  unhighlightButtons();
}

function buildPrompt(hand, playerCards, dealerUp) {
  const handDesc = hand.kind === 'pair'
    ? `a pair of ${rankPlural(hand.pairRank)}`
    : `${cardPhrase(playerCards)}, ${hand.kind === 'soft' ? 'a soft' : 'a hard'} ${hand.total}`;
  return `You have ${handDesc}. Dealer shows ${dealerUp.spoken}. Hit, stand, double, split, or surrender?`;
}

function buildFeedbackText(isCorrect, playerAction, result, trueCount) {
  const correctName = result.actionName;
  const playerName = App.Strategy.ACTION_NAMES[playerAction] || playerAction;
  let banner, spoken;

  if (isCorrect) {
    banner = `✅ Correct — ${correctName} is right.`;
    spoken = `Correct! ${correctName} is the right play.`;
  } else {
    banner = `❌ Not quite — you said ${playerName}, but the right play is ${correctName}.`;
    spoken = `Not quite. The right play here is to ${correctName.toLowerCase()}, not ${playerName.toLowerCase()}.`;
  }

  if (result.deviation) {
    const dev = result.deviation;
    const note = dev.triggered
      ? `This is a count play: at a true count of ${formatCount(trueCount)} (≥ ${formatCount(dev.threshold)}), you deviate from basic strategy on ${dev.label} and ${ACTION_VERB[result.action] || result.action}.`
      : `Basic strategy applies here on ${dev.label} because the true count of ${formatCount(trueCount)} hasn't reached the deviation index of ${formatCount(dev.threshold)}.`;
    banner += ` ${note}`;
    spoken += ` ${note}`;
  } else if (result.action !== result.basicAction) {
    // shouldn't normally happen, but guard
  }

  return { banner, spoken };
}

const ACTION_VERB = {
  hit: 'hit',
  stand: 'stand',
  double: 'double down',
  split: 'split',
  surrender: 'surrender',
};

// ----- Hi-Lo running-count quiz -----
async function runCountQuiz() {
  setStatus('Count check');
  const text = 'Quick check — what is the current running count?';
  els['prompt-text'].textContent = text;
  state.currentPromptText = text;
  await speak(text);

  showControls('count');
  const answer = await waitForChoice('count');
  if (!state.running) return;
  hideControls();

  const actual = state.shoe.runningCount;
  const isCorrect = answer === actual;
  const trueCount = state.shoe.trueCount();
  const banner = isCorrect
    ? `✅ Correct — the running count is ${actual}. (True count ≈ ${formatCount(trueCount)} with about ${state.shoe.decksRemaining()} deck${state.shoe.decksRemaining() === 1 ? '' : 's'} left.)`
    : `You said ${answer}, but the running count is actually ${actual}. (True count ≈ ${formatCount(trueCount)}.)`;
  const spoken = isCorrect
    ? `Correct, the running count is ${actual}.`
    : `Not quite — the running count is actually ${actual}.`;

  showFeedback(isCorrect, banner);
  await speak(spoken);
  await sleep(500);
}

function formatCount(n) {
  const r = Math.round(n * 10) / 10;
  return r > 0 ? `+${r}` : `${r}`;
}

// ===== UI rendering =====
function renderCards(container, cards) {
  container.innerHTML = '';
  cards.forEach(card => {
    const div = document.createElement('div');
    div.className = 'playing-card' + (['♥', '♦'].includes(card.suit) ? ' red' : '');
    div.textContent = card.display;
    container.appendChild(div);
  });
}

function setStatus(text) { els['status-pill'].textContent = text; }

function clearFeedback() {
  els['feedback-banner'].className = 'feedback-banner hidden';
  els['feedback-banner'].textContent = '';
}

function showFeedback(isCorrect, text) {
  els['feedback-banner'].className = 'feedback-banner ' + (isCorrect ? 'correct' : 'incorrect');
  els['feedback-banner'].textContent = text;
}

function highlightButtons(playerAction, correctAction) {
  els['action-buttons'].querySelectorAll('[data-action]').forEach(btn => {
    btn.classList.remove('shown-correct', 'shown-incorrect');
    if (btn.dataset.action === correctAction) btn.classList.add('shown-correct');
    else if (btn.dataset.action === playerAction) btn.classList.add('shown-incorrect');
  });
}
function unhighlightButtons() {
  els['action-buttons'].querySelectorAll('[data-action]').forEach(btn => {
    btn.classList.remove('shown-correct', 'shown-incorrect');
  });
}

function updateStats() {
  els['stat-hands'].textContent = String(state.handsPlayed);
  els['stat-accuracy'].textContent = state.handsPlayed > 0
    ? `${Math.round((state.correctCount / state.handsPlayed) * 100)}%`
    : '—';
  updateCountDisplay();
}

function updateCountDisplay() {
  if (!state.shoe) return;
  els['stat-running'].textContent = String(state.shoe.runningCount);
  els['stat-true'].textContent = formatCount(state.shoe.trueCount());
}

// ===== Choice-waiting machinery (voice + buttons race) =====
function showControls(kind) {
  els['action-buttons'].classList.toggle('hidden', kind !== 'action');
  els['yesno-buttons'].classList.toggle('hidden', kind !== 'yesno');
  els['count-input-row'].classList.toggle('hidden', kind !== 'count');
  if (kind === 'count') { els['count-answer'].value = ''; els['count-answer'].focus(); }
}
function hideControls() {
  showControls(null);
  showMic(false);
}
function showMic(on) { els['mic-indicator'].classList.toggle('hidden', !on); }

function waitForChoice(kind) {
  state.choiceToken++;
  const myToken = state.choiceToken;
  state.pendingKind = kind;
  return new Promise((resolve) => {
    state.resolveChoice = (value) => {
      if (myToken !== state.choiceToken) return;
      state.choiceToken++;
      state.pendingKind = null;
      state.resolveChoice = null;
      App.Voice.stopListening();
      showMic(false);
      resolve(value);
    };
    if (state.settings.voiceIn && App.Voice.supportsRecognition) {
      runVoiceLoop(kind, myToken);
    }
  });
}

function submitChoice(value) {
  if (state.resolveChoice) state.resolveChoice(value);
}

async function runVoiceLoop(kind, token) {
  while (token === state.choiceToken && state.running) {
    showMic(true);
    const transcript = await App.Voice.listenOnce({ timeoutMs: 6500 });
    if (token !== state.choiceToken) { showMic(false); return; }
    showMic(false);
    if (!transcript) continue;

    const control = App.Voice.matchControl(transcript);
    if (control === 'repeat') {
      await speak(state.currentPromptText);
      continue;
    }

    let value = null;
    if (kind === 'action') value = App.Voice.matchAction(transcript);
    else if (kind === 'yesno') value = App.Voice.matchYesNo(transcript);
    else if (kind === 'count') value = App.Voice.parseNumber(transcript);

    if (value !== null && value !== undefined) {
      if (state.resolveChoice) state.resolveChoice(value);
      return;
    }
    // Unrecognized — brief nudge, then keep listening.
    await speak("Sorry, I didn't catch that — please say your answer again.");
  }
}

// ===== PWA: register service worker for offline / installable use =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
