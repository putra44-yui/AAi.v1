// Struktur in-memory sederhana untuk dev & testing
// Nanti bisa diganti Redis/SQLite tanpa ubah interface route
const sessionStore = new Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>();

const MAX_HISTORY = 10; // Batas pesan per sesi untuk hemat token & memori

export function getHistory(userId: string) {
  return sessionStore.get(userId) || [];
}

export function addMessage(userId: string, role: 'user' | 'assistant', content: string) {
  const history = sessionStore.get(userId) || [];
  history.push({ role, content });

  // Potong history jika melebihi batas (FIFO)
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }

  sessionStore.set(userId, history);
}

export function clearSession(userId: string) {
  sessionStore.delete(userId);
}
