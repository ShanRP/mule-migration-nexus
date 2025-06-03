
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Github, Chrome, Building } from "lucide-react";
import { useState } from "react";

interface LoginPageProps {
  onLogin: (authenticated: boolean) => void;
  onUser: (user: any) => void;
}

const LoginPage = ({ onLogin, onUser }: LoginPageProps) => {
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (provider: string) => {
    setIsLoading(true);
    // Simulate authentication - will be replaced with Supabase
    setTimeout(() => {
      const mockUser = {
        name: "John Doe",
        email: "john.doe@company.com",
        workspace: "Production Workspace",
        avatar: "/placeholder.svg"
      };
      onUser(mockUser);
      onLogin(true);
      setIsLoading(false);
    }, 1500);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-blue-600 flex items-center justify-center">
            <Building className="h-6 w-6 text-white" />
          </div>
          <CardTitle className="text-2xl font-bold text-gray-900">MuleMigration</CardTitle>
          <CardDescription>
            Migrate your Mule applications from CloudHub 1.0 to CloudHub 2.0
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            variant="outline"
            className="w-full h-12"
            onClick={() => handleLogin("github")}
            disabled={isLoading}
          >
            <Github className="mr-2 h-5 w-5" />
            Continue with GitHub
          </Button>
          <Button
            variant="outline"
            className="w-full h-12"
            onClick={() => handleLogin("google")}
            disabled={isLoading}
          >
            <Chrome className="mr-2 h-5 w-5" />
            Continue with Google
          </Button>
          <Button
            variant="outline"
            className="w-full h-12"
            onClick={() => handleLogin("azure")}
            disabled={isLoading}
          >
            <Building className="mr-2 h-5 w-5" />
            Continue with Azure AD
          </Button>
          {isLoading && (
            <p className="text-center text-sm text-gray-600">Authenticating...</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default LoginPage;
