import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Github, Cloud, RefreshCw } from 'lucide-react';
import { useOrganizations } from '@/providers/OrganizationProvider';
import RepositoryList from './RepositoryList';
import { isMuleApplication, extractMuleInfo, analyzeMuleConfiguration, extractAzureOrganization } from '@/utils/muleDetection';
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
  pomPaths?: string[];
  artifactJsonPaths?: string[];
  projectXmlPaths?: string[];
}

const Dashboard = () => {
  const { selectedOrganization, updateOrganization } = useOrganizations();
  const [githubToken, setGithubToken] = useState('');
  const [azureToken, setAzureToken] = useState('');
  const [azureOrgUrl, setAzureOrgUrl] = useState('');
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
    if (!azureOrgUrl.trim()) {
      toast.error('Please enter your Azure DevOps organization URL');
      return;
    }
    setConnecting('azure');
    await updateOrganization(selectedOrganization!.id, {
      azure_devops_token: azureToken.trim(),
      azure_devops_url: azureOrgUrl.trim(),
      repository_type: 'azure_devops',
    });
    toast.success('Azure DevOps token saved!');
    setConnecting(null);
  };

  const fetchGitHubFileContent = async (repoFullName: string, filePath: string, token: string): Promise<string | null> => {
    try {
      console.log(`Fetching ${filePath} from GitHub repo ${repoFullName}`);
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

  const fetchAzureFileContent = async (organization: string, project: string, repoName: string, filePath: string, token: string): Promise<string | null> => {
    try {
      console.log(`Fetching ${filePath} from Azure DevOps repo ${organization}/${project}/${repoName}`);
      const response = await axios.get(
        `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repoName}/items?path=/${filePath}&api-version=6.0`,
        { 
          headers: { 
            Authorization: `Basic ${btoa(':' + token)}`,
            'Content-Type': 'application/json'
          } 
        }
      );
      
      if (response.data) {
        console.log(`Successfully fetched ${filePath} (${response.data.length} characters)`);
        return response.data;
      }
    } catch (error) {
      console.log(`Could not fetch ${filePath} from Azure DevOps repo:`, error);
    }
    return null;
  };

  const listAllGitHubFiles = async (repoFullName: string, path: string, token: string): Promise<string[]> => {
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
          const subFiles = await listAllGitHubFiles(repoFullName, item.path, token);
          files = files.concat(subFiles);
        }
      }
    } catch (e) {}
    return files;
  };

  const listAllAzureFiles = async (organization: string, project: string, repoName: string, path: string, token: string): Promise<string[]> => {
    let files: string[] = [];
    try {
      const res = await axios.get(
        `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repoName}/items?path=${path}&recursionLevel=Full&api-version=6.0`,
        { 
          headers: { 
            Authorization: `Basic ${btoa(':' + token)}`,
            'Content-Type': 'application/json'
          } 
        }
      );
      if (res.data && res.data.value) {
        files = res.data.value
          .filter((item: any) => !item.isFolder)
          .map((item: any) => item.path.substring(1)); // Remove leading slash
      }
    } catch (e) {
      console.log('Error listing Azure DevOps files:', e);
    }
    return files;
  };

  const scanGitHubRepositories = async (token: string, orgName: string) => {
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
        const allFiles = await listAllGitHubFiles(repo.full_name, '', token);
        const pomFiles = allFiles.filter(f => f.endsWith('pom.xml'));
        const artifactJsonFiles = allFiles.filter(f => f.endsWith('mule-artifact.json'));
        const projectXmlFiles = allFiles.filter(f => f.endsWith('.xml') && f.includes('src/main/mule/'));
        
        for (const pomPath of pomFiles) {
          const pomXml = await fetchGitHubFileContent(repo.full_name, pomPath, token);
          if (!pomXml || !isMuleApplication(pomXml)) continue;
          
          // Find corresponding mule-artifact.json file
          const pomDir = pomPath.substring(0, pomPath.lastIndexOf('/'));
          const artifactJsonPath = `${pomDir}/src/main/mule/mule-artifact.json`;
          let artifactJson = null;
          
          console.log(`Looking for artifact JSON at: ${artifactJsonPath}`);
          const artifactJsonContent = await fetchGitHubFileContent(repo.full_name, artifactJsonPath, token);
          if (artifactJsonContent) {
            try {
              artifactJson = JSON.parse(artifactJsonContent);
              console.log('Successfully parsed artifact JSON:', artifactJson);
            } catch (error) {
              console.log('Error parsing artifact JSON:', error);
            }
          } else {
            // Try alternative paths
            const altPaths = [
              `${pomDir}/mule-artifact.json`,
              `${pomDir}/src/main/resources/mule-artifact.json`
            ];
            
            for (const altPath of altPaths) {
              console.log(`Trying alternative path: ${altPath}`);
              const altContent = await fetchGitHubFileContent(repo.full_name, altPath, token);
              if (altContent) {
                try {
                  artifactJson = JSON.parse(altContent);
                  console.log('Successfully parsed artifact JSON from alternative path:', artifactJson);
                  break;
                } catch (error) {
                  console.log('Error parsing artifact JSON from alternative path:', error);
                }
              }
            }
          }
          
          const { applicationName, muleRuntime, muleVersion, javaVersion, dependencies } = extractMuleInfo(pomXml, artifactJson);
          
          let connectors: any[] = [];
          const configPaths = [
            `${pomDir}/src/main/mule/mule-configuration.xml`,
            `${pomDir}/src/main/app/mule-configuration.xml`,
            `${pomDir}/src/main/resources/mule-configuration.xml`,
            `${pomDir}/mule-configuration.xml`
          ];
          for (const configPath of configPaths) {
            const configXml = await fetchGitHubFileContent(repo.full_name, configPath, token);
            if (configXml) {
              connectors = analyzeMuleConfiguration(configXml);
              break;
            }
          }
          
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
                    const xmlContent = await fetchGitHubFileContent(repo.full_name, file.path, token);
                    if (xmlContent) {
                      connectors = [...connectors, ...analyzeMuleConfiguration(xmlContent)];
                    }
                  }
                }
              }
            } catch {}
          }
          
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
            lastUpdated: repo.updated_at,
            pomPaths: [pomPath],
            artifactJsonPaths: artifactJsonFiles.filter(f => f.startsWith(pomDir)),
            projectXmlPaths: projectXmlFiles.filter(f => f.startsWith(pomDir))
          });
        }
      } catch (error) {
        // skip repo on error
      }
    }
    return muleApps;
  };

  const scanAzureRepositories = async (token: string, organization: string) => {
    let allRepos = [];
    try {
      // First get all projects
      const projectsRes = await axios.get(
        `https://dev.azure.com/${organization}/_apis/projects?api-version=6.0`,
        { 
          headers: { 
            Authorization: `Basic ${btoa(':' + token)}`,
            'Content-Type': 'application/json'
          } 
        }
      );
      
      console.log('Azure DevOps projects found:', projectsRes.data.value.length);
      
      // Then get repositories for each project
      for (const project of projectsRes.data.value) {
        try {
          const reposRes = await axios.get(
            `https://dev.azure.com/${organization}/${project.name}/_apis/git/repositories?api-version=6.0`,
            { 
              headers: { 
                Authorization: `Basic ${btoa(':' + token)}`,
                'Content-Type': 'application/json'
              } 
            }
          );
          
          console.log(`Found ${reposRes.data.value.length} repositories in project ${project.name}`);
          
          for (const repo of reposRes.data.value) {
            allRepos.push({
              ...repo,
              project: project.name,
              organization
            });
          }
        } catch (error) {
          console.log(`Error fetching repos for project ${project.name}:`, error);
        }
      }
    } catch (error) {
      console.log('Error fetching Azure DevOps projects:', error);
      throw error;
    }

    console.log(`Total Azure DevOps repositories to scan: ${allRepos.length}`);

    const muleApps: MuleApplication[] = [];
    for (const repo of allRepos) {
      try {
        console.log(`Scanning Azure DevOps repo: ${repo.name} in project ${repo.project}`);
        const allFiles = await listAllAzureFiles(organization, repo.project, repo.name, '', token);
        console.log(`Found ${allFiles.length} total files in repo ${repo.name}`);
        
        const pomFiles = allFiles.filter(f => f.endsWith('pom.xml'));
        const artifactJsonFiles = allFiles.filter(f => f.endsWith('mule-artifact.json'));
        const projectXmlFiles = allFiles.filter(f => f.endsWith('.xml') && f.includes('src/main/mule/'));
        
        console.log(`Found in ${repo.name}:`, { 
          pomFiles: pomFiles.length, 
          artifactJsonFiles: artifactJsonFiles.length, 
          projectXmlFiles: projectXmlFiles.length 
        });
        
        for (const pomPath of pomFiles) {
          console.log(`Processing pom.xml: ${pomPath}`);
          const pomXml = await fetchAzureFileContent(organization, repo.project, repo.name, pomPath, token);
          if (!pomXml || !isMuleApplication(pomXml)) {
            console.log(`Not a Mule application: ${pomPath}`);
            continue;
          }
          
          console.log(`Found Mule application in: ${pomPath}`);
          
          // Find corresponding mule-artifact.json file
          const pomDir = pomPath.substring(0, pomPath.lastIndexOf('/')) || '';
          let artifactJson = null;
          
          // Try different paths for mule-artifact.json
          const artifactJsonPaths = [
            `${pomDir}/src/main/mule/mule-artifact.json`,
            `${pomDir}/mule-artifact.json`,
            `${pomDir}/src/main/resources/mule-artifact.json`
          ].filter(path => path !== '/'); // Remove invalid paths
          
          for (const ajPath of artifactJsonPaths) {
            console.log(`Looking for artifact JSON at: ${ajPath}`);
            const artifactJsonContent = await fetchAzureFileContent(organization, repo.project, repo.name, ajPath, token);
            if (artifactJsonContent) {
              try {
                artifactJson = JSON.parse(artifactJsonContent);
                console.log('Successfully parsed artifact JSON:', artifactJson);
                break;
              } catch (error) {
                console.log('Error parsing artifact JSON:', error);
              }
            }
          }
          
          const { applicationName, muleRuntime, muleVersion, javaVersion, dependencies } = extractMuleInfo(pomXml, artifactJson);
          console.log('Extracted Mule info:', { applicationName, muleRuntime, muleVersion, javaVersion, dependencies: dependencies.length });
          
          let connectors: any[] = [];
          const configPaths = [
            `${pomDir}/src/main/mule/mule-configuration.xml`,
            `${pomDir}/src/main/app/mule-configuration.xml`,
            `${pomDir}/src/main/resources/mule-configuration.xml`,
            `${pomDir}/mule-configuration.xml`
          ].filter(path => path !== '/');
          
          for (const configPath of configPaths) {
            const configXml = await fetchAzureFileContent(organization, repo.project, repo.name, configPath, token);
            if (configXml) {
              connectors = analyzeMuleConfiguration(configXml);
              console.log(`Found ${connectors.length} connectors in ${configPath}`);
              break;
            }
          }
          
          if (connectors.length === 0) {
            const muleDirPath = `${pomDir}/src/main/mule`;
            const muleFiles = allFiles.filter(f => f.startsWith(muleDirPath) && f.endsWith('.xml'));
            console.log(`Checking ${muleFiles.length} XML files in mule directory`);
            for (const xmlFile of muleFiles) {
              const xmlContent = await fetchAzureFileContent(organization, repo.project, repo.name, xmlFile, token);
              if (xmlContent) {
                const fileConnectors = analyzeMuleConfiguration(xmlContent);
                connectors = [...connectors, ...fileConnectors];
              }
            }
          }
          
          console.log(`Total connectors found: ${connectors.length}`);
          
          // Get file paths for this pom directory
          const relatedArtifactJsonFiles = artifactJsonFiles.filter(f => f.startsWith(pomDir));
          const relatedProjectXmlFiles = projectXmlFiles.filter(f => f.startsWith(pomDir));
          
          muleApps.push({
            id: `${repo.id}-${pomPath}`,
            name: repo.name,
            repository: repo.webUrl || `https://dev.azure.com/${organization}/${repo.project}/_git/${repo.name}`,
            branch: repo.defaultBranch?.replace('refs/heads/', '') || 'main',
            applicationName,
            muleRuntime,
            muleVersion,
            javaVersion,
            dependencies,
            connectors,
            status: 'pending',
            lastUpdated: new Date().toISOString(),
            pomPaths: [pomPath],
            artifactJsonPaths: relatedArtifactJsonFiles,
            projectXmlPaths: relatedProjectXmlFiles
          });
          
          console.log(`Added Mule app: ${applicationName} with paths:`, {
            pomPaths: [pomPath],
            artifactJsonPaths: relatedArtifactJsonFiles,
            projectXmlPaths: relatedProjectXmlFiles
          });
        }
      } catch (error) {
        console.log(`Error processing Azure repo ${repo.name}:`, error);
      }
    }
    
    console.log(`Total Mule applications found in Azure DevOps: ${muleApps.length}`);
    return muleApps;
  };

  const handleScanRepositories = async () => {
    const repositoryType = selectedOrganization?.repository_type;
    const githubToken = selectedOrganization?.github_token;
    const azureToken = selectedOrganization?.azure_devops_token;
    
    if (!repositoryType || (!githubToken && !azureToken)) {
      toast.error('Please connect to a source control provider first.');
      return;
    }

    setFetchingRepos(true);
    setApplications([]);

    try {
      let muleApps: MuleApplication[] = [];
      
      if (repositoryType === 'github' && githubToken) {
        console.log('Scanning GitHub repositories...');
        const orgName = selectedOrganization?.github_url?.split('/').pop() || '';
        muleApps = await scanGitHubRepositories(githubToken, orgName);
      } else if (repositoryType === 'azure_devops' && azureToken) {
        console.log('Scanning Azure DevOps repositories...');
        const organization = extractAzureOrganization(selectedOrganization?.azure_devops_url || '');
        if (!organization) {
          toast.error('Please provide a valid Azure DevOps organization URL');
          return;
        }
        console.log('Azure DevOps organization:', organization);
        muleApps = await scanAzureRepositories(azureToken, organization);
      }

      setApplications(muleApps);
      setShowRepositories(true);
      if (muleApps.length > 0) {
        toast.success(`Found ${muleApps.length} Mule application(s) with comprehensive analysis!`);
      } else {
        toast.info('No Mule applications found in your repositories.');
      }
    } catch (err) {
      console.error('Repository scanning error:', err);
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
                  placeholder="Azure DevOps Organization URL (e.g., https://dev.azure.com/your-org)"
                  value={azureOrgUrl}
                  onChange={e => setAzureOrgUrl(e.target.value)}
                  type="text"
                />
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
