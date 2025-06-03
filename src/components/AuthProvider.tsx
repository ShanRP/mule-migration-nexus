
import { createContext, useContext, ReactNode } from "react";

interface AuthContextType {
  user: any;
  login: (provider: string) => void;
  logout: () => void;
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
  const login = (provider: string) => {
    console.log(`Logging in with ${provider}`);
    // This will be implemented with Supabase integration
  };

  const logout = () => {
    console.log("Logging out");
    // This will be implemented with Supabase integration
  };

  const value = {
    user: null,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthProvider;
