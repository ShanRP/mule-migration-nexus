import React, { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Github, Cloud, RefreshCw, Lock, Key, CheckCircle2, AlertCircle, ExternalLink, GitBranch, Settings } from 'lucide-react';
import { useOrganizations } from '@/providers/OrganizationProvider';
import RepositoryList from './RepositoryList';
import { isMuleApplication, extractMuleInfo, analyzeMuleConfiguration, extractAzureOrganization, getLatestMuleVersion, getLatestJavaVersion } from '@/utils/muleDetection';
import { createAzureDevOpsAPI } from '@/utils/azureDevopsApi';
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
  const [fetchingRepos, setFetchingRepos] = useState<'github' | 'azure' | null>(null);
  const [showRepositories, setShowRepositories] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [reconnecting, setReconnecting] = useState<'github' | 'azure' | null>(null);

  // Reset state when organization changes
  useEffect(() => {
    setShowRepositories(false);
    setApplications([]);
    setGithubToken('');
    setAzureToken('');
    setAzureOrgUrl('');
    setReconnecting(null);
  }, [selectedOrganization?.id, selectedOrganization?.repository_type]);

  const handleReconnectGithub = () => {
    setReconnecting('github');
    setGithubToken('');
  };

  const handleReconnectAzure = () => {
    setReconnecting('azure');
    setAzureToken('');
    setAzureOrgUrl('');
  };

  const handleCancelReconnect = () => {
    setReconnecting(null);
    setGithubToken('');
    setAzureToken('');
    setAzureOrgUrl('');
  };

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
    setConnecting(null);
    setReconnecting(null);
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
    setConnecting(null);
    setReconnecting(null);
  };

  const fetchGitHubFileContent = async (repoFullName: string, filePath: string, token: string): Promise<string | null> => {
    try {
      // console.log(`Fetching ${filePath} from GitHub repo ${repoFullName}`);
      const response = await axios.get(
        `https://api.github.com/repos/${repoFullName}/contents/${filePath}`,
        { headers: { Authorization: `token ${token}` } }
      );
      
      if (response.data && response.data.content) {
        const content = atob(response.data.content.replace(/\n/g, ''));
        // console.log(`Successfully fetched ${filePath} (${content.length} characters)`);
        return content;
      }
    } catch (error) {
      console.log(`Could not fetch ${filePath} from ${repoFullName}:`, error);
    }
    return null;
  };

  const listAllGitHubFiles = async (repoFullName: string, path: string, token: string): Promise<string[]> => {
    let files: string[] = [];
    try {
      // Skip the target directory entirely
      if (path.includes('/target/') || path === 'target' || path.startsWith('target/')) {
        // console.log(`Skipping target directory: ${path}`);
        return files;
      }
      
      const res = await axios.get(
        `https://api.github.com/repos/${repoFullName}/contents/${path}`,
        { headers: { Authorization: `token ${token}` } }
      );
      for (const item of res.data) {
        // Skip target directories at any level
        if (item.name === 'target' || item.path.includes('/target/')) {
          // console.log(`Skipping target directory: ${item.path}`);
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
        // console.log(`Scanning repository: ${repo.name}`);
        const allFiles = await listAllGitHubFiles(repo.full_name, '', token);
        const pomFiles = allFiles.filter(f => f.endsWith('pom.xml'));
        const artifactJsonFiles = allFiles.filter(f => f.endsWith('mule-artifact.json'));
        const projectXmlFiles = allFiles.filter(f => f.endsWith('.xml') && f.includes('src/main/mule/'));
        
        // console.log(`Found in ${repo.name}:`, { pomFiles: pomFiles.length, artifactJsonFiles: artifactJsonFiles.length, projectXmlFiles: projectXmlFiles.length });

        // Check if any POM file contains a Mule application
        let isMuleRepo = false;
        let mainPomPath = '';
        let applicationInfo = null;
        
        for (const pomPath of pomFiles) {
          // console.log(`Processing pom.xml: ${pomPath}`);
          const pomXml = await fetchGitHubFileContent(repo.full_name, pomPath, token);
          if (pomXml && isMuleApplication(pomXml)) {
            // console.log(`Found Mule application in: ${pomPath}`);
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
              // console.log(`Looking for artifact JSON at: ${ajPath}`);
              const artifactJsonContent = await fetchGitHubFileContent(repo.full_name, ajPath, token);
              if (artifactJsonContent) {
                try {
                  artifactJson = JSON.parse(artifactJsonContent);
                  // console.log('Successfully parsed artifact JSON:', artifactJson);
                  break;
                } catch (error) {
                  console.log('Error parsing artifact JSON:', error);
                }
              }
            }
            
            applicationInfo = await extractMuleInfo(pomXml, artifactJson);
            // console.log('Extracted Mule info:', { 
            //   applicationName: applicationInfo.applicationName, 
            //   muleRuntime: applicationInfo.muleRuntime, 
            //   muleVersion: applicationInfo.muleVersion, 
            //   javaVersion: applicationInfo.javaVersion, 
            //   dependencies: applicationInfo.dependencies.length 
            // });
            break;
          }
        }
        
        if (isMuleRepo && applicationInfo) {
          // console.log(`Processing Mule repository: ${repo.name}`);
          
          // Analyze connectors from all XML files
          let connectors: any[] = [];
          const configPaths = [
            // `${mainPomPath.substring(0, mainPomPath.lastIndexOf('/'))}/src/main/mule/mule-configuration.xml`,
            // `${mainPomPath.substring(0, mainPomPath.lastIndexOf('/'))}/src/main/app/mule-configuration.xml`,
            // `${mainPomPath.substring(0, mainPomPath.lastIndexOf('/'))}/src/main/resources/mule-configuration.xml`,
            // `${mainPomPath.substring(0, mainPomPath.lastIndexOf('/'))}/mule-configuration.xml`
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
            // console.log(`Added unique Mule app: ${applicationInfo.applicationName} for repository ${repo.name}`);
          }
        }
      } catch (error) {
        console.log(`Error processing repository ${repo.name}:`, error);
        // skip repo on error
      }
    }
    
    const uniqueMuleApps = Array.from(muleAppsMap.values());
    // console.log(`Total unique Mule applications found: ${uniqueMuleApps.length}`);
    return uniqueMuleApps;
  };

  const scanAzureRepositories = async (token: string, organization: string) => {
    try {
      // console.log('Scanning Azure DevOps repositories...');
      
      const azureApi = createAzureDevOpsAPI(organization, token);
      
      // Get all projects
      const projects = await azureApi.getProjects();
      // console.log(`Found ${projects.length} projects in organization ${organization}`);
      
      if (projects.length === 0) {
        toast.error('No projects found in Azure DevOps organization. Please check your organization URL and PAT permissions.');
        return [];
      }
      
      const allRepos = [];
      
      // Get repositories for each project
      for (const project of projects) {
        try {
          // console.log(`Fetching repositories for project: ${project.name}`);
          const repos = await azureApi.getRepositories(project.name);
          
          for (const repo of repos) {
            allRepos.push({
              ...repo,
              project: project.name,
              organization,
              repoId: repo.id
            });
          }
        } catch (error) {
          // console.error(`Error fetching repos for project ${project.name}:`, error);
          toast.error(`Failed to fetch repositories for project ${project.name}. Please check your PAT permissions.`);
        }
      }
      
      // console.log(`Total Azure DevOps repositories to scan: ${allRepos.length}`);
      
      if (allRepos.length === 0) {
        toast.error('No repositories found in any project. Please check your PAT permissions and repository access.');
        return [];
      }
      
      const muleAppsMap = new Map<string, MuleApplication>();
      
      for (const repo of allRepos) {
        try {
          // console.log(`Scanning Azure DevOps repo: ${repo.name} (ID: ${repo.repoId}) in project ${repo.project}`);
          
          const allFiles = await azureApi.listFiles(repo.project, repo.repoId);
          // console.log(`Found ${allFiles.length} total files in repo ${repo.name}`);
          
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
            // console.log(`Processing pom.xml: ${pomPath}`);
            const pomXml = await azureApi.getFileContent(repo.project, repo.repoId, pomPath);
            if (pomXml && isMuleApplication(pomXml)) {
              // console.log(`Found Mule application in: ${pomPath}`);
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
                // console.log(`Looking for artifact JSON at: ${ajPath}`);
                const artifactJsonContent = await azureApi.getFileContent(repo.project, repo.repoId, ajPath);
                if (artifactJsonContent) {
                  try {
                    artifactJson = JSON.parse(artifactJsonContent);
                    // console.log('Successfully parsed artifact JSON:', artifactJson);
                    break;
                  } catch (error) {
                    console.log('Error parsing artifact JSON:', error);
                  }
                }
              }
              
              applicationInfo = await extractMuleInfo(pomXml, artifactJson);
              // console.log('Extracted Mule info:', { 
              //   applicationName: applicationInfo.applicationName, 
              //   muleRuntime: applicationInfo.muleRuntime, 
              //   muleVersion: applicationInfo.muleVersion, 
              //   javaVersion: applicationInfo.javaVersion, 
              //   dependencies: applicationInfo.dependencies.length 
              // });
              break;
            }
          }
          
          if (isMuleRepo && applicationInfo) {
            // console.log(`Processing Mule repository: ${repo.name}`);
            
            let connectors: any[] = [];
            
            // Look for XML files in the mule directory
            const muleDirPath = `${mainPomPath.substring(0, mainPomPath.lastIndexOf('/'))}/src/main/mule`;
            const muleFiles = allFiles.filter(f => f.startsWith(muleDirPath) && f.endsWith('.xml'));
            // console.log(`Found ${muleFiles.length} XML files in mule directory`);
            
            for (const xmlFile of muleFiles) {
              const xmlContent = await azureApi.getFileContent(repo.project, repo.repoId, xmlFile);
              if (xmlContent) {
                const fileConnectors = analyzeMuleConfiguration(xmlContent);
                if (fileConnectors.length > 0) {
                  console.log(`Found ${fileConnectors.length} connectors in ${xmlFile}`);
                  connectors = [...connectors, ...fileConnectors];
                }
              }
            }
            
            // console.log(`Total connectors found: ${connectors.length}`);
            
            const muleApp: MuleApplication = {
              id: `${repo.repoId}`,
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
              pomPaths: pomFiles,
              artifactJsonPaths: artifactJsonFiles,
              projectXmlPaths: projectXmlFiles
            };
            
            if (!muleAppsMap.has(repo.repoId)) {
              muleAppsMap.set(repo.repoId, muleApp);
              // console.log(`Added unique Mule app: ${applicationInfo.applicationName} for repository ${repo.name}`);
            }
          }
        } catch (error) {
          // console.error(`Error processing Azure repo ${repo.name}:`, error);
          toast.error(`Failed to process repository ${repo.name}. Please check your PAT permissions and repository access.`);
        }
      }
      
      const uniqueMuleApps = Array.from(muleAppsMap.values());
      // console.log(`Total unique Mule applications found in Azure DevOps: ${uniqueMuleApps.length}`);
      return uniqueMuleApps;
      
    } catch (error) {
      console.error('Azure DevOps scanning failed:', error);
      if (error instanceof Error) {
        if (error.message.includes('Authentication failed')) {
          toast.error('Authentication failed. Please check your Azure DevOps PAT and permissions.');
        } else if (error.message.includes('Organization not found')) {
          toast.error('Organization not found. Please check your Azure DevOps organization URL.');
        } else {
          toast.error(`Azure DevOps scanning failed: ${error.message}`);
        }
      } else {
        toast.error('Azure DevOps scanning failed. Please check your connection and try again.');
      }
      throw error;
    }
  };

  const handleScanGithub = async () => {
    const githubToken = selectedOrganization?.github_token;
    
    if (!githubToken) {
      toast.error('Please connect GitHub first');
      return;
    }

    setFetchingRepos('github');
    setApplications([]);

    try {
      // console.log('Scanning GitHub repositories...');
      const orgName = selectedOrganization?.github_url?.split('/').pop() || '';
      const muleApps = await scanGitHubRepositories(githubToken, orgName);

      setApplications(muleApps);
      setShowRepositories(true);
      if (muleApps.length > 0) {
        toast.success(`Found ${muleApps.length} unique Mule application(s) in GitHub!`);
      } else {
        toast.info('No Mule applications found in your GitHub repositories.');
      }
    } catch (err) {
      console.error('GitHub scanning error:', err);
      toast.error('Failed to scan GitHub repositories. Please check your token and permissions.');
    } finally {
      setFetchingRepos(null);
    }
  };

  const handleScanAzure = async () => {
    const azureToken = selectedOrganization?.azure_devops_token;
    
    if (!azureToken) {
      toast.error('Please connect Azure DevOps first');
      return;
    }

    setFetchingRepos('azure');
    setApplications([]);

    try {
      // console.log('Scanning Azure DevOps repositories...');
      const organization = extractAzureOrganization(selectedOrganization?.azure_devops_url || '');
      if (!organization) {
        toast.error('Please provide a valid Azure DevOps organization URL');
        return;
      }
      // console.log('Azure DevOps organization:', organization);
      const muleApps = await scanAzureRepositories(azureToken, organization);

      setApplications(muleApps);
      setShowRepositories(true);
      if (muleApps.length > 0) {
        toast.success(`Found ${muleApps.length} unique Mule application(s) in Azure DevOps!`);
      } else {
        toast.info('No Mule applications found in your Azure DevOps repositories.');
      }
    } catch (err) {
      console.error('Azure DevOps scanning error:', err);
      toast.error('Failed to scan Azure DevOps repositories. Please check your token and permissions.');
    } finally {
      setFetchingRepos(null);
    }
  };

  // Enhanced function to update dependency versions in POM XML
  const updatePomDependencies = (pomXml: string, dependencies: MuleDependency[]): string => {
    let updatedPom = pomXml;
    
    // Update app.runtime version to latest
    const latestMuleVersion = getLatestMuleVersion();
    updatedPom = updatedPom.replace(
      /<app\.runtime>.*?<\/app\.runtime>/g,
      `<app.runtime>${latestMuleVersion}</app.runtime>`
    );
    // console.log(`Updated app.runtime to ${latestMuleVersion}`);
    
    // Remove CloudHub dependencies
    const cloudHubDepPatterns = [
      /<dependency>\s*<groupId>org\.mule\.modules<\/groupId>\s*<artifactId>mule-module-cloudhub<\/artifactId>[\s\S]*?<\/dependency>/g,
      /<dependency>\s*<groupId>org\.mule\.connectors<\/groupId>\s*<artifactId>mule-cloudhub-connector<\/artifactId>[\s\S]*?<\/dependency>/g,
      /<dependency>[\s\S]*?<artifactId>[^<]*cloudhub[^<]*<\/artifactId>[\s\S]*?<\/dependency>/g,
      /<dependency>\s*<groupId>com\.mulesoft\.cloudhub<\/groupId>[\s\S]*?<\/dependency>/g,
      /<dependency>\s*<groupId>com\.mulesoft\.modules\.cloudhub<\/groupId>[\s\S]*?<\/dependency>/g
    ];
    
    cloudHubDepPatterns.forEach(pattern => {
      const matches = updatedPom.match(pattern);
      if (matches) {
        // console.log('Found CloudHub dependencies to remove:', matches);
        updatedPom = updatedPom.replace(pattern, '');
      }
    });
    
    // Update dependencies to their latest versions
    dependencies.forEach(dep => {
      if (dep.latestVersion && dep.latestVersion !== dep.version) {
        // console.log(`Updating ${dep.artifactId} from ${dep.version} to ${dep.latestVersion}`);
        
        const dependencyRegex = new RegExp(
          `(<dependency>[\\s\\S]*?<groupId>${dep.groupId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/groupId>[\\s\\S]*?<artifactId>${dep.artifactId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/artifactId>[\\s\\S]*?<version>).*?(<\\/version>[\\s\\S]*?<\\/dependency>)`,
          'g'
        );
        
        updatedPom = updatedPom.replace(dependencyRegex, `$1${dep.latestVersion}$2`);
      }
    });
    
    // Clean up any double empty lines
    updatedPom = updatedPom.replace(/\n\s*\n\s*\n/g, '\n\n');
    
    // Add migration comment
    if (!updatedPom.includes('<!-- Updated for CloudHub 2.0 migration -->')) {
      updatedPom = updatedPom + '\n<!-- Updated for CloudHub 2.0 migration -->';
    }
    
    return updatedPom;
  };

  // Function to replace CloudHub connectors with Logger in XML files
  const replaceCloudHubConnectors = (xmlContent: string): string => {
    let updatedXml = xmlContent;
    
    console.log('Replacing CloudHub connectors with Logger connectors...');
    
    // Add Logger namespace if not present
    if (!updatedXml.includes('xmlns:logger=')) {
      const muleTag = updatedXml.match(/<mule[^>]*>/);
      if (muleTag) {
        const updatedMuleTag = muleTag[0].replace('>', ' xmlns:logger="http://www.mulesoft.org/schema/mule/logger" xsi:schemaLocation="http://www.mulesoft.org/schema/mule/logger http://www.mulesoft.org/schema/mule/logger/current/mule-logger.xsd">');
        updatedXml = updatedXml.replace(muleTag[0], updatedMuleTag);
      }
    }
    
    // Replace CloudHub connectors with Logger
    const cloudHubPatterns = [
      {
        pattern: /<cloudhub:create-notification[^>]*>[\s\S]*?<\/cloudhub:create-notification>/g,
        replacement: '<logger:log level="INFO" message="CloudHub notification replaced with logger for CloudHub 2.0 migration" />'
      },
      {
        pattern: /<cloudhub:create-notification[^>]*\/>/g,
        replacement: '<logger:log level="INFO" message="CloudHub notification replaced with logger for CloudHub 2.0 migration" />'
      },
      {
        pattern: /<cloudhub:list-notifications[^>]*>[\s\S]*?<\/cloudhub:list-notifications>/g,
        replacement: '<logger:log level="INFO" message="CloudHub list notifications replaced with logger for CloudHub 2.0 migration" />'
      },
      {
        pattern: /<cloudhub:list-notifications[^>]*\/>/g,
        replacement: '<logger:log level="INFO" message="CloudHub list notifications replaced with logger for CloudHub 2.0 migration" />'
      },
      {
        pattern: /<cloudhub:get-application[^>]*>[\s\S]*?<\/cloudhub:get-application>/g,
        replacement: '<logger:log level="INFO" message="CloudHub get application replaced with logger for CloudHub 2.0 migration" />'
      },
      {
        pattern: /<cloudhub:get-application[^>]*\/>/g,
        replacement: '<logger:log level="INFO" message="CloudHub get application replaced with logger for CloudHub 2.0 migration" />'
      },
      {
        pattern: /<cloudhub:[^>]*>[\s\S]*?<\/cloudhub:[^>]*>/g,
        replacement: '<logger:log level="INFO" message="CloudHub operation replaced with logger for CloudHub 2.0 migration" />'
      },
      {
        pattern: /<cloudhub:[^>]*\/>/g,
        replacement: '<logger:log level="INFO" message="CloudHub operation replaced with logger for CloudHub 2.0 migration" />'
      }
    ];
    
    cloudHubPatterns.forEach(({ pattern, replacement }) => {
      const matches = updatedXml.match(pattern);
      if (matches) {
        console.log('Found CloudHub connectors to replace:', matches);
        updatedXml = updatedXml.replace(pattern, replacement);
      }
    });
    
    // Remove CloudHub namespace if no more CloudHub elements exist
    if (!/<cloudhub:/.test(updatedXml)) {
      updatedXml = updatedXml.replace(/xmlns:cloudhub="[^"]*"\s*/g, '');
      updatedXml = updatedXml.replace(/http:\/\/www\.mulesoft\.org\/schema\/mule\/cloudhub[^\s]*/g, '');
    }
    
    return updatedXml;
  };

  // GitHub migration function
  const migrateGitHubApplication = async (app: MuleApplication) => {
    console.log('Starting GitHub migration for app:', app.applicationName);
    
    const repoPath = app.repository.replace('https://github.com/', '');
    const newBranch = 'mulemigration';
    const githubToken = selectedOrganization?.github_token || '';
    
    // Get base branch SHA
    const branchRes = await axios.get(
      `https://api.github.com/repos/${repoPath}/git/refs/heads/${app.branch}`,
      { headers: { Authorization: `token ${githubToken}` } }
    );
    const baseSha = branchRes.data.object.sha;
    
    // Create branch
    try {
      await axios.post(
        `https://api.github.com/repos/${repoPath}/git/refs`,
        {
          ref: `refs/heads/${newBranch}`,
          sha: baseSha
        },
        { headers: { Authorization: `token ${githubToken}` } }
      );
    } catch (e) {
      // console.log('Branch may already exist, continuing...');
      toast.success('Branch may already exist, continuing...');
    }
    
    // Update POM files
    if (app.pomPaths) {
      for (const pomPath of app.pomPaths) {
        try {
          const pomRes = await axios.get(
            `https://api.github.com/repos/${repoPath}/contents/${pomPath}?ref=${app.branch}`,
            { headers: { Authorization: `token ${githubToken}` } }
          );
          const pomSha = pomRes.data.sha;
          const pomXml = atob(pomRes.data.content.replace(/\n/g, ''));
          
          const updatedPom = updatePomDependencies(pomXml, app.dependencies);
          
          await axios.put(
            `https://api.github.com/repos/${repoPath}/contents/${pomPath}`,
            {
              message: `Mule migration: update dependencies for CloudHub 2.0 - ${pomPath}`,
              content: btoa(updatedPom),
              branch: newBranch,
              sha: pomSha
            },
            { headers: { Authorization: `token ${githubToken}` } }
          );
          // console.log('Successfully updated:', pomPath);
        } catch (error) {
          console.error(`Failed to update ${pomPath}:`, error);
        }
      }
    }
    
    // Update artifact JSON files
    if (app.artifactJsonPaths) {
      for (const ajPath of app.artifactJsonPaths) {
        try {
          const ajRes = await axios.get(
            `https://api.github.com/repos/${repoPath}/contents/${ajPath}?ref=${app.branch}`,
            { headers: { Authorization: `token ${githubToken}` } }
          );
          const ajSha = ajRes.data.sha;
          const ajJson = JSON.parse(atob(ajRes.data.content.replace(/\n/g, '')));
          
          const updatedAj = { 
            ...ajJson,
            javaSpecificationVersions: [getLatestJavaVersion()],
            minMuleVersion: getLatestMuleVersion()
          };
          
          await axios.put(
            `https://api.github.com/repos/${repoPath}/contents/${ajPath}`,
            {
              message: `Mule migration: update artifact configuration for CloudHub 2.0 - ${ajPath}`,
              content: btoa(JSON.stringify(updatedAj, null, 2)),
              branch: newBranch,
              sha: ajSha
            },
            { headers: { Authorization: `token ${githubToken}` } }
          );
          // console.log('Successfully updated:', ajPath);
        } catch (error) {
          console.error(`Failed to update ${ajPath}:`, error);
        }
      }
    }
    
    // Update project XML files
    if (app.projectXmlPaths) {
      for (const xmlPath of app.projectXmlPaths) {
        try {
          const xmlRes = await axios.get(
            `https://api.github.com/repos/${repoPath}/contents/${xmlPath}?ref=${app.branch}`,
            { headers: { Authorization: `token ${githubToken}` } }
          );
          const xmlSha = xmlRes.data.sha;
          const xmlContent = atob(xmlRes.data.content.replace(/\n/g, ''));
          
          const updatedXml = replaceCloudHubConnectors(xmlContent) + '\n<!-- Updated for CloudHub 2.0 migration -->';
          
          await axios.put(
            `https://api.github.com/repos/${repoPath}/contents/${xmlPath}`,
            {
              message: `Mule migration: update connectors for CloudHub 2.0 - ${xmlPath}`,
              content: btoa(updatedXml),
              branch: newBranch,
              sha: xmlSha
            },
            { headers: { Authorization: `token ${githubToken}` } }
          );
          // console.log('Successfully updated:', xmlPath);
        } catch (error) {
          console.error(`Failed to update ${xmlPath}:`, error);
        }
      }
    }
  };

  // Azure DevOps migration function
  const migrateAzureApplication = async (app: MuleApplication) => {
    try {
      // console.log('Starting Azure DevOps migration for app:', app.applicationName);
      
      const urlParts = app.repository.split('/');
      const organization = urlParts[3];
      const project = urlParts[4];
      const repoId = app.id;
      const azureToken = selectedOrganization?.azure_devops_token || '';
      const azureApi = createAzureDevOpsAPI(organization, azureToken);
      
      // Create migration branch
      // console.log(`Creating migration branch for ${app.name}...`);
      const branchCreated = await azureApi.createBranch(project, repoId, 'mulemigration', app.branch);
      if (!branchCreated) {
        throw new Error('Failed to create migration branch. Please check your PAT permissions.');
      }
      
      const filesToCommit = [];
      
      // Update POM files
      if (app.pomPaths) {
        // console.log(`Updating POM files for ${app.name}...`);
        for (const pomPath of app.pomPaths) {
          let pomXml = await azureApi.getFileContent(project, repoId, pomPath);
          if (pomXml && typeof pomXml === 'string') {
            const updatedPom = updatePomDependencies(pomXml, app.dependencies);
            filesToCommit.push({ path: pomPath, content: updatedPom });
          }
        }
      }
      
      // Update artifact JSON files
      if (app.artifactJsonPaths) {
        // console.log(`Updating artifact JSON files for ${app.name}...`);
        for (const ajPath of app.artifactJsonPaths) {
          let ajContent = await azureApi.getFileContent(project, repoId, ajPath);
          let ajJson: Record<string, any> = {};
          
          if (ajContent && typeof ajContent === 'string') {
            try {
              ajJson = JSON.parse(ajContent);
            } catch (e) {
              console.warn('Invalid JSON in artifact JSON, creating new:', e);
              ajJson = {};
            }
          }
          
          const updatedAj = { 
            ...ajJson,
            javaSpecificationVersions: [getLatestJavaVersion()],
            minMuleVersion: getLatestMuleVersion()
          };
          
          filesToCommit.push({ path: ajPath, content: JSON.stringify(updatedAj, null, 2) });
        }
      }
      
      // Update project XML files
      if (app.projectXmlPaths) {
        // console.log(`Updating project XML files for ${app.name}...`);
        for (const xmlPath of app.projectXmlPaths) {
          let xmlContent = await azureApi.getFileContent(project, repoId, xmlPath);
          if (xmlContent && typeof xmlContent === 'string') {
            const updatedXml = replaceCloudHubConnectors(xmlContent) + '\n<!-- Updated for CloudHub 2.0 migration -->';
            filesToCommit.push({ path: xmlPath, content: updatedXml });
          }
        }
      }
      
      // Commit all changes
      if (filesToCommit.length > 0) {
        // console.log(`Committing ${filesToCommit.length} files for ${app.name}...`);
        const committed = await azureApi.commitFiles(
          project,
          repoId,
          'mulemigration',
          filesToCommit,
          'Mule migration: update for CloudHub 2.0'
        );
        if (!committed) {
          throw new Error('Failed to commit migration changes. Please check your PAT permissions.');
        }
        // console.log(`Successfully migrated ${app.name}`);
        return true;
      } else {
        console.warn(`No files to commit for ${app.name}`);
        return false;
      }
    } catch (error) {
      console.error(`Error migrating Azure DevOps application ${app.name}:`, error);
      throw error;
    }
  };

  const handleMigrateAll = async () => {
    const selectedApps = applications.filter(app => app.selected);
    if (selectedApps.length === 0) {
      toast.error('Please select at least one application to migrate');
      return;
    }
    
    const repositoryType = selectedOrganization?.repository_type;
    
    if (!repositoryType) {
      toast.error('Repository type not configured');
      return;
    }
    
    setMigrating(true);
    
    try {
      let successCount = 0;
      let failureCount = 0;
      
      for (const app of selectedApps) {
        try {
          // console.log(`Starting migration for: ${app.applicationName}`);
          
          // Update application status to in_progress
          setApplications(prev => prev.map(a => 
            a.id === app.id 
              ? { ...a, status: 'in_progress', lastUpdated: new Date().toISOString() }
              : a
          ));
          
          if (repositoryType === 'github') {
            await migrateGitHubApplication(app);
          } else if (repositoryType === 'azure_devops') {
            await migrateAzureApplication(app);
          }
          
          // Update application status to completed
          setApplications(prev => prev.map(a => 
            a.id === app.id 
              ? { ...a, status: 'completed', lastUpdated: new Date().toISOString() }
              : a
          ));
          
          successCount++;
          // console.log(`Successfully migrated: ${app.applicationName}`);
          
        } catch (error) {
          console.error(`Failed to migrate ${app.applicationName}:`, error);
          
          // Update application status to failed
          setApplications(prev => prev.map(a => 
            a.id === app.id 
              ? { ...a, status: 'failed', lastUpdated: new Date().toISOString() }
              : a
          ));
          
          failureCount++;
        }
      }
      
      // Show final results
      if (successCount > 0 && failureCount === 0) {
        toast.success(`Successfully migrated all ${successCount} selected application(s)!`);
      } else if (successCount > 0 && failureCount > 0) {
        toast.warning(`Migration completed: ${successCount} successful, ${failureCount} failed`);
      } else {
        toast.error(`Migration failed for all ${failureCount} selected application(s)`);
      }
      
    } catch (error) {
      console.error('Migration error:', error);
      toast.error('Migration process failed. Please try again.');
    } finally {
      setMigrating(false);
    }
  };

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
        </div>
        <RepositoryList 
          applications={applications} 
          setApplications={setApplications}
          onMigrateAll={handleMigrateAll}
        />
      </div>
    );
  }

  const isGithubConnected = selectedOrganization?.github_token && reconnecting !== 'github';
  const isAzureConnected = selectedOrganization?.azure_devops_token && reconnecting !== 'azure';

  return (
    <div className="container mx-auto p-6 space-y-8">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">Source Control Integration</h1>
        <p className="text-muted-foreground">Connect your repositories to start migrating Mule applications to CloudHub 2.0</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* GitHub Card */}
        <Card className={`relative overflow-hidden transition-all duration-300 hover:scale-105 ${isGithubConnected ? 'border-green-500 bg-green-50/50' : 'border-border hover:border-primary/50'}`}>
          <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-black/5 to-black/10 rounded-full -translate-y-16 translate-x-16" />
          <div className="absolute bottom-0 left-0 w-24 h-24 bg-gradient-to-tr from-primary/5 to-primary/10 rounded-full translate-y-12 -translate-x-12" />
          
          <CardHeader className="relative">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className={`p-3 rounded-full ${isGithubConnected ? 'bg-green-100' : 'bg-muted'}`}>
                  <Github className={`h-6 w-6 ${isGithubConnected ? 'text-green-600' : 'text-muted-foreground'}`} />
                </div>
                <div>
                  <CardTitle className="text-xl">GitHub</CardTitle>
                  <CardDescription>Connect to your GitHub repositories</CardDescription>
                </div>
              </div>
              {isGithubConnected && (
                <div className="flex items-center space-x-2">
                  <div className="flex items-center space-x-2 px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Connected</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleReconnectGithub}
                    className="h-8 w-8 p-0 hover:bg-green-100"
                    title="Reconnect GitHub"
                  >
                    <Settings className="h-4 w-4 text-green-600" />
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          
          <CardContent className="relative space-y-4">
            {!isGithubConnected ? (
              <>
                <div className="space-y-3">
                  <Input
                    placeholder="GitHub Personal Access Token"
                    value={githubToken}
                    onChange={e => setGithubToken(e.target.value)}
                    type="password"
                    className="bg-background/50"
                  />
                  <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                    <Lock className="h-3 w-3" />
                    <span>Your token is encrypted and stored securely</span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between">
                  <a
                    href="https://github.com/settings/tokens"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center space-x-1 text-sm text-primary hover:text-primary/80 transition-colors"
                  >
                    <Key className="h-3 w-3" />
                    <span>Generate token</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  
                  <div className="flex space-x-2">
                    {reconnecting === 'github' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCancelReconnect}
                      >
                        Cancel
                      </Button>
                    )}
                    <Button
                      onClick={handleConnectGithub}
                      disabled={connecting === 'github' || !githubToken.trim()}
                      className="px-6"
                    >
                      {connecting === 'github' ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          Connecting...
                        </>
                      ) : (
                        <>
                          <Github className="h-4 w-4 mr-2" />
                          {reconnecting === 'github' ? 'Reconnect' : 'Connect'}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span className="text-sm font-medium text-green-700">GitHub Connected</span>
                  </div>
                  <GitBranch className="h-4 w-4 text-green-600" />
                </div>
                
                <Button
                  onClick={handleScanGithub}
                  disabled={fetchingRepos === 'github'}
                  className="w-full"
                  variant="outline"
                >
                  {fetchingRepos === 'github' ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Scanning Repositories...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Scan for Mule Applications
                    </>
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Azure DevOps Card */}
        <Card className={`relative overflow-hidden transition-all duration-300 hover:scale-105 ${isAzureConnected ? 'border-blue-500 bg-blue-50/50' : 'border-border hover:border-primary/50'}`}>
          <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-blue-500/5 to-blue-500/10 rounded-full -translate-y-16 translate-x-16" />
          <div className="absolute bottom-0 left-0 w-24 h-24 bg-gradient-to-tr from-primary/5 to-primary/10 rounded-full translate-y-12 -translate-x-12" />
          
          <CardHeader className="relative">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className={`p-3 rounded-full ${isAzureConnected ? 'bg-blue-100' : 'bg-muted'}`}>
                  <Cloud className={`h-6 w-6 ${isAzureConnected ? 'text-blue-600' : 'text-muted-foreground'}`} />
                </div>
                <div>
                  <CardTitle className="text-xl">Azure DevOps</CardTitle>
                  <CardDescription>Connect to your Azure DevOps repositories</CardDescription>
                </div>
              </div>
              {isAzureConnected && (
                <div className="flex items-center space-x-2">
                  <div className="flex items-center space-x-2 px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Connected</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleReconnectAzure}
                    className="h-8 w-8 p-0 hover:bg-blue-100"
                    title="Reconnect Azure DevOps"
                  >
                    <Settings className="h-4 w-4 text-blue-600" />
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          
          <CardContent className="relative space-y-4">
            {!isAzureConnected ? (
              <>
                <div className="space-y-3">
                  <Input
                    placeholder="Azure DevOps Organization URL"
                    value={azureOrgUrl}
                    onChange={e => setAzureOrgUrl(e.target.value)}
                    type="text"
                    className="bg-background/50"
                  />
                  <Input
                    placeholder="Azure DevOps Personal Access Token"
                    value={azureToken}
                    onChange={e => setAzureToken(e.target.value)}
                    type="password"
                    className="bg-background/50"
                  />
                  <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                    <Lock className="h-3 w-3" />
                    <span>Your credentials are encrypted and stored securely</span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between">
                  <a
                    href="https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center space-x-1 text-sm text-primary hover:text-primary/80 transition-colors"
                  >
                    <Key className="h-3 w-3" />
                    <span>Generate token</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  
                  <div className="flex space-x-2">
                    {reconnecting === 'azure' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCancelReconnect}
                      >
                        Cancel
                      </Button>
                    )}
                    <Button
                      onClick={handleConnectAzure}
                      disabled={connecting === 'azure' || !azureToken.trim() || !azureOrgUrl.trim()}
                      className="px-6"
                    >
                      {connecting === 'azure' ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          Connecting...
                        </>
                      ) : (
                        <>
                          <Cloud className="h-4 w-4 mr-2" />
                          {reconnecting === 'azure' ? 'Reconnect' : 'Connect'}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="h-4 w-4 text-blue-600" />
                    <span className="text-sm font-medium text-blue-700">Azure DevOps Connected</span>
                  </div>
                  <GitBranch className="h-4 w-4 text-blue-600" />
                </div>
                
                <Button
                  onClick={handleScanAzure}
                  disabled={fetchingRepos === 'azure'}
                  className="w-full"
                  variant="outline"
                >
                  {fetchingRepos === 'azure' ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Scanning Repositories...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Scan for Mule Applications
                    </>
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {!isGithubConnected && !isAzureConnected && (
        <div className="text-center mt-8 p-6 bg-muted/30 rounded-lg">
          <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <h3 className="text-lg font-semibold mb-2">Ready to Get Started?</h3>
          <p className="text-muted-foreground">
            Connect your source control to begin discovering and migrating your Mule applications to CloudHub 2.0
          </p>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
