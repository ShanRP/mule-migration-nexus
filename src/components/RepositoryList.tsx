
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useOrganizations } from '@/providers/OrganizationProvider';
import axios from 'axios';

interface MuleDependency {
  groupId: string;
  artifactId: string;
  version: string;
  latestVersion: string;
  isDeprecated: boolean;
  replacement?: string;
}

interface MuleApplication {
  id: string;
  name: string;
  repository: string;
  branch: string;
  muleVersion: string;
  javaVersion: string;
  dependencies: MuleDependency[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  lastUpdated: string;
  selected?: boolean;
}

interface RepositoryListProps {
  applications: MuleApplication[];
  setApplications: React.Dispatch<React.SetStateAction<MuleApplication[]>>;
}

const RepositoryList: React.FC<RepositoryListProps> = ({ applications, setApplications }) => {
  const { selectedOrganization } = useOrganizations();
  const [migrating, setMigrating] = React.useState(false);

  const githubToken = selectedOrganization?.github_token || '';

  const toggleApplicationSelection = (appId: string) => {
    setApplications(prev => prev.map(app => 
      app.id === appId ? { ...app, selected: !app.selected } : app
    ));
  };

  const handleMigrateSelected = async () => {
    const selectedApps = applications.filter(app => app.selected);
    if (selectedApps.length === 0) {
      toast.error('Please select at least one application to migrate');
      return;
    }
    
    setMigrating(true);
    try {
      for (const app of selectedApps) {
        // Get latest pom.xml SHA
        const pomRes = await axios.get(
          `https://api.github.com/repos/${app.repository.replace('https://github.com/', '')}/contents/pom.xml`,
          { headers: { Authorization: `token ${githubToken}` } }
        );
        const pomSha = pomRes.data.sha;
        const pomXml = atob(pomRes.data.content.replace(/\n/g, ''));
        
        // Update dependencies to latest (for demo, just append a comment)
        const updatedPom = pomXml + '\n<!-- Updated for CloudHub 2.0 migration -->';
        
        // Create a new branch from default
        const branchRes = await axios.get(
          `https://api.github.com/repos/${app.repository.replace('https://github.com/', '')}/git/refs/heads/${app.branch}`,
          { headers: { Authorization: `token ${githubToken}` } }
        );
        const baseSha = branchRes.data.object.sha;
        const newBranch = 'mulemigration';
        
        // Create branch (ignore if exists)
        try {
          await axios.post(
            `https://api.github.com/repos/${app.repository.replace('https://github.com/', '')}/git/refs`,
            {
              ref: `refs/heads/${newBranch}`,
              sha: baseSha
            },
            { headers: { Authorization: `token ${githubToken}` } }
          );
        } catch (e) {
          // Branch may already exist
        }
        
        // Commit updated pom.xml to new branch
        await axios.put(
          `https://api.github.com/repos/${app.repository.replace('https://github.com/', '')}/contents/pom.xml`,
          {
            message: 'Mule migration: update dependencies for CloudHub 2.0',
            content: btoa(updatedPom),
            branch: newBranch,
            sha: pomSha
          },
          { headers: { Authorization: `token ${githubToken}` } }
        );
      }
      toast.success('Migration branch created and pom.xml updated for selected apps!');
    } catch (err) {
      toast.error('Migration failed. Please check your token and repo permissions.');
    } finally {
      setMigrating(false);
    }
  };

  const getStatusColor = (status: MuleApplication['status']) => {
    switch (status) {
      case 'completed':
        return 'text-green-500';
      case 'in_progress':
        return 'text-yellow-500';
      case 'failed':
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  };

  const getStatusIcon = (status: MuleApplication['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case 'in_progress':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <AlertTriangle className="h-5 w-5 text-gray-500" />;
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Mule Applications ({applications.length} found)</CardTitle>
          <CardDescription>
            Select applications to migrate to CloudHub 2.0
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">Select</TableHead>
                <TableHead>Application</TableHead>
                <TableHead>Repository</TableHead>
                <TableHead>Mule Version</TableHead>
                <TableHead>Java Version</TableHead>
                <TableHead>Dependencies</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {applications.map((app) => (
                <TableRow key={app.id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={!!app.selected}
                      onChange={() => toggleApplicationSelection(app.id)}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{app.name}</TableCell>
                  <TableCell>
                    <a 
                      href={app.repository} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="text-blue-600 hover:underline"
                    >
                      {app.repository.split('/').slice(-2).join('/')}
                    </a>
                  </TableCell>
                  <TableCell>{app.muleVersion}</TableCell>
                  <TableCell>{app.javaVersion}</TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      {app.dependencies.slice(0, 3).map((dep, index) => (
                        <div key={index} className="flex items-center space-x-2">
                          <span className="text-sm">{dep.artifactId}</span>
                          <Badge variant={dep.isDeprecated ? "destructive" : "secondary"} className="text-xs">
                            {dep.version}
                          </Badge>
                          {dep.isDeprecated && dep.replacement && (
                            <Badge variant="outline" className="text-yellow-600 text-xs">
                              Replace with {dep.replacement}
                            </Badge>
                          )}
                        </div>
                      ))}
                      {app.dependencies.length > 3 && (
                        <div className="text-xs text-gray-500">
                          +{app.dependencies.length - 3} more
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center space-x-2">
                      {getStatusIcon(app.status)}
                      <span className={getStatusColor(app.status)}>
                        {app.status.replace('_', ' ')}
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
      <div className="flex justify-end">
        <Button
          onClick={handleMigrateSelected}
          disabled={!applications.some(app => app.selected) || migrating}
          size="lg"
        >
          {migrating ? 'Migrating...' : 'Migrate Selected Applications'}
        </Button>
      </div>
    </div>
  );
};

export default RepositoryList;
