import { createContext, useContext, ReactNode, useEffect, useState } from "react";
import { User, Session } from '@supabase/supabase-js';
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  login: (provider: 'github' | 'google' | 'azure') => Promise<void>;
  logout: () => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    // Set up auth state listener first
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // console.log('Auth state changed:', event, session);
        
        if (event === 'SIGNED_IN') {
          try {
            // Ensure we have the user's email
            if (session?.user && !session.user.email) {
              const { data: { user }, error } = await supabase.auth.getUser();
              if (error) throw error;
              if (user) {
                session.user = user;
              }
            }
          } catch (error) {
            console.error('Error getting user email:', error);
            toast({
              title: "Authentication Error",
              description: "Failed to get user email. Please try again.",
              variant: "destructive"
            });
            await supabase.auth.signOut();
            return;
          }
        }
        
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    // Then check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [toast]);

  const login = async (provider: 'github' | 'google' | 'azure') => {
    const redirectUrl = `${window.location.origin}/`;
    
    let supabaseProvider: 'github' | 'google' | 'azure';
    switch (provider) {
      case 'azure':
        supabaseProvider = 'azure';
        break;
      case 'google':
        supabaseProvider = 'google';
        break;
      case 'github':
      default:
        supabaseProvider = 'github';
        break;
    }

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: supabaseProvider,
        options: {
          redirectTo: redirectUrl,
          scopes: provider === 'azure' ? 'email profile openid' : undefined,
          queryParams: provider === 'azure' ? {
            prompt: 'select_account'
          } : undefined
        }
      });

      if (error) {
        console.error('Login error:', error);
        throw error;
      }
    } catch (error: any) {
      console.error('Login error:', error);
      toast({
        title: "Authentication Error",
        description: error.message || "Failed to authenticate",
        variant: "destructive"
      });
      throw error;
    }
  };

  const logout = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('Logout error:', error);
        throw error;
      }
    } catch (error: any) {
      toast({
        title: "Logout Error",
        description: error.message || "Failed to logout",
        variant: "destructive"
      });
      throw error;
    }
  };

  const signUp = async (email: string, password: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl
        }
      });
      return { error };
    } catch (error: any) {
      toast({
        title: "Sign Up Error",
        description: error.message || "Failed to sign up",
        variant: "destructive"
      });
      return { error };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });
      return { error };
    } catch (error: any) {
      toast({
        title: "Sign In Error",
        description: error.message || "Failed to sign in",
        variant: "destructive"
      });
      return { error };
    }
  };

  const value = {
    user,
    session,
    login,
    logout,
    signUp,
    signIn,
    loading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthProvider;
