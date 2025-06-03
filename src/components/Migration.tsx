
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  GitBranch, 
  Scan, 
  CheckCircle, 
  AlertTriangle, 
  Clock,
  Github,
  Search
} from "lucide-react";

const Migration = () => {
  const [repoUrl, setRepoUrl] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanResults, setScanResults] = useState<any[]>([]);

  const handleScan = async () => {
    if (!repoUrl.trim()) return;
    
    setIsScanning(true);
    setScanProgress(0);
    
    // Simulate scanning process
    const progressInterval = setInterval(() => {
      setScanProgress(prev => {
        if (prev >= 100) {
          clearInterval(progressInterval);
          setIsScanning(false);
          // Mock scan results
          setScanResults([
            {
              name: "customer-service",
              path: "/src/main/mule",
              compatibility: 92,
              issues: 2,
              status: "ready",
              runtime: "4.4.0"
            },
            {
              name: "order-api",
              path: "/src/main/mule",
              compatibility: 78,
              issues: 5,
              status: "needs-review",
              runtime: "4.3.0"
            },
            {
              name: "payment-processor",
              path: "/src/main/mule",
              compatibility: 95,
              issues: 1,
              status: "ready",
              runtime: "4.4.0"
            }
          ]);
          return 100;
        }
        return prev + 10;
      });
    }, 300);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ready":
        return <Badge className="bg-green-100 text-green-800">Ready</Badge>;
      case "needs-review":
        return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">Needs Review</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  const getCompatibilityColor = (score: number) => {
    if (score >= 90) return "text-green-600";
    if (score >= 70) return "text-yellow-600";
    return "text-red-600";
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Repository Migration Scanner</h1>
        <p className="text-gray-600 mt-1">
          Scan your repositories to assess CloudHub 2.0 compatibility
        </p>
      </div>

      {/* Repository Input */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Github className="mr-2 h-5 w-5" />
            Connect Repository
          </CardTitle>
          <CardDescription>
            Enter your repository URL to start the migration assessment
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="repo-url">Repository URL</Label>
            <div className="flex space-x-2">
              <Input
                id="repo-url"
                placeholder="https://github.com/username/repository"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                disabled={isScanning}
              />
              <Button 
                onClick={handleScan} 
                disabled={!repoUrl.trim() || isScanning}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Scan className="mr-2 h-4 w-4" />
                {isScanning ? "Scanning..." : "Scan Repository"}
              </Button>
            </div>
          </div>

          {isScanning && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Scanning repository...</span>
                <span>{scanProgress}%</span>
              </div>
              <Progress value={scanProgress} className="h-2" />
              <p className="text-sm text-gray-600">
                Analyzing Mule applications and dependencies...
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Scan Results */}
      {scanResults.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Search className="mr-2 h-5 w-5 text-green-600" />
              Scan Results
            </CardTitle>
            <CardDescription>
              Found {scanResults.length} Mule applications in the repository
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {scanResults.map((app, index) => (
                <div key={index} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center space-x-3">
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900">{app.name}</h3>
                        <p className="text-sm text-gray-500">{app.path}</p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      {getStatusBadge(app.status)}
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div className="flex items-center space-x-2">
                      <CheckCircle className={`h-4 w-4 ${getCompatibilityColor(app.compatibility)}`} />
                      <span>Compatibility: </span>
                      <span className={`font-medium ${getCompatibilityColor(app.compatibility)}`}>
                        {app.compatibility}%
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <AlertTriangle className="h-4 w-4 text-yellow-600" />
                      <span>Issues: </span>
                      <span className="font-medium">{app.issues}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <GitBranch className="h-4 w-4 text-blue-600" />
                      <span>Runtime: </span>
                      <span className="font-medium">{app.runtime}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="mt-6 pt-4 border-t border-gray-200">
              <div className="flex justify-between items-center">
                <div className="text-sm text-gray-600">
                  Scan completed successfully
                </div>
                <Button variant="outline">
                  Export Report
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default Migration;
