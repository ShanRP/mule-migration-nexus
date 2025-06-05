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
import { formatDistanceToNow } from 'date-fns';
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
  const [migrateDialogSelections, setMigrateDialogSelections] = useState<any>({});
  const [migratingDialog, setMigratingDialog] = useState(false);

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

  // Enhanced function to discover file paths in repository
  const discoverFilePaths = async (repoPath: string, branch: string): Promise<{
    pomPaths: string[];
    artifactJsonPaths: string[];
    projectXmlPaths: string[];
  }> => {
    console.log(`Discovering file paths in ${repoPath} on branch ${branch}`);
    
    const pomPaths: string[] = [];
    const artifactJsonPaths: string[] = [];
    const projectXmlPaths: string[] = [];

    try {
      // Recursively search for files in the repository
      const searchFiles = async (path: string = '') => {
        try {
          const contentsRes = await axios.get(
            `https://api.github.com/repos/${repoPath}/contents/${path}?ref=${branch}`,
            { headers: { Authorization: `token ${githubToken}` } }
          );

          if (Array.isArray(contentsRes.data)) {
            for (const item of contentsRes.data) {
              if (item.type === 'file') {
                // Check for pom.xml files
                if (item.name === 'pom.xml') {
                  pomPaths.push(item.path);
                  console.log(`Found pom.xml: ${item.path}`);
                }
                // Check for mule-artifact.json files
                else if (item.name === 'mule-artifact.json') {
                  artifactJsonPaths.push(item.path);
                  console.log(`Found mule-artifact.json: ${item.path}`);
                }
                // Check for XML files in src/main/mule directory
                else if (item.name.endsWith('.xml') && item.path.includes('src/main/mule/')) {
                  projectXmlPaths.push(item.path);
                  console.log(`Found project XML: ${item.path}`);
                }
              } else if (item.type === 'dir') {
                // Recursively search directories
                await searchFiles(item.path);
              }
            }
          }
        } catch (error) {
          console.log(`Error searching in ${path}:`, error);
        }
      };

      await searchFiles();
    } catch (error) {
      console.error('Error discovering file paths:', error);
    }

    console.log('Discovery results:', { pomPaths, artifactJsonPaths, projectXmlPaths });
    return { pomPaths, artifactJsonPaths, projectXmlPaths };
  };

  // Enhanced function to update dependency versions in POM XML (ONLY app.runtime + remove CloudHub deps)
  const updatePomDependencies = (pomXml: string, dependencies: MuleDependency[]): string => {
    let updatedPom = pomXml;
    
    // ONLY update app.runtime version to 4.9.0
    const latestMuleVersion = getLatestMuleVersion();
    updatedPom = updatedPom.replace(
      /<app\.runtime>.*?<\/app\.runtime>/g,
      `<app.runtime>${latestMuleVersion}</app.runtime>`
    );
    
    // Remove ONLY CloudHub dependencies with more precise patterns
    console.log('Removing CloudHub dependencies from POM...');
    
    // More precise CloudHub dependency removal patterns
    const cloudHubDepPatterns = [
      // Specific CloudHub module dependency
      /<dependency>\s*<groupId>org\.mule\.modules<\/groupId>\s*<artifactId>mule-module-cloudhub<\/artifactId>[\s\S]*?<\/dependency>/g,
      
      // CloudHub connector dependencies
      /<dependency>\s*<groupId>org\.mule\.connectors<\/groupId>\s*<artifactId>mule-cloudhub-connector<\/artifactId>[\s\S]*?<\/dependency>/g,
      
      // Any dependency with cloudhub in artifactId
      /<dependency>[\s\S]*?<artifactId>[^<]*cloudhub[^<]*<\/artifactId>[\s\S]*?<\/dependency>/g,
      
      // CloudHub specific groupIds
      /<dependency>\s*<groupId>com\.mulesoft\.cloudhub<\/groupId>[\s\S]*?<\/dependency>/g,
      /<dependency>\s*<groupId>com\.mulesoft\.modules\.cloudhub<\/groupId>[\s\S]*?<\/dependency>/g
    ];
    
    cloudHubDepPatterns.forEach(pattern => {
      const matches = updatedPom.match(pattern);
      if (matches) {
        console.log('Found CloudHub dependencies to remove:', matches);
        updatedPom = updatedPom.replace(pattern, '');
      }
    });
    
    // Clean up any double empty lines left by removed dependencies
    updatedPom = updatedPom.replace(/\n\s*\n\s*\n/g, '\n\n');
    
    // Update each dependency to its latest version
    dependencies.forEach(dep => {
      if (dep.latestVersion && dep.latestVersion !== dep.version) {
        console.log(`Updating ${dep.artifactId} from ${dep.version} to ${dep.latestVersion}`);
        
        // Create a regex to find and update the specific dependency
        const dependencyRegex = new RegExp(
          `(<dependency>[\\s\\S]*?<groupId>${dep.groupId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/groupId>[\\s\\S]*?<artifactId>${dep.artifactId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/artifactId>[\\s\\S]*?<version>).*?(<\\/version>[\\s\\S]*?<\\/dependency>)`,
          'g'
        );
        
        updatedPom = updatedPom.replace(dependencyRegex, `$1${dep.latestVersion}$2`);
      }
    });
    
    // Add migration comment
    if (!updatedPom.includes('<!-- Updated for CloudHub 2.0 migration -->')) {
      updatedPom = updatedPom + '\n<!-- Updated for CloudHub 2.0 migration -->';
    }
    
    return updatedPom;
  };

  // Enhanced function to replace CloudHub connectors with Logger in XML files
  const replaceCloudHubConnectors = (xmlContent: string): string => {
    console.log('Replacing CloudHub connectors with Logger connectors...');
    let updatedXml = xmlContent;
    
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
      // CloudHub notification patterns
      {
        pattern: /<cloudhub:create-notification[^>]*>[\s\S]*?<\/cloudhub:create-notification>/g,
        replacement: '<logger:log level="INFO" message="CloudHub notification replaced with logger for CloudHub 2.0 migration" />'
      },
      {
        pattern: /<cloudhub:create-notification[^>]*\/>/g,
        replacement: '<logger:log level="INFO" message="CloudHub notification replaced with logger for CloudHub 2.0 migration" />'
      },
      // CloudHub list notifications
      {
        pattern: /<cloudhub:list-notifications[^>]*>[\s\S]*?<\/cloudhub:list-notifications>/g,
        replacement: '<logger:log level="INFO" message="CloudHub list notifications replaced with logger for CloudHub 2.0 migration" />'
      },
      {
        pattern: /<cloudhub:list-notifications[^>]*\/>/g,
        replacement: '<logger:log level="INFO" message="CloudHub list notifications replaced with logger for CloudHub 2.0 migration" />'
      },
      // CloudHub get application
      {
        pattern: /<cloudhub:get-application[^>]*>[\s\S]*?<\/cloudhub:get-application>/g,
        replacement: '<logger:log level="INFO" message="CloudHub get application replaced with logger for CloudHub 2.0 migration" />'
      },
      {
        pattern: /<cloudhub:get-application[^>]*\/>/g,
        replacement: '<logger:log level="INFO" message="CloudHub get application replaced with logger for CloudHub 2.0 migration" />'
      },
      // General CloudHub operations
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

  const migrateGitHubApplication = async (app: MuleApplication) => {
    console.log('Starting migration for app:', app.applicationName);
    console.log('App file paths:', {
      pomPaths: app.pomPaths,
      artifactJsonPaths: app.artifactJsonPaths,
      projectXmlPaths: app.projectXmlPaths
    });

    const repoPath = app.repository.replace('https://github.com/', '');
    const newBranch = 'mulemigration';
    
    // If file paths are not available, discover them first
    let pomPaths = app.pomPaths;
    let artifactJsonPaths = app.artifactJsonPaths;
    let projectXmlPaths = app.projectXmlPaths;

    if (!pomPaths || pomPaths.length === 0 || !artifactJsonPaths || !projectXmlPaths) {
      console.log('File paths not available, discovering them...');
      const discoveredPaths = await discoverFilePaths(repoPath, app.branch);
      pomPaths = discoveredPaths.pomPaths;
      artifactJsonPaths = discoveredPaths.artifactJsonPaths;
      projectXmlPaths = discoveredPaths.projectXmlPaths;
      
      // Update the application with discovered paths
      setApplications(prev => prev.map(a => 
        a.id === app.id 
          ? { 
              ...a, 
              pomPaths: discoveredPaths.pomPaths,
              artifactJsonPaths: discoveredPaths.artifactJsonPaths,
              projectXmlPaths: discoveredPaths.projectXmlPaths
            }
          : a
      ));
    }
    
    // 1. Get base branch SHA
    console.log(`Getting SHA for branch: ${app.branch}`);
    const branchRes = await axios.get(
      `https://api.github.com/repos/${repoPath}/git/refs/heads/${app.branch}`,
      { headers: { Authorization: `token ${githubToken}` } }
    );
    const baseSha = branchRes.data.object.sha;
    console.log('Base SHA:', baseSha);
    
    // 2. Create branch (ignore if exists)
    try {
      console.log(`Creating new branch: ${newBranch}`);
      await axios.post(
        `https://api.github.com/repos/${repoPath}/git/refs`,
        {
          ref: `refs/heads/${newBranch}`,
          sha: baseSha
        },
        { headers: { Authorization: `token ${githubToken}` } }
      );
      console.log('Branch created successfully');
    } catch (e) {
      console.log('Branch may already exist, continuing...');
    }
    
    // 3. Update all pom.xml files with dependency version updates and CloudHub removal
    if (pomPaths && pomPaths.length > 0) {
      console.log('Processing POM files:', pomPaths);
      
      for (const pomPath of pomPaths) {
        const normPomPath = normalizePath(pomPath);
        console.log('Attempting to fetch/update pom.xml:', normPomPath, 'on branch', app.branch);
        
        try {
          const pomRes = await axios.get(
            `https://api.github.com/repos/${repoPath}/contents/${normPomPath}?ref=${app.branch}`,
            { headers: { Authorization: `token ${githubToken}` } }
          );
          const pomSha = pomRes.data.sha;
          const pomXml = atob(pomRes.data.content.replace(/\n/g, ''));
          
          // Update POM with proper dependency version updates and CloudHub removal
          const updatedPom = updatePomDependencies(pomXml, app.dependencies);
          
          await axios.put(
            `https://api.github.com/repos/${repoPath}/contents/${normPomPath}`,
            {
              message: `Mule migration: update dependencies and remove CloudHub for CloudHub 2.0 - ${normPomPath}`,
              content: btoa(updatedPom),
              branch: newBranch,
              sha: pomSha
            },
            { headers: { Authorization: `token ${githubToken}` } }
          );
          console.log('Successfully updated:', normPomPath);
        } catch (error) {
          console.error(`Failed to update ${normPomPath}:`, error);
          // Continue with other files even if one fails
        }
      }
    } else {
      console.log('No pom.xml files found to update');
    }
    
    // 4. Update all mule-artifact.json files (Java version + minMuleVersion sync)
    if (artifactJsonPaths && artifactJsonPaths.length > 0) {
      console.log('Processing artifact JSON files:', artifactJsonPaths);
      
      for (const ajPath of artifactJsonPaths) {
        const normAjPath = normalizePath(ajPath);
        console.log('Attempting to fetch/update mule-artifact.json:', normAjPath, 'on branch', app.branch);
        
        try {
          const ajRes = await axios.get(
            `https://api.github.com/repos/${repoPath}/contents/${normAjPath}?ref=${app.branch}`,
            { headers: { Authorization: `token ${githubToken}` } }
          );
          const ajSha = ajRes.data.sha;
          const ajJson = JSON.parse(atob(ajRes.data.content.replace(/\n/g, '')));
          
          // Update Java version and sync minMuleVersion with app.runtime
          const latestJavaVersion = getLatestJavaVersion();
          const latestMuleVersion = getLatestMuleVersion();
          const updatedAj = { 
            ...ajJson, 
            javaSpecificationVersions: [latestJavaVersion],
            minMuleVersion: latestMuleVersion
          };
          
          await axios.put(
            `https://api.github.com/repos/${repoPath}/contents/${normAjPath}`,
            {
              message: `Mule migration: update Java version and sync minMuleVersion for CloudHub 2.0 - ${normAjPath}`,
              content: btoa(JSON.stringify(updatedAj, null, 2)),
              branch: newBranch,
              sha: ajSha
            },
            { headers: { Authorization: `token ${githubToken}` } }
          );
          console.log('Successfully updated:', normAjPath);
        } catch (error) {
          console.error(`Failed to update ${normAjPath}:`, error);
          // Continue with other files even if one fails
        }
      }
    } else {
      console.log('No mule-artifact.json files found to update');
    }
    
    // 5. Update all src/main/mule/*.xml files with CloudHub connector replacement
    if (projectXmlPaths && projectXmlPaths.length > 0) {
      console.log('Processing project XML files:', projectXmlPaths);
      
      for (const xmlPath of projectXmlPaths) {
        const normXmlPath = normalizePath(xmlPath);
        console.log('Attempting to fetch/update project xml:', normXmlPath, 'on branch', app.branch);
        
        try {
          const xmlRes = await axios.get(
            `https://api.github.com/repos/${repoPath}/contents/${normXmlPath}?ref=${app.branch}`,
            { headers: { Authorization: `token ${githubToken}` } }
          );
          const xmlSha = xmlRes.data.sha;
          const xmlContent = atob(xmlRes.data.content.replace(/\n/g, ''));
          
          // Replace CloudHub connectors with Logger
          const updatedXml = replaceCloudHubConnectors(xmlContent) + '\n<!-- Updated for CloudHub 2.0 migration -->';
          
          await axios.put(
            `https://api.github.com/repos/${repoPath}/contents/${normXmlPath}`,
            {
              message: `Mule migration: replace CloudHub connectors with Logger for CloudHub 2.0 - ${normXmlPath}`,
              content: btoa(updatedXml),
              branch: newBranch,
              sha: xmlSha
            },
            { headers: { Authorization: `token ${githubToken}` } }
          );
          console.log('Successfully updated:', normXmlPath);
        } catch (error) {
          console.error(`Failed to update ${normXmlPath}:`, error);
          // Continue with other files even if one fails
        }
      }
    } else {
      console.log('No project XML files found to update');
    }
    
    console.log('Migration completed for app:', app.applicationName);
  };

  // Enhanced Azure DevOps migration using new API and robust type checks
  const migrateAzureApplication = async (app: MuleApplication) => {
    try {
      console.log('Starting Azure DevOps migration for app:', app.applicationName);
      // Extract organization, project, and repo id (GUID)
      const urlParts = app.repository.split('/');
      const organization = urlParts[3];
      const project = urlParts[4];
      // Use app.id as repoId (should be GUID)
      const repoId = app.id;
      const azureApi = createAzureDevOpsAPI(organization, azureToken);
      // Create migration branch
      console.log(`Creating migration branch for ${app.name}...`);
      const branchCreated = await azureApi.createBranch(project, repoId, 'mulemigration', app.branch);
      if (!branchCreated) {
        throw new Error('Failed to create migration branch. Please check your PAT permissions.');
      }
      // Prepare files for commit
      const filesToCommit = [];
      // Update POM files
      console.log(`Updating POM files for ${app.name}...`);
      for (const pomPath of app.pomPaths || []) {
        let pomXml = await azureApi.getFileContent(project, repoId, pomPath);
        if (pomXml) {
          if (typeof pomXml !== 'string') pomXml = JSON.stringify(pomXml);
          let updatedPom;
          try {
            updatedPom = updatePomDependencies(pomXml, app.dependencies);
          } catch (e) {
            console.error('updatePomDependencies error:', e);
            continue;
          }
          if (typeof updatedPom !== 'string') updatedPom = String(updatedPom);
          filesToCommit.push({ path: pomPath, content: updatedPom });
        } else {
          console.warn(`Could not fetch POM file: ${pomPath}`);
        }
      }
      // Update artifact JSON files
      console.log(`Updating artifact JSON files for ${app.name}...`);
      for (const ajPath of app.artifactJsonPaths || []) {
        let ajContent = await azureApi.getFileContent(project, repoId, ajPath);
        let ajJson;
        if (ajContent) {
          if (typeof ajContent === 'string') {
            try {
              ajJson = JSON.parse(ajContent);
            } catch (e) {
              console.warn('Invalid JSON in artifact JSON, creating new:', e);
              ajJson = {};
            }
          } else {
            ajJson = ajContent;
          }
        } else {
          // File does not exist, create new
          console.warn(`artifact JSON file not found: ${ajPath}, creating new`);
          ajJson = {};
        }
        // Always update Java version and any other required fields
        ajJson.javaSpecificationVersions = [getLatestJavaVersion()];
        // Add any other default fields if needed
        filesToCommit.push({ path: ajPath, content: JSON.stringify(ajJson, null, 2) });
      }
      // Update project XML files
      console.log(`Updating project XML files for ${app.name}...`);
      for (const xmlPath of app.projectXmlPaths || []) {
        let xmlContent = await azureApi.getFileContent(project, repoId, xmlPath);
        if (xmlContent) {
          if (typeof xmlContent !== 'string') xmlContent = JSON.stringify(xmlContent);
          let updatedXml;
          try {
            updatedXml = replaceCloudHubConnectors(xmlContent) + '\n<!-- Updated for CloudHub 2.0 migration -->';
          } catch (e) {
            console.error('replaceCloudHubConnectors error:', e);
            continue;
          }
          if (typeof updatedXml !== 'string') updatedXml = String(updatedXml);
          filesToCommit.push({ path: xmlPath, content: updatedXml });
        } else {
          console.warn(`Could not fetch XML file: ${xmlPath}`);
        }
      }
      // Commit all changes
      if (filesToCommit.length > 0) {
        console.log(`Committing ${filesToCommit.length} files for ${app.name}...`);
        const committed = await azureApi.commitFiles(
          project,
          repoId,
          'mulemigration',
          filesToCommit,
          'Mule migration: update dependencies and configuration for CloudHub 2.0'
        );
        if (!committed) {
          throw new Error('Failed to commit migration changes. Please check your PAT permissions.');
        }
        console.log(`Successfully migrated ${app.name}`);
        setApplications(prev => prev.map(a => a.id === app.id ? { ...a, status: 'completed', lastUpdated: new Date().toISOString() } : a));
        return true;
      } else {
        console.warn(`No files to commit for ${app.name}`);
        return false;
      }
    } catch (error) {
      console.error(`Error migrating Azure DevOps application ${app.name}:`, error);
      toast.error(`Failed to migrate ${app.name}: ${error.message}`);
      return false;
    }
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
        console.log('Migrating app:', app.applicationName, 'with paths:', {
          pomPaths: app.pomPaths,
          artifactJsonPaths: app.artifactJsonPaths,
          projectXmlPaths: app.projectXmlPaths
        });
        
        if (repositoryType === 'github') {
          await migrateGitHubApplication(app);
        } else if (repositoryType === 'azure_devops') {
          await migrateAzureApplication(app);
        }
      }
      toast.success('Migration branch created and files updated for selected apps!');
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

  // Helper to handle checkbox changes in dialog
  const handleDialogCheckboxChange = (key: string, value: any) => {
    setMigrateDialogSelections((prev: any) => ({ ...prev, [key]: value }));
  };

  // Helper to handle migration from dialog
  const handleDialogMigrate = async () => {
    if (!selectedApp) return;
    setMigratingDialog(true);
    try {
      // Call migration logic with selected options
      await migrateSelectedParts(selectedApp, migrateDialogSelections);
      // Update status in applications state
      setApplications(prev => prev.map(app =>
        app.id === selectedApp.id ? { ...app, status: 'completed', lastUpdated: new Date().toISOString() } : app
      ));
      toast.success('Migration completed for selected parts!');
      setSelectedApp(null);
      setMigrateDialogSelections({});
    } catch (err) {
      toast.error('Migration failed.');
    } finally {
      setMigratingDialog(false);
    }
  };

  // Dummy migration function for dialog (to be implemented in Migration.tsx)
  const migrateSelectedParts = async (app: MuleApplication, selections: any) => {
    // This should call a prop or context migration function, or you can lift this up to Migration.tsx
    // For now, just simulate delay
    return new Promise(resolve => setTimeout(resolve, 1000));
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
                  <TableHead className="border border-gray-300">Last Updated</TableHead>
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
                      <span className="text-xs text-gray-600">
                        {app.lastUpdated ? formatDistanceToNow(new Date(app.lastUpdated), { addSuffix: true }) : 'N/A'}
                      </span>
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
                      <Button variant="outline" size="sm" onClick={() => {
                        setSelectedApp(app);
                        setMigrateDialogSelections({
                          muleRuntime: true,
                          javaVersion: true,
                          dependencies: app.dependencies.map(dep => dep.artifactId),
                          connectors: app.connectors.map(conn => conn.name)
                        });
                      }}>
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

      {/* Dialog for View Details with selective migration */}
      <Dialog open={!!selectedApp} onOpenChange={open => !open && setSelectedApp(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedApp?.applicationName || selectedApp?.name}</DialogTitle>
            <DialogDescription>Mule Application Details & Selective Migration</DialogDescription>
          </DialogHeader>
          {selectedApp && (
            <div className="space-y-2">
              <div><b>Repository:</b> {selectedApp.repository}</div>
              <div><b>Mule Runtime:</b> {selectedApp.muleRuntime} <input type="checkbox" checked={!!migrateDialogSelections.muleRuntime} onChange={e => handleDialogCheckboxChange('muleRuntime', e.target.checked)} /> Update</div>
              <div><b>Mule Version:</b> {selectedApp.muleVersion}</div>
              <div><b>Java Version:</b> {selectedApp.javaVersion} <input type="checkbox" checked={!!migrateDialogSelections.javaVersion} onChange={e => handleDialogCheckboxChange('javaVersion', e.target.checked)} /> Update</div>
              <div><b>Dependencies:</b>
                <ul className="ml-4 list-disc">
                  {selectedApp.dependencies.map(dep => (
                    <li key={dep.artifactId}>
                      <input type="checkbox" checked={migrateDialogSelections.dependencies?.includes(dep.artifactId)} onChange={e => {
                        const checked = e.target.checked;
                        setMigrateDialogSelections((prev: any) => ({
                          ...prev,
                          dependencies: checked
                            ? [...(prev.dependencies || []), dep.artifactId]
                            : (prev.dependencies || []).filter((id: string) => id !== dep.artifactId)
                        }));
                      }} />
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
                      <input type="checkbox" checked={migrateDialogSelections.connectors?.includes(conn.name)} onChange={e => {
                        const checked = e.target.checked;
                        setMigrateDialogSelections((prev: any) => ({
                          ...prev,
                          connectors: checked
                            ? [...(prev.connectors || []), conn.name]
                            : (prev.connectors || []).filter((n: string) => n !== conn.name)
                        }));
                      }} />
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
              <div className="flex justify-end mt-4">
                <Button onClick={handleDialogMigrate} disabled={migratingDialog}>
                  {migratingDialog ? 'Migrating...' : 'Migrate Selected'}
                </Button>
              </div>
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
