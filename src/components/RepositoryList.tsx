import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CheckCircle2, AlertTriangle, XCircle, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { useOrganizations } from '@/providers/OrganizationProvider';
import axios from 'axios';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { useState } from 'react';
import { getLatestMuleVersion, getLatestJavaVersion } from '@/utils/muleDetection';

interface MuleDependency {
  groupId: string;
  artifactId: string;
  version: string;
  latestVersion: string;
  isDeprecated: boolean;
  replacement?: string;
}

interface MuleConnector {
  name: string;
  namespace: string;
  isDeprecated: boolean;
  cloudHub2Alternative?: string;
}

interface MuleApplication {
  id: string;
  name: string;
  repository: string;
  branch: string;
  muleVersion: string;
  javaVersion: string;
  dependencies: MuleDependency[];
  connectors: MuleConnector[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  lastUpdated: string;
  selected?: boolean;
  applicationName: string;
  muleRuntime: string;
  artifactJson?: Record<string, any>;
  pomPaths?: string[];
  artifactJsonPaths?: string[];
  projectXmlPaths?: string[];
}

interface RepositoryListProps {
  applications: MuleApplication[];
  setApplications: React.Dispatch<React.SetStateAction<MuleApplication[]>>;
}

const RepositoryList: React.FC<RepositoryListProps> = ({ applications, setApplications }) => {
  const { selectedOrganization } = useOrganizations();
  const [migrating, setMigrating] = React.useState(false);
  const [selectedApp, setSelectedApp] = useState<MuleApplication | null>(null);

  const repositoryType = selectedOrganization?.repository_type;
  const githubToken = selectedOrganization?.github_token || '';
  const azureToken = selectedOrganization?.azure_devops_token || '';

  const toggleApplicationSelection = (appId: string) => {
    setApplications(prev => prev.map(app => 
      app.id === appId ? { ...app, selected: !app.selected } : app
    ));
  };

  // Helper to normalize file paths (remove leading slash)
  const normalizePath = (path: string) => path.replace(/^\/+/, '');

  const migrateGitHubApplication = async (app: MuleApplication) => {
    const repoPath = app.repository.replace('https://github.com/', '');
    const newBranch = 'mulemigration';
    // 1. Get base branch SHA
    const branchRes = await axios.get(
      `https://api.github.com/repos/${repoPath}/git/refs/heads/${app.branch}`,
      { headers: { Authorization: `token ${githubToken}` } }
    );
    const baseSha = branchRes.data.object.sha;
    // 2. Create branch (ignore if exists)
    try {
      await axios.post(
        `https://api.github.com/repos/${repoPath}/git/refs`,
        {
          ref: `refs/heads/${newBranch}`,
          sha: baseSha
        },
        { headers: { Authorization: `token ${githubToken}` } }
      );
    } catch (e) {/* branch may already exist */}
    // 3. Update all pom.xml files
    for (const pomPath of app.pomPaths || ['pom.xml']) {
      const normPomPath = normalizePath(pomPath);
      console.log('Attempting to fetch/update pom.xml:', normPomPath, 'on branch', newBranch);
      const pomRes = await axios.get(
        `https://api.github.com/repos/${repoPath}/contents/${normPomPath}`,
        { headers: { Authorization: `token ${githubToken}` } }
      );
      const pomSha = pomRes.data.sha;
      const pomXml = atob(pomRes.data.content.replace(/\n/g, ''));
      // For demo, just append a comment. You can add version update logic here if needed.
      const updatedPom = pomXml + '\n<!-- Updated for CloudHub 2.0 migration -->';
      await axios.put(
        `https://api.github.com/repos/${repoPath}/contents/${normPomPath}`,
        {
          message: 'Mule migration: update dependencies for CloudHub 2.0',
          content: btoa(updatedPom),
          branch: newBranch,
          sha: pomSha
        },
        { headers: { Authorization: `token ${githubToken}` } }
      );
    }
    // 4. Update all mule-artifact.json files
    for (const ajPath of app.artifactJsonPaths || []) {
      const normAjPath = normalizePath(ajPath);
      console.log('Attempting to fetch/update mule-artifact.json:', normAjPath, 'on branch', newBranch);
      const ajRes = await axios.get(
        `https://api.github.com/repos/${repoPath}/contents/${normAjPath}`,
        { headers: { Authorization: `token ${githubToken}` } }
      );
      const ajSha = ajRes.data.sha;
      const ajJson = JSON.parse(atob(ajRes.data.content.replace(/\n/g, '')));
      // For demo, just add a migration comment
      const updatedAj = { ...ajJson, migration: 'CloudHub 2.0' };
      await axios.put(
        `https://api.github.com/repos/${repoPath}/contents/${normAjPath}`,
        {
          message: 'Mule migration: update Java version for CloudHub 2.0',
          content: btoa(JSON.stringify(updatedAj, null, 2)),
          branch: newBranch,
          sha: ajSha
        },
        { headers: { Authorization: `token ${githubToken}` } }
      );
    }
    // 5. Update all src/main/*.xml files
    for (const xmlPath of app.projectXmlPaths || []) {
      const normXmlPath = normalizePath(xmlPath);
      console.log('Attempting to fetch/update project xml:', normXmlPath, 'on branch', newBranch);
      const xmlRes = await axios.get(
        `https://api.github.com/repos/${repoPath}/contents/${normXmlPath}`,
        { headers: { Authorization: `token ${githubToken}` } }
      );
      const xmlSha = xmlRes.data.sha;
      const xmlContent = atob(xmlRes.data.content.replace(/\n/g, ''));
      const updatedXml = xmlContent + '\n<!-- Updated for CloudHub 2.0 migration -->';
      await axios.put(
        `https://api.github.com/repos/${repoPath}/contents/${normXmlPath}`,
        {
          message: 'Mule migration: update for CloudHub 2.0',
          content: btoa(updatedXml),
          branch: newBranch,
          sha: xmlSha
        },
        { headers: { Authorization: `token ${githubToken}` } }
      );
    }
  };

  const migrateAzureApplication = async (app: MuleApplication) => {
    // Extract organization, project, and repo name from repository URL
    const urlParts = app.repository.split('/');
    const organization = urlParts[3]; // dev.azure.com/{org}
    const project = urlParts[4];
    const repoName = urlParts[6];
    
    // Get the repository details
    const repoRes = await axios.get(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repoName}?api-version=6.0`,
      { 
        headers: { 
          Authorization: `Basic ${btoa(':' + azureToken)}`,
          'Content-Type': 'application/json'
        } 
      }
    );
    
    // Get the default branch
    const defaultBranchName = repoRes.data.defaultBranch.replace('refs/heads/', '');
    
    // Get latest commit from default branch
    const commitsRes = await axios.get(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repoName}/commits?searchCriteria.itemVersion.version=${defaultBranchName}&$top=1&api-version=6.0`,
      { 
        headers: { 
          Authorization: `Basic ${btoa(':' + azureToken)}`,
          'Content-Type': 'application/json'
        } 
      }
    );
    const latestCommitId = commitsRes.data.value[0].commitId;
    
    // Get pom.xml content
    const pomRes = await axios.get(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repoName}/items?path=pom.xml&api-version=6.0`,
      { 
        headers: { 
          Authorization: `Basic ${btoa(':' + azureToken)}`,
          'Content-Type': 'application/json'
        } 
      }
    );
    const pomXml = pomRes.data;
    
    // Update dependencies (for demo, just append a comment)
    const updatedPom = pomXml + '\n<!-- Updated for CloudHub 2.0 migration -->';
    
    // Create new branch
    const newBranch = 'mulemigration';
    try {
      await axios.post(
        `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repoName}/refs?api-version=6.0`,
        {
          name: `refs/heads/${newBranch}`,
          oldObjectId: '0000000000000000000000000000000000000000',
          newObjectId: latestCommitId
        },
        { 
          headers: { 
            Authorization: `Basic ${btoa(':' + azureToken)}`,
            'Content-Type': 'application/json'
          } 
        }
      );
    } catch (e) {
      // Branch may already exist
    }
    
    // Push updated pom.xml to new branch
    await axios.post(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repoName}/pushes?api-version=6.0`,
      {
        refUpdates: [{
          name: `refs/heads/${newBranch}`,
          oldObjectId: latestCommitId
        }],
        commits: [{
          comment: 'Mule migration: update dependencies for CloudHub 2.0',
          changes: [{
            changeType: 'edit',
            item: { path: '/pom.xml' },
            newContent: {
              content: updatedPom,
              contentType: 'rawtext'
            }
          }]
        }]
      },
      { 
        headers: { 
          Authorization: `Basic ${btoa(':' + azureToken)}`,
          'Content-Type': 'application/json'
        } 
      }
    );
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
        if (repositoryType === 'github') {
          await migrateGitHubApplication(app);
        } else if (repositoryType === 'azure_devops') {
          await migrateAzureApplication(app);
        }
      }
      toast.success('Migration branch created and pom.xml updated for selected apps!');
    } catch (err) {
      console.error('Migration error:', err);
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

  const getTotalDeprecatedItems = (app: MuleApplication) => {
    const deprecatedDeps = app.dependencies.filter(dep => dep.isDeprecated).length;
    const deprecatedConnectors = app.connectors.filter(conn => conn.isDeprecated).length;
    return deprecatedDeps + deprecatedConnectors;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Mule Applications ({applications.length} found)</CardTitle>
          <CardDescription>
            Comprehensive analysis including dependencies, connectors, and CloudHub 2.0 compatibility
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table className="min-w-[1400px] border border-gray-300 border-collapse">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px] border border-gray-300">Select</TableHead>
                  <TableHead className="border border-gray-300">Application Name</TableHead>
                  <TableHead className="border border-gray-300">Repository</TableHead>
                  <TableHead className="border border-gray-300">Mule Runtime</TableHead>
                  <TableHead className="border border-gray-300">Java Version</TableHead>
                  <TableHead className="border border-gray-300">Dependencies</TableHead>
                  <TableHead className="border border-gray-300">Connectors</TableHead>
                  <TableHead className="border border-gray-300">CloudHub 2.0 Compatibility</TableHead>
                  <TableHead className="border border-gray-300">Latest Version</TableHead>
                  <TableHead className="border border-gray-300">Migration Status</TableHead>
                  <TableHead className="border border-gray-300">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {applications.map((app) => (
                  <TableRow key={app.id}>
                    <TableCell className="border border-gray-300">
                      <input
                        type="checkbox"
                        checked={!!app.selected}
                        onChange={() => toggleApplicationSelection(app.id)}
                      />
                    </TableCell>
                    <TableCell className="border border-gray-300">{app.applicationName}</TableCell>
                    <TableCell className="border border-gray-300">
                      <a 
                        href={app.repository} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-blue-600 hover:underline text-sm flex items-center"
                      >
                        {repositoryType === 'github' 
                          ? app.repository.split('/').slice(-2).join('/')
                          : app.repository.split('/').slice(-1)[0]}
                        <ExternalLink className="h-3 w-3 ml-1" />
                      </a>
                    </TableCell>
                    <TableCell className="border border-gray-300">
                      {app.muleRuntime}
                      <div className="text-xs text-gray-500">Latest: {getLatestMuleVersion()}</div>
                    </TableCell>
                    <TableCell className="border border-gray-300">
                      {app.javaVersion}
                      <div className="text-xs text-gray-500">Latest: {getLatestJavaVersion()}</div>
                    </TableCell>
                    <TableCell className="border border-gray-300">
                      <div className="space-y-1">
                        {app.dependencies.map(dep => (
                          <div key={dep.artifactId} className="flex items-center space-x-2">
                            <span>{dep.artifactId}</span>
                            <Badge variant="outline" className="text-xs">{dep.version}</Badge>
                            {dep.version !== dep.latestVersion && (
                              <Badge variant="outline" className="text-yellow-600 text-xs">→ {dep.latestVersion}</Badge>
                            )}
                            {dep.isDeprecated && (
                              <Badge variant="destructive" className="text-xs">Deprecated</Badge>
                            )}
                            {dep.replacement && (
                              <Badge variant="secondary" className="text-xs">Replace: {dep.replacement}</Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="border border-gray-300">
                      <div className="space-y-1">
                        {app.connectors.map(conn => (
                          <div key={conn.name} className="flex items-center space-x-2">
                            <span>{conn.name}</span>
                            {conn.isDeprecated && (
                              <Badge variant="destructive" className="text-xs">Deprecated</Badge>
                            )}
                            {conn.cloudHub2Alternative && (
                              <Badge variant="outline" className="text-blue-600 text-xs">{conn.cloudHub2Alternative}</Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="border border-gray-300">
                      {app.connectors.filter(conn => conn.cloudHub2Alternative).length > 0 ? (
                        <span className="text-red-600 text-xs">Some connectors not available in CloudHub 2.0</span>
                      ) : (
                        <span className="text-green-600 text-xs">All compatible</span>
                      )}
                    </TableCell>
                    <TableCell className="border border-gray-300">
                      <div className="space-y-1">
                        <div className="text-xs">Mule: {getLatestMuleVersion()}</div>
                        <div className="text-xs">Java: {getLatestJavaVersion()}</div>
                        {app.dependencies.map(dep => (
                          <div key={dep.artifactId} className="text-xs">
                            {dep.artifactId}: {dep.latestVersion}
                          </div>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="border border-gray-300">
                      <div className="flex items-center space-x-2">
                        {getStatusIcon(app.status)}
                        <div className="flex flex-col">
                          <span className={getStatusColor(app.status)}>
                            {app.status.replace('_', ' ')}
                          </span>
                          {getTotalDeprecatedItems(app) > 0 && (
                            <span className="text-xs text-red-600">
                              {getTotalDeprecatedItems(app)} items need attention
                            </span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="border border-gray-300">
                      <Button variant="outline" size="sm" onClick={() => setSelectedApp(app)}>
                        View Details
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
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

      {/* Dialog for View Details */}
      <Dialog open={!!selectedApp} onOpenChange={open => !open && setSelectedApp(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedApp?.applicationName || selectedApp?.name}</DialogTitle>
            <DialogDescription>Mule Application Details</DialogDescription>
          </DialogHeader>
          {selectedApp && (
            <div className="space-y-2">
              <div><b>Repository:</b> {selectedApp.repository}</div>
              <div><b>Mule Runtime:</b> {selectedApp.muleRuntime}</div>
              <div><b>Mule Version:</b> {selectedApp.muleVersion}</div>
              <div><b>Java Version:</b> {selectedApp.javaVersion}</div>
              <div><b>Dependencies:</b>
                <ul className="ml-4 list-disc">
                  {selectedApp.dependencies.map(dep => (
                    <li key={dep.artifactId}>
                      {dep.artifactId} ({dep.version})
                      {dep.version !== dep.latestVersion && <> → <b>{dep.latestVersion}</b></>}
                      {dep.isDeprecated && <span className="text-red-600 ml-1">Deprecated</span>}
                      {dep.replacement && <span className="ml-1">(Replace with {dep.replacement})</span>}
                    </li>
                  ))}
                </ul>
              </div>
              <div><b>Connectors:</b>
                <ul className="ml-4 list-disc">
                  {selectedApp.connectors.map(conn => (
                    <li key={conn.name}>
                      {conn.name} {conn.isDeprecated && <span className="text-red-600 ml-1">Deprecated</span>}
                      {conn.cloudHub2Alternative && <span className="ml-1">(CloudHub 2.0: {conn.cloudHub2Alternative})</span>}
                    </li>
                  ))}
                </ul>
              </div>
              {selectedApp.artifactJson && (
                <div><b>Artifact JSON:</b>
                  <ul className="ml-4 list-disc">
                    {Object.entries(selectedApp.artifactJson).map(([key, value]) => (
                      <li key={key}>{key}: {String(value)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <DialogClose asChild>
            <Button>Close</Button>
          </DialogClose>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RepositoryList;
