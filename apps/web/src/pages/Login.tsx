import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../store/auth';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  // Debug: afficher l'état de l'erreur dans la console quand il change
  useEffect(() => {
    if (error) {
      console.log('État error mis à jour dans Login:', error);
    }
  }, [error]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation basique côté client
    if (!email || !password) {
      setError('Veuillez remplir tous les champs');
      return;
    }

    setError(''); // Effacer les erreurs précédentes au début de la soumission
    setLoading(true);

    try {
      await login(email, password);
      // Effacer l'erreur uniquement si la connexion réussit
      setError('');
      navigate('/dashboard');
    } catch (err: any) {
      // Afficher le message d'erreur spécifique retourné par l'API
      console.log('=== ERREUR DE CONNEXION ===');
      console.log('Erreur complète:', err);
      console.log('Response:', err.response);
      console.log('Response data:', err.response?.data);
      console.log('Response status:', err.response?.status);
      console.log('Message:', err.message);
      
      // Extraire le message d'erreur de différentes façons possibles
      let errorMessage = 'Erreur de connexion';
      
      if (err.response?.data?.error) {
        errorMessage = String(err.response.data.error);
      } else if (err.message && err.message !== 'Request failed with status code 401') {
        errorMessage = String(err.message);
      } else if (err.response?.status === 401) {
        errorMessage = 'Email ou mot de passe incorrect';
      }
      
      console.log('Message d\'erreur final à afficher:', errorMessage);
      console.log('=== FIN ERREUR ===');
      
      // Forcer l'affichage de l'erreur - utiliser une fonction pour garantir la mise à jour
      setError(() => {
        console.log('setError appelé avec:', errorMessage);
        return errorMessage;
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow">
        <div>
          <div className="flex justify-center mb-4">
            <img
              src="/logo-pmo-hub.png"
              alt="PMO HUB"
              className="w-full max-w-[360px] h-auto object-contain"
            />
          </div>
          <h2 className="text-center text-3xl font-bold text-gray-900">Connexion</h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Connectez-vous à votre compte
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div 
            className={`bg-red-50 border-2 border-red-400 text-red-700 px-4 py-3 rounded-md shadow-sm flex items-center gap-2 ${error ? '' : 'hidden'}`}
            role="alert"
            aria-live="assertive"
            style={{ display: error ? 'flex' : 'none' }}
          >
            <svg className="w-5 h-5 text-red-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <span className="font-medium text-sm">{error || 'Erreur de connexion'}</span>
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              placeholder="votre@email.com"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
              Mot de passe
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {loading ? 'Connexion...' : 'Se connecter'}
          </button>
          <div className="flex justify-end">
            <Link to="/forgot-password" className="text-sm text-blue-600 hover:underline">
              Mot de passe oublié ?
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
