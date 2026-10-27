import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Profile, Branch } from './types';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  branches: Branch[];
  currentBranch: Branch | null;
  setCurrentBranchId: (id: string) => void;
  canSwitchBranch: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const BRANCH_KEY = 'pos_current_branch';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranch, setCurrentBranch] = useState<Branch | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (uid: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*, role:roles(*), branch:branches!profiles_branch_id_fkey(*)')
      .eq('id', uid)
      .maybeSingle();
    if (error) {
      console.error('Error loading profile', error);
      return null;
    }
    setProfile(data as Profile | null);
    return data as Profile | null;
  }, []);

  const loadBranches = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_accessible_branches');
    if (error) {
      console.error('Error loading accessible branches', error);
      setBranches([]);
      setCurrentBranch(null);
      return;
    }
    const list = (data as Branch[]) ?? [];
    setBranches(list);
    const savedBranchId = localStorage.getItem(BRANCH_KEY);
    const savedBranch = savedBranchId ? list.find((b) => b.id === savedBranchId) : null;
    if (savedBranch) {
      setCurrentBranch(savedBranch);
    } else if (list.length === 1) {
      setCurrentBranch(list[0]);
      localStorage.setItem(BRANCH_KEY, list[0].id);
    } else {
      setCurrentBranch(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) {
        Promise.all([loadProfile(data.session.user.id), loadBranches()]).finally(() => {
          if (active) setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      if (event === 'TOKEN_REFRESHED' && sess?.user) {
        setSession(sess);
        setUser(sess.user);
        return;
      }
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        (async () => {
          await loadProfile(sess.user.id);
          await loadBranches();
        })();
      } else {
        setProfile(null);
        setBranches([]);
        setCurrentBranch(null);
        setUser(null);
        localStorage.removeItem(BRANCH_KEY);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile, loadBranches]);

  const setCurrentBranchId = useCallback((id: string) => {
    const found = branches.find((b) => b.id === id) ?? null;
    if (found) {
      setCurrentBranch(found);
      localStorage.setItem(BRANCH_KEY, found.id);
    }
  }, [branches]);

  const hasPermission = useCallback((permission: string) => {
    const permissions = profile?.role?.permissions ?? [];
    return permissions.includes('all') || permissions.includes(permission);
  }, [profile]);

  const canSwitchBranch = hasPermission('branch_switch');

  const refreshProfile = useCallback(async () => {
    if (user) await loadProfile(user.id);
  }, [user, loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const signUp = useCallback(async (email: string, password: string, fullName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) return { error: error.message };
    if (data.user) {
      await loadProfile(data.user.id);
    }
    return { error: null };
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    localStorage.removeItem(BRANCH_KEY);
    await supabase.auth.signOut();
    setProfile(null);
    setBranches([]);
    setCurrentBranch(null);
    setUser(null);
    setSession(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        profile,
        branches,
        currentBranch,
        setCurrentBranchId,
        canSwitchBranch,
        loading,
        signIn,
        signUp,
        signOut,
        refreshProfile,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
