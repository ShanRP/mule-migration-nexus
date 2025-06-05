
import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Header from "@/components/Header";
import Dashboard from "@/components/Dashboard";
import Migration from "@/components/Migration";
import Applications from "@/components/Applications";
import LandingPage from "@/components/LandingPage";
import AuthProvider, { useAuth } from "@/components/AuthProvider";
import AuthPage from "@/pages/Auth";
import { OrganizationProvider } from "@/providers/OrganizationProvider";

const AppContent = () => {
  const { user, loading } = useAuth();

  useEffect(() => {
    // Log authentication state for debugging
    console.log('AppContent - User:', user);
    console.log('AppContent - Loading:', loading);
  }, [user, loading]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  // User is authenticated, redirect to dashboard
  return (
    <OrganizationProvider>
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="pt-16">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/migration" element={<Migration />} />
            <Route path="/applications" element={<Applications />} />
            <Route path="/auth" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>
      </div>
    </OrganizationProvider>
  );
};

const Index = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
};

export default Index;
