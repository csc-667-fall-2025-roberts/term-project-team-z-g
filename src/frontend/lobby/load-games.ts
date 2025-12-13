export async function loadGames() {
  try {
    const response = await fetch("/games", {
      method: "GET",
      credentials: "include",
    });
    
    if (!response.ok) {
      throw new Error("Failed to load games");
    }
    
    const games = await response.json();
    const gamesContainer = document.querySelector("#games-list");
    
    if (!gamesContainer) {
      console.error("Games container not found");
      return;
    }
    
    // Clear existing games
    gamesContainer.innerHTML = "";
    
    if (games.length === 0) {
      gamesContainer.innerHTML = '<p class="no-games">No games available. Create one!</p>';
      return;
    }
    
    // Render each game
    games.forEach((game: any) => {
      const gameElement = document.createElement("div");
      gameElement.className = "game-item";
      
      // Check state and capacity
      const playerCount = game.player_count || 0;
      const maxPlayers = game.max_players || 4;
      const isFull = playerCount >= maxPlayers;
      const isWaiting = game.state === "waiting";
      const isFinished = game.state === "finished";
      const isInProgress = game.state === "in_progress";
      const joinable = isWaiting && !isFull;
      const userInGame = game.user_in_game || false;

      let buttonText = 'Join Game';
      let buttonDisabled = !joinable;

      if (isFinished) {
        buttonText = 'View Results';
        buttonDisabled = false;
      } else if (userInGame) {
        buttonText = 'Return to Game';
        buttonDisabled = false;
      } else if (isFull) {
        buttonText = 'Game Full';
      } else if (!isWaiting) {
        buttonText = 'In Progress';
      }
      
      let statusNote = '';
      if (isFinished) {
        statusNote = '<p class="game-status-note" style="color:#1e9b4c;">Complete.</p>';
      } else if (isInProgress && isFull) {
        statusNote = '<p class="game-status-note" style="color:#b36b00;">Full and in progress.</p>';
      } else if (isFull) {
        statusNote = '<p class="game-status-note game-full-error">Game is full</p>';
      } else if (!isWaiting && !userInGame) {
        statusNote = '<p class="game-status-note game-full-error">Game already started</p>';
      }

      gameElement.innerHTML = `
        <div class="game-info">
          <h3>${game.name || 'Game #' + game.id}</h3>
          <p>Status: ${game.state}</p>
          <p>Players: ${playerCount}/${maxPlayers}</p>
          ${statusNote}
          <div class="game-error" aria-live="polite"></div>
        </div>
        <button class="join-game-btn" data-game-id="${game.id}" ${buttonDisabled ? 'disabled' : ''}>
          ${buttonText}
        </button>
      `;
      
      const joinButton = gameElement.querySelector(".join-game-btn") as HTMLButtonElement | null;
      const errorEl = gameElement.querySelector(".game-error") as HTMLElement | null;
      
      if (joinButton) {
        joinButton.addEventListener("click", async () => {
          // Finished games go to results page for everyone
          if (isFinished) {
            window.location.href = `/games/${game.id}/results`;
            return;
          }

          // If user is already in the game, just navigate to it
          if (userInGame) {
            window.location.href = `/games/${game.id}`;
            return;
          }
          
          // If not joinable, stay on lobby and show reason
          if (!joinable) {
            if (errorEl) {
              errorEl.textContent = isFull ? "Game is full." : "Game already started.";
            }
            joinButton.disabled = true;
            joinButton.textContent = isFull ? "Game Full" : "In Progress";
            return;
          }

          try {
            const resp = await fetch(`/games/${game.id}/join`, {
              method: "POST",
              credentials: "include",
            });

            if (resp.ok) {
              window.location.href = `/games/${game.id}`;
              return;
            }

            // Handle 4xx errors (e.g., full game)
            const data = await resp.json().catch(() => null);
            const msg = data?.error || "Unable to join this game.";
            if (errorEl) errorEl.textContent = msg;
            joinButton.disabled = true;
            joinButton.textContent = isFull ? "Game Full" : "In Progress";
          } catch (err) {
            if (errorEl) errorEl.textContent = "Unable to join this game.";
          }
        });
      }
      
      gamesContainer.appendChild(gameElement);
    });
  } catch (error) {
    console.error("Error loading games:", error);
  }
}
