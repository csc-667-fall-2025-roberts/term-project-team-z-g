import socketIOClient from "socket.io-client";

// Game state management
interface Card {
  id: number;
  suit: string;
  rank: string;
  location: string;
  player_id?: number;
  position?: number;
}

interface Player {
  player_id: number;
  username: string;
  card_count: number;
}

interface GameState {
  current_turn_player_id: number;
  hidden_joker_rank: string;
  winner_id?: number;
  turn_number: number;
  deck_count: number;
  discard_pile: Card[];
  players: Player[];
}

let socket: any;
let gameId: number;
let currentUserId: number;
let gameState: GameState;
let playerHand: Card[] = [];

// Initialize socket connection
export function initGameSocket(gId: number, uId: number) {
  gameId = gId;
  currentUserId = uId;
  socket = socketIOClient();

  socket.on("connect", () => {
    console.log("Connected to game socket");
    socket.emit("game:join-room", { gameId });
    socket.emit("game:request-state", { gameId, userId: currentUserId });
  });

  // State update from server
  socket.on("game:state-update", (data: { gameState: GameState; playerHand?: Card[] }) => {
    gameState = data.gameState;
    if (data.playerHand) {
      playerHand = data.playerHand;
    }
    updateUI();
  });

  // Card drawn by current player
  socket.on("game:card-drawn", (data: { card: Card; playerHand: Card[] }) => {
    playerHand = data.playerHand;
    updatePlayerHand();
    updateTurnIndicator();
  });

  // Another player drew a card
  socket.on("game:player-drew", (data: { userId: number; source: string; card?: Card }) => {
    console.log(`Player ${data.userId} drew from ${data.source}`);
    // Update UI to show other player drew
    updateOtherPlayers();
  });

  // Discard successful
  socket.on("game:discard-success", (data: { playerHand: Card[] }) => {
    playerHand = data.playerHand;
    updatePlayerHand();
  });

  // Winner declared
  socket.on("game:winner", (data: { winnerId: number; gameState: GameState }) => {
    gameState = data.gameState;
    showWinnerModal(data.winnerId);
  });

  // Error handling
  socket.on("game:error", (data: { message: string }) => {
    showError(data.message);
  });

  socket.on("disconnect", () => {
    console.log("Disconnected from game socket");
  });
}

// UI update functions
function updateUI() {
  updatePlayerHand();
  updateOtherPlayers();
  updateDiscardPile();
  updateDeckCount();
  updateTurnIndicator();
}

function updatePlayerHand() {
  const handDiv = document.getElementById("player-hand");
  if (!handDiv) return;

  if (!playerHand || playerHand.length === 0) {
    handDiv.innerHTML = '<div class="text-muted">No cards yet</div>';
    return;
  }

  handDiv.innerHTML = playerHand.map(renderCard).join("");

  // Add click handlers for card selection
  handDiv.querySelectorAll(".playing-card").forEach((card) => {
    card.addEventListener("click", () => {
      selectCard(card as HTMLElement);
    });
  });
}

function updateOtherPlayers() {
  if (!gameState?.players) return;
  const container = document.getElementById("other-players");
  if (!container) return;

  container.innerHTML = gameState.players
    .filter((p) => p.player_id !== currentUserId)
    .map((p) => {
      const isActive = p.player_id === gameState.current_turn_player_id;
      return `
        <div class="player-info ${isActive ? "active" : ""}">
          <strong>${p.username || "Player " + p.player_id}</strong>
          <div class="small">${p.card_count || 0} cards</div>
          ${isActive ? '<div class="small text-success">Current Turn</div>' : ""}
        </div>
      `;
    })
    .join("");
}

function updateDiscardPile() {
  if (!gameState?.discard_pile) return;
  const container = document.getElementById("discard-top-card");
  if (!container) return;

  if (gameState.discard_pile.length === 0) {
    container.innerHTML = '<div class="text-muted">Empty</div>';
    return;
  }

  const topCard = gameState.discard_pile[gameState.discard_pile.length - 1];
  container.innerHTML = renderCard(topCard);
}

function updateDeckCount() {
  const countEl = document.getElementById("deck-count");
  if (countEl && gameState) {
    countEl.textContent = String(gameState.deck_count || 0);
  }
}

function updateTurnIndicator() {
  const indicator = document.getElementById("turn-indicator");
  if (!indicator || !gameState) return;

  const isMyTurn = gameState.current_turn_player_id === currentUserId;
  indicator.textContent = isMyTurn ? "It's your turn!" : "Waiting for other player...";
  indicator.className = isMyTurn
    ? "small text-success fw-bold ms-3"
    : "small text-muted ms-3";

  // Enable/disable draw buttons
  const deckBtn = document.getElementById("draw-deck-btn");
  const discardBtn = document.getElementById("draw-discard-btn");
  if (deckBtn) deckBtn.style.pointerEvents = isMyTurn ? "auto" : "none";
  if (discardBtn) discardBtn.style.pointerEvents = isMyTurn ? "auto" : "none";
}

// Card rendering
const suitSymbols: Record<string, string> = {
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
  spades: "♠",
};

function renderCard(card: Card): string {
  const color = card.suit === "hearts" || card.suit === "diamonds" ? "red" : "black";
  return `
    <div class="playing-card ${color}" data-card-id="${card.id}">
      <div class="card-rank">${card.rank}</div>
      <div class="card-suit">${suitSymbols[card.suit] || card.suit}</div>
    </div>
  `;
}

// Card selection
let selectedCardId: number | null = null;

function selectCard(cardElement: HTMLElement) {
  // Deselect all cards
  document.querySelectorAll(".playing-card").forEach((c) => c.classList.remove("selected"));

  // Select this card
  cardElement.classList.add("selected");
  selectedCardId = parseInt(cardElement.dataset.cardId || "0");

  // Enable discard button
  const discardBtn = document.getElementById("discard-btn") as HTMLButtonElement;
  if (discardBtn) discardBtn.disabled = false;
}

// Game actions
export function drawFromDeck() {
  if (!socket) return;
  socket.emit("game:draw-deck", { gameId, userId: currentUserId });
}

export function drawFromDiscard() {
  if (!socket) return;
  socket.emit("game:draw-discard", { gameId, userId: currentUserId });
}

export function discardCard() {
  if (!socket || !selectedCardId) return;
  socket.emit("game:discard", { gameId, userId: currentUserId, cardId: selectedCardId });
  selectedCardId = null;
}

export function declareWinner() {
  if (!socket) return;
  socket.emit("game:declare", { gameId, userId: currentUserId });
}

// UI helpers
function showError(message: string) {
  const alert = document.getElementById("error-alert");
  if (!alert) return;
  alert.textContent = message;
  alert.style.display = "block";
  setTimeout(() => {
    alert.style.display = "none";
  }, 5000);
}

function showWinnerModal(winnerId: number) {
  const isMe = winnerId === currentUserId;
  const message = isMe ? "Congratulations! You won!" : `Player ${winnerId} won the game!`;
  alert(message);
  
  // Redirect to lobby after showing winner
  setTimeout(() => {
    window.location.href = "/lobby";
  }, 2000);
}

// Initialize when page loads
if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    // Check if we're on a game page
    const gameIdEl = document.getElementById("game-id");
    const userIdEl = document.getElementById("user-id");

    if (gameIdEl && userIdEl) {
      const gId = parseInt(gameIdEl.textContent || "0");
      const uId = parseInt(userIdEl.textContent || "0");
      if (gId && uId) {
        initGameSocket(gId, uId);
      }
    }
  });
}
