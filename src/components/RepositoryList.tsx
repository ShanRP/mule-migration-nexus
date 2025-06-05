import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Eye, GitBranch, Calendar, ArrowRight, CheckCircle2, AlertTriangle, XCircle, Play } from 'lucide-react';
import { toast } from 'sonner';
import MigrationDetailsDialog from './MigrationDetailsDialog';
import { useOrganizations } from '@/providers/OrganizationProvider';
import { createAzureDevOpsAPI } from '@/utils/azureDevopsApi';
import { extractAzureOrganization, getLatestMuleVersion, getLatestJavaVersion } from '@/utils/muleDetection';
import axios from 'axios';

interface MuleApplication {
  id: string;
  name: string;
  repository: string;
  branch: string;
  applicationName: string;
  muleRuntime: string;
  muleVersion: string;
  javaVersion: string;
  dependencies: any[];
  connectors: any[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  lastUpdated: string;
  selected?: boolean;
  pomPaths?: string[];
  artifactJsonPaths?: string[];
  projectXmlPaths?: string[];
}

interface RepositoryListProps {
  applications: MuleApplication[];
  setApplications: (applications: MuleApplication[]) => void;
}

const RepositoryList = ({ applications, setApplications }: RepositoryListProps) => {
  const { selectedOrganization } = useOrganizations();
  const [selectedApp, setSelectedApp] = useState<MuleApplication | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [migrating, setMigrating] = useState<string | null>(null);
  const [migratingAll, setMigratingAll] = useState(false);

  const repositoryType = selectedOrganization?.repository_type;
  const githubToken = selectedOrganization?.github_token || '';
  const azureToken = selectedOrganization?.azure_devops_token || '';

  const toggleApplicationSelection = (appId: string) => {
    setApplications(applications.map(app => 
      app.id === appId ? { ...app, selected: !app.selected } : app
    ));
  };

  const toggleSelectAll = () => {
    const allSelected = applications.every(app => app.selected);
    setApplications(applications.map(app => ({ ...app, selected: !allSelected })));
  };

  const handleViewDetails = (app: MuleApplication) => {
    setSelectedApp(app);
    setDetailsDialogOpen(true);
  };

  const handleMigrateAll = async () => {
    const selectedApps = applications.filter(app => app.selected);
    if (selectedApps.length === 0) {
      toast.error('Please select at least one application to migrate');
      return;
    }

    setMigratingAll(true);
    let successCount = 0;
    let failureCount = 0;

    for (const app of selectedApps) {
      try {
        setMigrating(app.id);
        
        // Get all available updates for automatic migration
        const allUpdates = getAllAvailableUpdates(app);
        
        if (repositoryType === 'github' && githubToken) {
          await migrateGitHubApplication(app, allUpdates);
        } else if (repositoryType === 'azure_devops' && azureToken) {
          await migrateAzureApplication(app, allUpdates);
        }
        
        // Update application status
        setApplications(prev => prev.map(a => 
          a.id === app.id ? { ...a, status: 'completed' as const } : a
        ));
        
        successCount++;
      } catch (error) {
        console.error(`Migration failed for ${app.applicationName}:`, error);
        setApplications(prev => prev.map(a => 
          a.id === app.id ? { ...a, status: 'failed' as const } : a
        ));
        failureCount++;
      }
    }

    setMigrating(null);
    setMigratingAll(false);

    if (successCount > 0) {
      toast.success(`Successfully migrated ${successCount} application(s)!`);
    }
    if (failureCount > 0) {
      toast.error(`Failed to migrate ${failureCount} application(s)`);
    }
  };

  const getAllAvailableUpdates = (app: MuleApplication) => {
    const updates = [];

    // Check Mule runtime
    if (app.muleRuntime !== getLatestMuleVersion()) {
      updates.push('mule-runtime');
    }

    // Check Java version
    if (app.javaVersion !== getLatestJavaVersion()) {
      updates.push('java-version');
    }

    // Check dependencies
    if (app.dependencies) {
      app.dependencies.forEach(dep => {
        if (dep.version !== dep.latestVersion) {
          updates.push(`dependency-${dep.artifactId}`);
        }
      });
    }

    // Check connectors
    if (app.connectors) {
      app.connectors.forEach(conn => {
        if (conn.isDeprecated) {
          updates.push(`connector-${conn.name}`);
        }
      });
    }

    return updates;
  };

  const getUpdateSummary = (app: MuleApplication) => {
    let totalUpdates = 0;
    let criticalUpdates = 0;

    // Check Mule runtime
    if (app.muleRuntime !== getLatestMuleVersion()) {
      totalUpdates++;
      criticalUpdates++;
    }

    // Check Java version
    if (app.javaVersion !== getLatestJavaVersion()) {
      totalUpdates++;
      criticalUpdates++;
    }

    // Check dependencies
    if (app.dependencies) {
      app.dependencies.forEach(dep => {
        if (dep.version !== dep.latestVersion) {
          totalUpdates++;
          if (dep.isDeprecated) criticalUpdates++;
        }
      });
    }

    // Check connectors
    if (app.connectors) {
      app.connectors.forEach(conn => {
        if (conn.isDeprecated) {
          totalUpdates++;
          criticalUpdates++;
        }
      });
    }

    return { totalUpdates, criticalUpdates };
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
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'in_progress':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-gray-500" />;
    }
  };

