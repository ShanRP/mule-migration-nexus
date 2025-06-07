import React, { useState, useEffect } from 'react';
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
import { createAzureDevOpsAPI } from '@/utils/azureDevopsApi';

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

const Migration = () => {
  const { selectedOrganization, updateOrganization } = useOrganizations();
  const [applications, setApplications] = useState<MuleApplication[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchingRepos, setFetchingRepos] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [githubToken, setGithubToken] = useState('');
  const [azureToken, setAzureToken] = useState('');
  const [azureOrgUrl, setAzureOrgUrl] = useState('');

  const repositoryType = selectedOrganization?.repository_type;

  // Reset state when organization changes
  useEffect(() => {
    setApplications([]);
    setError(null);
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
              projectXmlPaths: projectXmlFiles,
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
  const handleFetchRepositories = async () => {
    if (!repositoryType || (!githubToken && !azureToken)) {
      toast.error('Please connect to a source control provider in the Dashboard.');
      return;
    }

    // Validate repository type matches the available token
    if (repositoryType === 'github' && !githubToken) {
      toast.error('GitHub token not found. Please connect GitHub in the Dashboard.');
      return;
    }
    if (repositoryType === 'azure_devops' && !azureToken) {
      toast.error('Azure DevOps token not found. Please connect Azure DevOps in the Dashboard.');
      return;
    }

    setFetchingRepos(true);
    setError(null);
    setApplications([]);

    try {
      let muleApps: any[] = [];
      
      if (repositoryType === 'github' && githubToken) {
        // console.log('Scanning GitHub repositories...');
        const orgName = selectedOrganization?.github_url?.split('/').pop() || '';
        muleApps = await scanGitHubRepositories(githubToken, orgName);
      } else if (repositoryType === 'azure_devops' && azureToken) {
        // console.log('Scanning Azure DevOps repositories...');
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

  const normalizePath = (path: string) => path.replace(/^\/+/, '');

  const handleMigrateSelected = async (rules: MigrationRules) => {
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

          // 3. Update files with rules priority
          const filesToCommit = [];

          // Update POM files
          if (app.pomPaths) {
            for (const pomPath of app.pomPaths) {
              const pomContent = await fetchGitHubFileContent(repoPath, pomPath, githubToken);
              if (pomContent) {
                const updatedPom = updatePomXmlWithLatestVersions(pomContent, app.dependencies, rules);
                filesToCommit.push({ path: pomPath, content: updatedPom });
              }
            }
          }

          // Update artifact JSON files
          if (app.artifactJsonPaths) {
            for (const ajPath of app.artifactJsonPaths) {
              const ajContent = await fetchGitHubFileContent(repoPath, ajPath, githubToken);
              if (ajContent) {
                const updatedAj = updateArtifactJsonWithLatestJava(JSON.parse(ajContent), rules);
                filesToCommit.push({ path: ajPath, content: JSON.stringify(updatedAj, null, 2) });
              }
            }
          }

          // Update project XML files
          if (app.projectXmlPaths) {
            for (const xmlPath of app.projectXmlPaths) {
              const xmlContent = await fetchGitHubFileContent(repoPath, xmlPath, githubToken);
              if (xmlContent) {
                const updatedXml = updateProjectXml(xmlContent, rules);
                filesToCommit.push({ path: xmlPath, content: updatedXml });
              }
            }
          }

          // 4. Commit all changes
          for (const file of filesToCommit) {
            const fileRes = await axios.get(
              `https://api.github.com/repos/${repoPath}/contents/${file.path}?ref=${app.branch}`,
              { headers: { Authorization: `token ${githubToken}` } }
            );
            const fileSha = fileRes.data.sha;

            await axios.put(
              `https://api.github.com/repos/${repoPath}/contents/${file.path}`,
              {
                message: `Mule migration: update ${file.path} for CloudHub 2.0 with rules priority`,
                content: btoa(file.content),
                branch: newBranch,
                sha: fileSha
              },
              { headers: { Authorization: `token ${githubToken}` } }
            );
          }

          // Update application status
          setApplications(prev => prev.map(a => 
            a.id === app.id 
              ? { ...a, status: 'completed', lastUpdated: new Date().toISOString() }
              : a
          ));

        } else if (repositoryType === 'azure_devops') {
          const urlParts = app.repository.split('/');
          const organization = urlParts[3];
          const project = urlParts[4];
          const repoId = app.id;
          const azureApi = createAzureDevOpsAPI(organization, azureToken);

          // Create migration branch
          const branchCreated = await azureApi.createBranch(project, repoId, 'mulemigration', app.branch);
          if (!branchCreated) {
            throw new Error('Failed to create migration branch');
          }

          const filesToCommit = [];

          // Update POM files
          if (app.pomPaths) {
            for (const pomPath of app.pomPaths) {
              const pomContent = await azureApi.getFileContent(project, repoId, pomPath);
              if (pomContent) {
                const updatedPom = updatePomXmlWithLatestVersions(pomContent, app.dependencies, rules);
                filesToCommit.push({ path: pomPath, content: updatedPom });
              }
            }
          }

          // Update artifact JSON files
          if (app.artifactJsonPaths) {
            for (const ajPath of app.artifactJsonPaths) {
              const ajContent = await azureApi.getFileContent(project, repoId, ajPath);
              if (ajContent) {
                const updatedAj = updateArtifactJsonWithLatestJava(JSON.parse(ajContent), rules);
                filesToCommit.push({ path: ajPath, content: JSON.stringify(updatedAj, null, 2) });
              }
            }
          }

          // Update project XML files
          if (app.projectXmlPaths) {
            for (const xmlPath of app.projectXmlPaths) {
              const xmlContent = await azureApi.getFileContent(project, repoId, xmlPath);
              if (xmlContent) {
                const updatedXml = updateProjectXml(xmlContent, rules);
                filesToCommit.push({ path: xmlPath, content: updatedXml });
              }
            }
          }

          // Commit all changes
          if (filesToCommit.length > 0) {
            const committed = await azureApi.commitFiles(
              project,
              repoId,
              'mulemigration',
              filesToCommit,
              'Mule migration: update files for CloudHub 2.0 with rules priority'
            );
            if (!committed) {
              throw new Error('Failed to commit migration changes');
            }
          }

          // Update application status
          setApplications(prev => prev.map(a => 
            a.id === app.id 
              ? { ...a, status: 'completed', lastUpdated: new Date().toISOString() }
              : a
          ));
        }
      }
      toast.success('Migration completed successfully!');
    } catch (error) {
      console.error('Migration error:', error);
      toast.error('Migration failed. Please try again.');
    } finally {
      setMigrating(false);
    }
  };

  // Keep only the new versions of update functions
  const updatePomXmlWithLatestVersions = (pomXml: string, dependencies: MuleDependency[], rules: MigrationRules): string => {
    let updatedPom = pomXml;

    // Update app.runtime version
    updatedPom = updatedPom.replace(
      /<app\.runtime>.*?<\/app\.runtime>/g,
      `<app.runtime>${rules.muleVersion}</app.runtime>`
    );

    // Update dependencies
    dependencies.forEach(dep => {
      const ruleVersion = rules.dependencyVersions.find(d => d.artifactId === dep.artifactId)?.version;
      if (ruleVersion) {
        const dependencyRegex = new RegExp(
          `(<dependency>[\\s\\S]*?<groupId>${dep.groupId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/groupId>[\\s\\S]*?<artifactId>${dep.artifactId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/artifactId>[\\s\\S]*?<version>).*?(<\\/version>[\\s\\S]*?<\\/dependency>)`,
          'g'
        );
        updatedPom = updatedPom.replace(dependencyRegex, `$1${ruleVersion}$2`);
      }
    });

    return updatedPom;
  };

  const updateArtifactJsonWithLatestJava = (artifactJson: any, rules: MigrationRules): any => {
    const updatedJson = { ...artifactJson };
    updatedJson.javaSpecificationVersions = [rules.javaVersion];
    updatedJson.minMuleVersion = rules.minMuleVersion;
    return updatedJson;
  };

  const updateProjectXml = (xml: string, rules: MigrationRules): string => {
    let updatedXml = xml;

    // Replace connectors based on rules
    rules.connectorReplacements.forEach(replacement => {
      const pattern = new RegExp(`<${replacement.from}:[^>]*>.*?</${replacement.from}:[^>]*>`, 'g');
      updatedXml = updatedXml.replace(pattern, `<${replacement.to}:log level="INFO" message="Replaced ${replacement.from} with ${replacement.to} for CloudHub 2.0 migration" />`);
    });

    return updatedXml;
  };

  const getStatusColor = (status: MuleApplication['status']): 'default' | 'destructive' | 'outline' | 'secondary' => {
    switch (status) {
      case 'completed':
        return 'default';
      case 'in_progress':
        return 'secondary';
      case 'failed':
        return 'destructive';
      default:
        return 'outline';
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

  const handleConnectGithub = async () => {
    if (!githubToken.trim()) {
      toast.error('Please enter a GitHub token');
      return;
    }
    setConnecting('github');
    try {
      await updateOrganization(selectedOrganization!.id, {
        github_token: githubToken.trim(),
        repository_type: 'github',
      });
    } finally {
      setConnecting(null);
    }
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
    try {
      await updateOrganization(selectedOrganization!.id, {
        azure_devops_token: azureToken.trim(),
        azure_devops_url: azureOrgUrl.trim(),
        repository_type: 'azure_devops',
      });
    } finally {
      setConnecting(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Migration</CardTitle>
          <CardDescription>
            Select applications to migrate to CloudHub 2.0
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {repositoryType === 'github' ? (
              <div className="flex items-center space-x-2">
                <Input
                  type="password"
                  placeholder="GitHub Personal Access Token"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                />
                <Button
                  onClick={handleConnectGithub}
                  disabled={!githubToken || connecting === 'github'}
                >
                  {connecting === 'github' ? (
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Github className="mr-2 h-4 w-4" />
                  )}
                  Connect GitHub
                </Button>
              </div>
            ) : repositoryType === 'azure_devops' ? (
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Input
                    type="text"
                    placeholder="Azure DevOps Organization URL"
                    value={azureOrgUrl}
                    onChange={(e) => setAzureOrgUrl(e.target.value)}
                  />
                  <Input
                    type="password"
                    placeholder="Azure DevOps Personal Access Token"
                    value={azureToken}
                    onChange={(e) => setAzureToken(e.target.value)}
                  />
                  <Button
                    onClick={handleConnectAzure}
                    disabled={!azureToken || !azureOrgUrl || connecting === 'azure'}
                  >
                    {connecting === 'azure' ? (
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <GitBranch className="mr-2 h-4 w-4" />
                    )}
                    Connect Azure DevOps
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="flex justify-between items-center">
              <Button
                onClick={handleFetchRepositories}
                disabled={fetchingRepos || !(githubToken || azureToken)}
              >
                {fetchingRepos ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Fetch Repositories
              </Button>

              <Button
                onClick={() => handleMigrateSelected({
                  javaVersion: '17',
                  muleVersion: '4.4.0',
                  minMuleVersion: '4.4.0',
                  connectorReplacements: [],
                  dependencyVersions: []
                })}
                disabled={migrating || applications.filter(app => app.selected).length === 0}
              >
                {migrating ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <GitBranch className="mr-2 h-4 w-4" />
                )}
                Migrate Selected
              </Button>
            </div>

            {error && (
              <div className="text-red-500 text-sm">{error}</div>
            )}

            {applications.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Select</TableHead>
                    <TableHead>Application</TableHead>
                    <TableHead>Repository</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Mule Version</TableHead>
                    <TableHead>Java Version</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {applications.map((app) => (
                    <TableRow key={app.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={app.selected}
                          onChange={() => toggleApplicationSelection(app.id)}
                        />
                      </TableCell>
                      <TableCell>{app.applicationName}</TableCell>
                      <TableCell>
                        <a
                          href={app.repository}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-500 hover:underline"
                        >
                          {app.name}
                        </a>
                      </TableCell>
                      <TableCell>{app.branch}</TableCell>
                      <TableCell>{app.muleVersion}</TableCell>
                      <TableCell>{app.javaVersion}</TableCell>
                      <TableCell>
                        <Badge
                          variant={getStatusColor(app.status)}
                          className="flex items-center space-x-1"
                        >
                          {getStatusIcon(app.status)}
                          <span>{app.status}</span>
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {new Date(app.lastUpdated).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Migration;
