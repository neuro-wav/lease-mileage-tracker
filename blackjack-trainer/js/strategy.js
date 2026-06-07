// ===== Basic Strategy + Hi-Lo Count Deviation Engine =====
//
// Dealer upcard columns are always indexed: 2,3,4,5,6,7,8,9,10,A  (index 0-9)
// Action codes used in the raw tables:
//   H  = Hit
//   S  = Stand
//   D  = Double if allowed, else Hit
//   Ds = Double if allowed, else Stand
//   P  = Split
//   Ph = Split if Double-After-Split allowed, else Hit
//   R  = Surrender if allowed, else Hit
//
// Tables below reflect the standard published multi-deck "Dealer Stands on
// Soft 17" basic strategy chart (Vegas Strip rules: DAS + late surrender).
// The H17_OVERRIDES are the well-documented changes for "Dealer Hits Soft 17".

window.App = window.App || {};

const DEALER_COLS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];

function col(upcardLabel) {
  return DEALER_COLS.indexOf(upcardLabel);
}

// ----- Hard totals (player total 8-16; <=7 always Hit, >=17 always Stand) -----
const HARD_S17 = {
  8:  ['H','H','H','H','H','H','H','H','H','H'],
  9:  ['H','D','D','D','D','H','H','H','H','H'],
  10: ['D','D','D','D','D','D','D','D','H','H'],
  11: ['D','D','D','D','D','D','D','D','D','H'],
  12: ['H','H','S','S','S','H','H','H','H','H'],
  13: ['S','S','S','S','S','H','H','H','H','H'],
  14: ['S','S','S','S','S','H','H','H','H','H'],
  15: ['S','S','S','S','S','H','H','H','R','H'],
  16: ['S','S','S','S','S','H','H','R','R','R'],
};

// ----- Soft totals (A,2 = soft 13 ... A,9 = soft 20). Soft 20/21 always Stand -----
const SOFT_S17 = {
  13: ['H','H','H','D','D','H','H','H','H','H'], // A,2
  14: ['H','H','H','D','D','H','H','H','H','H'], // A,3
  15: ['H','H','D','D','D','H','H','H','H','H'], // A,4
  16: ['H','H','D','D','D','H','H','H','H','H'], // A,5
  17: ['H','D','D','D','D','H','H','H','H','H'], // A,6
  18: ['Ds','Ds','Ds','Ds','Ds','S','S','H','H','H'], // A,7
  19: ['S','S','S','S','S','S','S','S','S','S'],      // A,8
};

// ----- Pairs. 5,5 and 10,10 are intentionally absent (played as hard totals) -----
const PAIRS_S17 = {
  '2,2': ['Ph','Ph','P','P','P','P','H','H','H','H'],
  '3,3': ['Ph','Ph','P','P','P','P','H','H','H','H'],
  '4,4': ['H','H','H','Ph','Ph','H','H','H','H','H'],
  '6,6': ['Ph','P','P','P','P','H','H','H','H','H'],
  '7,7': ['P','P','P','P','P','P','H','H','H','H'],
  '8,8': ['P','P','P','P','P','P','P','P','P','P'],
  '9,9': ['P','P','P','P','P','S','P','P','S','S'],
  'A,A': ['P','P','P','P','P','P','P','P','P','P'],
};

// ----- Differences when the dealer Hits on Soft 17 (well-documented deltas) -----
const H17_OVERRIDES = {
  hard: { 11: { [col('A')]: 'D' }, 15: { [col('A')]: 'R' } },
  soft: { 19: { [col('6')]: 'Ds' } },
};

