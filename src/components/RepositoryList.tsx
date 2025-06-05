import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CheckCircle2, AlertTriangle, XCircle, ExternalLink, Eye, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useOrganizations } from '@/providers/OrganizationProvider';
import axios from 'axios';
import { useState } from 'react';
import { getLatestMuleVersion, getLatestJavaVersion } from '@/utils/muleDetection';
import { formatDistanceToNow } from 'date-fns';
import { createAzureDevOpsAPI } from '@/utils/azureDevopsApi';
import MigrationDetailsDialog from './MigrationDetailsDialog';

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

interface MigrationSelections {
  muleRuntime: boolean;
  javaVersion: boolean;
  minMuleVersion: boolean;
  dependencies: string[];
  connectors: string[];
}

interface RepositoryListProps {
  applications: MuleApplication[];
  setApplications: React.Dispatch<React.SetStateAction<MuleApplication[]>>;
  onMigrateAll: () => void;
}

const RepositoryList: React.FC<RepositoryListProps> = ({ 
  applications = [], // Add default empty array
  setApplications, 
  onMigrateAll 
}) => {
  const { selectedOrganization } = useOrganizations();
  const [migrating, setMigrating] = React.useState(false);
  const [selectedApp, setSelectedApp] = useState<MuleApplication | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);

  const repositoryType = selectedOrganization?.repository_type;
  const githubToken = selectedOrganization?.github_token || '';
  const azureToken = selectedOrganization?.azure_devops_token || '';

  const toggleApplicationSelection = (appId: string) => {
    setApplications(prev => prev.map(app => 
      app.id === appId ? { ...app, selected: !app.selected } : app
    ));
  };

  const selectAll = () => {
    setApplications(prev => prev.map(app => ({ ...app, selected: true })));
  };

  const deselectAll = () => {
    setApplications(prev => prev.map(app => ({ ...app, selected: false })));
  };

  // Enhanced function to update dependency versions in POM XML
  const updatePomDependencies = (pomXml: string, dependencies: MuleDependency[], selections: MigrationSelections): string => {
    let updatedPom = pomXml;
    
    // Update app.runtime version if selected
    if (selections.muleRuntime) {
      const latestMuleVersion = getLatestMuleVersion();
      updatedPom = updatedPom.replace(
        /<app\.runtime>.*?<\/app\.runtime>/g,
        `<app.runtime>${latestMuleVersion}</app.runtime>`
      );
      console.log(`Updated app.runtime to ${latestMuleVersion}`);
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
        console.log('Found CloudHub dependencies to remove:', matches);
        updatedPom = updatedPom.replace(pattern, '');
      }
    });
    
    // Update selected dependencies to their latest versions
    dependencies.forEach(dep => {
      if (selections.dependencies.includes(dep.artifactId) && dep.latestVersion && dep.latestVersion !== dep.version) {
        console.log(`Updating ${dep.artifactId} from ${dep.version} to ${dep.latestVersion}`);
        
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

  // Enhanced function to replace CloudHub connectors with Logger in XML files
  const replaceCloudHubConnectors = (xmlContent: string, selections: MigrationSelections): string => {
    let updatedXml = xmlContent;
    
    // Only process selected connectors
    const selectedCloudHubConnectors = selections.connectors.filter(name => 
      name.toLowerCase().includes('cloudhub')
    );
    
    if (selectedCloudHubConnectors.length === 0) {
      return xmlContent;
    }
    
    console.log('Replacing selected CloudHub connectors with Logger connectors...');
    
    // Add Logger namespace if not present
    if (!updatedXml.includes('xmlns:logger=')) {
      const muleTag = updatedXml.match(/<mule[^>]*>/);
      if (muleTag) {
        const updatedMuleTag = muleTag[0].replace('>', ' xmlns:logger="http://www.mulesoft.org/schema/mule/logger" xsi:schemaLocation="http://www.mulesoft.org/schema/mule/logger current/mule-logger.xsd">');
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

  // Enhanced GitHub migration function
  const migrateGitHubApplication = async (app: MuleApplication, selections: MigrationSelections) => {
    console.log('Starting GitHub migration for app:', app.applicationName);
    
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
    
    // Update POM files if muleRuntime or dependencies are selected
    if ((selections.muleRuntime || selections.dependencies.length > 0) && app.pomPaths) {
      for (const pomPath of app.pomPaths) {
        try {
          const pomRes = await axios.get(
            `https://api.github.com/repos/${repoPath}/contents/${pomPath}?ref=${app.branch}`,
            { headers: { Authorization: `token ${githubToken}` } }
          );
          const pomSha = pomRes.data.sha;
          const pomXml = atob(pomRes.data.content.replace(/\n/g, ''));
          
          const updatedPom = updatePomDependencies(pomXml, app.dependencies, selections);
          
          await axios.put(
            `https://api.github.com/repos/${repoPath}/contents/${pomPath}`,
            {
              message: `Mule migration: update selected dependencies for CloudHub 2.0 - ${pomPath}`,
              content: btoa(updatedPom),
              branch: newBranch,
              sha: pomSha
            },
            { headers: { Authorization: `token ${githubToken}` } }
          );
          console.log('Successfully updated:', pomPath);
        } catch (error) {
          console.error(`Failed to update ${pomPath}:`, error);
        }
      }
    }
    
    // Update artifact JSON files if javaVersion or minMuleVersion are selected
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
            updatedAj.javaSpecificationVersions = [getLatestJavaVersion()];
          }
          
          if (selections.minMuleVersion) {
            updatedAj.minMuleVersion = getLatestMuleVersion();
          }
          
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
          console.log('Successfully updated:', ajPath);
        } catch (error) {
          console.error(`Failed to update ${ajPath}:`, error);
        }
      }
    }
    
    // Update project XML files if connectors are selected
    if (selections.connectors.length > 0 && app.projectXmlPaths) {
      for (const xmlPath of app.projectXmlPaths) {
        try {
          const xmlRes = await axios.get(
            `https://api.github.com/repos/${repoPath}/contents/${xmlPath}?ref=${app.branch}`,
            { headers: { Authorization: `token ${githubToken}` } }
          );
          const xmlSha = xmlRes.data.sha;
          const xmlContent = atob(xmlRes.data.content.replace(/\n/g, ''));
          
          const updatedXml = replaceCloudHubConnectors(xmlContent, selections) + '\n<!-- Updated for CloudHub 2.0 migration -->';
          
          await axios.put(
            `https://api.github.com/repos/${repoPath}/contents/${xmlPath}`,
            {
              message: `Mule migration: update selected connectors for CloudHub 2.0 - ${xmlPath}`,
              content: btoa(updatedXml),
              branch: newBranch,
              sha: xmlSha
            },
            { headers: { Authorization: `token ${githubToken}` } }
          );
          console.log('Successfully updated:', xmlPath);
        } catch (error) {
          console.error(`Failed to update ${xmlPath}:`, error);
        }
      }
    }
  };

  // Enhanced Azure DevOps migration function
  const migrateAzureApplication = async (app: MuleApplication, selections: MigrationSelections) => {
    try {
      console.log('Starting Azure DevOps migration for app:', app.applicationName);
      console.log('Migration selections:', selections);
      
      const urlParts = app.repository.split('/');
      const organization = urlParts[3];
      const project = urlParts[4];
      const repoId = app.id;
      const azureApi = createAzureDevOpsAPI(organization, azureToken);
      
      // Create migration branch
      console.log(`Creating migration branch for ${app.name}...`);
      const branchCreated = await azureApi.createBranch(project, repoId, 'mulemigration', app.branch);
      if (!branchCreated) {
        throw new Error('Failed to create migration branch. Please check your PAT permissions.');
      }
      
      const filesToCommit = [];
      
      // Update POM files if selected
      if ((selections.muleRuntime || selections.dependencies.length > 0) && app.pomPaths) {
        console.log(`Updating selected POM files for ${app.name}...`);
        for (const pomPath of app.pomPaths) {
          let pomXml = await azureApi.getFileContent(project, repoId, pomPath);
          if (pomXml && typeof pomXml === 'string') {
            const updatedPom = updatePomDependencies(pomXml, app.dependencies, selections);
            filesToCommit.push({ path: pomPath, content: updatedPom });
          }
        }
      }
      
      // Update artifact JSON files if selected
      if ((selections.javaVersion || selections.minMuleVersion) && app.artifactJsonPaths) {
        console.log(`Updating selected artifact JSON files for ${app.name}...`);
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
            updatedAj.javaSpecificationVersions = [getLatestJavaVersion()];
          }
          
          if (selections.minMuleVersion) {
            updatedAj.minMuleVersion = getLatestMuleVersion();
          }
          
          filesToCommit.push({ path: ajPath, content: JSON.stringify(updatedAj, null, 2) });
        }
      }
      
      // Update project XML files if connectors are selected
      if (selections.connectors.length > 0 && app.projectXmlPaths) {
        console.log(`Updating selected project XML files for ${app.name}...`);
        for (const xmlPath of app.projectXmlPaths) {
          let xmlContent = await azureApi.getFileContent(project, repoId, xmlPath);
          if (xmlContent && typeof xmlContent === 'string') {
            const updatedXml = replaceCloudHubConnectors(xmlContent, selections) + '\n<!-- Updated for CloudHub 2.0 migration -->';
            filesToCommit.push({ path: xmlPath, content: updatedXml });
          }
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
          'Mule migration: update selected components for CloudHub 2.0'
        );
        if (!committed) {
          throw new Error('Failed to commit migration changes. Please check your PAT permissions.');
        }
        console.log(`Successfully migrated selected components for ${app.name}`);
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

  // Handle selective migration from dialog
  const handleSelectiveMigration = async (app: MuleApplication, selections: MigrationSelections) => {
    setMigrating(true);
    try {
      console.log('Starting selective migration for:', app.applicationName, 'with selections:', selections);
      
      if (repositoryType === 'github') {
        await migrateGitHubApplication(app, selections);
      } else if (repositoryType === 'azure_devops') {
        await migrateAzureApplication(app, selections);
      }
      
      // Update application status
      setApplications(prev => prev.map(a => 
        a.id === app.id 
          ? { ...a, status: 'completed', lastUpdated: new Date().toISOString() }
          : a
      ));
      
      toast.success(`Migration completed for ${app.applicationName}!`);
    } catch (err) {
      console.error('Selective migration error:', err);
      setApplications(prev => prev.map(a => 
        a.id === app.id 
          ? { ...a, status: 'failed', lastUpdated: new Date().toISOString() }
          : a
      ));
      toast.error(`Migration failed for ${app.applicationName}`);
    } finally {
      setMigrating(false);
    }
  };

  const openDetailsDialog = (app: MuleApplication) => {
    setSelectedApp(app);
    setDetailsDialogOpen(true);
  };

  const closeDetailsDialog = () => {
    setSelectedApp(null);
    setDetailsDialogOpen(false);
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

  const getTotalUpdateCount = (app: MuleApplication) => {
    let count = 0;
    
    // Check for runtime updates
    if (app.muleRuntime !== getLatestMuleVersion()) count++;
    if (app.javaVersion !== getLatestJavaVersion()) count++;
    
    // Add defensive checks for dependencies array
    const dependencies = app.dependencies || [];
    count += dependencies.filter(dep => dep.version !== dep.latestVersion).length;
    
    // Check for deprecated items with defensive checks
    count += dependencies.filter(dep => dep.isDeprecated).length;
    const connectors = app.connectors || [];
    count += connectors.filter(conn => conn.isDeprecated).length;
    
    return count;
  };

  const getUpdateSummary = (app: MuleApplication) => {
    const updates = [];
    
    if (app.muleRuntime !== getLatestMuleVersion()) {
      updates.push(`Mule Runtime: ${app.muleRuntime} → ${getLatestMuleVersion()}`);
    }
    
    if (app.javaVersion !== getLatestJavaVersion()) {
      updates.push(`Java: ${app.javaVersion} → ${getLatestJavaVersion()}`);
    }
    
    // Add defensive checks for dependencies array
    const dependencies = app.dependencies || [];
    const depUpdates = dependencies.filter(dep => dep.version !== dep.latestVersion).length;
    if (depUpdates > 0) {
      updates.push(`${depUpdates} dependency updates`);
    }
    
    // Add defensive checks for both arrays
    const connectors = app.connectors || [];
    const deprecatedCount = dependencies.filter(dep => dep.isDeprecated).length + 
                           connectors.filter(conn => conn.isDeprecated).length;
    if (deprecatedCount > 0) {
      updates.push(`${deprecatedCount} deprecated items`);
    }
    
    return updates.join(', ');
  };

  const selectedCount = applications.filter(app => app.selected).length;

  // Add early return if applications is empty or loading
  if (!applications || applications.length === 0) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Mule Applications (0 found)</CardTitle>
            <CardDescription>
              Scanning repositories for Mule applications...
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8 text-gray-500">
              No Mule applications found yet. Please wait while we scan your repositories.
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Mule Applications ({applications.length} found)</span>
            <div className="flex items-center space-x-2">
              <Button variant="outline" size="sm" onClick={selectAll}>
                Select All
              </Button>
              <Button variant="outline" size="sm" onClick={deselectAll}>
                Deselect All
              </Button>
              <Button 
                onClick={onMigrateAll}
                disabled={selectedCount === 0 || migrating}
                size="lg"
                className="bg-blue-600 hover:bg-blue-700"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {migrating ? 'Migrating...' : `Migrate All Selected (${selectedCount})`}
              </Button>
            </div>
          </CardTitle>
          <CardDescription>
            Select applications and view details to customize your CloudHub 2.0 migration
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table className="min-w-[1600px] border border-gray-300 border-collapse">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px] border border-gray-300">Select</TableHead>
                  <TableHead className="border border-gray-300">Application</TableHead>
                  <TableHead className="border border-gray-300">Repository</TableHead>
                  <TableHead className="border border-gray-300">Current Versions</TableHead>
                  <TableHead className="border border-gray-300">Available Updates</TableHead>
                  <TableHead className="border border-gray-300">Dependencies</TableHead>
                  <TableHead className="border border-gray-300">Connectors</TableHead>
                  <TableHead className="border border-gray-300">Migration Status</TableHead>
                  <TableHead className="border border-gray-300">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {applications.map((app) => {
                  // Add defensive checks for each app's arrays
                  const dependencies = app.dependencies || [];
                  const connectors = app.connectors || [];
                  
                  return (
                    <TableRow key={app.id} className={app.selected ? 'bg-blue-50' : ''}>
                      <TableCell className="border border-gray-300">
                        <input
                          type="checkbox"
                          checked={!!app.selected}
                          onChange={() => toggleApplicationSelection(app.id)}
                          className="w-4 h-4"
                        />
                      </TableCell>
                      <TableCell className="border border-gray-300">
                        <div>
                          <div className="font-medium">{app.applicationName}</div>
                          <div className="text-sm text-gray-500">Branch: {app.branch}</div>
                        </div>
                      </TableCell>
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
                        <div className="space-y-1 text-sm">
                          <div>Mule: {app.muleRuntime}</div>
                          <div>Java: {app.javaVersion || 'Unknown'}</div>
                        </div>
                      </TableCell>
                      <TableCell className="border border-gray-300">
                        <div className="space-y-1 text-sm">
                          {app.muleRuntime !== getLatestMuleVersion() && (
                            <Badge variant="outline" className="text-yellow-600 text-xs">
                              Mule → {getLatestMuleVersion()}
                            </Badge>
                          )}
                          {app.javaVersion !== getLatestJavaVersion() && (
                            <Badge variant="outline" className="text-yellow-600 text-xs">
                              Java → {getLatestJavaVersion()}
                            </Badge>
                          )}
                          {getTotalUpdateCount(app) > 0 && (
                            <div className="text-xs text-blue-600 font-medium">
                              {getTotalUpdateCount(app)} updates available
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="border border-gray-300">
                        <div className="space-y-1">
                          <div className="text-sm font-medium">{dependencies.length} total</div>
                          {dependencies.filter(dep => dep.version !== dep.latestVersion).length > 0 && (
                            <Badge variant="outline" className="text-yellow-600 text-xs">
                              {dependencies.filter(dep => dep.version !== dep.latestVersion).length} updates
                            </Badge>
                          )}
                          {dependencies.filter(dep => dep.isDeprecated).length > 0 && (
                            <Badge variant="destructive" className="text-xs">
                              {dependencies.filter(dep => dep.isDeprecated).length} deprecated
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="border border-gray-300">
                        <div className="space-y-1">
                          <div className="text-sm font-medium">{connectors.length} total</div>
                          {connectors.filter(conn => conn.isDeprecated).length > 0 && (
                            <Badge variant="destructive" className="text-xs">
                              {connectors.filter(conn => conn.isDeprecated).length} deprecated
                            </Badge>
                          )}
                          {connectors.filter(conn => conn.cloudHub2Alternative).length > 0 && (
                            <Badge variant="outline" className="text-blue-600 text-xs">
                              {connectors.filter(conn => conn.cloudHub2Alternative).length} need replacement
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="border border-gray-300">
                        <div className="flex items-center space-x-2">
                          {getStatusIcon(app.status)}
                          <div className="flex flex-col">
                            <span className={getStatusColor(app.status)}>
                              {app.status.replace('_', ' ')}
                            </span>
                            {app.lastUpdated && (
                              <span className="text-xs text-gray-500">
                                {formatDistanceToNow(new Date(app.lastUpdated), { addSuffix: true })}
                              </span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="border border-gray-300">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => openDetailsDialog(app)}
                          className="flex items-center space-x-1"
                        >
                          <Eye className="h-3 w-3" />
                          <span>View Details</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Migration Details Dialog */}
      <MigrationDetailsDialog
        application={selectedApp}
        isOpen={detailsDialogOpen}
        onClose={closeDetailsDialog}
        onMigrate={handleSelectiveMigration}
        repositoryType={repositoryType || 'github'}
      />
    </div>
  );
};

export default RepositoryList;
