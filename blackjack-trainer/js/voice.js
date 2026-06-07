// ===== Voice I/O: Speech Synthesis (output) + Speech Recognition (input) =====

window.App = window.App || {};

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, plus: null, positive: null,
};

const ACTION_PHRASES = [
  { action: 'hit', phrases: ['hit', 'hit me', 'card', 'one more'] },
  { action: 'stand', phrases: ['stand', 'stay', 'stick', 'no more', 'hold'] },
  { action: 'double', phrases: ['double', 'double down', 'double it', 'doubling'] },
  { action: 'split', phrases: ['split', 'split it', 'split them', 'split pair', 'split the pair'] },
  { action: 'surrender', phrases: ['surrender', 'give up', 'fold'] },
];

const YES_PHRASES = ['yes', 'yeah', 'yep', 'sure', 'take it', 'insurance', 'take insurance', 'i do'];
const NO_PHRASES = ['no', 'nope', 'nah', 'pass', 'decline', 'no insurance', "don't", 'skip'];

const CONTROL_PHRASES = [
  { action: 'repeat', phrases: ['repeat', 'say again', 'what', 'come again', 'pardon'] },
  { action: 'pause', phrases: ['pause', 'stop', 'hold on', 'wait'] },
  { action: 'resume', phrases: ['resume', 'continue', 'go on', 'keep going', 'start'] },
  { action: 'skip', phrases: ['skip', 'next', 'next hand'] },
];

function normalize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\- ]/g, '').trim();
}

function matchPhrase(text, table) {
  const norm = normalize(text);
  for (const entry of table) {
    for (const phrase of entry.phrases) {
      if (norm === phrase || norm.includes(phrase)) return entry.action;
    }
  }
  return null;
}

// Parse a spoken number like "minus three", "negative two", "plus four", "seven", "-3"
function parseSpokenNumber(text) {
  const norm = normalize(text);
  let sign = 1;
  let body = norm;

  if (/^(minus|negative|down)\b/.test(body)) { sign = -1; body = body.replace(/^(minus|negative|down)\s*/, ''); }
  else if (/^(plus|positive|up)\b/.test(body)) { sign = 1; body = body.replace(/^(plus|positive|up)\s*/, ''); }

  const numMatch = body.match(/-?\d+/);
  if (numMatch) return sign * parseInt(numMatch[0], 10);

  const word = body.trim().split(/\s+/)[0];
  if (Object.prototype.hasOwnProperty.call(NUMBER_WORDS, word) && NUMBER_WORDS[word] !== null) {
    return sign * NUMBER_WORDS[word];
  }
  if (norm === 'zero' || norm === 'even' || norm === 'level') return 0;
  return null;
}

App.Voice = {
  supportsSynthesis: 'speechSynthesis' in window,
  supportsRecognition: !!SpeechRecognitionImpl,

  _recognition: null,
  _listening: false,
  _voices: [],

  init() {
    if (this.supportsSynthesis) {
      const load = () => { this._voices = window.speechSynthesis.getVoices(); };
      load();
      window.speechSynthesis.onvoiceschanged = load;
    }
  },

  voices() {
    return this._voices;
  },

  // Speak text aloud. Returns a promise that resolves when speech ends.
  speak(text, opts = {}) {
    if (!this.supportsSynthesis || !text) return Promise.resolve();
    return new Promise((resolve) => {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = opts.rate || 1;
      utter.pitch = opts.pitch || 1;
      if (opts.voiceURI) {
        const v = this._voices.find(v => v.voiceURI === opts.voiceURI);
        if (v) utter.voice = v;
      }
      utter.onend = () => resolve();
      utter.onerror = () => resolve();
      window.speechSynthesis.speak(utter);
    });
  },

  stopSpeaking() {
    if (this.supportsSynthesis) window.speechSynthesis.cancel();
  },

  // Listen once for a phrase. Resolves with the raw transcript (string) or null on failure/timeout.
  listenOnce({ timeoutMs = 7000 } = {}) {
    if (!this.supportsRecognition) return Promise.resolve(null);
    if (this._listening) this.stopListening();

    return new Promise((resolve) => {
      const recognition = new SpeechRecognitionImpl();
      this._recognition = recognition;
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 3;

      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        this._listening = false;
        clearTimeout(timer);
        try { recognition.stop(); } catch (e) {}
        resolve(value);
      };

      const timer = setTimeout(() => finish(null), timeoutMs);

      recognition.onresult = (event) => {
        const transcripts = [];
        for (let i = 0; i < event.results.length; i++) {
          for (let j = 0; j < event.results[i].length; j++) {
            transcripts.push(event.results[i][j].transcript);
          }
        }
        finish(transcripts[0] || null);
      };
      recognition.onerror = () => finish(null);
      recognition.onend = () => finish(null);

      this._listening = true;
      try {
        recognition.start();
      } catch (e) {
        finish(null);
      }
    });
  },

  stopListening() {
    if (this._recognition) {
      try { this._recognition.abort(); } catch (e) {}
    }
    this._listening = false;
  },

  isListening() {
    return this._listening;
  },

  // ----- Phrase interpretation helpers -----
  matchAction(text) { return text ? matchPhrase(text, ACTION_PHRASES) : null; },
  matchControl(text) { return text ? matchPhrase(text, CONTROL_PHRASES) : null; },
  matchYesNo(text) {
    if (!text) return null;
    const norm = normalize(text);
    if (YES_PHRASES.some(p => norm === p || norm.includes(p))) return 'yes';
    if (NO_PHRASES.some(p => norm === p || norm.includes(p))) return 'no';
    return null;
  },
  parseNumber: parseSpokenNumber,
};
