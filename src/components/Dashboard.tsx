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

  const fetchAzureFileContent = async (organization: string, project: string, repoId: string, filePath: string, token: string): Promise<string | null> => {
    try {
      console.log(`Fetching ${filePath} from Azure DevOps repo ${organization}/${project}/${repoId}`);
      
      // Try multiple CORS proxy services in order of preference
      const proxyServices = [
        'https://api.allorigins.win/raw?url=',
        'https://cors-anywhere.herokuapp.com/',
        'https://thingproxy.freeboard.io/fetch/'
      ];
      
      const targetUrl = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repoId}/items?path=${encodeURIComponent('/' + filePath)}&api-version=6.0`;
      
      for (const proxyUrl of proxyServices) {
        try {
          console.log(`Trying proxy: ${proxyUrl}`);
          const fullUrl = proxyUrl + encodeURIComponent(targetUrl);
          
          const response = await axios.get(fullUrl, {
            headers: {
              'Authorization': `Basic ${btoa(':' + token)}`,
              'Content-Type': 'application/json'
            },
            timeout: 10000
          });
          
          if (response.data) {
            console.log(`Successfully fetched ${filePath} from Azure DevOps using ${proxyUrl}`);
            return response.data;
          }
        } catch (proxyError) {
          console.log(`Proxy ${proxyUrl} failed:`, proxyError);
          continue;
        }
      }
      
      // If all proxies fail, try direct request (might work in some environments)
      try {
        console.log('Attempting direct request to Azure DevOps...');
        const response = await axios.get(targetUrl, {
          headers: {
            'Authorization': `Basic ${btoa(':' + token)}`,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        });
        
        if (response.data) {
          console.log(`Successfully fetched ${filePath} via direct request`);
          return response.data;
        }
      } catch (directError) {
        console.log('Direct request failed:', directError);
      }
      
    } catch (error) {
      console.log(`Could not fetch ${filePath} from Azure DevOps repo:`, error);
    }
    return null;
  };

  const listAllGitHubFiles = async (repoFullName: string, path: string, token: string): Promise<string[]> => {
    let files: string[] = [];
    try {
      // Skip the target directory entirely
      if (path.includes('/target/') || path === 'target' || path.startsWith('target/')) {
        console.log(`Skipping target directory: ${path}`);
        return files;
      }
      
      const res = await axios.get(
        `https://api.github.com/repos/${repoFullName}/contents/${path}`,
        { headers: { Authorization: `token ${token}` } }
      );
      for (const item of res.data) {
        // Skip target directories at any level
        if (item.name === 'target' || item.path.includes('/target/')) {
          console.log(`Skipping target directory: ${item.path}`);
          continue;
        }
        
        if (item.type === 'file') {
          files.push(item.path);
        } else if (item.type === 'dir') {
          const subFiles = await listAllGitHubFiles(repoFullName, item.path, token);
          files = files.concat(subFiles);
        }
      }
    } catch (e) {
      console.log(`Error listing files in ${path}:`, e);
    }
    return files;
  };

  const listAllAzureFiles = async (organization: string, project: string, repoId: string, path: string, token: string): Promise<string[]> => {
    let files: string[] = [];
    try {
      console.log(`Listing files in Azure DevOps repo: org=${organization}, project=${project}, repoId=${repoId}, path=${path}`);
      
      // Try multiple CORS proxy services
      const proxyServices = [
        'https://api.allorigins.win/raw?url=',
        'https://cors-anywhere.herokuapp.com/',
        'https://thingproxy.freeboard.io/fetch/'
      ];
      
      const targetUrl = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repoId}/items?path=${encodeURIComponent(path)}&recursionLevel=Full&api-version=6.0`;
      
      for (const proxyUrl of proxyServices) {
        try {
          console.log(`Trying proxy for file listing: ${proxyUrl}`);
          const fullUrl = proxyUrl + encodeURIComponent(targetUrl);
          
          const response = await axios.get(fullUrl, {
            headers: {
              'Authorization': `Basic ${btoa(':' + token)}`,
              'Content-Type': 'application/json'
            },
            timeout: 15000
          });
          
          if (response.data && response.data.value) {
            files = response.data.value
              .filter((item: any) => !item.isFolder && item.path && !item.path.includes('/target/'))
              .map((item: any) => item.path.substring(1)); // Remove leading slash
            console.log(`Successfully listed ${files.length} files from Azure DevOps using ${proxyUrl}`);
            break;
          }
        } catch (proxyError) {
          console.log(`File listing proxy ${proxyUrl} failed:`, proxyError);
          continue;
        }
      }
      
      // If all proxies fail, try direct request
      if (files.length === 0) {
        try {
          console.log('Attempting direct file listing request...');
          const response = await axios.get(targetUrl, {
            headers: {
              'Authorization': `Basic ${btoa(':' + token)}`,
              'Content-Type': 'application/json'
            },
            timeout: 10000
          });
          
          if (response.data && response.data.value) {
            files = response.data.value
              .filter((item: any) => !item.isFolder && item.path && !item.path.includes('/target/'))
              .map((item: any) => item.path.substring(1));
            console.log(`Successfully listed ${files.length} files via direct request`);
          }
        } catch (directError) {
          console.log('Direct file listing failed:', directError);
        }
      }
      
    } catch (error) {
      console.log('Error listing Azure DevOps files:', error);
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

    const muleAppsMap = new Map<string, MuleApplication>(); // Use Map to avoid duplicates by repository
    
    for (const repo of allRepos) {
      try {
        console.log(`Scanning repository: ${repo.name}`);
        const allFiles = await listAllGitHubFiles(repo.full_name, '', token);
        const pomFiles = allFiles.filter(f => f.endsWith('pom.xml'));
        const artifactJsonFiles = allFiles.filter(f => f.endsWith('mule-artifact.json'));
        const projectXmlFiles = allFiles.filter(f => f.endsWith('.xml') && f.includes('src/main/mule/'));
        
        console.log(`Found in ${repo.name}:`, { pomFiles: pomFiles.length, artifactJsonFiles: artifactJsonFiles.length, projectXmlFiles: projectXmlFiles.length });

        // Check if any POM file contains a Mule application
        let isMuleRepo = false;
        let mainPomPath = '';
        let applicationInfo = null;
        
        for (const pomPath of pomFiles) {
          const pomXml = await fetchGitHubFileContent(repo.full_name, pomPath, token);
          if (pomXml && isMuleApplication(pomXml)) {
            console.log(`Found Mule application in: ${pomPath}`);
            isMuleRepo = true;
            mainPomPath = pomPath;
            
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
            
            applicationInfo = extractMuleInfo(pomXml, artifactJson);
            break; // Use the first valid Mule application found
          }
        }
        
        if (isMuleRepo && applicationInfo) {
          console.log(`Processing Mule repository: ${repo.name}`);
          
          // Analyze connectors from all XML files
          let connectors: any[] = [];
          const configPaths = [
            `${mainPomPath.substring(0, mainPomPath.lastIndexOf('/'))}/src/main/mule/mule-configuration.xml`,
            `${mainPomPath.substring(0, mainPomPath.lastIndexOf('/'))}/src/main/app/mule-configuration.xml`,
            `${mainPomPath.substring(0, mainPomPath.lastIndexOf('/'))}/src/main/resources/mule-configuration.xml`,
            `${mainPomPath.substring(0, mainPomPath.lastIndexOf('/'))}/mule-configuration.xml`
          ];
          
          for (const configPath of configPaths) {
            const configXml = await fetchGitHubFileContent(repo.full_name, configPath, token);
            if (configXml) {
              connectors = analyzeMuleConfiguration(configXml);
              console.log(`Found ${connectors.length} connectors in ${configPath}`);
              break;
            }
          }
          
          if (connectors.length === 0) {
            try {
              const muleDirPath = `${mainPomPath.substring(0, mainPomPath.lastIndexOf('/'))}/src/main/mule`;
              const muleDir = await axios.get(
                `https://api.github.com/repos/${repo.full_name}/contents/${muleDirPath}`,
                { headers: { Authorization: `token ${token}` } }
              );
              if (muleDir.data && Array.isArray(muleDir.data)) {
                for (const file of muleDir.data) {
                  if (file.name.endsWith('.xml')) {
                    const xmlContent = await fetchGitHubFileContent(repo.full_name, file.path, token);
                    if (xmlContent) {
                      const fileConnectors = analyzeMuleConfiguration(xmlContent);
                      connectors = [...connectors, ...fileConnectors];
                    }
                  }
                }
              }
            } catch {}
          }
          
          // Create a single entry for this repository with all file paths consolidated
          const muleApp: MuleApplication = {
            id: `${repo.id}`, // Use repository ID as unique identifier
            name: repo.name,
            repository: repo.html_url,
            branch: repo.default_branch,
            applicationName: applicationInfo.applicationName,
            muleRuntime: applicationInfo.muleRuntime,
            muleVersion: applicationInfo.muleVersion,
            javaVersion: applicationInfo.javaVersion,
            dependencies: applicationInfo.dependencies,
            connectors,
            status: 'pending',
            lastUpdated: repo.updated_at,
            pomPaths: pomFiles, // Include all POM files found
            artifactJsonPaths: artifactJsonFiles, // Include all artifact JSON files
            projectXmlPaths: projectXmlFiles // Include all project XML files
          };
          
          // Only add if not already processed (avoid duplicates)
          if (!muleAppsMap.has(repo.id.toString())) {
            muleAppsMap.set(repo.id.toString(), muleApp);
            console.log(`Added unique Mule app: ${applicationInfo.applicationName} for repository ${repo.name}`);
          }
        }
      } catch (error) {
        console.log(`Error processing repository ${repo.name}:`, error);
        // skip repo on error
      }
    }
    
    const uniqueMuleApps = Array.from(muleAppsMap.values());
    console.log(`Total unique Mule applications found: ${uniqueMuleApps.length}`);
    return uniqueMuleApps;
  };

  const scanAzureRepositories = async (token: string, organization: string) => {
    let allRepos = [];
    try {
      console.log('Scanning Azure DevOps repositories with improved CORS handling...');
      
      // Try multiple CORS proxy services
      const proxyServices = [
        'https://api.allorigins.win/raw?url=',
        'https://cors-anywhere.herokuapp.com/',
        'https://thingproxy.freeboard.io/fetch/'
      ];
      
      let projectsData = null;
      
      // First get all projects
      const projectsUrl = `https://dev.azure.com/${organization}/_apis/projects?api-version=6.0`;
      
      for (const proxyUrl of proxyServices) {
        try {
          console.log(`Trying proxy for projects: ${proxyUrl}`);
          const projectsFullUrl = proxyUrl + encodeURIComponent(projectsUrl);
          
          const projectsResponse = await axios.get(projectsFullUrl, {
            headers: {
              'Authorization': `Basic ${btoa(':' + token)}`,
              'Content-Type': 'application/json'
            },
            timeout: 15000
          });
          
          projectsData = projectsResponse.data;
          console.log(`Successfully fetched projects using ${proxyUrl}:`, projectsData.value?.length || 0);
          break;
        } catch (proxyError) {
          console.log(`Projects proxy ${proxyUrl} failed:`, proxyError);
          continue;
        }
      }
      
      // If all proxies fail, try direct request
      if (!projectsData) {
        try {
          console.log('Attempting direct projects request...');
          const projectsResponse = await axios.get(projectsUrl, {
            headers: {
              'Authorization': `Basic ${btoa(':' + token)}`,
              'Content-Type': 'application/json'
            },
            timeout: 10000
          });
          projectsData = projectsResponse.data;
          console.log('Successfully fetched projects via direct request:', projectsData.value?.length || 0);
        } catch (directError) {
          console.log('Direct projects request failed:', directError);
          throw new Error('Unable to fetch Azure DevOps projects due to CORS restrictions');
        }
      }
      
      if (!projectsData || !projectsData.value || projectsData.value.length === 0) {
        console.log('No projects found in Azure DevOps organization');
        return [];
      }
      
      // Then get repositories for each project
      for (const project of projectsData.value) {
        try {
          const reposUrl = `https://dev.azure.com/${organization}/${project.name}/_apis/git/repositories?api-version=6.0`;
          let reposData = null;
          
          for (const proxyUrl of proxyServices) {
            try {
              console.log(`Trying proxy for repos in project ${project.name}: ${proxyUrl}`);
              const reposFullUrl = proxyUrl + encodeURIComponent(reposUrl);
              
              const reposResponse = await axios.get(reposFullUrl, {
                headers: {
                  'Authorization': `Basic ${btoa(':' + token)}`,
                  'Content-Type': 'application/json'
                },
                timeout: 15000
              });
              
              reposData = reposResponse.data;
              console.log(`Successfully fetched repos for project ${project.name} using ${proxyUrl}:`, reposData.value?.length || 0);
              break;
            } catch (proxyError) {
              console.log(`Repos proxy ${proxyUrl} failed for project ${project.name}:`, proxyError);
              continue;
            }
          }
          
          // If proxies fail, try direct request
          if (!reposData) {
            try {
              console.log(`Attempting direct repos request for project ${project.name}...`);
              const reposResponse = await axios.get(reposUrl, {
                headers: {
                  'Authorization': `Basic ${btoa(':' + token)}`,
                  'Content-Type': 'application/json'
                },
                timeout: 10000
              });
              reposData = reposResponse.data;
              console.log(`Successfully fetched repos for project ${project.name} via direct request`);
            } catch (directError) {
              console.log(`Direct repos request failed for project ${project.name}:`, directError);
              continue;
            }
          }
          
          if (reposData && reposData.value) {
            for (const repo of reposData.value) {
              allRepos.push({
                ...repo,
                project: project.name,
                organization,
                repoId: repo.id
              });
            }
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

    const muleAppsMap = new Map<string, MuleApplication>(); // Use Map to avoid duplicates by repository
    
    for (const repo of allRepos) {
      try {
        console.log(`Scanning Azure DevOps repo: ${repo.name} (ID: ${repo.repoId}) in project ${repo.project}`);
        
        const allFiles = await listAllAzureFiles(organization, repo.project, repo.repoId, '', token);
        console.log(`Found ${allFiles.length} total files in repo ${repo.name}`);
        
        const pomFiles = allFiles.filter(f => f.endsWith('pom.xml'));
        const artifactJsonFiles = allFiles.filter(f => f.endsWith('mule-artifact.json'));
        const projectXmlFiles = allFiles.filter(f => f.endsWith('.xml') && f.includes('src/main/mule/'));
        
        console.log(`Found in ${repo.name}:`, { 
          pomFiles: pomFiles.length, 
          artifactJsonFiles: artifactJsonFiles.length, 
          projectXmlFiles: projectXmlFiles.length 
        });
        
        // Check if any POM file contains a Mule application
        let isMuleRepo = false;
        let mainPomPath = '';
        let applicationInfo = null;
        
        for (const pomPath of pomFiles) {
          console.log(`Processing pom.xml: ${pomPath}`);
          const pomXml = await fetchAzureFileContent(organization, repo.project, repo.repoId, pomPath, token);
          if (pomXml && isMuleApplication(pomXml)) {
            console.log(`Found Mule application in: ${pomPath}`);
            isMuleRepo = true;
            mainPomPath = pomPath;
            
            const pomDir = pomPath.substring(0, pomPath.lastIndexOf('/')) || '';
            let artifactJson = null;
            
            const artifactJsonPaths = [
              `${pomDir}/src/main/mule/mule-artifact.json`,
              `${pomDir}/mule-artifact.json`,
              `${pomDir}/src/main/resources/mule-artifact.json`
            ].filter(path => path !== '/');
            
            for (const ajPath of artifactJsonPaths) {
              console.log(`Looking for artifact JSON at: ${ajPath}`);
              const artifactJsonContent = await fetchAzureFileContent(organization, repo.project, repo.repoId, ajPath, token);
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
            
            applicationInfo = extractMuleInfo(pomXml, artifactJson);
            console.log('Extracted Mule info:', { applicationName: applicationInfo.applicationName, muleRuntime: applicationInfo.muleRuntime, muleVersion: applicationInfo.muleVersion, javaVersion: applicationInfo.javaVersion, dependencies: applicationInfo.dependencies.length });
            break; // Use the first valid Mule application found
          }
        }
        
        if (isMuleRepo && applicationInfo) {
          console.log(`Processing Mule repository: ${repo.name}`);
          
          let connectors: any[] = [];
          const configPaths = [
            `${mainPomPath.substring(0, mainPomPath.lastIndexOf('/'))}/src/main/mule/mule-configuration.xml`,
            `${mainPomPath.substring(0, mainPomPath.lastIndexOf('/'))}/src/main/app/mule-configuration.xml`,
            `${mainPomPath.substring(0, mainPomPath.lastIndexOf('/'))}/src/main/resources/mule-configuration.xml`,
            `${mainPomPath.substring(0, mainPomPath.lastIndexOf('/'))}/mule-configuration.xml`
          ].filter(path => path !== '/');
          
          for (const configPath of configPaths) {
            const configXml = await fetchAzureFileContent(organization, repo.project, repo.repoId, configPath, token);
            if (configXml) {
              connectors = analyzeMuleConfiguration(configXml);
              console.log(`Found ${connectors.length} connectors in ${configPath}`);
              break;
            }
          }
          
          if (connectors.length === 0) {
            const muleDirPath = `${mainPomPath.substring(0, mainPomPath.lastIndexOf('/'))}/src/main/mule`;
            const muleFiles = allFiles.filter(f => f.startsWith(muleDirPath) && f.endsWith('.xml'));
            console.log(`Checking ${muleFiles.length} XML files in mule directory`);
            for (const xmlFile of muleFiles) {
              const xmlContent = await fetchAzureFileContent(organization, repo.project, repo.repoId, xmlFile, token);
              if (xmlContent) {
                const fileConnectors = analyzeMuleConfiguration(xmlContent);
                connectors = [...connectors, ...fileConnectors];
              }
            }
          }
          
          console.log(`Total connectors found: ${connectors.length}`);
          
          // Create a single entry for this repository with all file paths consolidated
          const muleApp: MuleApplication = {
            id: `${repo.repoId}`, // Use repository ID as unique identifier
            name: repo.name,
            repository: repo.webUrl || `https://dev.azure.com/${organization}/${repo.project}/_git/${repo.name}`,
            branch: repo.defaultBranch?.replace('refs/heads/', '') || 'main',
            applicationName: applicationInfo.applicationName,
            muleRuntime: applicationInfo.muleRuntime,
            muleVersion: applicationInfo.muleVersion,
            javaVersion: applicationInfo.javaVersion,
            dependencies: applicationInfo.dependencies,
            connectors,
            status: 'pending',
            lastUpdated: new Date().toISOString(),
            pomPaths: pomFiles, // Include all POM files found
            artifactJsonPaths: artifactJsonFiles, // Include all artifact JSON files
            projectXmlPaths: projectXmlFiles // Include all project XML files
          };
          
          // Only add if not already processed (avoid duplicates)
          if (!muleAppsMap.has(repo.repoId)) {
            muleAppsMap.set(repo.repoId, muleApp);
            console.log(`Added unique Mule app: ${applicationInfo.applicationName} for repository ${repo.name}`);
          }
        }
      } catch (error) {
        console.log(`Error processing Azure repo ${repo.name}:`, error);
      }
    }
    
    const uniqueMuleApps = Array.from(muleAppsMap.values());
    console.log(`Total unique Mule applications found in Azure DevOps: ${uniqueMuleApps.length}`);
    return uniqueMuleApps;
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
        toast.success(`Found ${muleApps.length} unique Mule application(s) with comprehensive analysis!`);
      } else {
        toast.info('No Mule applications found in your repositories.');
      }
    } catch (err) {
      console.error('Repository scanning error:', err);
      if (err instanceof Error && err.message.includes('401')) {
        toast.error('Authentication failed. Please check your token and permissions.');
      } else if (err instanceof Error && err.message.includes('CORS')) {
        toast.error('CORS restrictions encountered. Please try using a CORS browser extension or contact your administrator.');
      } else {
        toast.error('Failed to fetch repositories. Please check your token and permissions.');
      }
    } finally {
      setFetchingRepos(false);
    }
  };

  const isConnected = selectedOrganization?.github_token || selectedOrganization?.azure_devops_token;

  if (showRepositories && applications.length > 0) {
    return (
      <div className="container mx-auto p-6 max-w-full w-full overflow-x-auto">
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
