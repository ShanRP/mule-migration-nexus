import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Github, RefreshCw, GitBranch, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';
import { useOrganizations } from '@/providers/OrganizationProvider';
import { isMuleApplication, extractMuleInfo, analyzeMuleConfiguration, getLatestMuleVersion, getLatestJavaVersion } from '@/utils/muleDetection';

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
  connectors: any[];
  artifactJson: any;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  lastUpdated: string;
  selected?: boolean;
  applicationName: string;
}

const Migration = () => {
  const { selectedOrganization } = useOrganizations();
  const [applications, setApplications] = useState<MuleApplication[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchingRepos, setFetchingRepos] = useState(false);
  const [migrating, setMigrating] = useState(false);

  const githubToken = selectedOrganization?.github_token || localStorage.getItem('MULE_githubToken') || '';

  // Utility to fetch file content from GitHub
  const fetchFileContent = async (repoFullName: string, filePath: string, token: string): Promise<string | null> => {
    try {
      const response = await axios.get(
        `https://api.github.com/repos/${repoFullName}/contents/${filePath}`,
        { headers: { Authorization: `token ${token}` } }
      );
      if (response.data && response.data.content) {
        return atob(response.data.content.replace(/\n/g, ''));
      }
    } catch (error) {
      // File not found or access denied
    }
    return null;
  };

  // Utility: Recursively list all files in a repo
  const listAllFiles = async (repoFullName: string, path: string, token: string): Promise<string[]> => {
    let files: string[] = [];
    try {
      const res = await axios.get(
        `https://api.github.com/repos/${repoFullName}/contents/${path}`,
        { headers: { Authorization: `token ${token}` } }
      );
      for (const item of res.data) {
        if (item.type === 'file') {
          files.push(item.path);
        } else if (item.type === 'dir') {
          const subFiles = await listAllFiles(repoFullName, item.path, token);
          files = files.concat(subFiles);
        }
      }
    } catch (e) {}
    return files;
  };

  // Fetch all repos and scan for Mule apps (robust)
  const handleFetchRepositories = async () => {
    if (!githubToken) {
      toast.error('Please connect GitHub and provide a token in the Dashboard.');
      return;
    }
    setFetchingRepos(true);
    setError(null);
    setApplications([]);

    try {
      const orgName = selectedOrganization?.github_url?.split('/').pop() || '';
      let allRepos = [];
      let page = 1;
      const perPage = 100;
      while (true) {
        const url = orgName
          ? `https://api.github.com/orgs/${orgName}/repos?per_page=${perPage}&page=${page}`
          : `https://api.github.com/user/repos?per_page=${perPage}&page=${page}`;
        const reposRes = await axios.get(url, {
          headers: { Authorization: `token ${githubToken}` }
        });
        if (reposRes.data.length === 0) break;
        allRepos.push(...reposRes.data);
        page++;
        if (page > 10) break;
      }

      const muleApps: any[] = [];
      for (const repo of allRepos) {
        try {
          // Recursively list all files in the repo
          const allFiles = await listAllFiles(repo.full_name, '', githubToken);
          const pomFiles = allFiles.filter(f => f.endsWith('pom.xml'));
          for (const pomPath of pomFiles) {
            const pomXml = await fetchFileContent(repo.full_name, pomPath, githubToken);
            if (!pomXml || !isMuleApplication(pomXml)) continue;
            // Extract Mule info
            const { applicationName, muleRuntime, muleVersion, javaVersion, dependencies } = extractMuleInfo(pomXml);
            // If no connectors, try all .xml in src/main/mule (relative to pom.xml)
            let connectors: any[] = [];
            try {
              const muleDirPath = `${pomPath.substring(0, pomPath.lastIndexOf('/'))}/src/main/mule`;
              const muleDir = await axios.get(
                `https://api.github.com/repos/${repo.full_name}/contents/${muleDirPath}`,
                { headers: { Authorization: `token ${githubToken}` } }
              );
              if (muleDir.data && Array.isArray(muleDir.data)) {
                for (const file of muleDir.data) {
                  if (file.name.endsWith('.xml')) {
                    const xmlContent = await fetchFileContent(repo.full_name, file.path, githubToken);
                    if (xmlContent) {
                      connectors = [...connectors, ...analyzeMuleConfiguration(xmlContent)];
                    }
                  }
                }
              }
            } catch {}
            // Try to fetch artifact.json for extra info (optional, relative to pom.xml)
            let artifactJson = null;
            try {
              const artifactPath1 = `${pomPath.substring(0, pomPath.lastIndexOf('/'))}/mule-artifact.json`;
              const artifactPath2 = `${pomPath.substring(0, pomPath.lastIndexOf('/'))}/src/main/resources/mule-artifact.json`;
              const artifactContent = await fetchFileContent(repo.full_name, artifactPath1, githubToken) ||
                await fetchFileContent(repo.full_name, artifactPath2, githubToken);
              if (artifactContent) artifactJson = JSON.parse(artifactContent);
            } catch {}
            // Add to Mule apps
            muleApps.push({
              id: `${repo.id}-${pomPath}`,
              name: repo.name,
              repository: repo.html_url,
              branch: repo.default_branch,
              muleVersion,
              javaVersion,
              dependencies,
              connectors,
              artifactJson,
              status: 'pending',
              lastUpdated: repo.updated_at,
              applicationName,
            });
          }
        } catch (error) {
          // skip repo on error
        }
      }
      setApplications(muleApps);
      if (muleApps.length > 0) {
        toast.success(`Found ${muleApps.length} Mule application(s)!`);
      } else {
        toast.info('No Mule applications found in your repositories.');
      }
    } catch (err) {
      setError('Failed to fetch repositories');
      toast.error('Failed to fetch repositories. Please check your token and permissions.');
    } finally {
      setFetchingRepos(false);
    }
  };

  // Select/deselect apps
  const toggleApplicationSelection = (appId: string) => {
    setApplications(prev => prev.map(app => 
      app.id === appId ? { ...app, selected: !app.selected } : app
    ));
  };

  // Migrate selected apps: create branch, update pom.xml, commit
  const handleMigrateSelected = async () => {
    const selectedApps = applications.filter(app => app.selected);
    if (selectedApps.length === 0) {
      toast.error('Please select at least one application to migrate');
      return;
    }
    setMigrating(true);
    try {
      for (const app of selectedApps) {
        // 1. Get latest pom.xml SHA
        const pomRes = await axios.get(
          `https://api.github.com/repos/${app.repository.replace('https://github.com/', '')}/contents/pom.xml`,
          { headers: { Authorization: `token ${githubToken}` } }
        );
        const pomSha = pomRes.data.sha;
        const pomXml = atob(pomRes.data.content.replace(/\n/g, ''));
        // 2. Update dependencies to latest (for demo, just append a comment)
        const updatedPom = pomXml + '\n<!-- Updated for CloudHub 2.0 migration -->';
        // 3. Create a new branch from default
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
        } catch (e) {/* branch may already exist */}
        // 4. Commit updated pom.xml to new branch
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
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Mule Application Migration</h1>
          <p className="text-gray-600 mt-1">
            Scan your repositories and migrate Mule applications to CloudHub 2.0
          </p>
        </div>
        <Button onClick={handleFetchRepositories} disabled={fetchingRepos}>
          <RefreshCw className={`h-4 w-4 mr-2 ${fetchingRepos ? 'animate-spin' : ''}`} />
          {fetchingRepos ? 'Scanning...' : 'Fetch Mule Applications'}
        </Button>
      </div>
      {error && (
        <div className="text-red-600 mb-4">{error}</div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Mule Applications</CardTitle>
          <CardDescription>
            View and select Mule applications for migration
          </CardDescription>
        </CardHeader>
        <CardContent>
          {fetchingRepos ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            </div>
          ) : applications.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">No Mule applications found. Click 'Fetch Mule Applications' to scan.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[1400px] border border-gray-300 border-collapse">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px] border border-gray-300">Select</TableHead>
                    <TableHead className="border border-gray-300">Application</TableHead>
                    <TableHead className="border border-gray-300">Repository</TableHead>
                    <TableHead className="border border-gray-300">Mule Version</TableHead>
                    <TableHead className="border border-gray-300">Java Version</TableHead>
                    <TableHead className="border border-gray-300">Dependencies</TableHead>
                    <TableHead className="border border-gray-300">Connectors</TableHead>
                    <TableHead className="border border-gray-300">Artifact JSON</TableHead>
                    <TableHead className="border border-gray-300">Latest Version</TableHead>
                    <TableHead className="border border-gray-300">Status</TableHead>
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
                        <a href={app.repository} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                          {app.repository.split('/').slice(-2).join('/')}
                        </a>
                      </TableCell>
                      <TableCell className="border border-gray-300">
                        {app.muleVersion}
                        <div className="text-xs text-gray-500">Latest: {getLatestMuleVersion()}</div>
                      </TableCell>
                      <TableCell className="border border-gray-300">
                        {app.javaVersion}
                        <div className="text-xs text-gray-500">Latest: {getLatestJavaVersion()}</div>
                      </TableCell>
                      <TableCell className="border border-gray-300">
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
                              <span className="text-xs text-gray-500">Latest: {dep.latestVersion}</span>
                            </div>
                          ))}
                          {app.dependencies.length > 3 && (
                            <div className="text-xs text-gray-500">
                              +{app.dependencies.length - 3} more
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="border border-gray-300">
                        <div className="space-y-1">
                          {app.connectors.slice(0, 3).map((conn, index) => (
                            <div key={index} className="flex items-center space-x-2">
                              <span className="text-sm">{conn.artifactId}</span>
                              <Badge variant={conn.isDeprecated ? "destructive" : "secondary"} className="text-xs">
                                {conn.version}
                              </Badge>
                              {conn.isDeprecated && conn.replacement && (
                                <Badge variant="outline" className="text-yellow-600 text-xs">
                                  Replace with {conn.replacement}
                                </Badge>
                              )}
                            </div>
                          ))}
                          {app.connectors.length > 3 && (
                            <div className="text-xs text-gray-500">
                              +{app.connectors.length - 3} more
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="border border-gray-300">
                        {app.artifactJson && (
                          <div className="space-y-1">
                            {Object.entries(app.artifactJson).slice(0, 3).map(([key, value], index) => (
                              <div key={index} className="flex items-center space-x-2">
                                <span className="text-sm">{key}</span>
                                <Badge variant="secondary" className="text-xs">
                                  {String(value)}
                                </Badge>
                              </div>
                            ))}
                            {Object.entries(app.artifactJson).length > 3 && (
                              <div className="text-xs text-gray-500">
                                +{Object.entries(app.artifactJson).length - 3} more
                              </div>
                            )}
                          </div>
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
                          <span className={getStatusColor(app.status)}>
                            {app.status.replace('_', ' ')}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <div className="flex justify-end mt-4">
        <Button
          onClick={handleMigrateSelected}
          disabled={!applications.some(app => app.selected) || migrating}
        >
          {migrating ? 'Migrating...' : 'Migrate Selected'}
        </Button>
      </div>
    </div>
  );
};

export default Migration;
