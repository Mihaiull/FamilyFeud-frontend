// Simple API utility for backend requests
// We'll use fetch for HTTP calls

const BASE_URL = 'http://localhost:8080';

export async function createGame(topic: string) {
  const res = await fetch(`${BASE_URL}/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic }),
  });
  if (!res.ok) throw new Error('Failed to create game');
  return res.json(); // Returns Game object
}

export async function joinGame(code: string, name: string, team: string) {
  const res = await fetch(`${BASE_URL}/games/${code}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, team }),
  });
  if (!res.ok) throw new Error('Failed to join game');
  return res.json(); // Returns Player object
}
