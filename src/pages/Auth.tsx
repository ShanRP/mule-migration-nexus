
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Github, Chrome, Building } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/hooks/use-toast";
import { useSearchParams, useNavigate } from "react-router-dom";

const AuthPage = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const mode = searchParams.get('mode') || 'signin';
  const { login } = useAuth();
  const { toast } = useToast();

  const handleOAuthLogin = async (provider: 'github' | 'google' | 'azure') => {
    setIsLoading(true);
    try {
      await login(provider);
    } catch (error: any) {
      toast({
        title: "Authentication Error",
        description: error.message || "Failed to authenticate",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getTitle = () => {
    return mode === 'signup' ? 'Get Started' : 'Welcome Back';
  };

  const getDescription = () => {
    return mode === 'signup' 
      ? 'Create your account to start migrating to CloudHub 2.0'
      : 'Sign in to your account to continue your migration journey';
  };

  const getButtonText = (provider: string) => {
    const action = mode === 'signup' ? 'Sign up' : 'Continue';
    return `${action} with ${provider}`;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="w-full max-w-md p-6">
        {/* Back to home link */}
        <div className="mb-6">
          <Button 
            variant="ghost" 
            onClick={() => navigate("/")}
            className="text-gray-600 hover:text-gray-900"
          >
            ← Back to Home
          </Button>
        </div>

        <Card className="w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-blue-600 flex items-center justify-center">
              <Building className="h-6 w-6 text-white" />
            </div>
            <CardTitle className="text-2xl font-bold text-gray-900">{getTitle()}</CardTitle>
            <CardDescription>
              {getDescription()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Button
                variant="outline"
                className="w-full h-12"
                onClick={() => handleOAuthLogin("github")}
                disabled={isLoading}
              >
                <Github className="mr-2 h-5 w-5" />
                {getButtonText("GitHub")}
              </Button>
              <Button
                variant="outline"
                className="w-full h-12"
                onClick={() => handleOAuthLogin("google")}
                disabled={isLoading}
              >
                <Chrome className="mr-2 h-5 w-5" />
                {getButtonText("Google")}
              </Button>
              <Button
                variant="outline"
                className="w-full h-12"
                onClick={() => handleOAuthLogin("azure")}
                disabled={isLoading}
              >
                <Building className="mr-2 h-5 w-5" />
                {getButtonText("Azure AD")}
              </Button>
            </div>

            <div className="mt-6 text-center text-sm text-gray-600">
              {mode === 'signup' ? (
                <p>
                  Already have an account?{" "}
                  <Button 
                    variant="link" 
                    className="p-0 h-auto text-blue-600 hover:text-blue-700"
                    onClick={() => navigate("/auth?mode=signin")}
                  >
                    Sign in
                  </Button>
                </p>
              ) : (
                <p>
                  Don't have an account?{" "}
                  <Button 
                    variant="link" 
                    className="p-0 h-auto text-blue-600 hover:text-blue-700"
                    onClick={() => navigate("/auth?mode=signup")}
                  >
                    Sign up
                  </Button>
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AuthPage;