  const updatePomXmlWithLatestVersions = (pomXml: string, dependencies: any[], selectedUpdates: string[]) => {
    if (typeof pomXml !== 'string') {
      console.error('POM XML is not a string:', typeof pomXml);
      return String(pomXml);
    }
    
    let updated = pomXml;
    
    // Update dependencies only if selected
    dependencies.forEach(dep => {
      const updateKey = `dependency-${dep.artifactId}`;
      if (selectedUpdates.includes(updateKey) && dep.latestVersion && dep.version && dep.latestVersion !== dep.version) {
        const regex = new RegExp(`(<artifactId>${dep.artifactId}</artifactId>[\\s\\S]*?<version>)([^<]+)(</version>)`, 'g');
        updated = updated.replace(regex, `$1${dep.latestVersion}$3`);
        console.log(`Updated ${dep.artifactId} from ${dep.version} to ${dep.latestVersion}`);
      }
    });
    
    // Update Mule runtime only if selected
    if (selectedUpdates.includes('mule-runtime')) {
      const runtimeRegex = /(<app\.runtime>)([^<]+)(<\/app\.runtime>)/g;
      updated = updated.replace(runtimeRegex, `$1${getLatestMuleVersion()}$3`);
      console.log(`Updated Mule runtime to ${getLatestMuleVersion()}`);
    }
    
    if (!updated.includes('<!-- Updated for CloudHub 2.0 migration -->')) {
      updated += '\n<!-- Updated for CloudHub 2.0 migration -->';
    }
    return updated;
  };

  const updateArtifactJsonWithLatestJava = (artifactJson: any, selectedUpdates: string[]) => {
    if (!artifactJson) return artifactJson;
    
    const updatedJson = { ...artifactJson };
    
    // Update Java version only if selected
    if (selectedUpdates.includes('java-version')) {
      const latestJava = getLatestJavaVersion();
      
      if (Array.isArray(updatedJson['javaSpecificationVersions'])) {
        updatedJson['javaSpecificationVersions'][0] = latestJava;
      } else if (updatedJson['javaVersion']) {
        updatedJson['javaVersion'] = latestJava;
      } else if (updatedJson['java']) {
        updatedJson['java'] = latestJava;
      } else {
        updatedJson['javaSpecificationVersions'] = [latestJava];
      }
      console.log(`Updated Java version to ${latestJava}`);
    }
    
    // Add/update minMuleVersion only if Mule runtime is being updated
    if (selectedUpdates.includes('mule-runtime')) {
      updatedJson['minMuleVersion'] = getLatestMuleVersion();
      console.log(`Updated minMuleVersion to ${getLatestMuleVersion()}`);
    }
    
    return updatedJson;
  };

  const updateProjectXml = (xml: string, selectedUpdates: string[]) => {
    if (typeof xml !== 'string') {
      console.error('XML content is not a string:', typeof xml);
      return String(xml);
    }
    
    let updated = xml;
    
    // Replace CloudHub connectors only if selected
    const cloudHubConnectorUpdates = selectedUpdates.filter(update => update.startsWith('connector-') && update.includes('cloudhub'));
    if (cloudHubConnectorUpdates.length > 0) {
      updated = updated.replace(/<cloudhub:[^>]*>/g, '<!-- Replaced CloudHub connector with Logger for CloudHub 2.0 -->');
      console.log(`Updated ${cloudHubConnectorUpdates.length} CloudHub connector(s)`);
    }
    
    if (!updated.includes('<!-- Updated for CloudHub 2.0 migration -->')) {
      updated += '\n<!-- Updated for CloudHub 2.0 migration -->';
    }
    return updated;
  };

