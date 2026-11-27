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
  /** Raison technique si le profil n'a pas pu être chargé */
  profileError: string | null;
  refreshProfile: () => Promise<void>;
  signUp: (params: {
    password: string;
    username: string;
  }) => Promise<{ error: string | null; needsEmailConfirmation?: boolean }>;
  signIn: (params: {
    /** Pseudonyme, ou adresse e-mail pour les comptes créés avant ce changement */
    identifier: string;
    password: string;
  }) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

// Connexion par pseudonyme : Supabase Auth exige une adresse e-mail, on en
// dérive donc une à partir du pseudonyme. Elle n'est jamais affichée et
// aucun e-mail n'y est envoyé (la confirmation par e-mail doit être
// désactivée dans Supabase). Le domaine .invalid est réservé (RFC 2606).
const USERNAME_EMAIL_DOMAIN = 'users.pancards.invalid';

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${USERNAME_EMAIL_DOMAIN}`;
}

// Traduction des erreurs d'authentification Supabase les plus courantes
function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Pseudonyme ou mot de passe incorrect.';
  if (m.includes('email not confirmed'))
    return 'Compte non confirmé : la confirmation par e-mail doit être désactivée dans Supabase (Authentication › Sign In / Providers › Email).';
  if (m.includes('user already registered')) return 'Ce pseudonyme est déjà utilisé.';
  if (m.includes('password should be at least')) {
    const min = message.match(/at least (\d+)/i)?.[1];
    return min
      ? `Le mot de passe est trop court (${min} caractères minimum).`
      : 'Le mot de passe est trop court.';
  }
  if (m.includes('rate limit') || m.includes('too many requests'))
    return 'Trop de tentatives. Patiente quelques minutes avant de réessayer.';
  if (m.includes('database error saving new user'))
    return 'La création du compte a échoué. Réessaie dans un instant.';
  return message;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const loadedProfileUserId = useRef<string | null>(null);
  // Utilisateur actuellement connecté : une réponse arrivée après une
  // déconnexion ou un changement de compte est ignorée.
  const currentUserId = useRef<string | null>(null);

  const fetchProfile = useCallback(async (userId: string) => {
    const loadProfile = () =>
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle();

    let { data, error } = await loadProfile();
    let repairError: string | null = null;

    // Compte sans profil (créé avant l'installation du trigger d'inscription) :
    // on demande à la base de le créer, puis on recharge.
    if (!error && !data && currentUserId.current === userId) {
      const { error: rpcError } = await supabase.rpc('ensure_my_profile');
      if (rpcError) {
        console.error('Création du profil impossible :', rpcError.message);
        repairError = rpcError.message;
      } else {
        ({ data, error } = await loadProfile());
      }
    }

    if (currentUserId.current !== userId) return;

    if (!error && data) {
      setProfile(data as Profile);
      setProfileError(null);
      loadedProfileUserId.current = userId;
    } else {
      setProfile(null);
      setProfileError(
        error?.message ?? repairError ?? 'Aucun profil trouvé pour ce compte.'
      );
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

    const { data, error } = await supabase.auth.signUp({
      email: usernameToEmail(cleanUsername),
      password,
      options: {
        data: { username: cleanUsername },
      },
    });

    if (error) {
      return { error: translateAuthError(error.message) };
    }

    // Sans confirmation par e-mail, Supabase renvoie directement une session :
    // l'utilisateur est connecté. Sinon, il doit d'abord valider son adresse.
    // Adresse déjà utilisée : Supabase renvoie une réponse « masquée »
    // (utilisateur sans identité, aucune session, aucun e-mail envoyé).
    if (!data.session && data.user && data.user.identities?.length === 0) {
      return { error: 'Ce pseudonyme est déjà utilisé.' };
    }
    return { error: null, needsEmailConfirmation: !data.session };
  };

  const signIn: AuthContextValue['signIn'] = async ({ identifier, password }) => {
    const value = identifier.trim();
    const { error } = await supabase.auth.signInWithPassword({
      // Un « @ » = ancien compte créé avec une vraie adresse e-mail
      email: value.includes('@') ? value : usernameToEmail(value),
      password,
    });
    if (error) {
      return { error: translateAuthError(error.message) };
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
        profileError,
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
