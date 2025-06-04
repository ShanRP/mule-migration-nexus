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
import { isMuleApplication, extractMuleInfo, analyzeMuleConfiguration, getLatestMuleVersion, getLatestJavaVersion, extractAzureOrganization } from '@/utils/muleDetection';

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
  pomPaths: string[];
  artifactJsonPaths: string[];
  projectXmlPaths: string[];
}

const Migration = () => {
  const { selectedOrganization } = useOrganizations();
  const [applications, setApplications] = useState<MuleApplication[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchingRepos, setFetchingRepos] = useState(false);
  const [migrating, setMigrating] = useState(false);

  const repositoryType = selectedOrganization?.repository_type;
  const githubToken = selectedOrganization?.github_token || '';
  const azureToken = selectedOrganization?.azure_devops_token || '';

  // GitHub file operations
  const fetchGitHubFileContent = async (repoFullName: string, filePath: string, token: string): Promise<string | null> => {
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

  // Azure DevOps file operations
  const fetchAzureFileContent = async (organization: string, project: string, repoName: string, filePath: string, token: string): Promise<string | null> => {
    try {
      console.log(`Fetching ${filePath} from Azure DevOps repo ${organization}/${project}/${repoName}`);
      const response = await axios.get(
        `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repoName}/items?path=${encodeURIComponent(filePath)}&api-version=6.0`,
        { 
          headers: { 
            Authorization: `Basic ${btoa(':' + token)}`,
            'Content-Type': 'application/json'
          } 
        }
      );
      
      if (response.data) {
        // Azure DevOps returns content in base64
        const content = response.data.content;
        if (content) {
          try {
            return atob(content);
          } catch (e) {
            console.error('Error decoding base64 content:', e);
            return null;
          }
        }
      }
    } catch (error) {
      console.error(`Error fetching ${filePath}:`, error);
    }
    return null;
  };

  const listAllAzureFiles = async (organization: string, project: string, repoName: string, path: string, token: string): Promise<string[]> => {
    let files: string[] = [];
    try {
      console.log(`Listing files in ${path} from Azure DevOps repo ${organization}/${project}/${repoName}`);
      const res = await axios.get(
        `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repoName}/items?path=${encodeURIComponent(path)}&recursionLevel=Full&api-version=6.0`,
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
        console.log(`Found ${files.length} files in ${path}`);
      }
    } catch (error) {
      console.error('Error listing files:', error);
    }
    return files;
  };

  // Scan GitHub repositories
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

    const muleApps: any[] = [];
    for (const repo of allRepos) {
      try {
        const allFiles = await listAllGitHubFiles(repo.full_name, '', token);
        const pomFiles = allFiles.filter(f => f.endsWith('pom.xml'));
        const artifactJsonFiles = allFiles.filter(f => f.endsWith('mule-artifact.json'));
        const projectXmlFiles = allFiles.filter(f => f.startsWith('src/main/') && f.endsWith('.xml'));
        for (const pomPath of pomFiles) {
          const pomXml = await fetchGitHubFileContent(repo.full_name, pomPath, token);
          if (!pomXml || !isMuleApplication(pomXml)) continue;
          
          const { applicationName, muleRuntime, muleVersion, javaVersion, dependencies } = extractMuleInfo(pomXml);
          
          let connectors: any[] = [];
          try {
            const muleDirPath = `${pomPath.substring(0, pomPath.lastIndexOf('/'))}/src/main/mule`;
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
          
          let artifactJson = null;
          let artifactJsonPath = null;
          for (const ajPath of artifactJsonFiles) {
            const artifactContent = await fetchGitHubFileContent(repo.full_name, ajPath, token);
            if (artifactContent) {
              try {
                artifactJson = JSON.parse(artifactContent);
                artifactJsonPath = ajPath;
                break;
              } catch {}
            }
          }
          
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
            pomPaths: pomFiles,
            artifactJsonPaths: artifactJsonFiles,
            projectXmlPaths: projectXmlFiles,
          });
        }
      } catch (error) {
        // skip repo on error
      }
    }
    return muleApps;
  };

  // Scan Azure DevOps repositories
  const scanAzureRepositories = async (token: string, organization: string) => {
    let allRepos = [];
    try {
      console.log('Fetching Azure DevOps projects...');
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
      
      // Then get repositories for each project
      for (const project of projectsRes.data.value) {
        try {
          console.log(`Fetching repos for project ${project.name}...`);
          const reposRes = await axios.get(
            `https://dev.azure.com/${organization}/${project.name}/_apis/git/repositories?api-version=6.0`,
            { 
              headers: { 
                Authorization: `Basic ${btoa(':' + token)}`,
                'Content-Type': 'application/json'
              } 
            }
          );
          
          for (const repo of reposRes.data.value) {
            allRepos.push({
              ...repo,
              project: project.name,
              organization
            });
          }
        } catch (error) {
          console.error(`Error fetching repos for project ${project.name}:`, error);
        }
      }
    } catch (error) {
      console.error('Error fetching Azure DevOps projects:', error);
      throw error;
    }

    console.log(`Found ${allRepos.length} repositories to scan`);
    const muleApps: any[] = [];
    
    for (const repo of allRepos) {
      try {
        console.log(`Scanning repo ${repo.name}...`);
        const allFiles = await listAllAzureFiles(organization, repo.project, repo.name, '', token);
        const pomFiles = allFiles.filter(f => f.toLowerCase().endsWith('pom.xml'));
        const artifactJsonFiles = allFiles.filter(f => f.endsWith('mule-artifact.json'));
        const projectXmlFiles = allFiles.filter(f => f.startsWith('src/main/') && f.endsWith('.xml'));
        console.log(`Found ${pomFiles.length} pom.xml files in ${repo.name}`);
        
        for (const pomPath of pomFiles) {
          console.log(`Processing pom.xml at ${pomPath}...`);
          const pomXml = await fetchAzureFileContent(organization, repo.project, repo.name, pomPath, token);
          if (!pomXml || !isMuleApplication(pomXml)) {
            console.log(`Skipping non-Mule pom.xml at ${pomPath}`);
            continue;
          }
          
          const { applicationName, muleRuntime, muleVersion, javaVersion, dependencies } = extractMuleInfo(pomXml);
          
          let connectors: any[] = [];
          const pomDir = pomPath.substring(0, pomPath.lastIndexOf('/'));
          const configPaths = [
            `${pomDir}/src/main/mule/mule-configuration.xml`,
            `${pomDir}/src/main/app/mule-configuration.xml`,
            `${pomDir}/src/main/resources/mule-configuration.xml`,
            `${pomDir}/mule-configuration.xml`
          ];
          
          for (const configPath of configPaths) {
            const configXml = await fetchAzureFileContent(organization, repo.project, repo.name, configPath, token);
            if (configXml) {
              connectors = analyzeMuleConfiguration(configXml);
              break;
            }
          }
          
          if (connectors.length === 0) {
            const muleDirPath = `${pomDir}/src/main/mule`;
            const muleFiles = allFiles.filter(f => f.startsWith(muleDirPath) && f.toLowerCase().endsWith('.xml'));
            for (const xmlFile of muleFiles) {
              const xmlContent = await fetchAzureFileContent(organization, repo.project, repo.name, xmlFile, token);
              if (xmlContent) {
                connectors = [...connectors, ...analyzeMuleConfiguration(xmlContent)];
              }
            }
          }
          
          let artifactJson = null;
          let artifactJsonPath = null;
          for (const ajPath of artifactJsonFiles) {
            const artifactContent = await fetchAzureFileContent(organization, repo.project, repo.name, ajPath, token);
            if (artifactContent) {
              try {
                artifactJson = JSON.parse(artifactContent);
                artifactJsonPath = ajPath;
                break;
              } catch (e) {
                console.error('Error parsing artifact.json:', e);
              }
            }
          }
          
          console.log(`Found Mule application: ${applicationName} in ${repo.name}`);
          muleApps.push({
            id: `${repo.id}-${pomPath}`,
            name: repo.name,
            repository: repo.webUrl || `https://dev.azure.com/${organization}/${repo.project}/_git/${repo.name}`,
            branch: repo.defaultBranch || 'main',
            muleVersion,
            javaVersion,
            dependencies,
            connectors,
            artifactJson,
            status: 'pending',
            lastUpdated: new Date().toISOString(),
            applicationName,
            pomPaths: pomFiles,
            artifactJsonPaths: artifactJsonFiles,
            projectXmlPaths: projectXmlFiles,
          });
        }
      } catch (error) {
        console.error(`Error processing Azure repo ${repo.name}:`, error);
      }
    }
    return muleApps;
  };

  // Azure DevOps migration
  const migrateAzureApplication = async (app: MuleApplication) => {
    const urlParts = app.repository.split('/');
    const organization = urlParts[3];
    const project = urlParts[4];
    const repoName = urlParts[6];
    
    const repoRes = await axios.get(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repoName}?api-version=6.0`,
      { 
        headers: { 
          Authorization: `Basic ${btoa(':' + azureToken)}`,
          'Content-Type': 'application/json'
        } 
      }
    );
    
    const defaultBranchName = repoRes.data.defaultBranch.replace('refs/heads/', '');
    
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
    const updatedPom = pomXml + '\n<!-- Updated for CloudHub 2.0 migration -->';
    
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
    } catch (e) {/* branch may already exist */}
    
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

  // Fetch all repos and scan for Mule apps
  const handleFetchRepositories = async () => {
    if (!repositoryType || (!githubToken && !azureToken)) {
      toast.error('Please connect to a source control provider in the Dashboard.');
      return;
    }
    setFetchingRepos(true);
    setError(null);
    setApplications([]);

    try {
      let muleApps: any[] = [];
      
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
        muleApps = await scanAzureRepositories(azureToken, organization);
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

  // Helper to update pom.xml content with latest versions
  const updatePomXmlWithLatestVersions = (pomXml: string, dependencies: MuleDependency[]) => {
    let updated = pomXml;
    dependencies.forEach(dep => {
      if (dep.latestVersion && dep.version && dep.latestVersion !== dep.version) {
        // Replace the version for this dependency
        const regex = new RegExp(`(<artifactId>${dep.artifactId}</artifactId>[\s\S]*?<version>)([^<]+)(</version>)`, 'g');
        updated = updated.replace(regex, `$1${dep.latestVersion}$3`);
      }
    });
    // Add migration comment
    if (!updated.includes('<!-- Updated for CloudHub 2.0 migration -->')) {
      updated += '\n<!-- Updated for CloudHub 2.0 migration -->';
    }
    return updated;
  };

  // Helper to update mule-artifact.json with latest Java version
  const updateArtifactJsonWithLatestJava = (artifactJson: any) => {
    if (!artifactJson) return artifactJson;
    const latestJava = '17';
    if (Array.isArray(artifactJson['javaSpecificationVersions'])) {
      artifactJson['javaSpecificationVersions'][0] = latestJava;
    } else if (artifactJson['javaversion']) {
      artifactJson['javaversion'] = latestJava;
    } else if (artifactJson['javaVersion']) {
      artifactJson['javaVersion'] = latestJava;
    } else if (artifactJson['java']) {
      artifactJson['java'] = latestJava;
    }
    return artifactJson;
  };

  // Helper to update src/main/*.xml (for demo, just add a migration comment)
  const updateProjectXml = (xml: string) => {
    if (!xml.includes('<!-- Updated for CloudHub 2.0 migration -->')) {
      return xml + '\n<!-- Updated for CloudHub 2.0 migration -->';
    }
    return xml;
  };

  // Helper to normalize file paths (remove leading slash)
  const normalizePath = (path: string) => path.replace(/^\/+/, '');

  // Migrate selected apps
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
          const repoPath = app.repository.replace('https://github.com/', '');
          // 1. Get base branch SHA
          const branchRes = await axios.get(
            `https://api.github.com/repos/${repoPath}/git/refs/heads/${app.branch}`,
            { headers: { Authorization: `token ${githubToken}` } }
          );
          const baseSha = branchRes.data.object.sha;
          const newBranch = 'mulemigration';
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
          for (const pomPath of app.pomPaths) {
            const normPomPath = normalizePath(pomPath);
            console.log('Attempting to fetch/update pom.xml:', normPomPath, 'on branch', newBranch);
            const pomRes = await axios.get(
              `https://api.github.com/repos/${repoPath}/contents/${normPomPath}`,
              { headers: { Authorization: `token ${githubToken}` } }
            );
            const pomSha = pomRes.data.sha;
            const pomXml = atob(pomRes.data.content.replace(/\n/g, ''));
            const updatedPom = updatePomXmlWithLatestVersions(pomXml, app.dependencies);
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
          for (const ajPath of app.artifactJsonPaths) {
            const normAjPath = normalizePath(ajPath);
            console.log('Attempting to fetch/update mule-artifact.json:', normAjPath, 'on branch', newBranch);
            const ajRes = await axios.get(
              `https://api.github.com/repos/${repoPath}/contents/${normAjPath}`,
              { headers: { Authorization: `token ${githubToken}` } }
            );
            const ajSha = ajRes.data.sha;
            const ajJson = JSON.parse(atob(ajRes.data.content.replace(/\n/g, '')));
            const updatedAj = updateArtifactJsonWithLatestJava(ajJson);
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
          for (const xmlPath of app.projectXmlPaths) {
            const normXmlPath = normalizePath(xmlPath);
            console.log('Attempting to fetch/update project xml:', normXmlPath, 'on branch', newBranch);
            const xmlRes = await axios.get(
              `https://api.github.com/repos/${repoPath}/contents/${normXmlPath}`,
              { headers: { Authorization: `token ${githubToken}` } }
            );
            const xmlSha = xmlRes.data.sha;
            const xmlContent = atob(xmlRes.data.content.replace(/\n/g, ''));
            const updatedXml = updateProjectXml(xmlContent);
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
        } else if (repositoryType === 'azure_devops') {
          await migrateAzureApplication(app);
        }
      }
      toast.success('Migration branch created and all files updated for selected apps!');
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
                          {repositoryType === 'github' 
                            ? app.repository.split('/').slice(-2).join('/')
                            : app.repository.split('/').slice(-1)[0]}
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