  const handleSelectedMigration = async (selectedUpdates: string[]) => {
    if (!selectedApp) return;
    
    console.log('Starting migration with selected updates:', selectedUpdates);
    setMigrating(selectedApp.id);
    
    try {
      if (repositoryType === 'github' && githubToken) {
        await migrateGitHubApplication(selectedApp, selectedUpdates);
      } else if (repositoryType === 'azure_devops' && azureToken) {
        await migrateAzureApplication(selectedApp, selectedUpdates);
      }
      
      setApplications(applications.map(app => 
        app.id === selectedApp.id 
          ? { ...app, status: 'completed' as const }
          : app
      ));
      
      toast.success(`Successfully migrated ${selectedApp.applicationName} with selected updates!`);
    } catch (error) {
      console.error('Migration failed:', error);
      setApplications(applications.map(app => 
        app.id === selectedApp.id 
          ? { ...app, status: 'failed' as const }
          : app
      ));
      toast.error(`Migration failed for ${selectedApp.applicationName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setMigrating(null);
    }
  };

  const migrateGitHubApplication = async (app: MuleApplication, selectedUpdates: string[]) => {
    const repoPath = app.repository.replace('https://github.com/', '');
    
    // Get base branch SHA
    const branchRes = await axios.get(
      `https://api.github.com/repos/${repoPath}/git/refs/heads/${app.branch}`,
      { headers: { Authorization: `token ${githubToken}` } }
    );
    const baseSha = branchRes.data.object.sha;
    const newBranch = 'mulemigration';
    
    // Create branch (ignore if exists)
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
    
    // Update files based on selected updates
    for (const pomPath of app.pomPaths || []) {
      const normPomPath = pomPath.replace(/^\/+/, '');
      const pomRes = await axios.get(
        `https://api.github.com/repos/${repoPath}/contents/${normPomPath}`,
        { headers: { Authorization: `token ${githubToken}` } }
      );
      const pomSha = pomRes.data.sha;
      const pomXml = atob(pomRes.data.content.replace(/\n/g, ''));
      const updatedPom = updatePomXmlWithLatestVersions(pomXml, app.dependencies, selectedUpdates);
      
      await axios.put(
        `https://api.github.com/repos/${repoPath}/contents/${normPomPath}`,
        {
          message: 'Mule migration: update selected dependencies for CloudHub 2.0',
          content: btoa(updatedPom),
          branch: newBranch,
          sha: pomSha
        },
        { headers: { Authorization: `token ${githubToken}` } }
      );
    }
    
    // Update artifact JSON files
    for (const ajPath of app.artifactJsonPaths || []) {
      const normAjPath = ajPath.replace(/^\/+/, '');
      const ajRes = await axios.get(
        `https://api.github.com/repos/${repoPath}/contents/${normAjPath}`,
        { headers: { Authorization: `token ${githubToken}` } }
      );
      const ajSha = ajRes.data.sha;
      const ajJson = JSON.parse(atob(ajRes.data.content.replace(/\n/g, '')));
      const updatedAj = updateArtifactJsonWithLatestJava(ajJson, selectedUpdates);
      
      await axios.put(
        `https://api.github.com/repos/${repoPath}/contents/${normAjPath}`,
        {
          message: 'Mule migration: update Java version and Mule runtime for CloudHub 2.0',
          content: btoa(JSON.stringify(updatedAj, null, 2)),
          branch: newBranch,
          sha: ajSha
        },
        { headers: { Authorization: `token ${githubToken}` } }
      );
    }
  };

  const migrateAzureApplication = async (app: MuleApplication, selectedUpdates: string[]) => {
    console.log('Starting Azure DevOps migration for:', app.applicationName);
    console.log('Selected updates:', selectedUpdates);
    
    const urlParts = app.repository.split('/');
    const organization = urlParts[3];
    const project = urlParts[4];
    let repoName = urlParts[6];
    
    if (repoName && repoName.endsWith('.git')) {
      repoName = repoName.replace('.git', '');
    }
    
    const azureApi = createAzureDevOpsAPI(organization, azureToken);
    
    try {
      const repos = await azureApi.getRepositories(project);
      const targetRepo = repos.find(r => r.name === repoName || r.name === `${repoName}.git`);
      
      if (!targetRepo) {
        throw new Error(`Repository ${repoName} not found in project ${project}`);
      }
      
      const repositoryId = targetRepo.id;
      const defaultBranch = targetRepo.defaultBranch?.replace('refs/heads/', '') || 'main';
      
      console.log('Found repository:', repositoryId, 'default branch:', defaultBranch);
      
      // Create migration branch with error handling
      const branchCreated = await azureApi.createBranch(project, repositoryId, 'mulemigration', defaultBranch);
      console.log('Branch creation result:', branchCreated);
      
      // Prepare files for commit
      const filesToCommit = [];
      
      // Update POM files only if there are dependency or runtime updates selected
      if (app.pomPaths && (selectedUpdates.some(u => u.startsWith('dependency-')) || selectedUpdates.includes('mule-runtime'))) {
        for (const pomPath of app.pomPaths) {
          console.log('Processing POM file:', pomPath);
          const pomContent = await azureApi.getFileContent(project, repositoryId, pomPath);
          if (pomContent && typeof pomContent === 'string') {
            const updatedPom = updatePomXmlWithLatestVersions(pomContent, app.dependencies, selectedUpdates);
            if (updatedPom !== pomContent) {
              filesToCommit.push({ path: pomPath, content: updatedPom });
              console.log('Added POM file to commit:', pomPath);
            }
          }
        }
      }
      
      // Update artifact JSON files only if Java or Mule runtime updates are selected
      if (app.artifactJsonPaths && (selectedUpdates.includes('java-version') || selectedUpdates.includes('mule-runtime'))) {
        for (const ajPath of app.artifactJsonPaths) {
          console.log('Processing artifact JSON file:', ajPath);
          const ajContent = await azureApi.getFileContent(project, repositoryId, ajPath);
          if (ajContent) {
            let ajJson;
            if (typeof ajContent === 'string') {
              ajJson = JSON.parse(ajContent);
            } else {
              ajJson = ajContent;
            }
            
            const updatedAj = updateArtifactJsonWithLatestJava(ajJson, selectedUpdates);
            const updatedContent = JSON.stringify(updatedAj, null, 2);
            if (updatedContent !== JSON.stringify(ajJson, null, 2)) {
              filesToCommit.push({ path: ajPath, content: updatedContent });
              console.log('Added artifact JSON file to commit:', ajPath);
            }
          }
        }
      }
      
      // Update project XML files only if connector updates are selected
      if (app.projectXmlPaths && selectedUpdates.some(u => u.startsWith('connector-'))) {
        for (const xmlPath of app.projectXmlPaths) {
          console.log('Processing project XML file:', xmlPath);
          const xmlContent = await azureApi.getFileContent(project, repositoryId, xmlPath);
          if (xmlContent && typeof xmlContent === 'string') {
            const updatedXml = updateProjectXml(xmlContent, selectedUpdates);
            if (updatedXml !== xmlContent) {
              filesToCommit.push({ path: xmlPath, content: updatedXml });
              console.log('Added project XML file to commit:', xmlPath);
            }
          }
        }
      }
      
      console.log('Total files to commit:', filesToCommit.length);
      
      // Commit all changes
      if (filesToCommit.length > 0) {
        const committed = await azureApi.commitFiles(
          project, 
          repositoryId, 
          'mulemigration', 
          filesToCommit, 
          `Mule migration: update selected components for CloudHub 2.0 (${selectedUpdates.join(', ')})`
        );
        
        console.log('Commit result:', committed);
        
        if (!committed) {
          throw new Error('Failed to commit migration changes. Please verify your Azure DevOps PAT has the following permissions: Code (read & write), Project and team (read)');
        }
      } else {
        console.log('No files needed to be updated based on selected options');
        toast.info('No changes were needed based on your selected updates');
      }
    } catch (error) {
      console.error('Azure DevOps migration error:', error);
      throw error;
    }
  };

  const selectedAppsCount = applications.filter(app => app.selected).length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="text-2xl">Mule Applications Found</CardTitle>
              <p className="text-gray-600 mt-1">
                Review and migrate your Mule applications to CloudHub 2.0
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm text-gray-600">Total Applications</p>
                <p className="text-2xl font-bold text-blue-600">{applications.length}</p>
              </div>
              {applications.length > 0 && (
                <div className="flex flex-col gap-2">
                  <Button
                    onClick={toggleSelectAll}
                    variant="outline"
                    size="sm"
                    className="w-24"
                  >
                    {applications.every(app => app.selected) ? 'Deselect All' : 'Select All'}
                  </Button>
                  <Button
                    onClick={handleMigrateAll}
                    disabled={selectedAppsCount === 0 || migratingAll}
                    className="w-24 bg-green-600 hover:bg-green-700"
                    size="sm"
                  >
                    <Play className="h-4 w-4 mr-1" />
                    {migratingAll ? 'Migrating...' : `Migrate All (${selectedAppsCount})`}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {applications.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p className="text-lg">No Mule applications found</p>
              <p>Scan repositories to find Mule applications</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Select</TableHead>
                    <TableHead>Application</TableHead>
                    <TableHead>Repository</TableHead>
                    <TableHead>Current Versions</TableHead>
                    <TableHead>Latest Versions</TableHead>
                    <TableHead>Updates Available</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {applications.map((app) => {
                    const { totalUpdates, criticalUpdates } = getUpdateSummary(app);
                    
                    return (
                      <TableRow key={app.id} className="hover:bg-gray-50">
                        <TableCell>
                          <Checkbox
                            checked={!!app.selected}
                            onCheckedChange={() => toggleApplicationSelection(app.id)}
                          />
                        </TableCell>
                        
                        <TableCell>
                          <div>
                            <p className="font-medium">{app.applicationName}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <GitBranch className="h-3 w-3 text-gray-400" />
                              <span className="text-xs text-gray-500">{app.branch}</span>
                            </div>
                          </div>
                        </TableCell>
                        
                        <TableCell>
                          <a 
                            href={app.repository} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="text-blue-600 hover:underline text-sm"
                          >
                            {repositoryType === 'github' 
                              ? app.repository.split('/').slice(-2).join('/')
                              : app.repository.split('/').slice(-1)[0]
                            }
                          </a>
                        </TableCell>
                        
                        <TableCell>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-600">Mule:</span>
                              <Badge variant="outline" className="text-xs">
                                {app.muleRuntime}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-600">Java:</span>
                              <Badge variant="outline" className="text-xs">
                                {app.javaVersion}
                              </Badge>
                            </div>
                          </div>
                        </TableCell>
                        
                        <TableCell>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-600">Mule:</span>
                              <Badge variant="default" className="text-xs bg-green-100 text-green-800">
                                {getLatestMuleVersion()}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-600">Java:</span>
                              <Badge variant="default" className="text-xs bg-green-100 text-green-800">
                                {getLatestJavaVersion()}
                              </Badge>
                            </div>
                          </div>
                        </TableCell>
                        
                        <TableCell>
                          <div className="space-y-1">
                            {totalUpdates > 0 ? (
                              <>
                                <div className="flex items-center gap-2">
                                  <Badge 
                                    variant={criticalUpdates > 0 ? "destructive" : "secondary"} 
                                    className="text-xs"
                                  >
                                    {totalUpdates} update{totalUpdates !== 1 ? 's' : ''}
                                  </Badge>
                                </div>
                                {criticalUpdates > 0 && (
                                  <div className="flex items-center gap-1">
                                    <AlertTriangle className="h-3 w-3 text-red-500" />
                                    <span className="text-xs text-red-600">
                                      {criticalUpdates} critical
                                    </span>
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3 text-green-500" />
                                <span className="text-xs text-green-600">Up to date</span>
                              </div>
                            )}
                          </div>
                        </TableCell>
                        
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getStatusIcon(app.status)}
                            <span className={`text-xs ${getStatusColor(app.status)}`}>
                              {app.status.replace('_', ' ')}
                            </span>
                          </div>
                        </TableCell>
                        
                        <TableCell>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleViewDetails(app)}
                            disabled={migrating === app.id}
                            className="text-xs"
                          >
                            <Eye className="h-3 w-3 mr-1" />
                            {migrating === app.id ? 'Migrating...' : 'View Details'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <MigrationDetailsDialog
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
        application={selectedApp}
        onMigrate={handleSelectedMigration}
      />
    </div>
  );
};

export default RepositoryList;
