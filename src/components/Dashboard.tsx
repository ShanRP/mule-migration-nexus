
import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Github, Cloud, RefreshCw } from 'lucide-react';
import { useOrganizations } from '@/providers/OrganizationProvider';
import RepositoryList from './RepositoryList';
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

  const isMuleApplication = (pomXml: string): boolean => {
    // Check for Mule-specific indicators in pom.xml
    const muleIndicators = [
      /<groupId>org\.mule\./,
      /<artifactId>mule-/,
      /<mule\.version>/,
      /<packaging>mule-application<\/packaging>/,
      /<packaging>mule<\/packaging>/,
      /<plugin>[\s\S]*?<groupId>org\.mule\.tools\.maven<\/groupId>/,
      /<dependency>[\s\S]*?<groupId>org\.mule\.connectors<\/groupId>/,
      /<dependency>[\s\S]*?<groupId>org\.mule\.modules<\/groupId>/
    ];

    return muleIndicators.some(regex => regex.test(pomXml));
  };

  const extractMuleInfo = (pomXml: string) => {
    // Extract Mule version with multiple patterns
    const muleVersionPatterns = [
      /<mule\.version>(.*?)<\/mule\.version>/,
      /<version>(4\.\d+\.\d+)<\/version>[\s\S]*?<groupId>org\.mule/,
      /<version>(3\.\d+\.\d+)<\/version>[\s\S]*?<groupId>org\.mule/
    ];
    
    let muleVersion = 'Unknown';
    for (const pattern of muleVersionPatterns) {
      const match = pomXml.match(pattern);
      if (match && match[1]) {
        muleVersion = match[1];
        break;
      }
    }

    // Extract Java version
    const javaVersionPatterns = [
      /<java\.version>(.*?)<\/java\.version>/,
      /<maven\.compiler\.source>(.*?)<\/maven\.compiler\.source>/,
      /<maven\.compiler\.target>(.*?)<\/maven\.compiler\.target>/
    ];
    
    let javaVersion = 'Unknown';
    for (const pattern of javaVersionPatterns) {
      const match = pomXml.match(pattern);
      if (match && match[1]) {
        javaVersion = match[1];
        break;
      }
    }

    // Extract Mule-specific dependencies
    const depMatches = [...pomXml.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)];
    const dependencies = depMatches
      .map(match => {
        const depXml = match[1];
        const groupId = (depXml.match(/<groupId>(.*?)<\/groupId>/) || [])[1] || '';
        const artifactId = (depXml.match(/<artifactId>(.*?)<\/artifactId>/) || [])[1] || '';
        const version = (depXml.match(/<version>(.*?)<\/version>/) || [])[1] || '';
        
        return { groupId, artifactId, version };
      })
      .filter(dep => 
        dep.groupId.includes('mule') || 
        dep.artifactId.includes('mule') ||
        dep.groupId.includes('org.mule')
      )
      .map(dep => ({
        groupId: dep.groupId,
        artifactId: dep.artifactId,
        version: dep.version,
        latestVersion: dep.version,
        isDeprecated: false
      }));

    return { muleVersion, javaVersion, dependencies };
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
      console.log('Starting repository scan...');
      
      // Fetch user/org repos with pagination
      const orgName = selectedOrganization?.github_url?.split('/').pop() || '';
      let allRepos = [];
      let page = 1;
      const perPage = 100;
      
      while (true) {
        const url = orgName
          ? `https://api.github.com/orgs/${orgName}/repos?per_page=${perPage}&page=${page}`
          : `https://api.github.com/user/repos?per_page=${perPage}&page=${page}`;
        
        console.log(`Fetching repositories page ${page}...`);
        const reposRes = await axios.get(url, {
          headers: { Authorization: `token ${token}` }
        });
        
        if (reposRes.data.length === 0) break;
        allRepos.push(...reposRes.data);
        page++;
        
        // Limit to prevent excessive API calls (adjust as needed)
        if (page > 10) break;
      }
      
      console.log(`Found ${allRepos.length} total repositories`);
      
      // Check each repo for Mule applications
      const muleApps: MuleApplication[] = [];
      for (const repo of allRepos) {
        try {
          console.log(`Checking repository: ${repo.name}`);
          const pomRes = await axios.get(
            `https://api.github.com/repos/${repo.full_name}/contents/pom.xml`,
            { headers: { Authorization: `token ${token}` } }
          );
          
          if (pomRes.data && pomRes.data.content) {
            // Decode base64 pom.xml
            const pomXml = atob(pomRes.data.content.replace(/\n/g, ''));
            
            // Check if it's actually a Mule application
            if (isMuleApplication(pomXml)) {
              console.log(`✓ Found Mule application: ${repo.name}`);
              
              const { muleVersion, javaVersion, dependencies } = extractMuleInfo(pomXml);
              
              muleApps.push({
                id: repo.id,
                name: repo.name,
                repository: repo.html_url,
                branch: repo.default_branch,
                muleVersion,
                javaVersion,
                dependencies,
                status: 'pending',
                lastUpdated: repo.updated_at
              });
            } else {
              console.log(`✗ Not a Mule application: ${repo.name}`);
            }
          }
        } catch (e) {
          // No pom.xml or access denied, skip silently
          console.log(`No pom.xml found in ${repo.name}`);
        }
      }
      
      console.log(`Found ${muleApps.length} Mule applications`);
      setApplications(muleApps);
      setShowRepositories(true);
      
      if (muleApps.length > 0) {
        toast.success(`Found ${muleApps.length} Mule application(s)!`);
      } else {
        toast.info('No Mule applications found in your repositories.');
      }
    } catch (err) {
      console.error('Repository scan error:', err);
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
