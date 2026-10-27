import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Mail, Lock, User as UserIcon, Loader2 } from 'lucide-react';
import { PROGRAM_LOGO } from '@/lib/branding';

export default function AuthPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    if (mode === 'signup' && password.length < 8) {
      setBusy(false);
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    const result =
      mode === 'signin'
        ? await signIn(email.trim(), password)
        : await signUp(email.trim(), password, fullName.trim());
    setBusy(false);
    if (mode === 'signup') {
      if (result.error) console.error('sign up failed', result.error);
      setPassword('');
      setNotice('Si los datos son válidos, tu cuenta quedó registrada y un administrador debe activarla antes de que puedas entrar.');
      return;
    }
    if (result.error) {
      console.error('sign in failed', result.error);
      setError('Correo o contraseña incorrectos.');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <img
            src={PROGRAM_LOGO}
            alt="DRISRED Operadora"
            className="mb-4 h-auto w-full max-w-sm object-contain"
          />
          <p className="text-sm text-slate-500">Punto de Venta Multi-Sucursal</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/50">
          <div className="mb-6 flex rounded-lg bg-slate-100 p-1">
            <button
              onClick={() => { setMode('signin'); setError(null); setNotice(null); }}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition ${
                mode === 'signin' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
              }`}
            >
              Iniciar sesión
            </button>
            <button
              onClick={() => { setMode('signup'); setError(null); setNotice(null); }}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition ${
                mode === 'signup' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
              }`}
            >
              Crear cuenta
            </button>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Nombre completo</label>
                <div className="relative">
                  <UserIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    placeholder="Tu nombre"
                    className="w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition"
                  />
                </div>
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Correo electrónico</label>
              <div className="relative">
                <Mail size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="tu@correo.com"
                  className="w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition"
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Contraseña</label>
              <div className="relative">
                <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition"
                />
              </div>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 border border-red-100">
                {error}
              </div>
            )}

            {notice && (
              <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 border border-emerald-100">
                {notice}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {busy && <Loader2 size={16} className="animate-spin" />}
              {mode === 'signin' ? 'Entrar' : 'Crear cuenta'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Sistema POS BIENESTAR · 2 sucursales · Versión VERSION-LEAL-2601
        </p>
      </div>
    </div>
  );
}
