import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Github, Cloud, RefreshCw } from 'lucide-react';
import { useOrganizations } from '@/providers/OrganizationProvider';
import RepositoryList from './RepositoryList';
import { isMuleApplication, extractMuleInfo, analyzeMuleConfiguration } from '@/utils/muleDetection';
import axios from 'axios';

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
  applicationName: string;
  muleRuntime: string;
  muleVersion: string;
  javaVersion: string;
  dependencies: MuleDependency[];
  connectors: MuleConnector[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  lastUpdated: string;
  selected?: boolean;
}

const Dashboard = () => {
  const { selectedOrganization, updateOrganization } = useOrganizations();
  const [githubToken, setGithubToken] = useState('');
  const [azureToken, setAzureToken] = useState('');
  const [connecting, setConnecting] = useState<'github' | 'azure' | null>(null);
  const [applications, setApplications] = useState<MuleApplication[]>([]);
  const [fetchingRepos, setFetchingRepos] = useState(false);
  const [showRepositories, setShowRepositories] = useState(false);

  const handleConnectGithub = async () => {
    if (!githubToken.trim()) {
      toast.error('Please enter a GitHub token');
      return;
    }
    setConnecting('github');
    await updateOrganization(selectedOrganization!.id, {
      github_token: githubToken.trim(),
      repository_type: 'github',
    });
    toast.success('GitHub token saved!');
    setConnecting(null);
  };

  const handleConnectAzure = async () => {
    if (!azureToken.trim()) {
      toast.error('Please enter an Azure DevOps token');
      return;
    }
    setConnecting('azure');
    await updateOrganization(selectedOrganization!.id, {
      azure_devops_token: azureToken.trim(),
      repository_type: 'azure_devops',
    });
    toast.success('Azure DevOps token saved!');
    setConnecting(null);
  };

  const fetchFileContent = async (repoFullName: string, filePath: string, token: string): Promise<string | null> => {
    try {
      console.log(`Fetching ${filePath} from ${repoFullName}`);
      const response = await axios.get(
        `https://api.github.com/repos/${repoFullName}/contents/${filePath}`,
        { headers: { Authorization: `token ${token}` } }
      );
      
      if (response.data && response.data.content) {
        const content = atob(response.data.content.replace(/\n/g, ''));
        console.log(`Successfully fetched ${filePath} (${content.length} characters)`);
        return content;
      }
    } catch (error) {
      console.log(`Could not fetch ${filePath} from ${repoFullName}:`, error);
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

  const handleScanRepositories = async () => {
    const token = selectedOrganization?.github_token || githubToken.trim();
    if (!token) {
      toast.error('Please connect GitHub and provide a token first.');
      return;
    }
    setFetchingRepos(true);
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
          headers: { Authorization: `token ${token}` }
        });
        if (reposRes.data.length === 0) break;
        allRepos.push(...reposRes.data);
        page++;
        if (page > 10) break;
      }

      const muleApps: MuleApplication[] = [];
      for (const repo of allRepos) {
        try {
          // Recursively list all files in the repo
          const allFiles = await listAllFiles(repo.full_name, '', token);
          const pomFiles = allFiles.filter(f => f.endsWith('pom.xml'));
          for (const pomPath of pomFiles) {
            const pomXml = await fetchFileContent(repo.full_name, pomPath, token);
            if (!pomXml || !isMuleApplication(pomXml)) continue;
            // Extract Mule info
            const { applicationName, muleRuntime, muleVersion, javaVersion, dependencies } = extractMuleInfo(pomXml);
            // Try to find connectors from config files (relative to pom.xml location)
            let connectors: any[] = [];
            const pomDir = pomPath.substring(0, pomPath.lastIndexOf('/'));
            const configPaths = [
              `${pomDir}/src/main/mule/mule-configuration.xml`,
              `${pomDir}/src/main/app/mule-configuration.xml`,
              `${pomDir}/src/main/resources/mule-configuration.xml`,
              `${pomDir}/mule-configuration.xml`
            ];
            for (const configPath of configPaths) {
              const configXml = await fetchFileContent(repo.full_name, configPath, token);
              if (configXml) {
                connectors = analyzeMuleConfiguration(configXml);
                break;
              }
            }
            // If no connectors, try all .xml in src/main/mule (relative to pom.xml)
            if (connectors.length === 0) {
              try {
                const muleDirPath = `${pomDir}/src/main/mule`;
                const muleDir = await axios.get(
                  `https://api.github.com/repos/${repo.full_name}/contents/${muleDirPath}`,
                  { headers: { Authorization: `token ${token}` } }
                );
                if (muleDir.data && Array.isArray(muleDir.data)) {
                  for (const file of muleDir.data) {
                    if (file.name.endsWith('.xml')) {
                      const xmlContent = await fetchFileContent(repo.full_name, file.path, token);
                      if (xmlContent) {
                        connectors = [...connectors, ...analyzeMuleConfiguration(xmlContent)];
                      }
                    }
                  }
                }
              } catch {}
            }
            // Try to fetch artifact.json for extra info (optional, relative to pom.xml)
            let artifactJson = null;
            try {
              const artifactPath1 = `${pomDir}/mule-artifact.json`;
              const artifactPath2 = `${pomDir}/src/main/resources/mule-artifact.json`;
              const artifactContent = await fetchFileContent(repo.full_name, artifactPath1, token) ||
                await fetchFileContent(repo.full_name, artifactPath2, token);
              if (artifactContent) artifactJson = JSON.parse(artifactContent);
            } catch {}
            // Add to Mule apps
            muleApps.push({
              id: `${repo.id}-${pomPath}`,
              name: repo.name,
              repository: repo.html_url,
              branch: repo.default_branch,
              applicationName,
              muleRuntime,
              muleVersion,
              javaVersion,
              dependencies,
              connectors,
              status: 'pending',
              lastUpdated: repo.updated_at
            });
          }
        } catch (error) {
          // skip repo on error
        }
      }
      setApplications(muleApps);
      setShowRepositories(true);
      if (muleApps.length > 0) {
        toast.success(`Found ${muleApps.length} Mule application(s) with comprehensive analysis!`);
      } else {
        toast.info('No Mule applications found in your repositories.');
      }
    } catch (err) {
      toast.error('Failed to fetch repositories. Please check your token and permissions.');
    } finally {
      setFetchingRepos(false);
    }
  };

  const isConnected = selectedOrganization?.github_token || selectedOrganization?.azure_devops_token;

  if (showRepositories && applications.length > 0) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex justify-between items-center mb-6">
          <Button 
            variant="outline" 
            onClick={() => setShowRepositories(false)}
          >
            ← Back to Dashboard
          </Button>
          <Button onClick={handleScanRepositories} disabled={fetchingRepos}>
            <RefreshCw className={`h-4 w-4 mr-2 ${fetchingRepos ? 'animate-spin' : ''}`} />
            {fetchingRepos ? 'Scanning...' : 'Rescan Repositories'}
          </Button>
        </div>
        <RepositoryList applications={applications} setApplications={setApplications} />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 flex flex-col items-center justify-center min-h-[60vh]">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Connect your Source Control</CardTitle>
          <CardDescription>
            Please connect your GitHub or Azure DevOps account to begin migration.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="github" className="w-full">
            <TabsList className="w-full grid grid-cols-2 mb-4">
              <TabsTrigger value="github">
                <Github className="h-4 w-4 mr-2" /> GitHub
              </TabsTrigger>
              <TabsTrigger value="azure">
                <Cloud className="h-4 w-4 mr-2" /> Azure DevOps
              </TabsTrigger>
            </TabsList>
            <TabsContent value="github">
              <div className="space-y-4">
                <Input
                  placeholder="GitHub Personal Access Token"
                  value={githubToken}
                  onChange={e => setGithubToken(e.target.value)}
                  type="password"
                />
                <div className="text-xs text-gray-500">
                  Need a token?{' '}
                  <a
                    href="https://github.com/settings/tokens"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    Generate a GitHub token
                  </a>
                </div>
                <Button
                  onClick={handleConnectGithub}
                  disabled={connecting === 'github'}
                  className="w-full"
                >
                  {connecting === 'github' ? 'Connecting...' : 'Connect GitHub'}
                </Button>
              </div>
            </TabsContent>
            <TabsContent value="azure">
              <div className="space-y-4">
                <Input
                  placeholder="Azure DevOps Personal Access Token"
                  value={azureToken}
                  onChange={e => setAzureToken(e.target.value)}
                  type="password"
                />
                <div className="text-xs text-gray-500">
                  Need a token?{' '}
                  <a
                    href="https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    Generate an Azure DevOps token
                  </a>
                </div>
                <Button
                  onClick={handleConnectAzure}
                  disabled={connecting === 'azure'}
                  className="w-full"
                >
                  {connecting === 'azure' ? 'Connecting...' : 'Connect Azure DevOps'}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
          
          {isConnected && (
            <div className="mt-6 pt-6 border-t">
              <Button
                onClick={handleScanRepositories}
                disabled={fetchingRepos}
                className="w-full"
                variant="outline"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${fetchingRepos ? 'animate-spin' : ''}`} />
                {fetchingRepos ? 'Scanning Repositories...' : 'Scan for Mule Applications'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;
