import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BACKEND_URL } from "./config";
import { createGame, joinGame } from "./api";

export function Lobby() {
  // useNavigate lets us programmatically change the page
  const navigate = useNavigate();

  // State for player name (used for both create and join)
  const [name, setName] = useState('');
  // State for create game form
  const [topic, setTopic] = useState('');
  // State for join game form
  const [code, setCode] = useState('');
  // State for feedback messages
  const [createError, setCreateError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Handle create game form submit
  // Helper to auto-assign team (even split)
  async function getAutoTeam(gameCode: string) {
    try {
      const res = await fetch(`${BACKEND_URL}/games/${gameCode}/state`);
      if (!res.ok) return 'RED';
      const data = await res.json();
      const redCount = data.players.filter((p: any) => p.team === 'RED').length;
      const blueCount = data.players.filter((p: any) => p.team === 'BLUE').length;
      return redCount <= blueCount ? 'RED' : 'BLUE';
    } catch {
      return 'RED';
    }
  }

  // When creating a game, also join as player
  async function handleCreateGame(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    if (!name.trim()) {
      setCreateError('Please enter your name.');
      return;
    }
    try {
      // Create game
      const game = await createGame(topic);
      // Auto-assign team (creator is always RED for now)
      await joinGame(game.code, name, 'RED');
      // Store host info in localStorage
      localStorage.setItem('ff_host', '1');
      localStorage.setItem('ff_name', name);
      localStorage.setItem('ff_code', game.code);
      // Redirect to Game Room
      navigate(`/game/${game.code}`);
    } catch (err: any) {
      setCreateError('Error creating game: ' + (err?.response?.data?.message || err.message));
    }
  }

  // Handle join game form submit
  async function handleJoinGame(e: React.FormEvent) {
    e.preventDefault();
    setJoinError(null);
    if (!name.trim()) {
      setJoinError('Please enter your name.');
      return;
    }
    try {
      // Auto-assign team
      const team = await getAutoTeam(code);
      await joinGame(code, name, team);
      // Store player info
      localStorage.setItem('ff_host', '0');
      localStorage.setItem('ff_name', name);
      localStorage.setItem('ff_code', code);
      // Redirect to Game Room
      navigate(`/game/${code}`);
    } catch (err: any) {
      // Try to extract backend error message
      let msg = err?.response?.data?.message || err.message;
      if (msg && msg.toLowerCase().includes('name')) {
        msg = 'That name is already taken in this game. Please choose another.';
      }
      setJoinError('Error joining game: ' + msg);
    }
  }

  // Clear error when user starts typing again
  function handleTopicChange(e: React.ChangeEvent<HTMLInputElement>) {
    setTopic(e.target.value);
    setCreateError(null);
  }
  function handleCodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    setCode(e.target.value);
    setJoinError(null);
  }
  function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    setName(e.target.value);
    setCreateError(null);
    setJoinError(null);
  }

  return (
    <div style={{ maxWidth: 400, margin: '2rem auto' }}>
      <h2>Lobby</h2>
      {/* Name input at the top, used for both create and join */}
      <input
        type="text"
        placeholder="Your Name"
        value={name}
        onChange={handleNameChange}
        required
        style={{ width: '100%', marginBottom: 12 }}
      />
      {/* Create Game Form */}
      <form onSubmit={handleCreateGame} style={{ marginBottom: '2rem' }}>
        <h3>Create Game</h3>
        <input
          type="text"
          placeholder="Game Name (e.g. A murit Iliescu!)"
          value={topic}
          onChange={handleTopicChange}
          required
          style={{ width: '100%', marginBottom: 8 }}
        />
        <button type="submit" style={{ width: '100%' }}>Create</button>
        {createError && <div style={{ color: 'red', marginTop: 8 }}>{createError}</div>}
      </form>
      {/* Join Game Form */}
      <form onSubmit={handleJoinGame}>
        <h3>Join Game</h3>
        <input
          type="text"
          placeholder="Game Code"
          value={code}
          onChange={handleCodeChange}
          required
          style={{ width: '100%', marginBottom: 8 }}
        />
        <button type="submit" style={{ width: '100%' }}>Join</button>
        {joinError && <div style={{ color: 'red', marginTop: 8 }}>{joinError}</div>}
      </form>
    </div>
  );
}