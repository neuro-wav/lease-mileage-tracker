// ===== Card / Shoe / Hi-Lo running-count model =====

window.App = window.App || {};

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

function rankValue(rank) {
  if (rank === 'A') return 11;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return parseInt(rank, 10);
}

// Hi-Lo tag values: 2-6 = +1, 7-9 = 0, 10/J/Q/K/A = -1
function hiLoTag(rank) {
  if (['2','3','4','5','6'].includes(rank)) return 1;
  if (['7','8','9'].includes(rank)) return 0;
  return -1;
}

// A card's spoken/displayed label collapses 10/J/Q/K to "10" for strategy lookup.
function strategyLabel(rank) {
  return (rank === 'J' || rank === 'Q' || rank === 'K') ? '10' : rank;
}

function makeCard(rank, suit) {
  return {
    rank,
    suit,
    value: rankValue(rank),
    tag: hiLoTag(rank),
    label: strategyLabel(rank),
    display: `${rank}${suit}`,
    spoken: spokenName(rank),
  };
}

function spokenName(rank) {
  switch (rank) {
    case 'J': return 'Jack';
    case 'Q': return 'Queen';
    case 'K': return 'King';
    case 'A': return 'Ace';
    default: return rank;
  }
}

class Shoe {
  constructor(numDecks, penetration) {
    this.numDecks = numDecks;
    this.penetration = penetration; // fraction of shoe dealt before reshuffle, e.g. 0.75
    this.runningCount = 0;
    this._build();
  }

  _build() {
    const cards = [];
    for (let d = 0; d < this.numDecks; d++) {
      for (const suit of SUITS) {
        for (const rank of RANKS) {
          cards.push(makeCard(rank, suit));
        }
      }
    }
    this.cards = shuffle(cards);
    this.totalCards = this.cards.length;
    this.cutCardPosition = Math.floor(this.totalCards * (1 - this.penetration));
    this.runningCount = 0;
  }

  reshuffle() {
    this._build();
  }

  needsReshuffle() {
    return this.cards.length <= this.cutCardPosition;
  }

  // Draw one card, update the running count.
  draw() {
    const card = this.cards.pop();
    this.runningCount += card.tag;
    return card;
  }

  cardsRemaining() {
    return this.cards.length;
  }

  decksRemaining() {
    // Round to nearest half-deck, minimum of 0.5 to avoid wild true-count swings.
    const raw = this.cards.length / 52;
    return Math.max(0.5, Math.round(raw * 2) / 2);
  }

  trueCount() {
    return this.runningCount / this.decksRemaining();
  }
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

App.Cards = { Shoe, makeCard, hiLoTag, strategyLabel };
