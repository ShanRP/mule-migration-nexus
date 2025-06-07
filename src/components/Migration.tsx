import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useOrganizations } from '@/providers/OrganizationProvider';
import RepositoryList from './RepositoryList';
import { createAzureDevOpsAPI } from '@/utils/azureDevopsApi';
import { getLatestMuleVersion, getLatestJavaVersion, analyzeMuleProject } from '@/utils/muleDetection';
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
  artifactId?: string;
  version?: string;
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
  connectors: MuleConnector[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  lastUpdated: string;
  selected?: boolean;
  applicationName: string;
  pomPaths?: string[];
  artifactJsonPaths?: string[];
  projectXmlPaths?: string[];
  artifactJson?: any;
}

interface MigrationRules {
  javaVersion: string;
  muleVersion: string;
  minMuleVersion: string;
  connectorReplacements: { from: string; to: string; }[];
  dependencyVersions: { artifactId: string; version: string; }[];
}

interface MigrationSelections {
  muleRuntime: boolean;
  javaVersion: boolean;
  minMuleVersion: boolean;
  dependencies: string[];
  connectors: string[];
}

const Migration: React.FC = () => {
  const { selectedOrganization } = useOrganizations();
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [applications, setApplications] = useState<MuleApplication[]>([]);
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);

  // Reset state when organization changes
  useEffect(() => {
    setRepositories([]);
    setApplications([]);
  }, [selectedOrganization?.id]);

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
          
          const { applicationName, muleRuntime, muleVersion, javaVersion, dependencies } = await extractMuleInfo(pomXml);
          
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
        console.error(`Error processing repository ${repo.name}:`, error);
      }
    }
    return muleApps;
  };

  // Updated Azure DevOps scanning using the new API
  const scanAzureRepositories = async (token: string, organization: string) => {
    try {
      // console.log('Scanning Azure DevOps repositories using new API...');
      
      const azureApi = createAzureDevOpsAPI(organization, token);
      
      const projects = await azureApi.getProjects();
      // console.log(`Found ${projects.length} projects`);
      
      const allRepos = [];
      for (const project of projects) {
        const repos = await azureApi.getRepositories(project.name);
        for (const repo of repos) {
          allRepos.push({
            ...repo,
            project: project.name,
            organization
          });
        }
      }
      
      console.log(`Found ${allRepos.length} repositories to scan`);
      const muleApps: any[] = [];
      
      for (const repo of allRepos) {
        try {
          // console.log(`Scanning repo ${repo.name}...`);
          const allFiles = await azureApi.listFiles(repo.project, repo.id);
          const pomFiles = allFiles.filter(f => f.toLowerCase().endsWith('pom.xml'));
          const artifactJsonFiles = allFiles.filter(f => f.endsWith('mule-artifact.json'));
          const projectXmlFiles = allFiles.filter(f => f.startsWith('src/main/') && f.endsWith('.xml'));
          // console.log(`Found ${pomFiles.length} pom.xml files in ${repo.name}`);
          
          for (const pomPath of pomFiles) {
            // console.log(`Processing pom.xml at ${pomPath}...`);
            const pomXml = await azureApi.getFileContent(repo.project, repo.id, pomPath);
            if (!pomXml || !isMuleApplication(pomXml)) {
              // console.log(`Skipping non-Mule pom.xml at ${pomPath}`);
              continue;
            }
            
            let artifactJson = null;
            let artifactJsonPath = null;
            for (const ajPath of artifactJsonFiles) {
              try {
                // console.log(`Fetching mule-artifact.json: ${ajPath}`);
                const artifactContent = await azureApi.getFileContent(repo.project, repo.id, ajPath);
                if (artifactContent) {
                  try {
                    artifactJson = JSON.parse(artifactContent);
                    artifactJsonPath = ajPath;
                    // console.log('Successfully parsed artifact.json:', artifactJson);
                    break;
                  } catch (e) {
                    console.error('Error parsing artifact.json:', e);
                  }
                }
              } catch (error) {
                console.error(`Error fetching artifact.json at ${ajPath}:`, error);
              }
            }
            
            const { applicationName, muleRuntime, muleVersion, javaVersion, dependencies } = await extractMuleInfo(pomXml, artifactJson);
            
            let connectors: any[] = [];
            const pomDir = pomPath.substring(0, pomPath.lastIndexOf('/'));
            const configPaths = [
              `${pomDir}/src/main/mule/mule-configuration.xml`,
              `${pomDir}/src/main/app/mule-configuration.xml`,
              `${pomDir}/src/main/resources/mule-configuration.xml`,
              `${pomDir}/mule-configuration.xml`
            ];
            
            for (const configPath of configPaths) {
              const configXml = await azureApi.getFileContent(repo.project, repo.id, configPath);
              if (configXml) {
                connectors = analyzeMuleConfiguration(configXml);
                break;
              }
            }
            
            if (connectors.length === 0) {
              const muleDirPath = `${pomDir}/src/main/mule`;
              const muleFiles = allFiles.filter(f => f.startsWith(muleDirPath) && f.toLowerCase().endsWith('.xml'));
              for (const xmlFile of muleFiles) {
                const xmlContent = await azureApi.getFileContent(repo.project, repo.id, xmlFile);
                if (xmlContent) {
                  connectors = [...connectors, ...analyzeMuleConfiguration(xmlContent)];
                }
              }
            }
            
            // console.log(`Found Mule application: ${applicationName} in ${repo.name}`);
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
              projectXmlPaths: projectXmlPaths,
            });
          }
        } catch (error) {
          console.error(`Error processing repository ${repo.name}:`, error);
        }
      }
      return muleApps;
    } catch (error) {
      console.error('Azure DevOps scanning failed:', error);
      throw error;
    }
  };

  // Updated Azure DevOps migration using new API
  const migrateAzureApplication = async (app: MuleApplication, rules: MigrationRules) => {
    try {
      // console.log(`Migrating app: ${app.applicationName} with paths:`, {
      //   pomPaths: app.pomPaths,
      //   artifactJsonPaths: app.artifactJsonPaths,
      //   projectXmlPaths: app.projectXmlPaths
      // });

      // Extract Azure DevOps details from repository URL
      const urlParts = app.repository.split('/');
      const organization = urlParts[3];
      const project = urlParts[4];
      let repoName = urlParts[6];
      
      // Handle .git extension in repo name
      if (repoName && repoName.endsWith('.git')) {
        repoName = repoName.replace('.git', '');
      }
      
      // console.log('Starting Azure DevOps migration for app:', app.applicationName);
      // console.log('Azure DevOps details:', { organization, project, repoName });
      
      const azureApi = createAzureDevOpsAPI(organization, azureToken);
      
      // Get repositories to find the correct repo ID
      const repos = await azureApi.getRepositories(project);
      const targetRepo = repos.find(r => r.name === repoName || r.name === `${repoName}.git`);
      
      if (!targetRepo) {
        throw new Error(`Repository ${repoName} not found in project ${project}`);
      }
      
      const repositoryId = targetRepo.id;
      const defaultBranch = targetRepo.defaultBranch || 'main';
      
      // console.log('Default branch:', defaultBranch);
      
      // Create migration branch
      // console.log(`Creating migration branch for ${app.applicationName}...`);
      const branchCreated = await azureApi.createBranch(project, repositoryId, 'mulemigration', defaultBranch);
      if (!branchCreated) {
        console.warn('Failed to create migration branch, but continuing...');
      }
      
      // Prepare files for commit
      const filesToCommit = [];
      
      // Update POM files
      // console.log(`Processing POM files for Azure DevOps:`, app.pomPaths);
      for (const pomPath of app.pomPaths) {
        try {
          // console.log(`Fetching pom.xml: ${pomPath}`);
          const pomContent = await azureApi.getFileContent(project, repositoryId, pomPath);
          if (pomContent && typeof pomContent === 'string') {
            const updatedPom = updatePomXmlWithLatestVersions(pomContent, app.dependencies, rules);
            filesToCommit.push({ path: pomPath, content: updatedPom });
          } else {
            console.warn(`Could not fetch or invalid POM file: ${pomPath}`);
          }
        } catch (error) {
          console.error(`Failed to process ${pomPath}:`, error);
        }
      }
      
      // Update artifact JSON files
      // console.log(`Processing artifact JSON files for Azure DevOps:`, app.artifactJsonPaths);
      for (const ajPath of app.artifactJsonPaths) {
        try {
          // console.log(`Fetching mule-artifact.json: ${ajPath}`);
          const ajContent = await azureApi.getFileContent(project, repositoryId, ajPath);
          if (ajContent) {
            let ajJson;
            if (typeof ajContent === 'string') {
              ajJson = JSON.parse(ajContent);
            } else if (typeof ajContent === 'object') {
              ajJson = ajContent;
            } else {
              console.warn(`Invalid artifact JSON content type for ${ajPath}:`, typeof ajContent);
              continue;
            }
            
            const updatedAj = updateArtifactJsonWithLatestJava(ajJson, rules);
            filesToCommit.push({ path: ajPath, content: JSON.stringify(updatedAj, null, 2) });
          } else {
            console.warn(`Could not fetch artifact JSON file: ${ajPath}`);
          }
        } catch (error) {
          console.error(`Failed to process ${ajPath}:`, error);
        }
      }
      
      // Update project XML files
      // console.log(`Processing project XML files for Azure DevOps:`, app.projectXmlPaths);
      for (const xmlPath of app.projectXmlPaths) {
        try {
          // console.log(`Fetching project XML: ${xmlPath}`);
          const xmlContent = await azureApi.getFileContent(project, repositoryId, xmlPath);
          if (xmlContent && typeof xmlContent === 'string') {
            const updatedXml = updateProjectXml(xmlContent, rules);
            filesToCommit.push({ path: xmlPath, content: updatedXml });
          } else {
            console.warn(`Could not fetch or invalid XML file: ${xmlPath}`);
          }
        } catch (error) {
          console.error(`Failed to process ${xmlPath}:`, error);
        }
      }
      
      // Commit all changes
      if (filesToCommit.length > 0) {
        // console.log(`Committing ${filesToCommit.length} files for ${app.applicationName}...`);
        const committed = await azureApi.commitFiles(
          project, 
          repositoryId, 
          'mulemigration', 
          filesToCommit, 
          'Mule migration: update dependencies and configuration for CloudHub 2.0'
        );
        
        if (!committed) {
          throw new Error('Failed to commit migration changes. Please check your PAT permissions.');
        }
        
        // console.log(`Successfully migrated ${app.applicationName}`);
        return true;
      } else {
        console.log(`No changes to push to Azure DevOps`);
        return false;
      }
    } catch (error) {
      console.error(`Error migrating Azure DevOps application ${app.applicationName}:`, error);
      if (error instanceof Error) {
        toast.error(`Failed to migrate ${app.applicationName}: ${error.message}`);
      } else {
        toast.error(`Failed to migrate ${app.applicationName}. Please check your connection and try again.`);
      }
      throw error;
    } finally {
      console.log(`Azure DevOps migration completed for app: ${app.applicationName}`);
    }
  };

  // Fetch all repos and scan for Mule apps
  const discoverRepositories = async () => {
    if (!selectedOrganization?.repository_type) {
      toast.error('Please connect to a source control provider in the Dashboard.');
      return;
    }

    // Validate repository type matches the available token
    if (selectedOrganization?.repository_type === 'github' && !selectedOrganization?.github_token) {
      toast.error('GitHub token not found. Please connect GitHub in the Dashboard.');
      return;
    }
    if (selectedOrganization?.repository_type === 'azure_devops' && !selectedOrganization?.azure_devops_token) {
      toast.error('Azure DevOps token not found. Please connect Azure DevOps in the Dashboard.');
      return;
    }

    setDiscovering(true);
    setError(null);
    setRepositories([]);

    try {
      let muleApps: any[] = [];
      
      if (selectedOrganization?.repository_type === 'github' && selectedOrganization?.github_token) {
        // console.log('Scanning GitHub repositories...');
        const orgName = selectedOrganization?.github_url?.split('/').pop() || '';
        muleApps = await scanGitHubRepositories(selectedOrganization?.github_token, orgName);
      } else if (selectedOrganization?.repository_type === 'azure_devops' && selectedOrganization?.azure_devops_token) {
        // console.log('Scanning Azure DevOps repositories...');
        const organization = extractAzureOrganization(selectedOrganization?.azure_devops_url || '');
        if (!organization) {
          toast.error('Please provide a valid Azure DevOps organization URL');
          return;
        }
        muleApps = await scanAzureRepositories(selectedOrganization?.azure_devops_token, organization);
      }

      setRepositories(muleApps);
      if (muleApps.length > 0) {
        toast.success(`Found ${muleApps.length} Mule application(s)!`);
      } else {
        toast.info('No Mule applications found in your repositories.');
      }
    } catch (err) {
      setError('Failed to fetch repositories');
      toast.error('Failed to fetch repositories. Please check your token and permissions.');
    } finally {
      setDiscovering(false);
    }
  };

  // Select/deselect apps
  const toggleApplicationSelection = (appId: string) => {
    setApplications(prev => prev.map(app => 
      app.id === appId ? { ...app, selected: !app.selected } : app
    ));
  };

  const normalizePath = (path: string) => path.replace(/^\/+/, '');

  const handleMigrateAll = async (rules: MigrationRules) => {
    console.log('=== MIGRATE ALL: APPLYING RULES WITH ABSOLUTE PRIORITY ===');
    console.log('Migration Rules (ABSOLUTE PRIORITY):', rules);
    
    const selectedApps = applications.filter(app => app.selected);
    if (selectedApps.length === 0) {
      toast.error('Please select at least one application to migrate');
      return;
    }

    setLoading(true);
    try {
      const repositoryType = selectedOrganization?.repository_type;
      const githubToken = selectedOrganization?.github_token || '';
      const azureToken = selectedOrganization?.azure_devops_token || '';

      for (const app of selectedApps) {
        try {
          // Update application status
          setApplications(prev => prev.map(a => 
            a.id === app.id 
              ? { ...a, status: 'in_progress' as const, lastUpdated: new Date().toISOString() }
              : a
          ));

          // Create default selections (all items selected)
          const selections: MigrationSelections = {
            muleRuntime: true,
            javaVersion: true,
            minMuleVersion: true,
            dependencies: app.dependencies.map(dep => dep.artifactId),
            connectors: app.connectors.map(conn => conn.name)
          };

          if (repositoryType === 'github') {
            await migrateGitHubApplication(app, selections, rules, githubToken);
          } else if (repositoryType === 'azure_devops') {
            await migrateAzureApplication(app, selections, rules, azureToken);
          }

          // Update application status to completed
          setApplications(prev => prev.map(a => 
            a.id === app.id 
              ? { ...a, status: 'completed' as const, lastUpdated: new Date().toISOString() }
              : a
          ));

          toast.success(`Migration completed for ${app.applicationName} with RULES PRIORITY!`);
        } catch (error) {
          console.error(`Error migrating ${app.applicationName}:`, error);
          setApplications(prev => prev.map(a => 
            a.id === app.id 
              ? { ...a, status: 'failed' as const, lastUpdated: new Date().toISOString() }
              : a
          ));
          toast.error(`Migration failed for ${app.applicationName}`);
        }
      }

      toast.success(`Bulk migration completed with RULES PRIORITY for ${selectedApps.length} applications!`);
    } catch (error) {
      console.error('Bulk migration error:', error);
      toast.error('Bulk migration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Enhanced GitHub migration function with RULES PRIORITY
  const migrateGitHubApplication = async (app: MuleApplication, selections: MigrationSelections, rules: MigrationRules, githubToken: string) => {
    console.log('=== GITHUB MIGRATION (MIGRATE ALL): APPLYING RULES WITH ABSOLUTE PRIORITY ===');
    console.log('Application:', app.applicationName);
    console.log('Migration Rules (ABSOLUTE PRIORITY):', rules);
    
    const repoPath = app.repository.replace('https://github.com/', '');
    const newBranch = 'mulemigration';
    
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
      console.log('Branch may already exist, continuing...');
    }
    
    // Update POM files with RULES PRIORITY
    if ((selections.muleRuntime || selections.dependencies.length > 0) && app.pomPaths) {
      for (const pomPath of app.pomPaths) {
        try {
          const pomRes = await axios.get(
            `https://api.github.com/repos/${repoPath}/contents/${pomPath}?ref=${app.branch}`,
            { headers: { Authorization: `token ${githubToken}` } }
          );
          const pomSha = pomRes.data.sha;
          const pomXml = atob(pomRes.data.content.replace(/\n/g, ''));
          
          const updatedPom = updatePomDependencies(pomXml, app.dependencies, selections, rules);
          
          await axios.put(
            `https://api.github.com/repos/${repoPath}/contents/${pomPath}`,
            {
              message: `Mule migration (MIGRATE ALL): update with RULES PRIORITY - ${pomPath}`,
              content: btoa(updatedPom),
              branch: newBranch,
              sha: pomSha
            },
            { headers: { Authorization: `token ${githubToken}` } }
          );
        } catch (error) {
          console.error(`Failed to update ${pomPath}:`, error);
        }
      }
    }
    
    // Update artifact JSON files with rules-based versions
    if ((selections.javaVersion || selections.minMuleVersion) && app.artifactJsonPaths) {
      for (const ajPath of app.artifactJsonPaths) {
        try {
          const ajRes = await axios.get(
            `https://api.github.com/repos/${repoPath}/contents/${ajPath}?ref=${app.branch}`,
            { headers: { Authorization: `token ${githubToken}` } }
          );
          const ajSha = ajRes.data.sha;
          const ajJson = JSON.parse(atob(ajRes.data.content.replace(/\n/g, '')));
          
          const updatedAj = { ...ajJson };
          
          if (selections.javaVersion) {
            const ruleBasedJavaVersion = rules.javaVersion;
            console.log(`ABSOLUTE PRIORITY (MIGRATE ALL): Setting Java version to ${ruleBasedJavaVersion} (from rules)`);
            updatedAj.javaSpecificationVersions = [ruleBasedJavaVersion];
          }
          
          if (selections.minMuleVersion) {
            const ruleBasedMinMuleVersion = rules.minMuleVersion;
            console.log(`ABSOLUTE PRIORITY (MIGRATE ALL): Setting min Mule version to ${ruleBasedMinMuleVersion} (from rules)`);
            updatedAj.minMuleVersion = ruleBasedMinMuleVersion;
          }
          
          await axios.put(
            `https://api.github.com/repos/${repoPath}/contents/${ajPath}`,
            {
              message: `Mule migration (MIGRATE ALL): update artifact with RULES PRIORITY - ${ajPath}`,
              content: btoa(JSON.stringify(updatedAj, null, 2)),
              branch: newBranch,
              sha: ajSha
            },
            { headers: { Authorization: `token ${githubToken}` } }
          );
        } catch (error) {
          console.error(`Failed to update ${ajPath}:`, error);
        }
      }
    }
    
    // Update project XML files if connectors are selected - RULES PRIORITY
    if (selections.connectors.length > 0 && app.projectXmlPaths) {
      for (const xmlPath of app.projectXmlPaths) {
        try {
          const xmlRes = await axios.get(
            `https://api.github.com/repos/${repoPath}/contents/${xmlPath}?ref=${app.branch}`,
            { headers: { Authorization: `token ${githubToken}` } }
          );
          const xmlSha = xmlRes.data.sha;
          const xmlContent = atob(xmlRes.data.content.replace(/\n/g, ''));
          
          const updatedXml = replaceCloudHubConnectors(xmlContent, selections, rules) + '\n<!-- Updated for CloudHub 2.0 migration (MIGRATE ALL) with RULES PRIORITY -->';
          
          await axios.put(
            `https://api.github.com/repos/${repoPath}/contents/${xmlPath}`,
            {
              message: `Mule migration (MIGRATE ALL): update connectors with RULES PRIORITY - ${xmlPath}`,
              content: btoa(updatedXml),
              branch: newBranch,
              sha: xmlSha
            },
            { headers: { Authorization: `token ${githubToken}` } }
          );
        } catch (error) {
          console.error(`Failed to update ${xmlPath}:`, error);
        }
      }
    }
  };

  // Enhanced Azure DevOps migration function with RULES PRIORITY
  const migrateAzureApplication = async (app: MuleApplication, selections: MigrationSelections, rules: MigrationRules, azureToken: string) => {
    try {
      console.log('=== AZURE DEVOPS MIGRATION (MIGRATE ALL): APPLYING RULES WITH ABSOLUTE PRIORITY ===');
      console.log('Application:', app.applicationName);
      console.log('Migration Rules (ABSOLUTE PRIORITY):', JSON.stringify(rules, null, 2));
      
      const urlParts = app.repository.split('/');
      const organization = urlParts[3];
      const project = urlParts[4];
      const repoId = app.id;
      const azureApi = createAzureDevOpsAPI(organization, azureToken);
      
      // Create migration branch
      const branchCreated = await azureApi.createBranch(project, repoId, 'mulemigration', app.branch);
      if (!branchCreated) {
        throw new Error('Failed to create migration branch. Please check your PAT permissions.');
      }
      
      const filesToCommit = [];
      
      // Update POM files with RULES PRIORITY
      if ((selections.muleRuntime || selections.dependencies.length > 0) && app.pomPaths) {
        for (const pomPath of app.pomPaths) {
          let pomXml = await azureApi.getFileContent(project, repoId, pomPath);
          if (pomXml && typeof pomXml === 'string') {
            const updatedPom = updatePomDependencies(pomXml, app.dependencies, selections, rules);
            filesToCommit.push({ path: pomPath, content: updatedPom });
          }
        }
      }
      
      // Update artifact JSON files with rules-based versions
      if ((selections.javaVersion || selections.minMuleVersion) && app.artifactJsonPaths) {
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
          
          const updatedAj = { ...ajJson };
          
          if (selections.javaVersion) {
            const ruleBasedJavaVersion = rules.javaVersion;
            console.log(`ABSOLUTE PRIORITY (MIGRATE ALL): Setting Java version to ${ruleBasedJavaVersion} (from rules)`);
            updatedAj.javaSpecificationVersions = [ruleBasedJavaVersion];
          }
          
          if (selections.minMuleVersion) {
            const ruleBasedMinMuleVersion = rules.minMuleVersion;
            console.log(`ABSOLUTE PRIORITY (MIGRATE ALL): Setting min Mule version to ${ruleBasedMinMuleVersion} (from rules)`);
            updatedAj.minMuleVersion = ruleBasedMinMuleVersion;
          }
          
          filesToCommit.push({ path: ajPath, content: JSON.stringify(updatedAj, null, 2) });
        }
      }
      
      // Update project XML files if connectors are selected - RULES PRIORITY
      if (selections.connectors.length > 0 && app.projectXmlPaths) {
        for (const xmlPath of app.projectXmlPaths) {
          let xmlContent = await azureApi.getFileContent(project, repoId, xmlPath);
          if (xmlContent && typeof xmlContent === 'string') {
            const updatedXml = replaceCloudHubConnectors(xmlContent, selections, rules) + '\n<!-- Updated for CloudHub 2.0 migration (MIGRATE ALL) with RULES PRIORITY -->';
            filesToCommit.push({ path: xmlPath, content: updatedXml });
          }
        }
      }
      
      // Commit all changes with rules data
      if (filesToCommit.length > 0) {
        console.log('=== CRITICAL (MIGRATE ALL): SENDING MIGRATION RULES TO AZURE DEVOPS EDGE FUNCTION ===');
        console.log('Migration Rules being sent:', JSON.stringify(rules, null, 2));
        
        const committed = await azureApi.commitFiles(
          project,
          repoId,
          'mulemigration',
          filesToCommit,
          'Mule migration (MIGRATE ALL): update with RULES PRIORITY',
          rules
        );
        if (!committed) {
          throw new Error('Failed to commit migration changes. Please check your PAT permissions.');
        }
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

  // Enhanced function to update dependency versions in POM XML with RULES PRIORITY
  const updatePomDependencies = (pomXml: string, dependencies: MuleDependency[], selections: MigrationSelections, rules: MigrationRules): string => {
    let updatedPom = pomXml;
    
    console.log('=== POM UPDATE (MIGRATE ALL): MIGRATION RULES HAVE ABSOLUTE PRIORITY ===');
    console.log('Active Migration Rules:', rules);
    
    // Update app.runtime version if selected - RULES FIRST
    if (selections.muleRuntime) {
      const ruleBasedMuleVersion = rules.muleVersion;
      console.log(`RULES PRIORITY (MIGRATE ALL): Setting app.runtime to ${ruleBasedMuleVersion}`);
      updatedPom = updatedPom.replace(
        /<app\.runtime>.*?<\/app\.runtime>/g,
        `<app.runtime>${ruleBasedMuleVersion}</app.runtime>`
      );
    }
    
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
        updatedPom = updatedPom.replace(pattern, '');
      }
    });
    
    // Update selected dependencies - RULES TAKE ABSOLUTE PRIORITY
    dependencies.forEach(dep => {
      if (selections.dependencies.includes(dep.artifactId)) {
        // PRIORITY 1: Check migration rules first
        const ruleBasedVersion = getRuleBasedDependencyVersion(dep.artifactId, dep.latestVersion, rules);
        
        if (ruleBasedVersion && ruleBasedVersion !== dep.version) {
          console.log(`ABSOLUTE PRIORITY UPDATE (MIGRATE ALL): ${dep.artifactId} from ${dep.version} to ${ruleBasedVersion} (Rules Priority)`);
          
          const dependencyRegex = new RegExp(
            `(<dependency>[\\s\\S]*?<groupId>${dep.groupId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/groupId>[\\s\\S]*?<artifactId>${dep.artifactId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/artifactId>[\\s\\S]*?<version>).*?(<\\/version>[\\s\\S]*?<\\/dependency>)`,
            'g'
          );
          
          updatedPom = updatedPom.replace(dependencyRegex, `$1${ruleBasedVersion}$2`);
        }
      }
    });
    
    // Clean up and add migration comment
    updatedPom = updatedPom.replace(/\n\s*\n\s*\n/g, '\n\n');
    
    if (!updatedPom.includes('<!-- Updated for CloudHub 2.0 migration (MIGRATE ALL) with RULES PRIORITY -->')) {
      updatedPom = updatedPom + '\n<!-- Updated for CloudHub 2.0 migration (MIGRATE ALL) with RULES PRIORITY -->';
    }
    
    return updatedPom;
  };

  // Enhanced function to replace connectors with RULES PRIORITY
  const replaceCloudHubConnectors = (xmlContent: string, selections: MigrationSelections, rules: MigrationRules): string => {
    let updatedXml = xmlContent;
    
    console.log('=== CONNECTOR REPLACEMENT (MIGRATE ALL): MIGRATION RULES HAVE ABSOLUTE PRIORITY ===');
    console.log('Active Migration Rules:', rules);
    
    // Only process selected connectors
    const selectedCloudHubConnectors = selections.connectors.filter(name => 
      name.toLowerCase().includes('cloudhub')
    );
    
    if (selectedCloudHubConnectors.length === 0) {
      return xmlContent;
    }
    
    // PRIORITY 1: Get replacement connector from migration rules
    const ruleBasedReplacement = getRuleBasedConnectorReplacement('cloudhub', rules);
    console.log(`ABSOLUTE PRIORITY (MIGRATE ALL): Using connector replacement: ${ruleBasedReplacement} (from migration rules)`);
    
    // Add replacement namespace if not present
    if (ruleBasedReplacement === 'logger' && !updatedXml.includes('xmlns:logger=')) {
      const muleTag = updatedXml.match(/<mule[^>]*>/);
      if (muleTag) {
        const updatedMuleTag = muleTag[0].replace('>', ` xmlns:logger="http://www.mulesoft.org/schema/mule/logger" xsi:schemaLocation="http://www.mulesoft.org/schema/mule/logger http://www.mulesoft.org/schema/mule/logger/current/mule-logger.xsd">`);
        updatedXml = updatedXml.replace(muleTag[0], updatedMuleTag);
      }
    }
    
    // Replace CloudHub connectors with rule-based replacement
    const cloudHubPatterns = [
      {
        pattern: /<cloudhub:create-notification[^>]*>[\s\S]*?<\/cloudhub:create-notification>/g,
        replacement: `<${ruleBasedReplacement}:log level="INFO" message="CloudHub notification replaced with ${ruleBasedReplacement} (MIGRATE ALL - RULES PRIORITY)" />`
      },
      {
        pattern: /<cloudhub:create-notification[^>]*\/>/g,
        replacement: `<${ruleBasedReplacement}:log level="INFO" message="CloudHub notification replaced with ${ruleBasedReplacement} (MIGRATE ALL - RULES PRIORITY)" />`
      }
    ];
    
    cloudHubPatterns.forEach(({ pattern, replacement }) => {
      const matches = updatedXml.match(pattern);
      if (matches) {
        console.log(`ABSOLUTE PRIORITY (MIGRATE ALL): Replacing CloudHub connectors with ${ruleBasedReplacement}:`, matches);
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

  // Helper function to get rule-based dependency version
  const getRuleBasedDependencyVersion = (artifactId: string, defaultVersion: string, rules: MigrationRules) => {
    const customRule = rules.dependencyVersions.find(dep => dep.artifactId === artifactId);
    const version = customRule?.version || defaultVersion;
    console.log(`Dependency ${artifactId} Priority Check (MIGRATE ALL) - Rules: ${customRule?.version}, Default: ${defaultVersion}, Using: ${version}`);
    return version;
  };

  // Helper function to get rule-based connector replacement
  const getRuleBasedConnectorReplacement = (connectorName: string, rules: MigrationRules) => {
    const customReplacement = rules.connectorReplacements.find(rep => 
      connectorName.toLowerCase().includes(rep.from.toLowerCase())
    );
    const replacement = customReplacement?.to || 'logger';
    console.log(`Connector ${connectorName} Priority Check (MIGRATE ALL) - Rules: ${customReplacement?.to}, Using: ${replacement}`);
    return replacement;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>CloudHub 2.0 Migration</span>
            <div className="flex items-center space-x-2">
              <Button 
                onClick={discoverRepositories} 
                disabled={loading || discovering}
                variant="outline"
              >
                {discovering ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Discovering...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Discover Applications
                  </>
                )}
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {repositories.length > 0 && (
            <div className="mb-4">
              <h3 className="text-lg font-semibold mb-2">Discovered Repositories</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {repositories.map((repo) => (
                  <Card key={repo.id} className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-medium">{repo.name}</h4>
                        <p className="text-sm text-gray-600">{repo.language}</p>
                      </div>
                      <Badge variant={repo.isMuleProject ? 'default' : 'secondary'}>
                        {repo.isMuleProject ? 'Mule' : 'Other'}
                      </Badge>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
          
          {applications.length > 0 && (
            <RepositoryList 
              applications={applications} 
              setApplications={setApplications}
              onMigrateAll={handleMigrateAll}
            />
          )}
          
          {!loading && !discovering && repositories.length === 0 && (
            <div className="text-center py-8">
              <AlertTriangle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No repositories discovered yet. Click "Discover Applications" to start.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Migration;
