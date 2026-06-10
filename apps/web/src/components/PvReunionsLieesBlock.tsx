import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, API_BASE_URL } from '../services/api';

type PvRow = {
  id: string;
  titre: string;
  dateReunion?: string | null;
  document?: { id: string; nom?: string; fichierNomOriginal?: string } | null;
};

/** Liste les PV liés à une ressource (GET …/pv-reunions déjà protégé côté API). */
export function PvReunionsLieesBlock({
  apiPath,
  title = 'PV de réunion liés',
}: {
  apiPath: string;
  title?: string;
}) {
  const [rows, setRows] = useState<PvRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    api
      .get(apiPath)
      .then((r) => {
        if (!cancel) setRows(Array.isArray(r.data) ? r.data : []);
      })
      .catch(() => {
        if (!cancel) setRows([]);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [apiPath]);

  if (loading) {
    return (
      <div className="text-sm text-gray-500 py-1">
        <span className="font-medium text-gray-700">{title}</span> — chargement…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="text-sm text-gray-400 italic py-1">
        <span className="font-medium text-gray-600 not-italic">{title}</span> — aucun PV lié.
      </div>
    );
  }

  return (
    <div className="text-sm space-y-2">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</p>
      <ul className="space-y-2">
        {rows.map((pv) => (
          <li
            key={pv.id}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border border-gray-100 rounded-lg px-3 py-2 bg-gray-50/80"
          >
            <Link to={`/pv-reunion/${pv.id}`} className="text-blue-600 hover:underline font-medium min-w-0">
              {pv.titre}
            </Link>
            <span className="text-[11px] font-mono text-gray-400 break-all" title={pv.id}>
              {pv.id}
            </span>
            {pv.dateReunion && (
              <span className="text-xs text-gray-500">
                {new Date(pv.dateReunion).toLocaleDateString('fr-FR')}
              </span>
            )}
            {pv.document?.id && (
              <a
                href={`${API_BASE_URL}/documents/${pv.document.id}/view?token=${localStorage.getItem('token')}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-600 hover:underline"
              >
                Voir le PDF
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
