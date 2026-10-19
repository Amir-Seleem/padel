/* ============================================================
   Padel Arena — vanilla JS app
   - Padel scoring engine (points, deuce, advantage, games, sets, undo)
   - Knockout bracket generation for any number of players (2–20+)
   - Random matchmaking (shuffle everyone)
   - Local Storage persistence
   ============================================================ */

(function () {
  'use strict';

  // ============================================================
  // Constants
  // ============================================================
  var STORAGE_KEY = 'padel-tournament-v1';
  var POINT_SEQUENCE = [0, 15, 30, 40];
  var SETS_TO_WIN = 2; // best of 3

  // ============================================================
  // State (persisted to localStorage)
  // ============================================================
  var state = {
    players: [],
    // teams is a list of { teamA: [p1, p2], teamB: [p3, p4] } pairings
    // Each pairing represents a 2v2 match between two teams of 2 players.
    teams: [],
    // teamFormationOpen controls the collapse state of the team-formation
    // sub-panel (roster + 2v2 pairings) INSIDE the lineup panel.
    //   null  = never opened (collapsed)
    //   false = opened then collapsed (header only)
    //   true  = open (header + body visible)
    teamFormationOpen: null,
    // lineupVisible controls the ENTIRE lineup panel (squad + bracket).
    //   null  = never opened (default — only ads + score counter visible)
    //   false = opened then hidden (team-logo button appears in header)
    //   true  = visible (squad + bracket both shown)
    lineupVisible: null,
    bracket: null,
    shufflePairings: [],
    activeMatchId: null,
    activeMatchScore: null,
    activeTeamAName: 'Team A',
    activeTeamBName: 'Team B',
  };

  // ============================================================
  // Persistence
  // ============================================================
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Failed to save state', e);
    }
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      Object.assign(state, parsed);
      // Backfill any missing fields
      if (!state.activeMatchScore) state.activeMatchScore = createInitialMatchScore();
      if (!Array.isArray(state.teams)) state.teams = [];
      // teamFormationOpen can be null (never opened), false (collapsed), or true (open)
      if (state.teamFormationOpen === undefined) state.teamFormationOpen = null;
      // lineupVisible can be null (never opened), false (hidden), or true (visible)
      if (state.lineupVisible === undefined) state.lineupVisible = null;
      // Migrate from old bracketVisible state if present
      if (state.bracketVisible !== undefined) {
        if (state.lineupVisible === null && state.bracketVisible !== null) {
          state.lineupVisible = state.bracketVisible;
        }
        delete state.bracketVisible;
      }
    } catch (e) {
      console.warn('Failed to load state', e);
    }
  }

  // ============================================================
  // Padel scoring engine
  // ============================================================
  function createInitialMatchScore() {
    return {
      currentGame: { rawA: 0, rawB: 0 },
      sets: [],
      currentSet: { gamesA: 0, gamesB: 0 },
      setsToWin: SETS_TO_WIN,
      server: 'A',
      winner: null,
      history: [],
    };
  }

  function pointLabel(rawIndex, opponentRawIndex) {
    if (rawIndex <= 3) return String(POINT_SEQUENCE[rawIndex]);
    // past 40 — deuce / advantage
    if (rawIndex === opponentRawIndex) return '40'; // deuce
    if (rawIndex === opponentRawIndex + 1) return 'Ad';
    return 'Ad';
  }

  function isDeuce(score) {
    var g = score.currentGame;
    return g.rawA >= 3 && g.rawB >= 3 && g.rawA === g.rawB;
  }

  function advantageTeam(score) {
    var g = score.currentGame;
    if (g.rawA >= 3 && g.rawB >= 3) {
      if (g.rawA === g.rawB) return null;
      return g.rawA > g.rawB ? 'A' : 'B';
    }
    return null;
  }

  function snapshot(score) {
    return {
      currentGame: { rawA: score.currentGame.rawA, rawB: score.currentGame.rawB },
      sets: score.sets.map(function (s) { return { gamesA: s.gamesA, gamesB: s.gamesB }; }),
      currentSet: { gamesA: score.currentSet.gamesA, gamesB: score.currentSet.gamesB },
      server: score.server,
      winner: score.winner,
    };
  }

  function isGameWon(rawA, rawB) {
    var MIN = 4;
    if (rawA >= MIN && rawA - rawB >= 2) return { won: true, winner: 'A' };
    if (rawB >= MIN && rawB - rawA >= 2) return { won: true, winner: 'B' };
    return { won: false, winner: null };
  }

  function isSetWon(gamesA, gamesB) {
    if (gamesA >= 6 && gamesA - gamesB >= 2) return { won: true, winner: 'A' };
    if (gamesB >= 6 && gamesB - gamesA >= 2) return { won: true, winner: 'B' };
    if (gamesA === 7 && gamesB < 7) return { won: true, winner: 'A' };
    if (gamesB === 7 && gamesA < 7) return { won: true, winner: 'B' };
    return { won: false, winner: null };
  }

  function isMatchWon(score, setsWonA, setsWonB) {
    if (setsWonA >= score.setsToWin) return 'A';
    if (setsWonB >= score.setsToWin) return 'B';
    return null;
  }

  function addPoint(score, team) {
    if (score.winner) return score;
    var next = {
      currentGame: { rawA: score.currentGame.rawA, rawB: score.currentGame.rawB },
      sets: score.sets.map(function (s) { return { gamesA: s.gamesA, gamesB: s.gamesB }; }),
      currentSet: { gamesA: score.currentSet.gamesA, gamesB: score.currentSet.gamesB },
      setsToWin: score.setsToWin,
      server: score.server,
      winner: score.winner,
      history: score.history.concat([snapshot(score)]),
    };

    if (team === 'A') next.currentGame.rawA += 1;
    else next.currentGame.rawB += 1;

    var g = isGameWon(next.currentGame.rawA, next.currentGame.rawB);
    if (g.won) {
      if (g.winner === 'A') next.currentSet.gamesA += 1;
      else next.currentSet.gamesB += 1;

      var s = isSetWon(next.currentSet.gamesA, next.currentSet.gamesB);
      if (s.won) {
        next.sets.push({ gamesA: next.currentSet.gamesA, gamesB: next.currentSet.gamesB });
        var setsWonA = next.sets.filter(function (x) { return x.gamesA > x.gamesB; }).length;
        var setsWonB = next.sets.filter(function (x) { return x.gamesB > x.gamesA; }).length;
        var mw = isMatchWon(next, setsWonA, setsWonB);
        if (mw) {
          next.winner = mw;
          next.currentSet = { gamesA: 0, gamesB: 0 };
          next.currentGame = { rawA: 0, rawB: 0 };
        } else {
          next.currentSet = { gamesA: 0, gamesB: 0 };
          next.currentGame = { rawA: 0, rawB: 0 };
          next.server = next.server === 'A' ? 'B' : 'A';
        }
      } else {
        next.currentGame = { rawA: 0, rawB: 0 };
        next.server = next.server === 'A' ? 'B' : 'A';
      }
    }
    return next;
  }

  function undoLastPoint(score) {
    if (score.history.length === 0) return score;
    var last = score.history[score.history.length - 1];
    return {
      currentGame: { rawA: last.currentGame.rawA, rawB: last.currentGame.rawB },
      sets: last.sets.map(function (s) { return { gamesA: s.gamesA, gamesB: s.gamesB }; }),
      currentSet: { gamesA: last.currentSet.gamesA, gamesB: last.currentSet.gamesB },
      setsToWin: score.setsToWin,
      server: last.server,
      winner: last.winner,
      history: score.history.slice(0, -1),
    };
  }

  function displayScore(score) {
    var g = score.currentGame;
    var setsWonA = score.sets.filter(function (s) { return s.gamesA > s.gamesB; }).length;
    var setsWonB = score.sets.filter(function (s) { return s.gamesB > s.gamesA; }).length;
    return {
      pointsA: pointLabel(g.rawA, g.rawB),
      pointsB: pointLabel(g.rawB, g.rawA),
      setsA: String(setsWonA),
      setsB: String(setsWonB),
      gamesA: String(score.currentSet.gamesA),
      gamesB: String(score.currentSet.gamesB),
    };
  }

  // ============================================================
  // Bracket generation
  // ============================================================
  function shuffleArray(arr) {
    var out = arr.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    return out;
  }

  function nextPowerOfTwo(n) {
    var p = 1;
    while (p < n) p *= 2;
    return p;
  }

  function generateBracket(players) {
    if (players.length < 2) return null;
    var size = nextPowerOfTwo(players.length);
    var rounds = Math.log2(size);
    var shuffled = shuffleArray(players);
    var slots = [];
    for (var i = 0; i < size; i++) {
      slots.push(i < shuffled.length ? shuffled[i] : null);
    }

    var matches = [];
    var matchIdCounter = 0;
    var firstRoundCount = size / 2;
    var firstRoundMatches = [];
    for (var i = 0; i < firstRoundCount; i++) {
      var a = slots[i * 2];
      var b = slots[i * 2 + 1];
      var winner = null;
      if (a && !b) winner = 'A';
      else if (!a && b) winner = 'B';
      var m = {
        id: 'm-' + (matchIdCounter++),
        round: 0,
        position: i,
        playerA: a, playerB: b,
        winner: winner,
        setsA: 0, setsB: 0,
        scoreDisplay: null,
        nextMatchId: null,
      };
      firstRoundMatches.push(m);
      matches.push(m);
    }

    var prevRound = firstRoundMatches;
    for (var r = 1; r < rounds; r++) {
      var count = firstRoundCount / Math.pow(2, r);
      var roundMatches = [];
      for (var i = 0; i < count; i++) {
        var m = {
          id: 'm-' + (matchIdCounter++),
          round: r, position: i,
          playerA: null, playerB: null,
          winner: null, setsA: 0, setsB: 0,
          scoreDisplay: null,
          nextMatchId: null,
        };
        roundMatches.push(m);
        matches.push(m);
      }
      for (var i = 0; i < prevRound.length; i++) {
        var parentIdx = Math.floor(i / 2);
        prevRound[i].nextMatchId = roundMatches[parentIdx].id;
      }
      prevRound = roundMatches;
    }

    return { matches: matches, rounds: rounds, champion: null };
  }

  function getRoundMatches(bracket, round) {
    return bracket.matches
      .filter(function (m) { return m.round === round; })
      .sort(function (a, b) { return a.position - b.position; });
  }

  function recomputeSlot(matches, match, slot) {
    var prevRound = match.round - 1;
    if (prevRound < 0) return slot === 'A' ? match.playerA : match.playerB;
    var slotIndex = slot === 'A' ? 0 : 1;
    var upstream = matches.find(function (m) {
      return m.round === prevRound && m.position === match.position * 2 + slotIndex;
    });
    if (!upstream || !upstream.winner) return null;
    return upstream.winner === 'A' ? upstream.playerA : upstream.playerB;
  }

  function setMatchWinner(bracket, matchId, winner) {
    var matches = bracket.matches.map(function (m) { return Object.assign({}, m); });
    var match = matches.find(function (m) { return m.id === matchId; });
    if (!match) return bracket;
    match.winner = winner;
    var winningPlayer = winner === 'A' ? match.playerA : match.playerB;

    if (match.nextMatchId) {
      var nextMatch = matches.find(function (m) { return m.id === match.nextMatchId; });
      if (nextMatch) {
        var isSlotA = match.position % 2 === 0;
        if (isSlotA) nextMatch.playerA = winningPlayer;
        else nextMatch.playerB = winningPlayer;
        nextMatch.winner = null;
      }
      return { matches: matches, rounds: bracket.rounds, champion: bracket.champion };
    } else {
      // Final
      return { matches: matches, rounds: bracket.rounds, champion: winningPlayer };
    }
  }

  function clearMatchWinner(bracket, matchId) {
    var matches = bracket.matches.map(function (m) { return Object.assign({}, m); });
    var match = matches.find(function (m) { return m.id === matchId; });
    if (!match) return bracket;
    match.winner = null;
    match.setsA = 0; match.setsB = 0; match.scoreDisplay = null;

    var currentId = match.nextMatchId;
    while (currentId) {
      var nextMatch = matches.find(function (m) { return m.id === currentId; });
      if (!nextMatch) break;
      nextMatch.winner = null;
      nextMatch.setsA = 0; nextMatch.setsB = 0; nextMatch.scoreDisplay = null;
      nextMatch.playerA = recomputeSlot(matches, nextMatch, 'A');
      nextMatch.playerB = recomputeSlot(matches, nextMatch, 'B');
      currentId = nextMatch.nextMatchId;
    }
    return { matches: matches, rounds: bracket.rounds, champion: null };
  }

  function shuffleAllPlayers(players) {
    var shuffled = shuffleArray(players);
    var pairings = [];
    var byes = [];
    for (var i = 0; i < shuffled.length; i += 2) {
      if (i + 1 < shuffled.length) pairings.push([shuffled[i], shuffled[i + 1]]);
      else byes.push(shuffled[i]);
    }
    return { pairings: pairings, byes: byes };
  }

  // ============================================================
  // Team formation — 2v2 pairings
  // Each match has Team A (2 players) vs Team B (2 players).
  // Given N players we form floor(N/4) full 2v2 matches.
  // Any remaining 1-3 players get grouped into a "bye" team slot
  // (shown but not scored) so the user can see who's left over.
  // ============================================================
  function buildTeams(players) {
    if (players.length < 4) return [];
    var shuffled = shuffleArray(players);
    var teams = [];
    var i = 0;
    while (i + 3 < shuffled.length) {
      teams.push({
        id: uid('team'),
        teamA: [shuffled[i], shuffled[i + 1]],
        teamB: [shuffled[i + 2], shuffled[i + 3]],
      });
      i += 4;
    }
    // Handle leftover 1-3 players as a partial team (display only)
    if (i < shuffled.length) {
      var leftover = shuffled.slice(i);
      teams.push({
        id: uid('team'),
        teamA: [leftover[0] || null, leftover[1] || null],
        teamB: [leftover[2] || null, null],
        isPartial: true,
      });
    }
    return teams;
  }

  function teamDisplayName(team) {
    // team is an array of 2 players (or nulls)
    if (!team || team.length === 0) return 'TBD';
    var names = team.filter(function (p) { return p && p.name; }).map(function (p) { return p.name; });
    if (names.length === 0) return 'TBD';
    if (names.length === 1) return names[0];
    return names[0] + ' / ' + names[1];
  }

  // Build a "team entity" used by the bracket.
  // The bracket stores playerA/playerB as either individual players or team objects.
  // For 2v2 mode we wrap each team of 2 into a single entity with a `name` and `members`.
  function teamEntity(teamArr) {
    if (!teamArr) return null;
    var valid = teamArr.filter(function (p) { return p && p.name; });
    if (valid.length === 0) return null;
    return {
      id: uid('ent'),
      name: teamDisplayName(teamArr),
      members: valid,
      isTeam: true,
    };
  }

  // ============================================================
  // Helpers
  // ============================================================
  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  }

  function roundNameLabels(roundCount) {
    var labels = [];
    for (var i = 0; i < roundCount; i++) {
      var remaining = roundCount - i;
      if (remaining === 1) labels.push('Final');
      else if (remaining === 2) labels.push('Semifinals');
      else if (remaining === 3) labels.push('Quarterfinals');
      else if (remaining === 4) labels.push('Round of 16');
      else if (remaining === 5) labels.push('Round of 32');
      else labels.push('Round of ' + Math.pow(2, remaining));
    }
    return labels;
  }

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'className') node.className = attrs[k];
        else if (k === 'textContent') node.textContent = attrs[k];
        else if (k === 'innerHTML') node.innerHTML = attrs[k];
        else if (k === 'dataset') {
          Object.keys(attrs.dataset).forEach(function (d) {
            node.dataset[d] = attrs.dataset[d];
          });
        } else if (k.startsWith('on') && typeof attrs[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (k === 'disabled' || k === 'checked' || k === 'readonly' || k === 'hidden' || k === 'selected' || k === 'multiple') {
          // Boolean attributes — only set when truthy
          if (attrs[k]) node.setAttribute(k, '');
          else node.removeAttribute(k);
        } else if (attrs[k] != null) {
          node.setAttribute(k, attrs[k]);
        }
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null) return;
        if (typeof c === 'string') node.appendChild(document.createTextNode(c));
        else node.appendChild(c);
      });
    }
    return node;
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ============================================================
  // Toast
  // ============================================================
  function toast(title, desc, destructive) {
    var container = $('toast-container');
    var t = el('div', { className: 'toast' + (destructive ? ' destructive' : '') }, [
      el('div', { className: 'toast-title', textContent: title }),
      desc ? el('div', { className: 'toast-desc', textContent: desc }) : null,
    ]);
    container.appendChild(t);
    setTimeout(function () {
      t.style.opacity = '0';
      t.style.transition = 'opacity 0.3s';
      setTimeout(function () { t.remove(); }, 300);
    }, 2800);
  }

  // ============================================================
  // Modal input state
  // ============================================================
  var modalInputs = ['', '', '', ''];

  // ============================================================
  // Render functions
  // ============================================================
  function renderHeader() {
    $('player-count').textContent = String(state.players.length);
    // Update the team-logo button badge with the number of formed 2v2 matches
    var teamLogoBadge = $('team-logo-badge');
    if (teamLogoBadge) {
      var fullMatches = state.teams.filter(function (t) { return !t.isPartial; }).length;
      teamLogoBadge.textContent = String(fullMatches);
    }
    var hasTournament = state.bracket || state.shufflePairings.length > 0;
    var resetBtn = $('reset-bracket-btn');
    var shuffleBtn = $('shuffle-btn');
    if (state.bracket) {
      resetBtn.classList.remove('hidden');
      shuffleBtn.classList.remove('hidden');
    } else if (state.shufflePairings.length > 0) {
      resetBtn.classList.add('hidden');
      shuffleBtn.classList.remove('hidden');
    } else {
      resetBtn.classList.add('hidden');
      shuffleBtn.classList.add('hidden');
    }

    // Footer text
    if (hasTournament) {
      $('footer-text').innerHTML =
        'Saved locally in your browser · refresh safely · ' +
        '<button id="footer-manage">manage players</button>';
      var fm = $('footer-manage');
      if (fm) fm.onclick = function () { openModal(); };
    } else {
      $('footer-text').innerHTML =
        'Tap <span class="accent">Add Players</span> to start your Padel tournament · data persists in your browser';
    }
  }

  function renderBracket() {
    var body = $('bracket-body');
    var titleEl = $('bracket-title');
    var subtitleEl = $('bracket-subtitle');
    body.innerHTML = '';
    body.classList.add('padel-scroll');

    if (!state.bracket && state.shufflePairings.length === 0) {
      titleEl.textContent = 'Tournament Hub';
      subtitleEl.textContent = 'Add players to begin';
      body.appendChild(renderEmptyState());
      return;
    }

    if (state.shufflePairings.length > 0 && !state.bracket) {
      titleEl.textContent = 'Random Matchmaking';
      subtitleEl.textContent = state.shufflePairings.length + ' active pairings · reshuffle anytime';
      body.appendChild(renderShuffleView());
      return;
    }

    // Bracket mode
    titleEl.textContent = 'Tournament Bracket';
    subtitleEl.textContent = state.players.length + ' players · ' + state.bracket.rounds + ' rounds';

    if (state.bracket.champion) {
      body.appendChild(renderChampionBanner(state.bracket.champion));
    }

    var wrap = el('div', { className: 'bracket-rounds padel-scroll' });
    var labels = roundNameLabels(state.bracket.rounds);
    for (var r = 0; r < state.bracket.rounds; r++) {
      var roundCol = el('div', { className: 'bracket-round' }, [
        el('div', { className: 'round-label', textContent: labels[r] }),
      ]);
      var matchesWrap = el('div', { className: 'round-matches' });
      var matches = getRoundMatches(state.bracket, r);
      matches.forEach(function (m) {
        matchesWrap.appendChild(renderMatchCard(m, false));
      });
      roundCol.appendChild(matchesWrap);
      wrap.appendChild(roundCol);
    }
    body.appendChild(wrap);
  }

  function renderEmptyState() {
    return el('div', { className: 'empty-state' }, [
      el('div', { className: 'empty-court-wrap' }, [
        el('div', { className: 'padel-court-icon big' }),
        el('div', { className: 'empty-trophy', textContent: '🏆' }),
      ]),
      el('h3', { textContent: 'Build your Padel tournament' }),
      el('p', { innerHTML:
        'Tap <span class="accent">Add Players</span> to register players (2–20+), ' +
        'then generate a knockout bracket — World-Cup style — or use random matchmaking.' }),
    ]);
  }

  function renderChampionBanner(champion) {
    return el('div', { className: 'champion-banner animate-fade-up' }, [
      el('div', { className: 'champion-icon', textContent: '👑' }),
      el('div', {}, [
        el('div', { className: 'champion-label', textContent: 'Champion' }),
        el('div', { className: 'champion-name', textContent: champion.name }),
        el('div', { className: 'champion-sub',
          textContent: 'Won the tournament of ' + state.players.length + ' players' }),
      ]),
    ]);
  }

  function renderMatchCard(match, isShuffle) {
    var card = el('div', { className: 'match-card' +
      (state.activeMatchId === match.id ? ' active' : '') +
      (match.winner ? ' completed' : '') });

    var slotA = el('div', { className: 'match-slot' +
      (match.winner === 'A' ? ' winner' : match.winner === 'B' ? ' loser' : '') }, [
      el('span', { className: 'player-name' }, [
        el('span', { className: 'player-dot a' }),
        el('span', { textContent: match.playerA ? match.playerA.name : (match.playerB ? 'Bye' : 'TBD') }),
      ]),
      match.winner === 'A' ? el('span', { className: 'crown', textContent: '★' }) : null,
    ]);

    var slotB = el('div', { className: 'match-slot' +
      (match.winner === 'B' ? ' winner' : match.winner === 'A' ? ' loser' : '') }, [
      el('span', { className: 'player-name' }, [
        el('span', { className: 'player-dot b' }),
        el('span', { textContent: match.playerB ? match.playerB.name :
          (match.playerA ? 'Bye' : 'TBD') }),
      ]),
      match.winner === 'B' ? el('span', { className: 'crown', textContent: '★' }) : null,
    ]);

    card.appendChild(slotA);
    card.appendChild(el('div', { className: 'match-vs', textContent: 'vs' }));
    card.appendChild(slotB);

    // Footer with score + actions
    var footer = el('div', { className: 'match-footer' });
    if (match.scoreDisplay) {
      footer.appendChild(el('span', { className: 'match-score-display',
        textContent: match.scoreDisplay }));
    }
    var isBye = (match.playerA && !match.playerB) || (!match.playerA && match.playerB);
    var canPlay = match.playerA && match.playerB && !match.winner;
    if (isBye) {
      footer.appendChild(el('span', { className: 'match-status', textContent: 'Auto-advanced' }));
    } else if (canPlay) {
      footer.appendChild(el('button', {
        className: 'match-action score', textContent: '▶ Score',
        onclick: function () { startMatchScoring(match.id, match.playerA.name, match.playerB.name); },
      }));
    } else if (match.winner) {
      footer.appendChild(el('button', {
        className: 'match-action undo', textContent: '↺ Undo',
        onclick: function () {
          if (isShuffle) {
            state.shufflePairings = state.shufflePairings.map(function (p) {
              return p.id === match.id ? Object.assign({}, p, { winner: null, scoreDisplay: null }) : p;
            });
            saveState();
            renderAll();
          } else {
            state.bracket = clearMatchWinner(state.bracket, match.id);
            saveState();
            renderAll();
          }
        },
      }));
    } else {
      footer.appendChild(el('span', { className: 'match-status', textContent: 'Waiting' }));
    }
    card.appendChild(footer);

    // Quick wins for unplayed matches
    if (canPlay) {
      card.appendChild(el('div', { className: 'quick-wins' }, [
        el('button', { className: 'a-win', textContent: 'A wins',
          onclick: function () { quickSetWinner(match.id, 'A', isShuffle); } }),
        el('button', { className: 'b-win', textContent: 'B wins',
          onclick: function () { quickSetWinner(match.id, 'B', isShuffle); } }),
      ]));
    }
    return card;
  }

  function quickSetWinner(matchId, winner, isShuffle) {
    if (isShuffle) {
      state.shufflePairings = state.shufflePairings.map(function (p) {
        return p.id === matchId ? Object.assign({}, p, { winner: winner }) : p;
      });
    } else {
      state.bracket = setMatchWinner(state.bracket, matchId, winner);
    }
    saveState();
    renderAll();
  }

  function renderShuffleView() {
    var wrap = el('div', {}, [
      el('div', { className: 'shuffle-info' }, [
        el('span', { className: 'icon', textContent: '⤮' }),
        el('div', { innerHTML:
          '<strong>Random matchmaking active.</strong> ' +
          'Anyone can play anyone — reshuffle to re-pair all players.' }),
      ]),
    ]);
    var grid = el('div', { className: 'shuffle-grid' });
    state.shufflePairings.forEach(function (p) {
      var match = {
        id: p.id,
        playerA: p.playerA, playerB: p.playerB,
        winner: p.winner, scoreDisplay: p.scoreDisplay,
      };
      grid.appendChild(renderMatchCard(match, true));
    });
    wrap.appendChild(grid);
    return wrap;
  }

  function renderScoreSection() {
    var section = $('score-section');
    section.innerHTML = '';

    if (!state.activeMatchId) {
      section.appendChild(el('div', { className: 'score-card' }, [
        el('div', { className: 'score-empty' }, [
          el('div', { className: 'score-empty-icon', textContent: '⚡' }),
          el('h3', { textContent: 'Score Counter' }),
          el('p', { innerHTML:
            'Pick a match from the bracket above and tap <span class="accent">Score</span> ' +
            'to start tracking points, games, and sets here.' }),
          el('button', {
            className: 'undo-btn quick-match-btn',
            textContent: 'Quick Match (no bracket)',
            onclick: function () {
              startMatchScoring('quick-' + Date.now(), 'Team A', 'Team B');
            },
          }),
        ]),
      ]));
      return;
    }

    var score = state.activeMatchScore;
    var disp = displayScore(score);
    var deuce = isDeuce(score);
    var adv = advantageTeam(score);
    var isOver = score.winner !== null;
    var canUndo = score.history.length > 0 && !isOver;

    var card = el('div', { className: 'score-card' });

    // Status row
    var statusRow = el('div', { className: 'score-status-row' }, [
      el('div', { className: 'score-status-left' }, [
        el('span', { className: 'live-dot' }),
        el('span', { className: 'status-label',
          textContent: isOver ? 'Match Complete' : 'Live Match' }),
      ]),
      el('div', { className: 'score-status-right' }, [
        el('span', { textContent: 'Best of ' + (score.setsToWin * 2 - 1) + ' sets' }),
        score.server && !isOver ? el('span', { className: 'serving-indicator' }, [
          el('span', { className: 'dot' }),
          el('span', { textContent: 'Serving: ' + (score.server === 'A' ?
            state.activeTeamAName : state.activeTeamBName) }),
        ]) : null,
      ]),
    ]);
    card.appendChild(statusRow);

    // Score grid (two columns)
    var grid = el('div', { className: 'score-grid' });
    grid.appendChild(renderScoreColumn(
      state.activeTeamAName, disp.pointsA, disp.gamesA, disp.setsA,
      'a', score.currentGame.rawA,
      isOver && score.winner === 'A', isOver && score.winner === 'B',
      adv === 'A', isOver, canUndo, 'A'));
    grid.appendChild(renderScoreColumn(
      state.activeTeamBName, disp.pointsB, disp.gamesB, disp.setsB,
      'b', score.currentGame.rawB,
      isOver && score.winner === 'B', isOver && score.winner === 'A',
      adv === 'B', isOver, canUndo, 'B'));
    card.appendChild(grid);

    // Banner
    var banner = el('div', { className: 'status-banner' });
    if (deuce && !isOver) {
      banner.appendChild(el('div', { className: 'banner-text deuce',
        textContent: 'Deuce — next point = Advantage' }));
    } else if (adv && !isOver) {
      banner.appendChild(el('div', { className: 'banner-text advantage',
        textContent: 'Advantage ' + (adv === 'A' ? state.activeTeamAName : state.activeTeamBName) }));
    } else if (isOver) {
      banner.appendChild(el('div', { className: 'banner-text match-winner',
        textContent: '🏆 ' + (score.winner === 'A' ? state.activeTeamAName : state.activeTeamBName) + ' wins!' }));
    }
    card.appendChild(banner);

    // Action bar
    var actions = el('div', { className: 'score-actions' }, [
      el('button', {
        className: 'undo-btn', textContent: '↺ Reset',
        onclick: function () {
          if (confirm('Reset current match score?')) {
            state.activeMatchScore = createInitialMatchScore();
            saveState();
            renderAll();
          }
        },
      }),
      isOver ? el('button', {
        className: 'finalize-btn', textContent: '✓ Save Result to Bracket',
        onclick: finalizeActiveMatch,
      }) : el('span', { className: 'hint', textContent: 'Tap a colored button to add a point' }),
    ]);
    card.appendChild(actions);

    section.appendChild(card);
  }

  function renderScoreColumn(name, pointsLabel, gamesLabel, setsLabel, color, flashKey,
      isWinner, isLoser, hasAdvantage, disabled, canUndo, team) {
    var col = el('div', { className: 'score-column' + (isLoser ? ' loser-side' : '') });
    var btn = el('button', {
      className: 'team-btn ' + (color === 'a' ? 'team-a' : 'team-b'),
      disabled: disabled,
      'aria-label': 'Add point for ' + name,
      onclick: function () {
        if (disabled) return;
        state.activeMatchScore = addPoint(state.activeMatchScore, team);
        saveState();
        renderAll();
      },
    }, [
      el('div', { className: 'team-btn-inner' }, [
        el('span', { className: 'team-label',
          textContent: hasAdvantage ? 'Advantage' : ('Team ' + color.toUpperCase()) }),
        el('span', { className: 'team-name', textContent: name }),
        el('span', {
          className: 'team-points score-flash',
          textContent: pointsLabel,
          // re-trigger animation via key re-mount
          dataset: { flashKey: String(flashKey) },
        }),
        el('span', { className: 'points-label', textContent: 'points' }),
      ]),
    ]);
    col.appendChild(btn);

    // Stats row
    col.appendChild(el('div', { className: 'stats-row' }, [
      el('div', { className: 'stat-box' }, [
        el('div', { className: 'stat-label', textContent: 'Games' }),
        el('div', { className: 'stat-value', textContent: gamesLabel }),
      ]),
      el('div', { className: 'stat-box' }, [
        el('div', { className: 'stat-label', textContent: 'Sets' }),
        el('div', { className: 'stat-value', textContent: setsLabel }),
      ]),
    ]));

    // Undo button — directly under the team button
    col.appendChild(el('button', {
      className: 'undo-btn',
      disabled: !canUndo,
      textContent: '↶ Undo Last Point',
      onclick: function () {
        if (!canUndo) return;
        state.activeMatchScore = undoLastPoint(state.activeMatchScore);
        saveState();
        renderAll();
      },
    }));

    if (isWinner) {
      col.appendChild(el('div', { className: 'winner-tag', textContent: '★ Winner ★' }));
    }
    return col;
  }

  function renderModal() {
    // Player count circle
    $('modal-player-count').textContent = String(state.players.length);
    $('summary-hint').textContent = state.players.length < 2
      ? 'Add at least 2 to start' : 'Ready to play';

    // Roster chips
    var chips = $('roster-chips');
    chips.innerHTML = '';
    state.players.forEach(function (p, i) {
      chips.appendChild(el('span', { className: 'player-chip',
        style: 'animation: chip-in 0.3s ' + (i * 0.03) + 's both ease-out;' }, [
        el('span', { className: 'chip-num', textContent: String(i + 1) }),
        el('span', { textContent: p.name }),
        el('button', {
          className: 'chip-remove', textContent: '✕',
          'aria-label': 'Remove ' + p.name,
          onclick: function () {
            state.players = state.players.filter(function (x) { return x.id !== p.id; });
            saveState();
            renderModal();
            renderHeader();
          },
        }),
      ]));
    });

    // Inputs
    var grid = $('inputs-grid');
    grid.innerHTML = '';
    modalInputs.forEach(function (val, idx) {
      var input = el('input', {
        className: 'player-input',
        type: 'text',
        value: val,
        placeholder: 'Player ' + (state.players.length + idx + 1) + ' name',
        oninput: function (e) { handleInputChange(idx, e.target.value); },
        onkeydown: function (e) {
          if (e.key === 'Enter') { e.preventDefault(); addToRoster(); }
        },
      });
      grid.appendChild(input);
    });

    // Button disabled states
    $('random-matchmaking-btn').disabled = state.players.length < 2;
    $('generate-bracket-btn').disabled = state.players.length < 2;
    $('clear-all-btn').disabled = state.players.length === 0;
  }

  // ============================================================
  // Actions
  // ============================================================
  function handleInputChange(idx, val) {
    modalInputs[idx] = val;
    if (idx === modalInputs.length - 1 && val.length > 0) {
      modalInputs.push('');
      renderModal();
    }
  }

  function addToRoster() {
    var names = modalInputs.map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
    if (names.length === 0) {
      toast('No names entered', 'Enter at least one player name.', true);
      return;
    }
    var newPlayers = names.map(function (n, i) {
      return { id: uid('p'), name: n };
    });
    state.players = state.players.concat(newPlayers);
    // Auto-rebuild 2v2 team pairings whenever roster changes
    state.teams = buildTeams(state.players);
    modalInputs = ['', '', '', ''];
    saveState();
    renderModal();
    renderHeader();
    renderTeamFormation();
    toast(names.length + ' player' + (names.length > 1 ? 's' : '') + ' added',
      'Total players: ' + state.players.length +
      (state.teams.length > 0 ? ' · ' + state.teams.length + ' 2v2 match' + (state.teams.length > 1 ? 'es' : '') + ' formed' : ''));
  }

  function clearAllPlayers() {
    state.players = [];
    state.teams = [];
    state.bracket = null;
    state.shufflePairings = [];
    state.activeMatchId = null;
    state.activeMatchScore = createInitialMatchScore();
    saveState();
    renderModal();
    renderHeader();
    renderTeamFormation();
    renderAll();
    toast('All players cleared');
  }

  function generateBracketAction() {
    if (state.players.length < 4) {
      toast('Need at least 4 players', 'A 2v2 match needs 4 players. Add more.', true);
      return;
    }
    // Auto-form 2v2 teams if not already done
    if (state.teams.length === 0) {
      state.teams = buildTeams(state.players);
    }
    // Convert each team of 2 into a "team entity" the bracket can route through.
    // Each pairing (teamA vs teamB) becomes one first-round match in the bracket.
    var allTeams = [];
    state.teams.forEach(function (t) {
      if (t.isPartial) return;
      allTeams.push(teamEntity(t.teamA));
      allTeams.push(teamEntity(t.teamB));
    });
    if (allTeams.length < 2) {
      toast('Not enough full teams', 'Need at least 4 players to form 2 teams.', true);
      return;
    }
    state.bracket = generateBracket(allTeams);
    state.shufflePairings = [];
    state.activeMatchId = null;
    state.activeMatchScore = createInitialMatchScore();
    // Make sure the lineup panel is visible after generation
    state.lineupVisible = true;
    saveState();
    renderAll();
    closeModal();
    toast('Bracket generated', allTeams.length + ' teams seeded into a knockout bracket.');
  }

  function shuffleAction() {
    if (state.players.length < 4) {
      toast('Need at least 4 players', 'A 2v2 match needs 4 players. Add more.', true);
      return;
    }
    // Re-pair everyone into fresh 2v2 matches (winners AND losers)
    state.teams = buildTeams(state.players);
    state.shufflePairings = state.teams
      .filter(function (t) { return !t.isPartial; })
      .map(function (t) {
        return {
          id: t.id,
          playerA: teamEntity(t.teamA),
          playerB: teamEntity(t.teamB),
          winner: null,
          scoreDisplay: null,
        };
      });
    state.bracket = null;
    state.activeMatchId = null;
    state.activeMatchScore = createInitialMatchScore();
    // Make sure the lineup panel is visible to show the new shuffle pairings
    state.lineupVisible = true;
    saveState();
    renderTeamFormation();
    renderAll();
    closeModal();
    toast('Random matchmaking activated',
      state.shufflePairings.length + ' 2v2 matches randomly paired.');
  }

  function resetBracketAction() {
    if (!confirm('Reset the bracket? Players will be kept.')) return;
    state.bracket = null;
    state.activeMatchId = null;
    state.activeMatchScore = createInitialMatchScore();
    saveState();
    renderAll();
  }

  function shuffleFromHeader() {
    if (!confirm('Reshuffle all players into new random pairings?')) return;
    shuffleAction();
  }

  function rePairTeams() {
    if (state.players.length < 4) {
      toast('Need at least 4 players', 'A 2v2 match needs 4 players. Add more.', true);
      return;
    }
    state.teams = buildTeams(state.players);
    saveState();
    renderTeamFormation();
    toast('Teams re-paired', state.teams.length + ' 2v2 match' + (state.teams.length > 1 ? 'es' : '') + ' formed.');
  }

  // Toggle the team-formation panel open/closed
  function toggleTeamFormation(open) {
    if (typeof open !== 'boolean') open = !state.teamFormationOpen;
    state.teamFormationOpen = open;
    saveState();
    // Re-render the panel to apply the new visibility state
    renderTeamFormation();
    // Update ARIA on the header button
    var addBtn = $('open-add-players');
    if (addBtn) addBtn.setAttribute('aria-expanded', String(open));
    var tfToggle = $('tf-toggle');
    if (tfToggle) tfToggle.setAttribute('aria-expanded', String(open));
  }

  // Toggle the ENTIRE lineup panel visibility (squad + bracket).
  //   null  -> never opened (default — only ads + score counter visible)
  //   false -> opened then hidden (team-logo button appears in header)
  //   true  -> visible (squad + bracket both shown)
  function toggleLineupPanel(visible) {
    if (typeof visible !== 'boolean') {
      // Toggle: if currently visible -> hide (false); otherwise -> show (true)
      visible = state.lineupVisible !== true;
    }
    state.lineupVisible = visible;
    // When showing the lineup, also auto-open the team-formation sub-panel
    if (visible && state.teamFormationOpen === null) {
      state.teamFormationOpen = true;
    }
    saveState();
    renderLineupPanel();
    renderTeamFormation(); // apply the team-formation collapse state too
    // Update ARIA on the Lineup toggle button
    var lineupBtn = $('lineup-toggle-btn');
    if (lineupBtn) lineupBtn.setAttribute('aria-expanded', String(visible === true));
  }

  // Apply the lineup panel visibility state to the DOM
  function renderLineupPanel() {
    var panel = $('lineup-panel');
    var teamLogoBtn = $('show-bracket-btn');
    var lineupBtn = $('lineup-toggle-btn');
    if (!panel) return;

    if (state.lineupVisible === true) {
      // Lineup visible
      panel.classList.remove('hidden-panel');
      if (teamLogoBtn) teamLogoBtn.classList.add('hidden');
      if (lineupBtn) lineupBtn.setAttribute('aria-expanded', 'true');
    } else {
      // Lineup hidden — either never revealed (null) or hidden (false)
      panel.classList.add('hidden-panel');
      if (lineupBtn) lineupBtn.setAttribute('aria-expanded', 'false');
      // Team-logo button only shows when the lineup has been revealed before
      // (i.e. hidden state = false). When never revealed (null), the user is
      // still expected to click "Add Players" or "Lineup" first.
      if (state.lineupVisible === false && teamLogoBtn) {
        teamLogoBtn.classList.remove('hidden');
      } else if (teamLogoBtn) {
        teamLogoBtn.classList.add('hidden');
      }
    }
  }

  // Quick-add player from the team formation panel input
  function quickAddPlayer() {
    var input = $('tf-quick-input');
    if (!input) return;
    var name = input.value.trim();
    if (name.length === 0) {
      toast('No name entered', 'Type a name and press Add.', true);
      return;
    }
    state.players = state.players.concat([{ id: uid('p'), name: name }]);
    state.teams = buildTeams(state.players);
    input.value = '';
    saveState();
    renderHeader();
    renderTeamFormation();
    toast('Player added', state.players.length + ' player' + (state.players.length !== 1 ? 's' : '') + ' total.');
  }

  function startMatchScoring(matchId, teamAName, teamBName) {
    state.activeMatchId = matchId;
    state.activeMatchScore = createInitialMatchScore();
    state.activeTeamAName = teamAName;
    state.activeTeamBName = teamBName;
    saveState();
    renderAll();
    // Scroll to score section on mobile
    if (window.innerWidth < 1024) {
      $('score-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function finalizeActiveMatch() {
    if (!state.activeMatchId || !state.activeMatchScore.winner) return;
    var winner = state.activeMatchScore.winner;
    var disp = displayScore(state.activeMatchScore);
    var matchId = state.activeMatchId;
    var isShuffle = state.shufflePairings.some(function (p) { return p.id === matchId; });

    if (isShuffle) {
      state.shufflePairings = state.shufflePairings.map(function (p) {
        if (p.id !== matchId) return p;
        return Object.assign({}, p, {
          winner: winner,
          scoreDisplay: disp.setsA + '-' + disp.setsB,
        });
      });
    } else if (state.bracket) {
      // Update bracket match with score, then propagate winner
      var updated = Object.assign({}, state.bracket, {
        matches: state.bracket.matches.map(function (m) {
          if (m.id !== matchId) return m;
          return Object.assign({}, m, {
            winner: winner,
            setsA: parseInt(disp.setsA, 10),
            setsB: parseInt(disp.setsB, 10),
            scoreDisplay: disp.setsA + '-' + disp.setsB,
          });
        }),
      });
      state.bracket = setMatchWinner(updated, matchId, winner);
    }
    state.activeMatchId = null;
    state.activeMatchScore = createInitialMatchScore();
    saveState();
    renderAll();
    toast('Match result saved', 'Winner advanced to next round.');
  }

  // ============================================================
  // Modal control
  // ============================================================
  function openModal() {
    modalInputs = ['', '', '', ''];
    renderModal();
    $('add-players-modal').classList.remove('hidden');
  }
  function closeModal() {
    $('add-players-modal').classList.add('hidden');
  }

  // "Add Players" header button — opens the bulk-add modal.
  // Also ensures the lineup panel (squad + bracket) is visible so the user
  // can see the squad/teams they're adding to.
  function addPlayersClick() {
    // Make sure the lineup panel is visible (squad + bracket)
    if (state.lineupVisible !== true) {
      toggleLineupPanel(true);
    }
    // Open the bulk-add modal
    openModal();
  }

  // ============================================================
  // Render: Team Formation Panel
  // ============================================================
  function renderTeamFormation() {
    var panel = $('team-formation-panel');
    if (!panel) return;

    // Apply collapse state based on state.teamFormationOpen:
    //   null or false -> collapsed (header only, body hidden)
    //   true          -> fully open (header + body)
    // Note: the team-formation panel is INSIDE the lineup-panel, so its
    // overall visibility is controlled by the parent. We only control the
    // collapse state here.
    if (state.teamFormationOpen === true) {
      panel.classList.remove('collapsed');
    } else {
      panel.classList.add('collapsed');
    }

    // Roster count
    var rosterCount = $('tf-roster-count');
    if (rosterCount) rosterCount.textContent = String(state.players.length);

    // Roster chips
    var chips = $('tf-roster-chips');
    if (chips) {
      chips.innerHTML = '';
      state.players.forEach(function (p, i) {
        chips.appendChild(el('span', { className: 'player-chip',
          style: 'animation: chip-in 0.3s ' + (i * 0.02) + 's both ease-out;' }, [
          el('span', { className: 'chip-num', textContent: String(i + 1) }),
          el('span', { textContent: p.name }),
          el('button', {
            className: 'chip-remove', textContent: '✕',
            'aria-label': 'Remove ' + p.name,
            onclick: function () {
              state.players = state.players.filter(function (x) { return x.id !== p.id; });
              state.teams = buildTeams(state.players);
              saveState();
              renderHeader();
              renderTeamFormation();
            },
          }),
        ]));
      });
    }

    // Subtitle
    var subtitle = $('tf-subtitle');
    if (subtitle) {
      var fullMatches = state.teams.filter(function (t) { return !t.isPartial; }).length;
      if (state.players.length === 0) {
        subtitle.textContent = 'Add players — teams will be auto-paired 2 vs 2';
      } else if (state.players.length < 4) {
        subtitle.textContent = state.players.length + ' player' + (state.players.length !== 1 ? 's' : '') + ' · need ' + (4 - state.players.length) + ' more to form a 2v2 match';
      } else {
        subtitle.textContent = state.players.length + ' players · ' + fullMatches + ' 2v2 match' + (fullMatches !== 1 ? 'es' : '') + ' formed';
      }
    }

    // Teams grid
    var grid = $('tf-teams-grid');
    if (grid) {
      grid.innerHTML = '';
      if (state.teams.length === 0) {
        grid.appendChild(el('div', {
          className: 'tf-hint',
          innerHTML: '<span class="hint-icon">💡</span> Add at least 4 players to auto-form two 2-player teams.',
        }));
      } else {
        state.teams.forEach(function (t, idx) {
          grid.appendChild(renderTeamCard(t, idx));
        });
      }
    }

    // Hint
    var hint = $('tf-hint');
    if (hint) {
      hint.className = 'tf-hint';
      if (state.players.length < 4) {
        hint.innerHTML = '<span class="hint-icon">💡</span> Add ' + (4 - state.players.length) + ' more player' + ((4 - state.players.length) !== 1 ? 's' : '') + ' to form the first 2v2 match.';
      } else {
        var fullCount = state.teams.filter(function (t) { return !t.isPartial; }).length;
        var partialCount = state.teams.filter(function (t) { return t.isPartial; }).length;
        hint.classList.add('ok');
        var msg = '<span class="hint-icon">✓</span> ' + fullCount + ' complete 2v2 match' + (fullCount !== 1 ? 'es' : '') + ' ready.';
        if (partialCount > 0) {
          msg += ' ' + partialCount + ' partial team' + (partialCount !== 1 ? 's' : '') + ' waiting for more players.';
        }
        hint.innerHTML = msg;
      }
    }

    // Footer action buttons disabled state
    var genBtn = $('tf-generate-bracket');
    var rndBtn = $('tf-random-matchmaking');
    if (genBtn) genBtn.disabled = state.players.length < 4;
    if (rndBtn) rndBtn.disabled = state.players.length < 4;
    var clearBtn = $('tf-clear-all');
    if (clearBtn) clearBtn.disabled = state.players.length === 0;
  }

  function renderTeamCard(team, idx) {
    var card = el('div', { className: 'tf-team-card' + (team.isPartial ? ' bye' : (idx % 2 === 0 ? ' team-a' : ' team-b')) });

    // Header
    var header = el('div', { className: 'tf-team-header' });
    var name = team.isPartial
      ? 'Waiting for players'
      : 'Match ' + (idx + 1);
    header.appendChild(el('div', { className: 'tf-team-name', textContent: name }));
    header.appendChild(el('div', { className: 'tf-team-tag',
      textContent: team.isPartial ? 'Partial' : '2 v 2' }));
    card.appendChild(header);

    // Team A
    card.appendChild(renderTeamSide('Team A', team.teamA, 'a'));
    // VS divider
    card.appendChild(el('div', { className: 'match-vs', textContent: 'vs' }));
    // Team B
    card.appendChild(renderTeamSide('Team B', team.teamB, 'b'));

    return card;
  }

  function renderTeamSide(label, teamArr, side) {
    var wrap = el('div', { className: 'tf-team-players' });
    var colorClass = side === 'a' ? 'team-a' : 'team-b';
    var labelText = side === 'a' ? 'Team A' : 'Team B';
    wrap.appendChild(el('div', {
      className: 'tf-team-tag ' + colorClass,
      textContent: labelText,
      style: 'align-self: flex-start; margin-bottom: 2px;',
    }));
    // Show 2 player slots (or "Empty" placeholders)
    for (var i = 0; i < 2; i++) {
      var p = teamArr && teamArr[i];
      if (p && p.name) {
        wrap.appendChild(el('div', { className: 'tf-player-row ' + colorClass }, [
          el('span', { className: 'dot' }),
          el('span', { textContent: p.name }),
        ]));
      } else {
        wrap.appendChild(el('div', { className: 'tf-player-row empty ' + colorClass }, [
          el('span', { className: 'dot' }),
          el('span', { textContent: 'Empty slot' }),
        ]));
      }
    }
    return wrap;
  }

  // ============================================================
  // AdSense initialization
  // ============================================================
  var adsInitialized = false;
  function initAds() {
    if (adsInitialized) return;
    adsInitialized = true;
    // Push each ad unit to AdSense. The actual ad rendering only happens
    // if a valid publisher ID (ca-pub-...) and slot ID are configured.
    // With a placeholder ID, AdSense may log retry messages to the console
    // — these are expected and stop appearing once a real ID is configured.
    try {
      var ads = document.getElementsByClassName('adsbygoogle');
      for (var i = 0; i < ads.length; i++) {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      }
    } catch (e) {
      // Mark as not initialized so we can retry on next render
      adsInitialized = false;
    }
  }

  // ============================================================
  // Re-render entry point
  // ============================================================
  function renderAll() {
    renderHeader();
    renderLineupPanel();
    renderTeamFormation();
    renderBracket();
    renderScoreSection();
  }

  // ============================================================
  // Init
  // ============================================================
  function init() {
    loadState();

    // Bind events
    $('open-add-players').onclick = addPlayersClick;
    $('close-modal').onclick = closeModal;
    $('add-players-modal').onclick = function (e) {
      if (e.target === this) closeModal();
    };
    $('add-to-roster-btn').onclick = addToRoster;
    $('clear-all-btn').onclick = clearAllPlayers;
    $('generate-bracket-btn').onclick = generateBracketAction;
    $('random-matchmaking-btn').onclick = shuffleAction;
    $('reset-bracket-btn').onclick = resetBracketAction;
    $('shuffle-btn').onclick = shuffleFromHeader;

    // Lineup toggle button — shows/hides the entire Add Players panel
    // (squad roster + bracket/teams view). Pressing it toggles the panel.
    var lineupToggleBtn = $('lineup-toggle-btn');
    if (lineupToggleBtn) lineupToggleBtn.onclick = function () { toggleLineupPanel(); };

    // Team-logo button in header — reveals the lineup panel when it's been hidden
    var showBracketBtn = $('show-bracket-btn');
    if (showBracketBtn) showBracketBtn.onclick = function () { toggleLineupPanel(true); };

    // Bracket minimize button — hides the entire lineup panel, shows the team-logo button
    var minimizeBtn = $('minimize-bracket-btn');
    if (minimizeBtn) minimizeBtn.onclick = function () { toggleLineupPanel(false); };

    // Team formation panel events
    var tfToggle = $('tf-toggle');
    if (tfToggle) tfToggle.onclick = function () { toggleTeamFormation(!state.teamFormationOpen); };
    var tfShuffle = $('tf-shuffle-teams');
    if (tfShuffle) tfShuffle.onclick = rePairTeams;
    var tfQuickAdd = $('tf-quick-add');
    if (tfQuickAdd) tfQuickAdd.onclick = quickAddPlayer;
    var tfQuickInput = $('tf-quick-input');
    if (tfQuickInput) {
      tfQuickInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); quickAddPlayer(); }
      });
    }
    var tfClearAll = $('tf-clear-all');
    if (tfClearAll) tfClearAll.onclick = clearAllPlayers;
    var tfGenBracket = $('tf-generate-bracket');
    if (tfGenBracket) tfGenBracket.onclick = generateBracketAction;
    var tfRandomMatch = $('tf-random-matchmaking');
    if (tfRandomMatch) tfRandomMatch.onclick = shuffleAction;

    // ESC to close modal
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('add-players-modal').classList.contains('hidden')) {
        closeModal();
      }
    });

    renderAll();
    // Initialize ads after first render
    setTimeout(initAds, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
