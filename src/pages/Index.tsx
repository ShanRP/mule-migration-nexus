
import { useState } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import Header from "@/components/Header";
import Dashboard from "@/components/Dashboard";
import Migration from "@/components/Migration";
import Applications from "@/components/Applications";
import AuthProvider from "@/components/AuthProvider";
import LoginPage from "@/components/LoginPage";

const Index = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);

  if (!isAuthenticated) {
    return (
      <AuthProvider>
        <LoginPage onLogin={setIsAuthenticated} onUser={setUser} />
      </AuthProvider>
    );
  }

  return (
    <AuthProvider>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={() => setIsAuthenticated(false)} />
        <main className="pt-16">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/migration" element={<Migration />} />
            <Route path="/applications" element={<Applications />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </AuthProvider>
  );
};

export default Index;
