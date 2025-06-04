
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Building, Github, Chrome, ArrowRight, CheckCircle, Zap, Shield } from "lucide-react";
import { useNavigate } from "react-router-dom";

const LandingPage = () => {
  const navigate = useNavigate();

  const features = [
    {
      icon: CheckCircle,
      title: "Compatibility Assessment",
      description: "Automatically scan your Mule applications to assess CloudHub 2.0 compatibility"
    },
    {
      icon: Zap,
      title: "Migration Planning",
      description: "Get detailed migration plans with step-by-step guidance for your applications"
    },
    {
      icon: Shield,
      title: "Risk Analysis",
      description: "Identify potential issues and risks before starting your migration journey"
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* Header */}
      <header className="w-full py-6 px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-lg bg-blue-600 flex items-center justify-center">
              <Building className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">MuleMigration</h1>
          </div>
          <div className="flex space-x-3">
            <Button variant="outline" onClick={() => navigate("/auth?mode=signin")}>
              Sign In
            </Button>
            <Button onClick={() => navigate("/auth?mode=signup")} className="bg-blue-600 hover:bg-blue-700">
              Get Started
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <div className="text-center">
          <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6">
            Migrate to
            <span className="text-blue-600"> CloudHub 2.0</span>
            <br />
            with Confidence
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto leading-relaxed">
            Streamline your migration from CloudHub 1.0 to CloudHub 2.0 with our comprehensive
            assessment and planning tools. Get compatibility reports, migration roadmaps, and expert guidance.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button 
              size="lg" 
              onClick={() => navigate("/auth?mode=signup")}
              className="bg-blue-600 hover:bg-blue-700 text-lg px-8 py-4 h-14"
            >
              Start Migration Assessment
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            <Button 
              variant="outline" 
              size="lg"
              onClick={() => navigate("/auth?mode=signin")}
              className="text-lg px-8 py-4 h-14"
            >
              Sign In to Dashboard
            </Button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            Everything You Need for Migration
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Our platform provides comprehensive tools to ensure your CloudHub migration is smooth and successful.
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {features.map((feature, index) => (
            <Card key={index} className="text-center hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center">
                  <feature.icon className="h-6 w-6 text-blue-600" />
                </div>
                <CardTitle className="text-xl mb-2">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-gray-600 leading-relaxed">
                  {feature.description}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-blue-600 py-20">
        <div className="max-w-4xl mx-auto text-center px-6">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
            Ready to Start Your Migration Journey?
          </h2>
          <p className="text-xl text-blue-100 mb-8 leading-relaxed">
            Join hundreds of organizations successfully migrating to CloudHub 2.0 with our platform.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button 
              size="lg" 
              variant="secondary"
              onClick={() => navigate("/auth?mode=signup")}
              className="text-lg px-8 py-4 h-14 bg-white text-blue-600 hover:bg-gray-50"
            >
              Get Started Free
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-50 py-12">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <div className="flex items-center justify-center space-x-3 mb-4">
            <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <Building className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900">MuleMigration</span>
          </div>
          <p className="text-gray-600">
            © 2024 MuleMigration. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
