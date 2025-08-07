
import './App.css';
import { BACKEND_URL } from './config';
import React, { useState, useEffect } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { createGame, joinGame } from './api';
import { Client } from '@stomp/stompjs';
// @ts-ignore
import SockJS from 'sockjs-client';

// FetchSynonymsButton: Button with loading animation and feedback for fetching synonyms

// Simple Admin Panel (password protected)
function AdminPanel() {
  // State for editing synonyms
  const [editingSynonym, setEditingSynonym] = useState<string | null>(null);
  const [editSynonymsText, setEditSynonymsText] = useState('');
  const [editSynStatus, setEditSynStatus] = useState<string | null>(null);

  // Handler for starting synonym edit
  function handleEditSynonymStart(answer: string, syns: string[]) {
    setEditingSynonym(answer);
    setEditSynonymsText(syns.join(', '));
    setEditSynStatus(null);
  }

  // Handler for canceling synonym edit
  function handleEditSynonymCancel() {
    setEditingSynonym(null);
    setEditSynonymsText('');
    setEditSynStatus(null);
  }

  // Handler for saving synonym edit
  async function handleEditSynonymSave(answer: string) {
    setEditSynStatus(null);
    const trimmed = editSynonymsText.split(',').map(s => s.trim()).filter(Boolean);
    if (trimmed.length === 0) {
      setEditSynStatus('Please enter at least one synonym.');
      return;
    }
    try {
      // Backend expects { canonical, synonyms: "a,b,c" }
      const payload = { canonical: answer, synonyms: trimmed.join(',') };
      const res = await fetch(`${BACKEND_URL}/admin/synonyms/${encodeURIComponent(answer)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to update synonyms');
      // Update local state
      setSynonyms(prev => ({ ...prev, [answer]: trimmed }));
      setEditingSynonym(null);
      setEditSynonymsText('');
      setEditSynStatus('Synonyms updated!');
    } catch (err: any) {
      setEditSynStatus('Error: ' + err.message);
    }
  }
  // State for editing questions
  const [editingQuestionId, setEditingQuestionId] = useState<number | null>(null);
  const [editQText, setEditQText] = useState('');
  const [editAnswers, setEditAnswers] = useState<{ text: string; points: string }[]>([]);
  const [editStatus, setEditStatus] = useState<string | null>(null);

  function handleEditClick(q: any) {
    setEditingQuestionId(q.id);
    setEditQText(q.question);
    setEditAnswers(
      (q.answers || []).map((a: any) => ({ text: a.text, points: String(a.points) }))
        .concat(Array(Math.max(0, 8 - (q.answers?.length || 0))).fill({ text: '', points: '' }))
    );
    setEditStatus(null);
  }

  function handleEditAnswerChange(idx: number, field: 'text' | 'points', value: string) {
    setEditAnswers(prev => prev.map((a, i) => i === idx ? { ...a, [field]: value } : a));
  }

  function handleEditCancel() {
    setEditingQuestionId(null);
    setEditQText('');
    setEditAnswers([]);
    setEditStatus(null);
  }

  async function handleEditSave(qid: number) {
    setEditStatus(null);
    if (!editQText.trim()) {
      setEditStatus('Please enter a question.');
      return;
    }
    const filtered = editAnswers.filter(a => a.text.trim() && a.points.trim());
    if (filtered.length < 5) {
      setEditStatus('Please enter at least 5 answers with points.');
      return;
    }
    try {
      // Only send {text, points} for each answer
      const payloadAnswers = filtered.map(a => ({ text: a.text.trim(), points: Number(a.points) }));
      const res = await fetch(`${BACKEND_URL}/admin/questions/${qid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: editQText, answers: payloadAnswers }),
      });
      if (!res.ok) throw new Error('Failed to update question');
      setEditStatus('Question updated!');
      setEditingQuestionId(null);
      setEditQText('');
      setEditAnswers([]);
      fetchDashboard();
    } catch (err: any) {
      setEditStatus('Error: ' + err.message);
    }
  }
  // Import Questions from file (single instance, JS only, no type annotations)
  const [importStatus, setImportStatus] = useState<string | null>(null);

  function parseCSV(text: string): { question: string; answers: { text: string; points: number }[] }[] {
    // Expecting: question,answer1,points1,answer2,points2,...
    const lines = text.split(/\r?\n/).filter((l: string) => l.trim());
    return lines.map((line: string) => {
      const parts = line.split(',');
      const question = parts[0];
      const answers: { text: string; points: number }[] = [];
      for (let i = 1; i < parts.length - 1; i += 2) {
        if (parts[i] && parts[i+1]) {
          answers.push({ text: parts[i], points: Number(parts[i+1]) });
        }
      }
      return { question, answers };
    });
  }

  function parseXML(text: string): { question: string; answers: { text: string; points: number }[] }[] {
    // Very basic XML parser for: <questions><question text="..."><answer points="...">...</answer>...</question>...</questions>
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, 'application/xml');
    const qNodes = Array.from(xml.getElementsByTagName('question'));
    return qNodes.map((qNode: Element) => {
      const question = qNode.getAttribute('text') || '';
      const answers: { text: string; points: number }[] = [];
      Array.from(qNode.getElementsByTagName('answer')).forEach((aNode: Element) => {
        answers.push({ text: aNode.textContent || '', points: Number(aNode.getAttribute('points')) });
      });
      return { question, answers };
    });
  }

  function parseJSON(text: string): { question: string; answers: { text: string; points: number }[] }[] {
    // Expecting array of { question, answers: [{ text, points }] }
    try {
      const arr = JSON.parse(text);
      if (!Array.isArray(arr)) throw new Error('JSON must be an array');
      return arr;
    } catch (e) {
      return [];
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    setImportStatus(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    const reader = new FileReader();
    reader.onload = async (ev: ProgressEvent<FileReader>) => {
      let questions: { question: string; answers: { text: string; points: number }[] }[] = [];
      const text = String(ev.target?.result || '');
      if (ext === 'csv') {
        questions = parseCSV(text);
      } else if (ext === 'xml') {
        questions = parseXML(text);
      } else if (ext === 'json') {
        questions = parseJSON(text);
      } else {
        setImportStatus('Error: Unsupported file type.');
        return;
      }
      // Filter out invalid
      questions = questions.filter(q => q.question && Array.isArray(q.answers) && q.answers.length >= 1);
      if (questions.length === 0) {
        setImportStatus('Error: No valid questions found.');
        return;
      }
      // Send to backend one by one (could be optimized)
      let success = 0, fail = 0;
      for (const q of questions) {
        try {
          const res = await fetch(`${BACKEND_URL}/admin/questions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: q.question, answers: q.answers }),
          });
          if (res.ok) success++;
          else fail++;
        } catch {
          fail++;
        }
      }
      setImportStatus(`Imported ${success} questions. ${fail ? fail + ' failed.' : ''}`);
      if (success) fetchDashboard();
    };
    reader.readAsText(file);
  }
  async function handleDeleteAllGames() {
    if (!window.confirm('Delete ALL games? This cannot be undone.')) return;
    try {
      const res = await fetch(`${BACKEND_URL}/admin/games`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete all games');
      setGames([]);
    } catch (err: any) {
      alert('Error: ' + err.message);
    }
  }

  async function handleDeleteAllPlayers() {
    if (!window.confirm('Delete ALL players? This cannot be undone.')) return;
    try {
      const res = await fetch(`${BACKEND_URL}/admin/players`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete all players');
      setPlayers([]);
    } catch (err: any) {
      alert('Error: ' + err.message);
    }
  }

    // Delete a single synonym entry
  async function handleDeleteSynonym(answer: string) {
    if (!window.confirm(`Delete synonyms for "${answer}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`${BACKEND_URL}/admin/synonyms/${encodeURIComponent(answer)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete synonym');
      setSynonyms(prev => {
        const copy: { [key: string]: string[] } = { ...prev };
        delete copy[answer];
        return copy;
      });
    } catch (err: any) {
      alert('Error: ' + err.message);
    }
  }

  async function handleDeleteAllQuestions() {
    if (!window.confirm('Delete ALL questions? This cannot be undone.')) return;
    try {
      const res = await fetch(`${BACKEND_URL}/admin/questions`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete all questions');
      setQuestions([]);
      setSynonyms({});
    } catch (err: any) {
      alert('Error: ' + err.message);
    }
  }

  async function handleDeleteAllSynonyms() {
    if (!window.confirm('Delete ALL synonyms? This cannot be undone.')) return;
    try {
      const res = await fetch(`${BACKEND_URL}/admin/synonyms`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete all synonyms');
      setSynonyms({});
    } catch (err: any) {
      alert('Error: ' + err.message);
    }
  }
  // Add missing state for broadcast tab
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [broadcastStatus, setBroadcastStatus] = useState<string | null>(null);

  // Add missing handler for login
  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    // Replace with your real admin password logic
    const ADMIN_PASSWORD = 'admin123';
    if (pw === ADMIN_PASSWORD) {
      setAuthed(true);
      setError(null);
      localStorage.setItem('admin_authed', '1');
      localStorage.setItem('admin_authed_expiry', String(Date.now() + 60 * 60 * 1000));
    } else {
      setError('Incorrect password.');
    }
  }

  // Add missing handler for answer change
  function handleAnswerChange(idx: number, field: 'text' | 'points', value: string) {
    setAnswers(prev => prev.map((a, i) => i === idx ? { ...a, [field]: value } : a));
  }

  // Add missing handler for broadcast
  async function handleBroadcast(e: React.FormEvent) {
    e.preventDefault();
    setBroadcastStatus(null);
    if (!broadcastMsg.trim()) {
      setBroadcastStatus('Error: Please enter a message.');
      return;
    }
    try {
      // Replace with your real broadcast endpoint
      const res = await fetch(`${BACKEND_URL}/admin/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: broadcastMsg }),
      });
      if (!res.ok) throw new Error('Failed to broadcast message');
      setBroadcastStatus('Message sent!');
      setBroadcastMsg('');
    } catch (err: any) {
      setBroadcastStatus('Error: ' + err.message);
    }
  }

  // Add missing handler for delete question (dashboard)
  async function handleDeleteQuestion(id: number) {
    if (!window.confirm('Delete this question?')) return;
    try {
      const res = await fetch(`${BACKEND_URL}/admin/questions/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete question');
      setQuestions(qs => qs.filter(q => q.id !== id));
    } catch (err: any) {
      alert('Error: ' + err.message);
    }
  }
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [games, setGames] = useState<any[]>([]);
  const [players, setPlayers] = useState<any[]>([]);
  const [questions, setQuestions] = useState<any[]>([]);
  const [synonyms, setSynonyms] = useState<{ [answer: string]: string[] }>({});
  const [qaStatus, setQaStatus] = useState<string | null>(null);
  const [tab, setTab] = useState<'dashboard' | 'add' | 'broadcast'>('dashboard');

  // All hooks must be at the top, before any return or conditional
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Removed unused state: synStatus, synAnim, lastSynFetchQuestions
  const [qText, setQText] = useState('');
  const [answers, setAnswers] = useState(Array(8).fill({ text: '', points: '' }));
  // Fetch dashboard data
  async function fetchDashboard() {
    setDashboardLoading(true);
    setDashboardError(null);
    try {
      const [gamesRes, playersRes, questionsRes] = await Promise.all([
        fetch(`${BACKEND_URL}/admin/games`),
        fetch(`${BACKEND_URL}/admin/players`),
        fetch(`${BACKEND_URL}/admin/questions`)
      ]);
      if (!gamesRes.ok || !playersRes.ok || !questionsRes.ok) throw new Error('Failed to fetch dashboard data');
      const [gamesData, playersData, questionsData] = await Promise.all([
        gamesRes.json(),
        playersRes.json(),
        questionsRes.json(),
      ]);
      setGames(gamesData);
      setPlayers(playersData);
      setQuestions(questionsData);

      // Always fetch all synonyms from the backend and log the result for debugging
      const synRes = await fetch(`${BACKEND_URL}/admin/synonyms`);
      if (synRes.ok) {
        const synArr = await synRes.json(); // Raw backend response
        console.log('Fetched synonyms from backend:', synArr); // Debug log
        let synMap: { [answer: string]: string[] } = {};
        let formatWarning = '';
        if (Array.isArray(synArr)) {
          for (const entry of synArr) {
            // Accept both formats: { answer, synonyms: [] } and { canonical, synonyms: "a,b,c" }
            if (entry.answer && Array.isArray(entry.synonyms)) {
              synMap[entry.answer] = entry.synonyms;
            } else if (entry.canonical && typeof entry.synonyms === 'string') {
              synMap[entry.canonical] = entry.synonyms.split(',').map((s: string) => s.trim()).filter(Boolean);
            } else {
              formatWarning = 'Warning: Some entries missing canonical/answer or synonyms.';
            }
          }
        } else if (typeof synArr === 'object' && synArr !== null) {
          // If backend returns an object mapping
          synMap = synArr;
        } else {
          formatWarning = 'Warning: Unexpected synonyms format from backend.';
        }
        setSynonyms(synMap);
        if (formatWarning) {
          setDashboardError(formatWarning);
        }
      } else {
        setSynonyms({});
      }
    } catch (err: any) {
      setDashboardError('Error: ' + err.message);
    } finally {
      setDashboardLoading(false);
    }
  }

  // Optionally, fetch on mount
  useEffect(() => {
    if (authed) fetchDashboard();
    // eslint-disable-next-line
  }, [authed]);

  async function handleAddQuestion(e: React.FormEvent) {
    e.preventDefault();
    setQaStatus(null);
    if (!qText.trim()) {
      setQaStatus('Please enter a question.');
      return;
    }
    // At least 5 answers with text and points
    const filtered = answers.filter(a => a.text.trim() && a.points.trim());
    if (filtered.length < 5) {
      setQaStatus('Please enter at least 5 answers with points.');
      return;
    }
    try {
      // Only send {text, points} for each answer
      const payloadAnswers = filtered.map(a => ({ text: a.text.trim(), points: Number(a.points) }));
      const res = await fetch(`${BACKEND_URL}/admin/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: qText, answers: payloadAnswers }),
      });
      if (!res.ok) throw new Error('Failed to add question');
      setQaStatus('Question added!');
      setQText('');
      setAnswers(Array(8).fill({ text: '', points: '' }));
    } catch (err: any) {
      setQaStatus('Error: ' + err.message);
    }
  }

  if (!authed) {
    return (
      <div style={{ maxWidth: 400, margin: '2rem auto' }}>
        <h2>Admin Login</h2>
        <form onSubmit={handleLogin}>
          <input
            type="password"
            placeholder="Admin password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            style={{ width: '100%', marginBottom: 8 }}
          />
          <button type="submit" style={{ width: '100%' }}>Login</button>
          {error && <div style={{ color: 'red', marginTop: 8 }}>{error}</div>}
        </form>
      </div>
    );
  }

  // Admin features skeleton with tabs
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', minHeight: '100vh' }}>
      <div style={{ minWidth: 180, marginRight: 32, borderRight: '1px solid #ddd', height: '100vh', position: 'fixed', left: 0, top: 0, bottom: 0, zIndex: 10, padding: '32px 0 0 0', boxShadow: '2px 0 8px #0001', background: 'inherit' }}>
        <h2 style={{ marginBottom: 16, paddingLeft: 24 }}>Admin Panel</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 12 }}>
          <button
            onClick={() => setTab('dashboard')}
            style={{
              padding: '8px 18px',
              fontSize: 15,
              borderRadius: 6,
              border: '1px solid #222',
              background: tab === 'dashboard' ? '#fff' : '#111',
              color: tab === 'dashboard' ? '#111' : '#fff',
              fontWeight: tab === 'dashboard' ? 'bold' : undefined,
              boxShadow: tab === 'dashboard' ? '0 2px 8px #0001' : undefined,
              cursor: 'pointer',
              outline: 'none',
              transition: 'background 0.2s, color 0.2s',
              textAlign: 'left',
            }}
          >Dashboard</button>
          <button
            onClick={() => setTab('add')}
            style={{
              padding: '8px 18px',
              fontSize: 15,
              borderRadius: 6,
              border: '1px solid #222',
              background: tab === 'add' ? '#fff' : '#111',
              color: tab === 'add' ? '#111' : '#fff',
              fontWeight: tab === 'add' ? 'bold' : undefined,
              boxShadow: tab === 'add' ? '0 2px 8px #0001' : undefined,
              cursor: 'pointer',
              outline: 'none',
              transition: 'background 0.2s, color 0.2s',
              textAlign: 'left',
            }}
          >Add Question</button>
          <button
            onClick={() => setTab('broadcast')}
            style={{
              padding: '8px 18px',
              fontSize: 15,
              borderRadius: 6,
              border: '1px solid #222',
              background: tab === 'broadcast' ? '#fff' : '#111',
              color: tab === 'broadcast' ? '#111' : '#fff',
              fontWeight: tab === 'broadcast' ? 'bold' : undefined,
              boxShadow: tab === 'broadcast' ? '0 2px 8px #0001' : undefined,
              cursor: 'pointer',
              outline: 'none',
              transition: 'background 0.2s, color 0.2s',
              textAlign: 'left',
            }}
          >Broadcast</button>
        </div>
      </div>
      <div style={{ flex: 1, marginLeft: 200, padding: '32px 32px 32px 0' }}>
        {/* Main content area */}
        {tab === 'dashboard' && (
          <div>
            <h3>Live Dashboard</h3>
            <button onClick={fetchDashboard} disabled={dashboardLoading}>
              {dashboardLoading ? 'Refreshing...' : 'Refresh Data'}
            </button>
            {dashboardError && <div style={{ color: 'red', marginTop: 8 }}>{dashboardError}</div>}
            <div style={{ marginTop: 16 }}>
            <h4 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              Games
              <button style={{ color: 'red', fontSize: 13 }} title="Delete all games" onClick={handleDeleteAllGames}>Delete All</button>
            </h4>
              <div style={{ overflowX: 'auto' }}>
                <table border={1} cellPadding={4} style={{ minWidth: 400, marginBottom: 16 }}>
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Topic</th>
                      <th>Status</th>
                      <th>Players</th>
                    </tr>
                  </thead>
                  <tbody>
                    {games.length === 0 ? (
                      <tr><td colSpan={4} style={{ textAlign: 'center' }}>No games</td></tr>
                    ) : games.map((g: any) => (
                      <tr key={g.code}>
                        <td>{g.code}</td>
                        <td>{g.topic}</td>
                        <td>{g.status}</td>
                        <td>{g.players ? g.players.length : 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            <h4 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              Players
              <button style={{ color: 'red', fontSize: 13 }} title="Delete all players" onClick={handleDeleteAllPlayers}>Delete All</button>
            </h4>
              <div style={{ overflowX: 'auto' }}>
                <table border={1} cellPadding={4} style={{ minWidth: 400, marginBottom: 16 }}>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Team</th>
                      <th>Game</th>
                    </tr>
                  </thead>
                  <tbody>
                    {players.length === 0 ? (
                      <tr><td colSpan={3} style={{ textAlign: 'center' }}>No players</td></tr>
                    ) : players.map((p: any, i: number) => (
                      <tr key={p.id || i}>
                        <td>{p.name}</td>
                        <td>{p.team}</td>
                        <td>{p.gameCode || p.game || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            <h4 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              Questions
              <button style={{ color: 'red', fontSize: 13 }} title="Delete all questions" onClick={handleDeleteAllQuestions}>Delete All</button>
            </h4>
              <div style={{ overflowX: 'auto' }}>
                <table border={1} cellPadding={4} style={{ minWidth: 400 }}>
                  <thead>
                    <tr>
                      <th style={{ minWidth: 180 }}>Question</th>
                      <th style={{ minWidth: 220 }}>Answers</th>
                      <th style={{ minWidth: 120 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {questions.length === 0 ? (
                      <tr><td colSpan={3} style={{ textAlign: 'center' }}>No questions</td></tr>
                    ) : questions.map((q: any, i: number) => {
                        // Debug: log the question object to the console
                        // eslint-disable-next-line no-console
                        console.log('Dashboard question row:', q);
                        // If question text is blank, show a placeholder but still allow edit/delete
                        const questionText = q.question || q.text || '';
                        const isBlank = !questionText.trim();
                        return editingQuestionId === q.id ? (
                          <tr key={q.id || i}>
                            <td colSpan={3}>
                              <form onSubmit={e => { e.preventDefault(); handleEditSave(q.id); }}>
                                <input
                                  type="text"
                                  value={editQText}
                                  onChange={e => setEditQText(e.target.value)}
                                  style={{ width: '100%', marginBottom: 4 }}
                                  required
                                />
                                {editAnswers.map((a, j) => (
                                  <div key={j} style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                                    <input
                                      type="text"
                                      placeholder={`Answer ${j + 1}`}
                                      value={a.text}
                                      onChange={e => handleEditAnswerChange(j, 'text', e.target.value)}
                                    />
                                    <input
                                      type="number"
                                      placeholder="Points"
                                      value={a.points}
                                      onChange={e => handleEditAnswerChange(j, 'points', e.target.value)}
                                      min={0}
                                      style={{ width: 60 }}
                                    />
                                  </div>
                                ))}
                                <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
                                  At least 5 answers with points are required to save.
                                </div>
                                <button type="submit">Save</button>
                                <button type="button" onClick={handleEditCancel} style={{ marginLeft: 8 }}>Cancel</button>
                                {editStatus && <div style={{ color: editStatus.startsWith('Error') ? 'red' : 'green', marginTop: 8 }}>{editStatus}</div>}
                              </form>
                            </td>
                          </tr>
                        ) : (
                          <tr key={q.id || i}>
                            <td
                              style={{
                                minWidth: 180,
                                maxWidth: 400,
                                wordBreak: 'break-word',
                                whiteSpace: 'pre-line',
                                background: 'transparent',
                                border: '1px solid #e0e0e0',
                                color: isBlank ? '#888' : undefined,
                                fontStyle: isBlank ? 'italic' : undefined
                              }}
                            >
                              {isBlank ? '(No question text)' : questionText}
                            </td>
                            <td style={{ minWidth: 220 }}>
                              {(q.answers || []).map((a: any, j: number) => (
                                <div key={j} style={{ marginBottom: 4 }}>
                                  <b>{a.text}</b> ({a.points})
                                </div>
                              ))}
                            </td>
                            <td style={{ minWidth: 120 }}>
                              <button onClick={() => handleEditClick(q)} style={{ color: 'blue', marginRight: 8 }}>Edit</button>
                              <button onClick={() => handleDeleteQuestion(q.id)} style={{ color: 'red' }}>Delete</button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            <h4 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              Synonyms
              <button style={{ color: 'red', fontSize: 13 }} title="Delete all synonyms" onClick={handleDeleteAllSynonyms}>Delete All</button>
              {/* Synonyms sync now runs automatically after adding/importing questions */}
            </h4>
            {/* Synonyms Table: styled and functional like Questions table */}
            <div style={{ overflowX: 'auto', marginBottom: 24 }}>
              <table border={1} cellPadding={4} style={{ minWidth: 400 }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 180 }}>Answer</th>
                    <th style={{ minWidth: 220 }}>Synonyms</th>
                    <th style={{ minWidth: 120 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(synonyms).length === 0 ? (
                    <tr><td colSpan={3} style={{ textAlign: 'center' }}>No synonyms</td></tr>
                  ) : Object.entries(synonyms).map(([answer, syns]) => (
                    editingSynonym === answer ? (
                      <tr key={answer}>
                        <td style={{ minWidth: 180 }}>{answer}</td>
                        <td style={{ minWidth: 220 }}>
                          <form onSubmit={e => { e.preventDefault(); handleEditSynonymSave(answer); }}>
                            <input
                              type="text"
                              value={editSynonymsText}
                              onChange={e => setEditSynonymsText(e.target.value)}
                              style={{ width: '100%' }}
                              placeholder="Comma-separated synonyms"
                              required
                            />
                            <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
                              Separate synonyms with commas.
                            </div>
                            <button type="submit">Save</button>
                            <button type="button" onClick={handleEditSynonymCancel} style={{ marginLeft: 8 }}>Cancel</button>
                            {editSynStatus && <div style={{ color: editSynStatus.startsWith('Error') ? 'red' : 'green', marginTop: 8 }}>{editSynStatus}</div>}
                          </form>
                        </td>
                        <td style={{ minWidth: 120 }}></td>
                      </tr>
                    ) : (
                      <tr key={answer}>
                        <td
                          style={{
                            minWidth: 180,
                            maxWidth: 400,
                            wordBreak: 'break-word',
                            whiteSpace: 'pre-line',
                            background: 'transparent',
                            border: '1px solid #e0e0e0',
                          }}
                        >
                          {answer}
                        </td>
                        <td style={{ minWidth: 220 }}>
                          {Array.isArray(syns) ? syns.map((s, j) => (
                            <div key={j} style={{ marginBottom: 4 }}>
                              <b>{s}</b>
                            </div>
                          )) : ''}
                        </td>
                        <td style={{ minWidth: 120 }}>
                          <button onClick={() => handleEditSynonymStart(answer, syns)} style={{ color: 'blue', marginRight: 8 }}>Edit</button>
                          <button onClick={() => handleDeleteSynonym(answer)} style={{ color: 'red' }}>Delete</button>
                        </td>
                      </tr>
                    )
                  ))}
                </tbody>
              </table>
            </div>
            </div>
          </div>
        )}
        {tab === 'add' && (
          <div>
            <h3>Add Question</h3>
            <form onSubmit={handleAddQuestion}>
              <div style={{ marginBottom: 12 }}>
                <label>Question Text:<br />
                  <input type="text" value={qText} onChange={e => setQText(e.target.value)} style={{ width: '100%' }} required />
                </label>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label>Answers:</label>
                {answers.map((a, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                    <input
                      type="text"
                      placeholder={`Answer ${i + 1}`}
                      value={a.text}
                      onChange={e => handleAnswerChange(i, 'text', e.target.value)}
                    />
                    <input
                      type="number"
                      placeholder="Points"
                      value={a.points}
                      onChange={e => handleAnswerChange(i, 'points', e.target.value)}
                      min={0}
                      style={{ width: 60 }}
                    />
                  </div>
                ))}
                <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
                  At least 5 answers with points are required to submit.
                </div>
              </div>
              <button type="submit">Add Question</button>
            </form>
            {qaStatus && <div style={{ color: qaStatus.startsWith('Error') ? 'red' : 'green', marginTop: 8 }}>{qaStatus}</div>}

            {/* Import Questions Section */}
            <div style={{ marginTop: 32, borderTop: '1px solid #ddd', paddingTop: 16 }}>
              <h4>Import Questions from File</h4>
              <input type="file" accept=".csv,.json,.xml" onChange={handleImportFile} />
              {importStatus && (
                <div style={{ color: typeof importStatus === 'string' && importStatus.startsWith('Error') ? 'red' : 'green', marginTop: 8 }}>{importStatus}</div>
              )}
            </div>
          </div>
        )}
        {tab === 'broadcast' && (
          <div>
            <h3>Broadcast Message</h3>
            <form onSubmit={handleBroadcast}>
              <input
                type="text"
                value={broadcastMsg}
                onChange={e => setBroadcastMsg(e.target.value)}
                placeholder="Enter message to broadcast"
                style={{ width: '100%', marginBottom: 8 }}
                required
              />
              <button type="submit">Send Broadcast</button>
            </form>
            {broadcastStatus && <div style={{ color: broadcastStatus.startsWith('Error') ? 'red' : 'green', marginTop: 8 }}>{broadcastStatus}</div>}
          </div>
        )}
      </div>
    </div>
  );
}


function Lobby() {
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


// Helper to fetch game state
async function fetchGameState(code: string) {
  const res = await fetch(`${BACKEND_URL}/games/${code}/state`);
  if (!res.ok) throw new Error('Failed to fetch game state');
  return res.json();
}

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
