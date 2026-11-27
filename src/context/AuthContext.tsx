import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types/database';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signUp: (params: {
    email: string;
    password: string;
    username: string;
  }) => Promise<{ error: string | null }>;
  signIn: (params: {
    email: string;
    password: string;
  }) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const loadedProfileUserId = useRef<string | null>(null);
  // Utilisateur actuellement connecté : une réponse arrivée après une
  // déconnexion ou un changement de compte est ignorée.
  const currentUserId = useRef<string | null>(null);

  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (currentUserId.current !== userId) return;

    if (!error && data) {
      setProfile(data as Profile);
      loadedProfileUserId.current = userId;
    } else {
      setProfile(null);
      loadedProfileUserId.current = null;
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user?.id) {
      await fetchProfile(user.id);
    }
  }, [user?.id, fetchProfile]);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      currentUserId.current = data.session?.user?.id ?? null;
      if (data.session?.user) {
        void fetchProfile(data.session.user.id).finally(() => {
          if (active) setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      currentUserId.current = nextSession?.user?.id ?? null;
      if (nextSession?.user) {
        const userId = nextSession.user.id;
        // Le profil ne change pas lors d'un simple rafraîchissement du jeton
        if (event === 'TOKEN_REFRESHED') return;
        // Nouvel utilisateur (connexion) : on garde l'état « chargement » tant
        // que le profil n'est pas arrivé, pour éviter d'afficher « Connexion
        // requise ». Même utilisateur : rafraîchissement silencieux.
        if (loadedProfileUserId.current !== userId) setLoading(true);
        // Supabase déconseille d'appeler l'API directement dans ce callback
        // (risque de blocage) : on diffère l'appel.
        window.setTimeout(() => {
          void fetchProfile(userId).finally(() => {
            if (active && currentUserId.current === userId) setLoading(false);
          });
        }, 0);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signUp: AuthContextValue['signUp'] = async ({
    email,
    password,
    username,
  }) => {
    const cleanUsername = username.trim();
    if (!/^[a-zA-Z0-9_-]{3,24}$/.test(cleanUsername)) {
      return {
        error:
          'Le pseudonyme doit contenir entre 3 et 24 caractères (lettres, chiffres, _ ou -).',
      };
    }

    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .ilike('username', cleanUsername)
      .maybeSingle();

    if (existing) {
      return { error: 'Ce pseudonyme est déjà utilisé par un autre membre.' };
    }

    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { username: cleanUsername },
      },
    });

    if (error) {
      return { error: error.message };
    }

    return { error: null };
  };

  const signIn: AuthContextValue['signIn'] = async ({ email, password }) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      return { error: error.message };
    }
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    loadedProfileUserId.current = null;
    currentUserId.current = null;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        loading,
        refreshProfile,
        signUp,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth doit être utilisé à l’intérieur de AuthProvider.');
  }
  return ctx;
}
