
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Eye, GitBranch, Calendar, ArrowRight, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
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

  const repositoryType = selectedOrganization?.repository_type;
  const githubToken = selectedOrganization?.github_token || '';
  const azureToken = selectedOrganization?.azure_devops_token || '';

  const toggleApplicationSelection = (appId: string) => {
    setApplications(applications.map(app => 
      app.id === appId ? { ...app, selected: !app.selected } : app
    ));
  };

  const handleViewDetails = (app: MuleApplication) => {
    setSelectedApp(app);
    setDetailsDialogOpen(true);
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

  // Helper functions for file operations and migration
  const updatePomXmlWithLatestVersions = (pomXml: string, dependencies: any[], selectedUpdates: string[]) => {
    if (typeof pomXml !== 'string') {
      console.error('POM XML is not a string:', typeof pomXml);
      return String(pomXml);
    }
    
    let updated = pomXml;
    dependencies.forEach(dep => {
      const updateKey = `dependency-${dep.artifactId}`;
      if (selectedUpdates.includes(updateKey) && dep.latestVersion && dep.version && dep.latestVersion !== dep.version) {
        const regex = new RegExp(`(<artifactId>${dep.artifactId}</artifactId>[\\s\\S]*?<version>)([^<]+)(</version>)`, 'g');
        updated = updated.replace(regex, `$1${dep.latestVersion}$3`);
      }
    });
    
    // Update Mule runtime if selected
    if (selectedUpdates.includes('mule-runtime')) {
      const runtimeRegex = /(<app\.runtime>)([^<]+)(<\/app\.runtime>)/g;
      updated = updated.replace(runtimeRegex, `$1${getLatestMuleVersion()}$3`);
    }
    
    if (!updated.includes('<!-- Updated for CloudHub 2.0 migration -->')) {
      updated += '\n<!-- Updated for CloudHub 2.0 migration -->';
    }
    return updated;
  };

  const updateArtifactJsonWithLatestJava = (artifactJson: any, selectedUpdates: string[]) => {
    if (!artifactJson || !selectedUpdates.includes('java-version')) return artifactJson;
    
    const latestJava = getLatestJavaVersion();
    const updatedJson = { ...artifactJson };
    
    // Update Java version
    if (Array.isArray(updatedJson['javaSpecificationVersions'])) {
      updatedJson['javaSpecificationVersions'][0] = latestJava;
    } else if (updatedJson['javaversion']) {
      updatedJson['javaversion'] = latestJava;
    } else if (updatedJson['javaVersion']) {
      updatedJson['javaVersion'] = latestJava;
    } else if (updatedJson['java']) {
      updatedJson['java'] = latestJava;
    } else {
      // Add javaSpecificationVersions if it doesn't exist
      updatedJson['javaSpecificationVersions'] = [latestJava];
    }
    
    // Add/update minMuleVersion if Mule runtime is being updated
    if (selectedUpdates.includes('mule-runtime')) {
      updatedJson['minMuleVersion'] = getLatestMuleVersion();
    }
    
    return updatedJson;
  };

  const updateProjectXml = (xml: string, selectedUpdates: string[]) => {
    if (typeof xml !== 'string') {
      console.error('XML content is not a string:', typeof xml);
      return String(xml);
    }
    
    let updated = xml;
    
    // Replace CloudHub connectors with Logger connectors if selected
    const cloudHubConnectorUpdates = selectedUpdates.filter(update => update.startsWith('connector-') && update.includes('cloudhub'));
    if (cloudHubConnectorUpdates.length > 0) {
      // Replace CloudHub operations with Logger operations
      updated = updated.replace(/<cloudhub:[^>]*>/g, '<!-- Replaced CloudHub connector with Logger for CloudHub 2.0 -->');
    }
    
    if (!updated.includes('<!-- Updated for CloudHub 2.0 migration -->')) {
      updated += '\n<!-- Updated for CloudHub 2.0 migration -->';
    }
    return updated;
  };

  const handleSelectedMigration = async (selectedUpdates: string[]) => {
    if (!selectedApp) return;
    
    setMigrating(selectedApp.id);
    
    try {
      if (repositoryType === 'github' && githubToken) {
        await migrateGitHubApplication(selectedApp, selectedUpdates);
      } else if (repositoryType === 'azure_devops' && azureToken) {
        await migrateAzureApplication(selectedApp, selectedUpdates);
      }
      
      // Update application status
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
      toast.error(`Migration failed for ${selectedApp.applicationName}`);
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
    const urlParts = app.repository.split('/');
    const organization = urlParts[3];
    const project = urlParts[4];
    let repoName = urlParts[6];
    
    if (repoName && repoName.endsWith('.git')) {
      repoName = repoName.replace('.git', '');
    }
    
    const azureApi = createAzureDevOpsAPI(organization, azureToken);
    
    const repos = await azureApi.getRepositories(project);
    const targetRepo = repos.find(r => r.name === repoName || r.name === `${repoName}.git`);
    
    if (!targetRepo) {
      throw new Error(`Repository ${repoName} not found in project ${project}`);
    }
    
    const repositoryId = targetRepo.id;
    const defaultBranch = targetRepo.defaultBranch || 'main';
    
    // Create migration branch
    const branchCreated = await azureApi.createBranch(project, repositoryId, 'mulemigration', defaultBranch);
    if (!branchCreated) {
      console.warn('Failed to create migration branch, but continuing...');
    }
    
    // Prepare files for commit
    const filesToCommit = [];
    
    // Update POM files
    for (const pomPath of app.pomPaths || []) {
      const pomContent = await azureApi.getFileContent(project, repositoryId, pomPath);
      if (pomContent && typeof pomContent === 'string') {
        const updatedPom = updatePomXmlWithLatestVersions(pomContent, app.dependencies, selectedUpdates);
        filesToCommit.push({ path: pomPath, content: updatedPom });
      }
    }
    
    // Update artifact JSON files
    for (const ajPath of app.artifactJsonPaths || []) {
      const ajContent = await azureApi.getFileContent(project, repositoryId, ajPath);
      if (ajContent) {
        let ajJson;
        if (typeof ajContent === 'string') {
          ajJson = JSON.parse(ajContent);
        } else {
          ajJson = ajContent;
        }
        
        const updatedAj = updateArtifactJsonWithLatestJava(ajJson, selectedUpdates);
        filesToCommit.push({ path: ajPath, content: JSON.stringify(updatedAj, null, 2) });
      }
    }
    
    // Update project XML files
    for (const xmlPath of app.projectXmlPaths || []) {
      const xmlContent = await azureApi.getFileContent(project, repositoryId, xmlPath);
      if (xmlContent && typeof xmlContent === 'string') {
        const updatedXml = updateProjectXml(xmlContent, selectedUpdates);
        filesToCommit.push({ path: xmlPath, content: updatedXml });
      }
    }
    
    // Commit all changes
    if (filesToCommit.length > 0) {
      const committed = await azureApi.commitFiles(
        project, 
        repositoryId, 
        'mulemigration', 
        filesToCommit, 
        'Mule migration: update selected components for CloudHub 2.0'
      );
      
      if (!committed) {
        throw new Error('Failed to commit migration changes. Please check your PAT permissions.');
      }
    }
  };

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
            <div className="text-right">
              <p className="text-sm text-gray-600">Total Applications</p>
              <p className="text-2xl font-bold text-blue-600">{applications.length}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
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
