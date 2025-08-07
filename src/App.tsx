
import './App.css';
// @ts-ignore
import SockJS from 'sockjs-client';
import { AdminPanel } from './AdminPanel';
import { Lobby } from './Lobby';
import { GameRoom } from './GameRoom';
import { Route, Routes } from 'react-router-dom';

function NotFound() {
  return <h2>404 - You ended up to a nonexistent page dum dum</h2>;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Lobby />} />
      <Route path="/game/:code" element={<GameRoom />} />
      <Route path="/admin" element={<AdminPanel />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default App;
