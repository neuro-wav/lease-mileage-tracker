// ===== Mistake tracking + weighted "drill my weak spots" generator =====
//
// Persists per-scenario seen/missed counts to localStorage. A "scenario" is
// a (hand description, dealer upcard) pair, e.g. "hard16_vs_10" or
// "soft18_vs_9" or "pair8_vs_A". Scenarios the player misses more often are
// weighted to appear more frequently in Drill mode, while still occasionally
// surfacing untested scenarios.

window.App = window.App || {};

const MISTAKES_KEY = 'blackjackTrainerMistakes';
const DEALER_LABELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];

// Hand descriptors worth drilling (totals where a real decision exists —
// hard 5-7 are always Hit and 17-21 always Stand, so they're excluded).
const HARD_TOTALS = [8, 9, 10, 11, 12, 13, 14, 15, 16];
const SOFT_TOTALS = [13, 14, 15, 16, 17, 18, 19];
const PAIR_RANKS = ['2', '3', '4', '6', '7', '8', '9', 'A', '10'];

// Card-rank combinations (by point value) that sum to each hard total
// without forming a pair (pairs are drilled under their own descriptor).
const HARD_COMBOS = {
  8:  [[2, 6], [3, 5]],
  9:  [[2, 7], [3, 6], [4, 5]],
  10: [[2, 8], [3, 7], [4, 6]],
  11: [[2, 9], [3, 8], [4, 7], [5, 6]],
  12: [[2, 10], [3, 9], [4, 8], [5, 7]],
  13: [[3, 10], [4, 9], [5, 8], [6, 7]],
  14: [[4, 10], [5, 9], [6, 8]],
  15: [[5, 10], [6, 9], [7, 8]],
  16: [[6, 10], [7, 9]],
};

const ALL_DESCRIPTORS = [
  ...HARD_TOTALS.map(t => `hard${t}`),
  ...SOFT_TOTALS.map(t => `soft${t}`),
  ...PAIR_RANKS.map(r => `pair${r}`),
];

const ALL_SCENARIOS = ALL_DESCRIPTORS.flatMap(d => DEALER_LABELS.map(dl => `${d}_vs_${dl}`));

function loadMistakes() {
  try {
    const raw = localStorage.getItem(MISTAKES_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {};
}

function saveMistakes(data) {
  try { localStorage.setItem(MISTAKES_KEY, JSON.stringify(data)); } catch (e) {}
}

function describeHandForKey(hand) {
  if (hand.kind === 'pair') return `pair${hand.pairRank}`;
  if (hand.kind === 'soft') return `soft${hand.total}`;
  return `hard${hand.total}`;
}

function scenarioKey(hand, dealerLabel) {
  return `${describeHandForKey(hand)}_vs_${dealerLabel}`;
}

function parseScenario(key) {
  const [descriptor, , dealerLabel] = key.split('_');
  let kind, total, pairRank;
  if (descriptor.startsWith('pair')) { kind = 'pair'; pairRank = descriptor.slice(4); }
  else if (descriptor.startsWith('soft')) { kind = 'soft'; total = parseInt(descriptor.slice(4), 10); }
  else { kind = 'hard'; total = parseInt(descriptor.slice(4), 10); }
  return { descriptor, kind, total, pairRank, dealerLabel };
}

function rankForValue(value) {
  if (value === 10) return ['10', 'J', 'Q', 'K'][Math.floor(Math.random() * 4)];
  if (value === 11) return 'A';
  return String(value);
}

// Build two card ranks that realize the given scenario descriptor, plus a
// dealer-upcard rank. Returns { playerRanks: [r1, r2], dealerRank }.
function synthesizeScenario(key) {
  const { kind, total, pairRank, dealerLabel } = parseScenario(key);
  let playerRanks;

  if (kind === 'pair') {
    if (pairRank === '10') {
      playerRanks = [rankForValue(10), rankForValue(10)];
    } else {
      playerRanks = [pairRank, pairRank];
    }
  } else if (kind === 'soft') {
    playerRanks = ['A', rankForValue(total - 11)];
  } else {
    const combos = HARD_COMBOS[total];
    const combo = combos[Math.floor(Math.random() * combos.length)];
    const ordered = Math.random() < 0.5 ? combo : [combo[1], combo[0]];
    playerRanks = ordered.map(rankForValue);
  }

  const dealerRank = dealerLabel === '10' ? rankForValue(10) : dealerLabel;
  return { playerRanks, dealerRank };
}

function describeScenarioForDisplay(key) {
  const { kind, total, pairRank, dealerLabel } = parseScenario(key);
  const handDesc = kind === 'pair' ? `Pair of ${pairRank === 'A' ? 'Aces' : pairRank + 's'}`
    : kind === 'soft' ? `Soft ${total}`
    : `Hard ${total}`;
  return `${handDesc} vs ${dealerLabel}`;
}

App.Mistakes = {
  ALL_SCENARIOS,

  scenarioKey,
  describeScenarioForDisplay,
  synthesizeScenario,

  load() { return loadMistakes(); },

  recordAttempt(data, key, wasCorrect) {
    if (!data[key]) data[key] = { seen: 0, missed: 0 };
    data[key].seen += 1;
    if (!wasCorrect) data[key].missed += 1;
    saveMistakes(data);
    return data;
  },

  reset() {
    saveMistakes({});
    return {};
  },

  // Weighted random pick favoring scenarios with more (and more frequent) misses.
  pickWeighted(data) {
    const weights = ALL_SCENARIOS.map((key) => {
      const m = data[key];
      if (!m || m.seen === 0) return 1;
      const missRate = m.missed / m.seen;
      return 1 + m.missed * 4 + missRate * 6;
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * totalWeight;
    for (let i = 0; i < ALL_SCENARIOS.length; i++) {
      r -= weights[i];
      if (r <= 0) return ALL_SCENARIOS[i];
    }
    return ALL_SCENARIOS[ALL_SCENARIOS.length - 1];
  },

  // Top N scenarios by absolute miss count (then miss rate), for display.
  topMistakes(data, n = 8) {
    return Object.keys(data)
      .map(key => ({ key, ...data[key], rate: data[key].missed / data[key].seen }))
      .filter(entry => entry.missed > 0)
      .sort((a, b) => (b.missed - a.missed) || (b.rate - a.rate))
      .slice(0, n);
  },
};
