
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  Search, 
  Filter, 
  Download, 
  Eye, 
  CheckCircle, 
  AlertTriangle,
  Clock,
  Server
} from "lucide-react";

const Applications = () => {
  const [searchTerm, setSearchTerm] = useState("");

  const applications = [
    {
      id: 1,
      name: "customer-service-api",
      repository: "github.com/company/customer-service",
      runtime: "4.4.0",
      compatibility: 95,
      status: "ready",
      issues: 1,
      lastScan: "2024-01-15",
      deployment: "Production"
    },
    {
      id: 2,
      name: "order-management",
      repository: "github.com/company/order-mgmt",
      runtime: "4.3.0",
      compatibility: 78,
      status: "needs-review",
      issues: 5,
      lastScan: "2024-01-14",
      deployment: "Production"
    },
    {
      id: 3,
      name: "payment-processor",
      repository: "github.com/company/payments",
      runtime: "4.4.0",
      compatibility: 92,
      status: "ready",
      issues: 2,
      lastScan: "2024-01-15",
      deployment: "Production"
    },
    {
      id: 4,
      name: "inventory-service",
      repository: "github.com/company/inventory",
      runtime: "4.2.0",
      compatibility: 65,
      status: "needs-migration",
      issues: 8,
      lastScan: "2024-01-13",
      deployment: "Staging"
    },
    {
      id: 5,
      name: "notification-api",
      repository: "github.com/company/notifications",
      runtime: "4.4.0",
      compatibility: 88,
      status: "in-progress",
      issues: 3,
      lastScan: "2024-01-15",
      deployment: "Development"
    }
  ];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ready":
        return (
          <Badge className="bg-green-100 text-green-800">
            <CheckCircle className="mr-1 h-3 w-3" />
            Ready
          </Badge>
        );
      case "needs-review":
        return (
          <Badge className="bg-yellow-100 text-yellow-800">
            <AlertTriangle className="mr-1 h-3 w-3" />
            Needs Review
          </Badge>
        );
      case "in-progress":
        return (
          <Badge className="bg-blue-100 text-blue-800">
            <Clock className="mr-1 h-3 w-3" />
            In Progress
          </Badge>
        );
      case "needs-migration":
        return (
          <Badge className="bg-red-100 text-red-800">
            <AlertTriangle className="mr-1 h-3 w-3" />
            Needs Migration
          </Badge>
        );
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  const getCompatibilityBadge = (score: number) => {
    if (score >= 90) {
      return <Badge className="bg-green-100 text-green-800">{score}%</Badge>;
    } else if (score >= 70) {
      return <Badge className="bg-yellow-100 text-yellow-800">{score}%</Badge>;
    } else {
      return <Badge className="bg-red-100 text-red-800">{score}%</Badge>;
    }
  };

  const filteredApplications = applications.filter(app =>
    app.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    app.repository.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Mule Applications</h1>
          <p className="text-gray-600 mt-1">
            Manage and monitor your Mule applications migration status
          </p>
        </div>
        <div className="flex space-x-2">
          <Button variant="outline">
            <Filter className="mr-2 h-4 w-4" />
            Filter
          </Button>
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Search and Stats */}
      <Card>
        <CardContent className="p-6">
          <div className="flex justify-between items-center mb-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Search applications..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex space-x-6 text-sm">
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900">{applications.length}</div>
                <div className="text-gray-600">Total Apps</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {applications.filter(app => app.status === "ready").length}
                </div>
                <div className="text-gray-600">Ready</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-600">
                  {applications.filter(app => app.status === "needs-review").length}
                </div>
                <div className="text-gray-600">Need Review</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Applications Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Server className="mr-2 h-5 w-5" />
            Applications Overview
          </CardTitle>
          <CardDescription>
            Detailed view of all Mule applications and their migration status
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Application Name</TableHead>
                <TableHead>Repository</TableHead>
                <TableHead>Runtime</TableHead>
                <TableHead>Compatibility</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Issues</TableHead>
                <TableHead>Last Scan</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredApplications.map((app) => (
                <TableRow key={app.id} className="hover:bg-gray-50">
                  <TableCell>
                    <div>
                      <div className="font-medium text-gray-900">{app.name}</div>
                      <div className="text-sm text-gray-500">{app.deployment}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-blue-600 hover:text-blue-800 cursor-pointer">
                      {app.repository}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{app.runtime}</Badge>
                  </TableCell>
                  <TableCell>
                    {getCompatibilityBadge(app.compatibility)}
                  </TableCell>
                  <TableCell>
                    {getStatusBadge(app.status)}
                  </TableCell>
                  <TableCell>
                    <span className={`font-medium ${app.issues > 5 ? 'text-red-600' : app.issues > 2 ? 'text-yellow-600' : 'text-green-600'}`}>
                      {app.issues}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-gray-500">
                    {app.lastScan}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm">
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default Applications;
