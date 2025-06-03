
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { 
  CheckCircle, 
  Clock, 
  AlertTriangle, 
  Server, 
  GitBranch, 
  TrendingUp,
  ArrowRight
} from "lucide-react";
import { useNavigate } from "react-router-dom";

const Dashboard = () => {
  const navigate = useNavigate();

  const stats = [
    {
      title: "Total Applications",
      value: "24",
      icon: Server,
      color: "text-blue-600",
      bgColor: "bg-blue-100"
    },
    {
      title: "Ready for Migration",
      value: "18",
      icon: CheckCircle,
      color: "text-green-600",
      bgColor: "bg-green-100"
    },
    {
      title: "Needs Review",
      value: "4",
      icon: AlertTriangle,
      color: "text-yellow-600",
      bgColor: "bg-yellow-100"
    },
    {
      title: "In Progress",
      value: "2",
      icon: Clock,
      color: "text-purple-600",
      bgColor: "bg-purple-100"
    }
  ];

  const recentScans = [
    {
      repo: "customer-api",
      status: "completed",
      compatibility: 95,
      lastScan: "2 hours ago"
    },
    {
      repo: "order-service",
      status: "completed",
      compatibility: 88,
      lastScan: "4 hours ago"
    },
    {
      repo: "payment-processor",
      status: "in-progress",
      compatibility: null,
      lastScan: "Scanning..."
    }
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Migration Dashboard</h1>
          <p className="text-gray-600 mt-1">
            Monitor your CloudHub 1.0 to CloudHub 2.0 migration progress
          </p>
        </div>
        <Button onClick={() => navigate("/migration")} className="bg-blue-600 hover:bg-blue-700">
          Start New Scan
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, index) => (
          <Card key={index} className="hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">{stat.title}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{stat.value}</p>
                </div>
                <div className={`p-3 rounded-full ${stat.bgColor}`}>
                  <stat.icon className={`h-6 w-6 ${stat.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Migration Progress */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <TrendingUp className="mr-2 h-5 w-5 text-blue-600" />
              Migration Progress
            </CardTitle>
            <CardDescription>
              Overall progress across all applications
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span>CloudHub 2.0 Compatibility</span>
                <span className="font-medium">75%</span>
              </div>
              <Progress value={75} className="h-2" />
            </div>
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span>Migration Readiness</span>
                <span className="font-medium">60%</span>
              </div>
              <Progress value={60} className="h-2" />
            </div>
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span>Documentation Coverage</span>
                <span className="font-medium">40%</span>
              </div>
              <Progress value={40} className="h-2" />
            </div>
          </CardContent>
        </Card>

        {/* Recent Scans */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <GitBranch className="mr-2 h-5 w-5 text-green-600" />
              Recent Repository Scans
            </CardTitle>
            <CardDescription>
              Latest compatibility scans and results
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentScans.map((scan, index) => (
                <div key={index} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{scan.repo}</p>
                      <p className="text-sm text-gray-500">{scan.lastScan}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {scan.compatibility && (
                      <Badge variant={scan.compatibility >= 90 ? "default" : scan.compatibility >= 70 ? "secondary" : "destructive"}>
                        {scan.compatibility}% compatible
                      </Badge>
                    )}
                    <Badge variant={scan.status === "completed" ? "default" : "secondary"}>
                      {scan.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
            <Button variant="outline" className="w-full mt-4" onClick={() => navigate("/applications")}>
              View All Applications
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