// ----- Illustrious 18 (Hi-Lo) count-based deviations -----
// Reference index numbers as commonly published for 6-deck, S17 games.
// Each entry: when true count >= index, use `above`; otherwise use `below`.
const ILLUSTRIOUS_18 = [
  { hand: 'insurance',     dealer: 'A',  index:  3, above: 'insurance',  below: 'no-insurance', label: 'Insurance' },
  { hand: 'hard16',        dealer: '10', index:  0, above: 'stand',      below: 'hit',          label: 'Hard 16 vs 10' },
  { hand: 'hard15',        dealer: '10', index:  4, above: 'stand',      below: 'hit',          label: 'Hard 15 vs 10' },
  { hand: 'pair10',        dealer: '6',  index:  4, above: 'split',      below: 'stand',        label: '10,10 vs 6' },
  { hand: 'pair10',        dealer: '5',  index:  5, above: 'split',      below: 'stand',        label: '10,10 vs 5' },
  { hand: 'hard10',        dealer: '10', index:  4, above: 'double',     below: 'hit',          label: 'Hard 10 vs 10' },
  { hand: 'hard12',        dealer: '2',  index:  3, above: 'stand',      below: 'hit',          label: 'Hard 12 vs 2' },
  { hand: 'hard12',        dealer: '3',  index:  2, above: 'stand',      below: 'hit',          label: 'Hard 12 vs 3' },
  { hand: 'hard11',        dealer: 'A',  index:  1, above: 'double',     below: 'hit',          label: 'Hard 11 vs A' },
  { hand: 'hard9',         dealer: '2',  index:  1, above: 'double',     below: 'hit',          label: 'Hard 9 vs 2' },
  { hand: 'hard10',        dealer: 'A',  index:  4, above: 'double',     below: 'hit',          label: 'Hard 10 vs A' },
  { hand: 'hard9',         dealer: '7',  index:  3, above: 'double',     below: 'hit',          label: 'Hard 9 vs 7' },
  { hand: 'hard16',        dealer: '9',  index:  5, above: 'stand',      below: 'hit',          label: 'Hard 16 vs 9' },
  { hand: 'hard13',        dealer: '2',  index: -1, above: 'stand',      below: 'hit',          label: 'Hard 13 vs 2' },
  { hand: 'hard12',        dealer: '4',  index:  0, above: 'stand',      below: 'hit',          label: 'Hard 12 vs 4' },
  { hand: 'hard12',        dealer: '5',  index: -2, above: 'stand',      below: 'hit',          label: 'Hard 12 vs 5' },
  { hand: 'hard12',        dealer: '6',  index: -1, above: 'stand',      below: 'hit',          label: 'Hard 12 vs 6' },
  { hand: 'hard13',        dealer: '3',  index: -2, above: 'stand',      below: 'hit',          label: 'Hard 13 vs 3' },
];

const ACTION_NAMES = {
  hit: 'Hit',
  stand: 'Stand',
  double: 'Double Down',
  split: 'Split',
  surrender: 'Surrender',
  insurance: 'Take Insurance',
  'no-insurance': 'Decline Insurance',
};

// Classify a two-card initial hand.
// Returns { kind: 'pair'|'soft'|'hard', total, pairRank, key }
function classifyHand(cards) {
  const ranks = cards.map(c => c.rank);
  const values = cards.map(c => c.value);
  const total = values[0] + values[1];

  // Splittable as a "pair": identical ranks, or any two ten-valued cards
  // (most US casinos let you split e.g. King + Queen as a pair of tens).
  const sameRank = ranks[0] === ranks[1];
  const bothTenValue = values[0] === 10 && values[1] === 10;
  if (sameRank || bothTenValue) {
    const pairRank = sameRank ? ranks[0] : '10';
    return { kind: 'pair', total, pairRank, key: `${pairRank},${pairRank}` };
  }
  const hasAce = ranks.includes('A');
  if (hasAce && total <= 21) {
    // Soft total: Ace counted as 11 (only possible with a 2-card hand summing <= 21 incl. Ace=11)
    // values already encode Ace as 11, so `total` here is the soft total.
    return { kind: 'soft', total };
  }
  return { kind: 'hard', total };
}

// Resolve a raw strategy code into a concrete action given table rules + the
// two-card total (needed to enforce double-down range restrictions).
function resolveCode(code, total, rules) {
  const canDouble =
    rules.doubleRange === 'any' ||
    (rules.doubleRange === '9-11' && total >= 9 && total <= 11) ||
    (rules.doubleRange === '10-11' && total >= 10 && total <= 11);

  switch (code) {
    case 'H': return 'hit';
    case 'S': return 'stand';
    case 'P': return 'split';
    case 'D': return canDouble ? 'double' : 'hit';
    case 'Ds': return canDouble ? 'double' : 'stand';
    case 'Ph': return rules.doubleAfterSplit ? 'split' : 'hit';
    case 'R': return rules.surrenderAllowed ? 'surrender' : 'hit';
    default: return 'hit';
  }
}

