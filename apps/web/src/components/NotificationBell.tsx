import { useEffect, useState, useRef } from 'react';
import { api } from '../services/api';
import { useNavigate } from 'react-router-dom';

type Notification = {
  id: string;
  type: string;
  titre: string;
  contenu: string;
  lienType?: string;
  lienId?: string;
  lue: boolean;
  createdAt: string;
};

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    loadCount();
    // Polling toutes les 30 secondes
    const interval = setInterval(loadCount, 30000);
    return () => clearInterval(interval);
  }, []);

  // Fermer en cliquant ailleurs
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const loadCount = async () => {
    try {
      const res = await api.get('/notifications/count');
      setCount(res.data.count);
    } catch {
      // silencieux
    }
  };

  const loadNotifications = async () => {
    try {
      const res = await api.get('/notifications');
      setNotifications(Array.isArray(res.data) ? res.data : []);
    } catch {
      // silencieux
    }
  };

  const handleOpen = async () => {
    setOpen(!open);
    if (!open) {
      await loadNotifications();
    }
  };

  const handleClick = async (notif: Notification) => {
    // Marquer comme lue
    if (!notif.lue) {
      await api.patch(`/notifications/${notif.id}/lue`);
      setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, lue: true } : n));
      setCount(prev => Math.max(0, prev - 1));
    }
    // Naviguer vers la tâche
    if (notif.lienType === 'tache') {
      navigate('/taches');
    } else if (notif.lienType === 'pvReunion' && notif.lienId) {
      navigate(`/pv-reunion/${notif.lienId}`);
    } else if (notif.lienType === 'processus' && notif.lienId) {
      navigate(`/processus/${notif.lienId}`);
    } else if (notif.lienType === 'projet' && notif.lienId) {
      navigate(`/projets/${notif.lienId}`);
    } else if (notif.lienType === 'licence') {
      navigate('/licences');
    } else if (notif.lienType === 'document') {
      navigate('/documents');
    } else if (notif.lienType === 'contrat') {
      navigate('/contrats');
    } else if (notif.lienType === 'epic' || notif.lienType === 'userStory') {
      navigate('/taches');
    }
    setOpen(false);
  };

  const marquerToutesLues = async () => {
    await api.patch('/notifications/toutes-lues');
    setNotifications(prev => prev.map(n => ({ ...n, lue: true })));
    setCount(0);
  };

  const formatDate = (d: string) => {
    const date = new Date(d);
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diff < 60) return 'À l\'instant';
    if (diff < 3600) return `Il y a ${Math.floor(diff / 60)}min`;
    if (diff < 86400) return `Il y a ${Math.floor(diff / 3600)}h`;
    return date.toLocaleDateString('fr-FR');
  };

  return (
    <div ref={ref} className="relative">
      {/* Cloche */}
      <button
        onClick={handleOpen}
        className="relative p-2 rounded-full hover:bg-gray-100 transition-colors"
        title="Notifications"
      >
        <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {count > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-lg shadow-xl border border-gray-200 z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="font-semibold text-gray-800">Notifications</h3>
            {count > 0 && (
              <button onClick={marquerToutesLues}
                className="text-xs text-blue-600 hover:text-blue-800">
                Tout marquer lu
              </button>
            )}
          </div>

          {/* Liste */}
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">
                Aucune notification
              </div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={`px-4 py-3 border-b border-gray-50 cursor-pointer hover:bg-gray-50 transition-colors ${!n.lue ? 'bg-blue-50' : ''}`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-lg mt-0.5">
                      {n.type === 'mention'
                        ? '📌'
                        : n.type === 'assignation_projet'
                          ? '📁'
                        : n.type === 'commentaire_pv_assigne'
                          ? '✅'
                          : n.type === 'commentaire_pv'
                            ? '💬'
                            : '🔔'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${!n.lue ? 'font-semibold text-gray-800' : 'text-gray-700'} truncate`}>
                        {n.titre}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.contenu}</p>
                      <p className="text-xs text-gray-400 mt-1">{formatDate(n.createdAt)}</p>
                    </div>
                    {!n.lue && (
                      <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
