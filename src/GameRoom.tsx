import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { BACKEND_URL } from "./config";
import SockJS from "sockjs-client";
import { Client } from "@stomp/stompjs";

function GameRoom() {
  // State for answer input and feedback
  const [answer, setAnswer] = useState('');
  const [guessError, setGuessError] = useState<string | null>(null);
  const [guessSuccess, setGuessSuccess] = useState<string | null>(null);
  const [startLoading, setStartLoading] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Handler for submitting a guess
  async function handleGuess(e: React.FormEvent) {
    e.preventDefault();
    setGuessError(null);
    setGuessSuccess(null);
    if (!answer.trim()) {
      setGuessError('Please enter an answer.');
      return;
    }
    try {
      const myName = localStorage.getItem('ff_name');
      const res = await fetch(`${BACKEND_URL}/games/${game.code}/guess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player: myName, answer }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        let msg = data.message || 'Guess failed';
        setGuessError('Incorrect! ' + msg);
        return;
      }
      // Assume backend returns { correct: true/false, message: string }
      if (data.correct) {
        setGuessSuccess('Correct! ' + (data.message || ''));
      } else {
        setGuessError('Incorrect! ' + (data.message || ''));
      }
      setAnswer('');
    } catch (err: any) {
      setGuessError('Error: ' + err.message);
    }
  }
  // Get game code from URL
  const { code } = useParams();
  // State for game info
  const [game, setGame] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch game state once on mount (for initial load)
  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchGameState(code!)
      .then(data => {
        setGame(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [code]);

  // Subscribe to WebSocket for live updates
  useEffect(() => {
    if (!code) return;
    // Create STOMP client
    const client = new Client({
      webSocketFactory: () => new SockJS(`${BACKEND_URL}/ws`),
      debug: () => {},
      reconnectDelay: 5000,
    });

    client.onConnect = () => {
      client.subscribe(`/topic/game/${code}`, (message) => {
        // Parse and update game state
        setGame(JSON.parse(message.body));
      });
    };

    client.activate();
    return () => {
      client.deactivate();
    };
  }, [code]);

  if (loading) return <div>Loading game...</div>;
  if (error) return <div style={{ color: 'red' }}>Error: {error}</div>;
  if (!game) return <div>No game data.</div>;

  // Handler for starting the game (button only visible to host)
  async function handleStartGame() {
    setStartLoading(true);
    setStartError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/games/${game.code}/start`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to start game');
      // No need to update state here; WebSocket will update all clients
    } catch (err: any) {
      setStartError('Error starting game: ' + err.message);
    } finally {
      setStartLoading(false);
    }
  }

  // Determine if current user is host
  const isHost = localStorage.getItem('ff_host') === '1' && localStorage.getItem('ff_code') === game.code;

  // Get current player name from localStorage
  const myName = localStorage.getItem('ff_name');

  // Faceoff UI logic (after game is loaded)
  const isFaceoff = game.status === 'FACEOFF';
  const faceoffPlayers = Array.isArray(game.faceoffPlayers) ? game.faceoffPlayers : [];
  const faceoffWinner = game.faceoffWinner || null;
  const isFaceoffPlayer = faceoffPlayers.some((p: any) => p.name === myName);

  return (
    <div style={{ maxWidth: 600, margin: '2rem auto' }}>
      <h2>Game Room: {game.code}</h2>
      <div>Game Name: <b>{game.topic}</b></div>
      <div>Status: {game.status}</div>
      <div>Round: {game.roundNumber}</div>
      <div>Current Team: {game.currentTeam}</div>
      <div>Strikes: {game.strikes}</div>
      <div>Scores: <span style={{ color: 'red' }}>Red {game.redScore}</span> | <span style={{ color: 'blue' }}>Blue {game.blueScore}</span></div>
      {/* Start Game button, only visible in LOBBY state and for host */}
      {game.status === 'LOBBY' && isHost && (
        <div>
          <button onClick={handleStartGame} style={{ margin: '16px 0', padding: '8px 16px' }} disabled={startLoading}>
            {startLoading ? 'Starting...' : 'Start Game'}
          </button>
          {startError && <div style={{ color: 'red', marginTop: 8 }}>{startError}</div>}
        </div>
      )}

      {/* Faceoff UI: Only show in FACEOFF state */}
      {isFaceoff && (
        <div style={{ margin: '24px 0', padding: '16px', background: '#fffbe6', borderRadius: 8, boxShadow: '0 2px 8px #0002' }}>
          <div style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 8 }}>Faceoff Round!</div>
          <div style={{ marginBottom: 12 }}>
            <b>Players:</b>
            <ul style={{ margin: '8px 0 0 0', padding: 0, listStyle: 'none', display: 'flex', gap: 24 }}>
              {faceoffPlayers.map((p: any) => (
                <li key={p.name} style={{ color: p.team === 'RED' ? 'red' : 'blue', fontWeight: 'bold', fontSize: 16 }}>
                  {p.name} ({p.team})
                  {p.name === myName && ' ← you'}
                </li>
              ))}
            </ul>
          </div>
          {faceoffWinner ? (
            <div style={{ fontSize: 16, color: faceoffWinner === 'RED' ? 'red' : 'blue', fontWeight: 'bold', marginBottom: 8 }}>
              {faceoffWinner} team wins the faceoff!
            </div>
          ) : (
            <div style={{ fontSize: 15, marginBottom: 8 }}>
              First to answer correctly wins control!
            </div>
          )}
          {/* Only allow faceoff players to answer */}
          {isFaceoffPlayer && !faceoffWinner && (
            <form onSubmit={handleGuess} style={{ margin: '16px 0' }}>
              <input
                type="text"
                placeholder="Your answer..."
                value={answer}
                onChange={e => setAnswer(e.target.value)}
                style={{ width: '60%', marginRight: 8 }}
              />
              <button type="submit">Answer</button>
              {guessError && <div style={{ color: 'red', marginTop: 8 }}>{guessError}</div>}
              {guessSuccess && <div style={{ color: 'green', marginTop: 8 }}>{guessSuccess}</div>}
            </form>
          )}
          {!isFaceoffPlayer && !faceoffWinner && (
            <div style={{ color: '#888', fontStyle: 'italic', marginTop: 8 }}>
              Waiting for faceoff players to answer...
            </div>
          )}
        </div>
      )}

      {/* Guessing UI: only show if IN_PROGRESS and player is on current team */}
      {game.status === 'IN_PROGRESS' && myName && (
        (() => {
          const me = game.players.find((p: any) => p.name === myName);
          if (me && me.team === game.currentTeam) {
            return (
              <form onSubmit={handleGuess} style={{ margin: '16px 0' }}>
                <input
                  type="text"
                  placeholder="Your answer..."
                  value={answer}
                  onChange={e => setAnswer(e.target.value)}
                  style={{ width: '60%', marginRight: 8 }}
                />
                <button type="submit">Guess</button>
                {guessError && <div style={{ color: 'red', marginTop: 8 }}>{guessError}</div>}
                {guessSuccess && <div style={{ color: 'green', marginTop: 8 }}>{guessSuccess}</div>}
              </form>
            );
          }
          return null;
        })()
      )}

      <div style={{ marginTop: 16 }}>
        <b>Players:</b>
        <ul>
          {game.players.map((p: any) => {
            const isMe = myName && p.name === myName;
            return (
              <li key={p.id} style={isMe ? { color: '#2e86de', fontWeight: 'bold' } : {}}>
                {p.name} ({p.team})
                {isMe && ' ← you'}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// Helper to fetch game state
async function fetchGameState(code: string) {
  const res = await fetch(`${BACKEND_URL}/games/${code}/state`);
  if (!res.ok) throw new Error('Failed to fetch game state');
  return res.json();
}

export default GameRoom;
export { GameRoom };