function lookupBaseAction(hand, dealerLabel, rules) {
  const c = col(dealerLabel);

  if (hand.kind === 'pair') {
    const rank = hand.pairRank;
    if (rank === '5') {
      return lookupHard({ kind: 'hard', total: 10 }, dealerLabel, rules);
    }
    if (rank === '10') {
      return lookupHard({ kind: 'hard', total: 20 }, dealerLabel, rules);
    }
    const key = `${rank},${rank}`;
    const row = PAIRS_S17[key];
    if (row) {
      let code = row[c];
      if (rules.dealerHitsSoft17) code = applyOverride(H17_OVERRIDES.pair, key, c, code);
      return { code, total: hand.total };
    }
  }

  if (hand.kind === 'soft') {
    return lookupSoft(hand, dealerLabel, rules);
  }
  return lookupHard(hand, dealerLabel, rules);
}

function lookupHard(hand, dealerLabel, rules) {
  const c = col(dealerLabel);
  let total = hand.total;
  if (total <= 7) return { code: 'H', total };
  if (total >= 17) return { code: 'S', total };
  let code = HARD_S17[total][c];
  if (rules.dealerHitsSoft17) code = applyOverride(H17_OVERRIDES.hard, total, c, code);
  return { code, total };
}

function lookupSoft(hand, dealerLabel, rules) {
  const c = col(dealerLabel);
  let total = hand.total;
  if (total <= 12) return lookupHard({ kind: 'hard', total }, dealerLabel, rules); // shouldn't happen for 2-card soft
  if (total >= 20) return { code: 'S', total };
  let code = SOFT_S17[total][c];
  if (rules.dealerHitsSoft17) code = applyOverride(H17_OVERRIDES.soft, total, c, code);
  return { code, total };
}

function applyOverride(table, key, colIndex, fallback) {
  if (table && table[key] && Object.prototype.hasOwnProperty.call(table[key], colIndex)) {
    return table[key][colIndex];
  }
  return fallback;
}

// Find an Illustrious-18 deviation matching this hand/dealer combo (if any).
function findDeviation(hand, dealerLabel) {
  let handKey = null;
  if (hand.kind === 'pair' && hand.pairRank === '10') {
    handKey = 'pair10';
  } else if (hand.kind === 'hard') {
    handKey = `hard${hand.total}`;
  }
  if (!handKey) return null;
  return ILLUSTRIOUS_18.find(d => d.hand === handKey && d.dealer === dealerLabel) || null;
}

// Main entry point.
// rules: { decks, dealerHitsSoft17, doubleAfterSplit, doubleRange, surrenderAllowed, useDeviations }
// dealerUpcard: card object { rank, value, label }
// trueCount: current Hi-Lo true count (number)
// Returns: { action, actionName, basicAction, basicActionName, deviation, reason }
App.Strategy = {
  ACTION_NAMES,
  ILLUSTRIOUS_18,

  classifyHand,

  decide(playerCards, dealerUpcard, rules, trueCount) {
    const hand = classifyHand(playerCards);
    const dealerLabel = dealerUpcard.label;
    const { code, total } = lookupBaseAction(hand, dealerLabel, rules);
    const basicAction = resolveCode(code, total, rules);

    let action = basicAction;
    let deviation = null;

    if (rules.useDeviations) {
      const dev = findDeviation(hand, dealerLabel);
      if (dev) {
        const useAbove = trueCount >= dev.index;
        let devAction = useAbove ? dev.above : dev.below;
        // Resolve deviation actions through the same rule constraints.
        if (devAction === 'double') devAction = resolveCode('D', hand.total, rules) === 'double' ? 'double' : 'hit';
        if (devAction === 'surrender' && !rules.surrenderAllowed) devAction = 'hit';
        if (devAction === 'split' && hand.kind === 'pair' && !rules.doubleAfterSplit && code === 'Ph') devAction = 'hit';
        action = devAction;
        deviation = { ...dev, triggered: useAbove, threshold: dev.index };
      }
    }

    return {
      action,
      actionName: ACTION_NAMES[action] || action,
      basicAction,
      basicActionName: ACTION_NAMES[basicAction] || basicAction,
      deviation,
      hand,
    };
  },

  // Whether this round should prompt an insurance question (dealer shows Ace).
  shouldAskInsurance(dealerUpcard, rules) {
    return rules.askInsurance && dealerUpcard.label === 'A';
  },

  correctInsuranceCall(rules, trueCount) {
    if (!rules.useDeviations) return 'no-insurance';
    return trueCount >= 3 ? 'insurance' : 'no-insurance';
  },
};
