import { useEffect, useState } from "react";
import { BACKEND_URL } from "./config";

export function AdminPanel() {
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
  const [authed, setAuthed] = useState(() => {
    const authedFlag = localStorage.getItem('admin_authed');
    const expiry = Number(localStorage.getItem('admin_authed_expiry'));
    return authedFlag === '1' && expiry > Date.now();
  });
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
    // On mount, check if admin_authed and expiry are valid
    if (!authed) {
      const authedFlag = localStorage.getItem('admin_authed');
      const expiry = Number(localStorage.getItem('admin_authed_expiry'));
      if (authedFlag === '1' && expiry > Date.now()) {
        setAuthed(true);
        return;
      }
    }
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
                <table style={{ minWidth: 400, marginBottom: 16, borderCollapse: 'separate', borderSpacing: 0, fontSize: 14, borderRadius: 8, overflow: 'hidden', boxShadow: '0 2px 8px #0001' }}>
                  <thead style={{ background: '#2a2236' }}>
                    <tr>
                      <th style={{ padding: '6px 12px', fontWeight: 600, borderBottom: '1px solid #e0e0e0' }}>Code</th>
                      <th style={{ padding: '6px 12px', fontWeight: 600, borderBottom: '1px solid #e0e0e0' }}>Topic</th>
                      <th style={{ padding: '6px 12px', fontWeight: 600, borderBottom: '1px solid #e0e0e0' }}>Status</th>
                      <th style={{ padding: '6px 12px', fontWeight: 600, borderBottom: '1px solid #e0e0e0' }}>Players</th>
                    </tr>
                  </thead>
                  <tbody>
                    {games.length === 0 ? (
                      <tr><td colSpan={4} style={{ textAlign: 'center', padding: '10px 0', color: '#888' }}>No games</td></tr>
                    ) : games.map((g: any, i: number) => (
                      <tr key={g.code} style={{ background: i % 2 === 0 ? '#242424' : '#2a2236', color: '#eaeaea', transition: 'background 0.2s' }}>
                        <td style={{ padding: '6px 12px', borderBottom: '1px solid #f0f0f0' }}>{g.code}</td>
                        <td style={{ padding: '6px 12px', borderBottom: '1px solid #f0f0f0' }}>{g.topic}</td>
                        <td style={{ padding: '6px 12px', borderBottom: '1px solid #f0f0f0' }}>{g.status}</td>
                        <td style={{ padding: '6px 12px', borderBottom: '1px solid #f0f0f0' }}>{g.players ? g.players.length : 0}</td>
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
                <table style={{ minWidth: 400, marginBottom: 16, borderCollapse: 'separate', borderSpacing: 0, fontSize: 14, borderRadius: 8, overflow: 'hidden', boxShadow: '0 2px 8px #0001' }}>
                  <thead style={{ background: '#2a2236' }}>
                    <tr>
                      <th style={{ padding: '6px 12px', fontWeight: 600, borderBottom: '1px solid #e0e0e0' }}>Name</th>
                      <th style={{ padding: '6px 12px', fontWeight: 600, borderBottom: '1px solid #e0e0e0' }}>Team</th>
                      <th style={{ padding: '6px 12px', fontWeight: 600, borderBottom: '1px solid #e0e0e0' }}>Game</th>
                    </tr>
                  </thead>
                  <tbody>
                    {players.length === 0 ? (
                      <tr><td colSpan={3} style={{ textAlign: 'center', padding: '10px 0', color: '#888' }}>No players</td></tr>
                    ) : players.map((p: any, i: number) => (
                      <tr key={p.id || i} style={{ background: i % 2 === 0 ? '#242424' : '#2a2236', color: '#eaeaea', transition: 'background 0.2s' }}>
                        <td style={{ padding: '6px 12px', borderBottom: '1px solid #f0f0f0' }}>{p.name}</td>
                        <td style={{ padding: '6px 12px', borderBottom: '1px solid #f0f0f0' }}>{p.team}</td>
                        <td style={{ padding: '6px 12px', borderBottom: '1px solid #f0f0f0' }}>{p.gameCode || p.game || ''}</td>
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
                <table style={{ minWidth: 400, borderCollapse: 'separate', borderSpacing: 0, fontSize: 14, borderRadius: 8, overflow: 'hidden', boxShadow: '0 2px 8px #0001' }}>
                  <thead style={{ background: '#2a2236' }}>
                    <tr>
                      <th style={{ minWidth: 140, padding: '6px 12px', fontWeight: 600, borderBottom: '1px solid #e0e0e0' }}>Question</th>
                      <th style={{ minWidth: 180, padding: '6px 12px', fontWeight: 600, borderBottom: '1px solid #e0e0e0' }}>Answers</th>
                      <th style={{ minWidth: 90, padding: '6px 12px', fontWeight: 600, borderBottom: '1px solid #e0e0e0' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {questions.length === 0 ? (
                      <tr><td colSpan={3} style={{ textAlign: 'center', padding: '10px 0', color: '#888' }}>No questions</td></tr>
                    ) : questions.map((q: any, i: number) => {
                        const questionText = q.question || q.text || '';
                        const isBlank = !questionText.trim();
                        return editingQuestionId === q.id ? (
                          <tr key={q.id || i} style={{ background: i % 2 === 0 ? '#242424' : '#2a2236', color: '#eaeaea', transition: 'background 0.2s' }}>
                            <td colSpan={3} style={{ padding: '10px 12px' }}>
                              <form onSubmit={e => { e.preventDefault(); handleEditSave(q.id); }}>
                                <input
                                  type="text"
                                  value={editQText}
                                  onChange={e => setEditQText(e.target.value)}
                                  style={{ width: '100%', marginBottom: 4, fontSize: 14, padding: '6px 8px', borderRadius: 4, border: '1px solid #ccc' }}
                                  required
                                />
                                {editAnswers.map((a, j) => (
                                  <div key={j} style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                                    <input
                                      type="text"
                                      placeholder={`Answer ${j + 1}`}
                                      value={a.text}
                                      onChange={e => handleEditAnswerChange(j, 'text', e.target.value)}
                                      style={{ fontSize: 14, padding: '6px 8px', borderRadius: 4, border: '1px solid #ccc', flex: 1 }}
                                    />
                                    <input
                                      type="number"
                                      placeholder="Points"
                                      value={a.points}
                                      onChange={e => handleEditAnswerChange(j, 'points', e.target.value)}
                                      min={0}
                                      style={{ width: 60, fontSize: 14, padding: '6px 8px', borderRadius: 4, border: '1px solid #ccc' }}
                                    />
                                  </div>
                                ))}
                                <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                                  At least 5 answers with points are required to save.
                                </div>
                                <button type="submit" style={{ color:'#e57373', fontSize: 13, padding: '6px 14px', borderRadius: 4, marginRight: 8 }}>Save</button>
                                <button type="button" onClick={handleEditCancel} style={{ fontSize: 13, padding: '6px 14px', borderRadius: 4 }}>Cancel</button>
                                {editStatus && <div style={{ color: editStatus.startsWith('Error') ? 'red' : 'green', marginTop: 8 }}>{editStatus}</div>}
                              </form>
                            </td>
                          </tr>
                        ) : (
                          <tr key={q.id || i} style={{ background: i % 2 === 0 ? '#242424' : '#2a2236', color: '#eaeaea', transition: 'background 0.2s' }}>
                            <td
                              style={{
                                minWidth: 140,
                                maxWidth: 320,
                                wordBreak: 'break-word',
                                whiteSpace: 'pre-line',
                                background: 'transparent',
                                borderBottom: '1px solid #f0f0f0',
                                color: isBlank ? '#888' : undefined,
                                fontStyle: isBlank ? 'italic' : undefined,
                                padding: '6px 12px',
                              }}
                            >
                              {isBlank ? '(No question text)' : questionText}
                            </td>
                            <td style={{ minWidth: 180, borderBottom: '1px solid #f0f0f0', padding: '6px 12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {(q.answers || []).map((a: any) => `${a.text} (${a.points})`).join(', ')}
                            </td>
                            <td style={{ minWidth: 90, borderBottom: '1px solid #f0f0f0', padding: '6px 12px' }}>
                              <button onClick={() => handleEditClick(q)} style={{ color: 'blue', marginRight: 6, fontSize: 13, padding: '4px 10px', borderRadius: 4, border: 'none', background: '#eaf2ff', cursor: 'pointer' }}>Edit</button>
                              <button onClick={() => handleDeleteQuestion(q.id)} style={{ color: 'red', fontSize: 13, padding: '4px 10px', borderRadius: 4, border: 'none', background: '#ffeaea', cursor: 'pointer' }}>Delete</button>
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
              <table style={{ minWidth: 400, borderCollapse: 'separate', borderSpacing: 0, fontSize: 14, borderRadius: 8, overflow: 'hidden', boxShadow: '0 2px 8px #0001' }}>
                <thead style={{ background: '#2a2236' }}>
                  <tr>
                    <th style={{ minWidth: 140, padding: '6px 12px', fontWeight: 600, borderBottom: '1px solid #e0e0e0' }}>Answer</th>
                    <th style={{ minWidth: 180, padding: '6px 12px', fontWeight: 600, borderBottom: '1px solid #e0e0e0' }}>Synonyms</th>
                    <th style={{ minWidth: 90, padding: '6px 12px', fontWeight: 600, borderBottom: '1px solid #e0e0e0' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(synonyms).length === 0 ? (
                    <tr><td colSpan={3} style={{ textAlign: 'center', padding: '10px 0', color: '#888' }}>No synonyms</td></tr>
                  ) : Object.entries(synonyms).map(([answer, syns], i) => (
                    editingSynonym === answer ? (
                      <tr key={answer} style={{ background: i % 2 === 0 ? '#242424' : '#2a2236', color: '#eaeaea', transition: 'background 0.2s' }}>
                        <td style={{ minWidth: 140, padding: '10px 12px' }}>{answer}</td>
                        <td style={{ minWidth: 180, padding: '10px 12px' }}>
                          <form onSubmit={e => { e.preventDefault(); handleEditSynonymSave(answer); }}>
                            <input
                              type="text"
                              value={editSynonymsText}
                              onChange={e => setEditSynonymsText(e.target.value)}
                              style={{ width: '100%', fontSize: 14, padding: '6px 8px', borderRadius: 4, border: '1px solid #ccc' }}
                              placeholder="Comma-separated synonyms"
                              required
                            />
                            <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                              Separate synonyms with commas.
                            </div>
                            <button type="submit" style={{ fontSize: 13, padding: '6px 14px', borderRadius: 4, marginRight: 8 }}>Save</button>
                            <button type="button" onClick={handleEditSynonymCancel} style={{ fontSize: 13, padding: '6px 14px', borderRadius: 4 }}>Cancel</button>
                            {editSynStatus && <div style={{ color: editSynStatus.startsWith('Error') ? 'red' : 'green', marginTop: 8 }}>{editSynStatus}</div>}
                          </form>
                        </td>
                        <td style={{ minWidth: 90, padding: '10px 12px' }}></td>
                      </tr>
                    ) : (
                      <tr key={answer} style={{ background: i % 2 === 0 ? '#242424' : '#2a2236', color: '#eaeaea', transition: 'background 0.2s' }}>
                        <td
                          style={{
                            minWidth: 140,
                            maxWidth: 320,
                            wordBreak: 'break-word',
                            whiteSpace: 'pre-line',
                            background: 'transparent',
                            borderBottom: '1px solid #f0f0f0',
                            padding: '6px 12px',
                          }}
                        >
                          {answer}
                        </td>
                        <td style={{ minWidth: 180, borderBottom: '1px solid #f0f0f0', padding: '6px 12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {Array.isArray(syns) ? syns.join(', ') : ''}
                        </td>
                        <td style={{ minWidth: 90, borderBottom: '1px solid #f0f0f0', padding: '6px 12px' }}>
                          <button onClick={() => handleEditSynonymStart(answer, syns)} style={{ color: 'blue', marginRight: 6, fontSize: 13, padding: '4px 10px', borderRadius: 4, border: 'none', background: '#eaf2ff', cursor: 'pointer' }}>Edit</button>
                          <button onClick={() => handleDeleteSynonym(answer)} style={{ color: 'red', fontSize: 13, padding: '4px 10px', borderRadius: 4, border: 'none', background: '#ffeaea', cursor: 'pointer' }}>Delete</button>
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