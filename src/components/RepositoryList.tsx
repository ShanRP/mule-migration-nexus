import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CheckCircle2, AlertTriangle, XCircle, ExternalLink, Eye, RefreshCw, Settings, Info } from 'lucide-react';
import { toast } from 'sonner';
import { useOrganizations } from '@/providers/OrganizationProvider';
import axios from 'axios';
import { useState } from 'react';
import { getLatestMuleVersion, getLatestJavaVersion } from '@/utils/muleDetection';
import { formatDistanceToNow } from 'date-fns';
import { createAzureDevOpsAPI } from '@/utils/azureDevopsApi';
import MigrationDetailsDialog from './MigrationDetailsDialog';
import RulesDialog from './RulesDialog';
import UpdatesDialog from './UpdatesDialog';

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
  savedSelections?: MigrationSelections;
}

interface MigrationSelections {
  muleRuntime: boolean;
  javaVersion: boolean;
  minMuleVersion: boolean;
  dependencies: string[];
  connectors: string[];
}

interface MigrationRules {
  javaVersion: string;
  muleVersion: string;
  minMuleVersion: string;
  connectorReplacements: { from: string; to: string; }[];
  dependencyVersions: { artifactId: string; version: string; }[];
}

interface RepositoryListProps {
  applications: MuleApplication[];
  setApplications: React.Dispatch<React.SetStateAction<MuleApplication[]>>;
  onMigrateAll: () => void;
}

const RepositoryList: React.FC<RepositoryListProps> = ({ 
  applications, 
  setApplications, 
  onMigrateAll 
}) => {
  const { selectedOrganization } = useOrganizations();
  const [migrating, setMigrating] = React.useState(false);
  const [selectedApp, setSelectedApp] = useState<MuleApplication | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [rulesDialogOpen, setRulesDialogOpen] = useState(false);
  const [updatesDialogOpen, setUpdatesDialogOpen] = useState(false);
  const [migrationRules, setMigrationRules] = useState<MigrationRules>({
    javaVersion: getLatestJavaVersion(),
    muleVersion: getLatestMuleVersion(),
    minMuleVersion: getLatestMuleVersion(),
    connectorReplacements: [
      { from: 'cloudhub', to: 'logger' }
    ],
    dependencyVersions: []
  });

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

  // Function to save rules configuration with priority logging
  const handleSaveRules = (rules: MigrationRules) => {
    setMigrationRules(rules);
    console.log('Migration rules updated and will take HIGHEST PRIORITY:', rules);
    toast.success('Migration rules saved and will be prioritized during migration!');
  };

  // Function to save selections for an application
  const handleSaveSelections = (app: MuleApplication, selections: MigrationSelections) => {
    setApplications(prev => prev.map(a => 
      a.id === app.id 
        ? { ...a, savedSelections: selections }
        : a
    ));
  };

  // PRIORITY SYSTEM: Rules ALWAYS take precedence over defaults
  const getRuleBasedJavaVersion = () => {
    console.log('Checking Java version - Rules first, then defaults');
    console.log('Rules Java version:', migrationRules.javaVersion);
    console.log('Default Java version:', getLatestJavaVersion());
    // Rules ALWAYS take priority
    return migrationRules.javaVersion || getLatestJavaVersion();
  };

  const getRuleBasedMuleVersion = () => {
    console.log('Checking Mule version - Rules first, then defaults');
    console.log('Rules Mule version:', migrationRules.muleVersion);
    console.log('Default Mule version:', getLatestMuleVersion());
    // Rules ALWAYS take priority
    return migrationRules.muleVersion || getLatestMuleVersion();
  };

  const getRuleBasedMinMuleVersion = () => {
    console.log('Checking Min Mule version - Rules first, then defaults');
    console.log('Rules Min Mule version:', migrationRules.minMuleVersion);
    console.log('Default Min Mule version:', getLatestMuleVersion());
    // Rules ALWAYS take priority
    return migrationRules.minMuleVersion || getLatestMuleVersion();
  };
  
  const getRuleBasedDependencyVersion = (artifactId: string, defaultVersion: string) => {
    console.log(`Checking dependency version for ${artifactId} - Rules first, then defaults`);
    
    // FIRST PRIORITY: Check migration rules for custom dependency version
    const customRule = migrationRules.dependencyVersions.find(dep => dep.artifactId === artifactId);
    if (customRule && customRule.version) {
      console.log(`RULES PRIORITY: Using custom version ${customRule.version} for ${artifactId} (from migration rules)`);
      return customRule.version;
    }
    
    console.log(`No custom rule found for ${artifactId}, using default version: ${defaultVersion}`);
    return defaultVersion;
  };
  
  const getRuleBasedConnectorReplacement = (connectorName: string) => {
    console.log(`Checking connector replacement for ${connectorName} - Rules first, then defaults`);
    
    // FIRST PRIORITY: Check migration rules for custom connector replacement
    const customReplacement = migrationRules.connectorReplacements.find(rep => 
      connectorName.toLowerCase().includes(rep.from.toLowerCase())
    );
    
    if (customReplacement && customReplacement.to) {
      console.log(`RULES PRIORITY: Using custom replacement ${customReplacement.to} for ${connectorName} (from migration rules)`);
      return customReplacement.to;
    }
    
    console.log(`No custom rule found for ${connectorName}, using default replacement: logger`);
    return 'logger';
  };

  // Enhanced function to update dependency versions in POM XML with RULES PRIORITY
  const updatePomDependencies = (pomXml: string, dependencies: MuleDependency[], selections: MigrationSelections): string => {
    let updatedPom = pomXml;
    
    console.log('=== POM UPDATE: Migration Rules take HIGHEST PRIORITY ===');
    
    // Update app.runtime version if selected - RULES FIRST
    if (selections.muleRuntime) {
      const ruleBasedMuleVersion = getRuleBasedMuleVersion();
      console.log(`Updating app.runtime to: ${ruleBasedMuleVersion} (prioritizing rules)`);
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
    
    // Update selected dependencies - RULES TAKE PRIORITY OVER EVERYTHING
    dependencies.forEach(dep => {
      if (selections.dependencies.includes(dep.artifactId)) {
        // PRIORITY 1: Check migration rules first
        const ruleBasedVersion = getRuleBasedDependencyVersion(dep.artifactId, dep.latestVersion);
        
        if (ruleBasedVersion && ruleBasedVersion !== dep.version) {
          console.log(`PRIORITY UPDATE: ${dep.artifactId} from ${dep.version} to ${ruleBasedVersion}`);
          
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
    
    if (!updatedPom.includes('<!-- Updated for CloudHub 2.0 migration -->')) {
      updatedPom = updatedPom + '\n<!-- Updated for CloudHub 2.0 migration -->';
    }
    
    return updatedPom;
  };

  // Enhanced function to replace connectors with RULES PRIORITY
  const replaceCloudHubConnectors = (xmlContent: string, selections: MigrationSelections): string => {
    let updatedXml = xmlContent;
    
    console.log('=== CONNECTOR REPLACEMENT: Migration Rules take HIGHEST PRIORITY ===');
    
    // Only process selected connectors
    const selectedCloudHubConnectors = selections.connectors.filter(name => 
      name.toLowerCase().includes('cloudhub')
    );
    
    if (selectedCloudHubConnectors.length === 0) {
      return xmlContent;
    }
    
    // PRIORITY 1: Get replacement connector from migration rules
    const ruleBasedReplacement = getRuleBasedConnectorReplacement('cloudhub');
    console.log(`Using connector replacement: ${ruleBasedReplacement} (from migration rules priority)`);
    
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
        replacement: `<${ruleBasedReplacement}:log level="INFO" message="CloudHub notification replaced with ${ruleBasedReplacement} for CloudHub 2.0 migration (rules priority)" />`
      },
      {
        pattern: /<cloudhub:create-notification[^>]*\/>/g,
        replacement: `<${ruleBasedReplacement}:log level="INFO" message="CloudHub notification replaced with ${ruleBasedReplacement} for CloudHub 2.0 migration (rules priority)" />`
      },
      {
        pattern: /<cloudhub:list-notifications[^>]*>[\s\S]*?<\/cloudhub:list-notifications>/g,
        replacement: `<${ruleBasedReplacement}:log level="INFO" message="CloudHub list notifications replaced with ${ruleBasedReplacement} for CloudHub 2.0 migration (rules priority)" />`
      },
      {
        pattern: /<cloudhub:list-notifications[^>]*\/>/g,
        replacement: `<${ruleBasedReplacement}:log level="INFO" message="CloudHub list notifications replaced with ${ruleBasedReplacement} for CloudHub 2.0 migration (rules priority)" />`
      },
      {
        pattern: /<cloudhub:get-application[^>]*>[\s\S]*?<\/cloudhub:get-application>/g,
        replacement: `<${ruleBasedReplacement}:log level="INFO" message="CloudHub get application replaced with ${ruleBasedReplacement} for CloudHub 2.0 migration (rules priority)" />`
      },
      {
        pattern: /<cloudhub:get-application[^>]*\/>/g,
        replacement: `<${ruleBasedReplacement}:log level="INFO" message="CloudHub get application replaced with ${ruleBasedReplacement} for CloudHub 2.0 migration (rules priority)" />`
      },
      {
        pattern: /<cloudhub:[^>]*>[\s\S]*?<\/cloudhub:[^>]*>/g,
        replacement: `<${ruleBasedReplacement}:log level="INFO" message="CloudHub operation replaced with ${ruleBasedReplacement} for CloudHub 2.0 migration (rules priority)" />`
      },
      {
        pattern: /<cloudhub:[^>]*\/>/g,
        replacement: `<${ruleBasedReplacement}:log level="INFO" message="CloudHub operation replaced with ${ruleBasedReplacement} for CloudHub 2.0 migration (rules priority)" />`
      }
    ];
    
    cloudHubPatterns.forEach(({ pattern, replacement }) => {
      const matches = updatedXml.match(pattern);
      if (matches) {
        console.log(`RULES PRIORITY: Replacing CloudHub connectors with ${ruleBasedReplacement}:`, matches);
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

  // Enhanced GitHub migration function with RULES PRIORITY
  const migrateGitHubApplication = async (app: MuleApplication, selections: MigrationSelections) => {
    console.log('=== GITHUB MIGRATION: Applying Rules with HIGHEST PRIORITY ===');
    console.log('Application:', app.applicationName);
    console.log('Current Migration Rules:', migrationRules);
    console.log('Selected Migration Items:', selections);
    
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
    
    // Update POM files if muleRuntime or dependencies are selected - RULES PRIORITY
    if ((selections.muleRuntime || selections.dependencies.length > 0) && app.pomPaths) {
      for (const pomPath of app.pomPaths) {
        try {
          const pomRes = await axios.get(
            `https://api.github.com/repos/${repoPath}/contents/${pomPath}?ref=${app.branch}`,
            { headers: { Authorization: `token ${githubToken}` } }
          );
          const pomSha = pomRes.data.sha;
          const pomXml = atob(pomRes.data.content.replace(/\n/g, ''));
          
          // Apply migration rules with HIGHEST PRIORITY
          let updatedPom = pomXml;
          
          // Update app.runtime version using migration rules
          if (selections.muleRuntime) {
            console.log(`RULES PRIORITY: Setting Mule version to ${migrationRules.muleVersion}`);
            updatedPom = updatedPom.replace(
              /<app\.runtime>.*?<\/app\.runtime>/g,
              `<app.runtime>${migrationRules.muleVersion}</app.runtime>`
            );
          }
          
          // Update dependencies using migration rules
          app.dependencies.forEach(dep => {
            if (selections.dependencies.includes(dep.artifactId)) {
              // Check migration rules first
              const customRule = migrationRules.dependencyVersions.find(rule => rule.artifactId === dep.artifactId);
              const targetVersion = customRule ? customRule.version : dep.latestVersion;
              
              console.log(`RULES PRIORITY: Updating ${dep.artifactId} to ${targetVersion}`);
              
              const dependencyRegex = new RegExp(
                `(<dependency>[\\s\\S]*?<groupId>${dep.groupId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/groupId>[\\s\\S]*?<artifactId>${dep.artifactId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/artifactId>[\\s\\S]*?<version>).*?(<\\/version>[\\s\\S]*?<\\/dependency>)`,
                'g'
              );
              
              updatedPom = updatedPom.replace(dependencyRegex, `$1${targetVersion}$2`);
            }
          });
          
          updatedPom += '\n<!-- Updated for CloudHub 2.0 migration with rules priority -->';
          
          await axios.put(
            `https://api.github.com/repos/${repoPath}/contents/${pomPath}`,
            {
              message: `Mule migration: update selected dependencies for CloudHub 2.0 with rules priority - ${pomPath}`,
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
    
    // Update artifact JSON files using migration rules
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
            console.log(`RULES PRIORITY: Setting Java version to ${migrationRules.javaVersion}`);
            updatedAj.javaSpecificationVersions = [migrationRules.javaVersion];
          }
          
          if (selections.minMuleVersion) {
            console.log(`RULES PRIORITY: Setting min Mule version to ${migrationRules.minMuleVersion}`);
            updatedAj.minMuleVersion = migrationRules.minMuleVersion;
          }
          
          await axios.put(
            `https://api.github.com/repos/${repoPath}/contents/${ajPath}`,
            {
              message: `Mule migration: update artifact configuration for CloudHub 2.0 with rules priority - ${ajPath}`,
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
    
    // Update project XML files using migration rules
    if (selections.connectors.length > 0 && app.projectXmlPaths) {
      for (const xmlPath of app.projectXmlPaths) {
        try {
          const xmlRes = await axios.get(
            `https://api.github.com/repos/${repoPath}/contents/${xmlPath}?ref=${app.branch}`,
            { headers: { Authorization: `token ${githubToken}` } }
          );
          const xmlSha = xmlRes.data.sha;
          let xmlContent = atob(xmlRes.data.content.replace(/\n/g, ''));
          
          // Apply connector replacements using migration rules
          const selectedCloudHubConnectors = selections.connectors.filter(name => 
            name.toLowerCase().includes('cloudhub')
          );
          
          if (selectedCloudHubConnectors.length > 0) {
            // Get replacement from migration rules
            const replacementRule = migrationRules.connectorReplacements.find(rule => 
              'cloudhub'.includes(rule.from.toLowerCase())
            );
            const replacement = replacementRule ? replacementRule.to : 'logger';
            
            console.log(`RULES PRIORITY: Replacing CloudHub connectors with ${replacement}`);
            
            // Replace CloudHub connectors
            xmlContent = xmlContent.replace(
              /<cloudhub:[^>]*\/>/g,
              `<${replacement}:log level="INFO" message="CloudHub operation replaced with ${replacement} for CloudHub 2.0 migration (rules priority)" />`
            );
          }
          
          xmlContent += '\n<!-- Updated for CloudHub 2.0 migration with rules priority -->';
          
          await axios.put(
            `https://api.github.com/repos/${repoPath}/contents/${xmlPath}`,
            {
              message: `Mule migration: update selected connectors for CloudHub 2.0 with rules priority - ${xmlPath}`,
              content: btoa(xmlContent),
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
  const migrateAzureApplication = async (app: MuleApplication, selections: MigrationSelections) => {
    try {
      console.log('=== AZURE DEVOPS MIGRATION: Applying Rules with HIGHEST PRIORITY ===');
      console.log('Application:', app.applicationName);
      console.log('Current Migration Rules:', migrationRules);
      console.log('Selected Migration Items:', selections);
      
      const urlParts = app.repository.split('/');
      const organization = urlParts[3];
      const project = urlParts[4];
      const repoId = app.id;
      
      // Use edge function for Azure DevOps operations with migration rules
      const { data: response } = await axios.post('/api/azure-devops', {
        operation: 'commitFiles',
        organization: organization,
        requestData: {
          project: project,
          repositoryId: repoId,
          branchName: 'mulemigration',
          files: [
            // Prepare files with migration rules and selections
            ...(app.pomPaths || []).map(path => ({
              path: path,
              content: '', // Content will be fetched and processed by edge function
              selections: selections,
              dependencies: app.dependencies,
              migrationRules: migrationRules
            })),
            ...(app.artifactJsonPaths || []).map(path => ({
              path: path,
              content: '',
              selections: selections,
              migrationRules: migrationRules
            })),
            ...(app.projectXmlPaths || []).map(path => ({
              path: path,
              content: '',
              selections: selections,
              migrationRules: migrationRules
            }))
          ],
          message: 'Mule migration: update selected components for CloudHub 2.0 with rules priority',
          migrationRules: migrationRules
        }
      });
      
      if (response.success) {
        return true;
      } else {
        throw new Error('Failed to commit migration changes via edge function');
      }
    } catch (error) {
      console.error(`Error migrating Azure DevOps application ${app.name}:`, error);
      toast.error(`Failed to migrate ${app.name}: ${error.message}`);
      return false;
    }
  };

  // Handle selective migration from dialog with RULES PRIORITY
  const handleSelectiveMigration = async (app: MuleApplication, selections: MigrationSelections) => {
    setMigrating(true);
    try {
      console.log('=== STARTING SELECTIVE MIGRATION WITH RULES PRIORITY ===');
      console.log('Application:', app.applicationName);
      console.log('Migration selections:', selections);
      console.log('Current migration rules (HIGHEST PRIORITY):', migrationRules);
      
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
      
      toast.success(`Migration completed for ${app.applicationName} with rules priority!`);
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

  const openUpdatesDialog = (app: MuleApplication) => {
    setSelectedApp(app);
    setUpdatesDialogOpen(true);
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
    
    // Check for dependency updates
    count += app.dependencies.filter(dep => dep.version !== dep.latestVersion).length;
    
    // Check for deprecated items
    count += app.dependencies.filter(dep => dep.isDeprecated).length;
    count += app.connectors.filter(conn => conn.isDeprecated).length;
    
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
    
    const depUpdates = app.dependencies.filter(dep => dep.version !== dep.latestVersion).length;
    if (depUpdates > 0) {
      updates.push(`${depUpdates} dependency updates`);
    }
    
    const deprecatedCount = app.dependencies.filter(dep => dep.isDeprecated).length + 
                           app.connectors.filter(conn => conn.isDeprecated).length;
    if (deprecatedCount > 0) {
      updates.push(`${deprecatedCount} deprecated items`);
    }
    
    return updates.join(', ');
  };

  const selectedCount = applications.filter(app => app.selected).length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Mule Applications ({applications.length} found)</span>
            <div className="flex items-center space-x-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setRulesDialogOpen(true)}
                className="flex items-center space-x-1 bg-yellow-50 border-yellow-300 text-yellow-800 hover:bg-yellow-100"
              >
                <Settings className="h-4 w-4" />
                <span>Rules (Priority)</span>
              </Button>
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
            Select applications and view details to customize your CloudHub 2.0 migration. Use Rules to configure custom versions and replacements with <strong>HIGHEST PRIORITY</strong>.
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
                {applications.map((app) => (
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
                        {getTotalUpdateCount(app) > 0 && (
                          <div className="flex items-center space-x-2">
                            <Badge variant="outline" className="text-blue-600 text-xs">
                              {getTotalUpdateCount(app)} updates
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openUpdatesDialog(app)}
                              className="h-6 w-6 p-0"
                            >
                              <Info className="h-4 w-4 text-blue-600" />
                            </Button>
                          </div>
                        )}
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
                      </div>
                    </TableCell>
                    <TableCell className="border border-gray-300">
                      <div className="space-y-1">
                        <div className="text-sm font-medium">{app.dependencies.length} total</div>
                        {app.dependencies.filter(dep => dep.version !== dep.latestVersion).length > 0 && (
                          <Badge variant="outline" className="text-yellow-600 text-xs">
                            {app.dependencies.filter(dep => dep.version !== dep.latestVersion).length} updates
                          </Badge>
                        )}
                        {app.dependencies.filter(dep => dep.isDeprecated).length > 0 && (
                          <Badge variant="destructive" className="text-xs">
                            {app.dependencies.filter(dep => dep.isDeprecated).length} deprecated
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="border border-gray-300">
                      <div className="space-y-1">
                        <div className="text-sm font-medium">{app.connectors.length} total</div>
                        {app.connectors.filter(conn => conn.isDeprecated).length > 0 && (
                          <Badge variant="destructive" className="text-xs">
                            {app.connectors.filter(conn => conn.isDeprecated).length} deprecated
                          </Badge>
                        )}
                        {app.connectors.filter(conn => conn.cloudHub2Alternative).length > 0 && (
                          <Badge variant="outline" className="text-blue-600 text-xs">
                            {app.connectors.filter(conn => conn.cloudHub2Alternative).length} need replacement
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
                ))}
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
        onSaveSelections={handleSaveSelections}
        repositoryType={repositoryType || 'github'}
      />

      {/* Updates Dialog */}
      <UpdatesDialog
        application={selectedApp}
        isOpen={updatesDialogOpen}
        onClose={() => setUpdatesDialogOpen(false)}
      />

      {/* Rules Dialog */}
      <RulesDialog
        isOpen={rulesDialogOpen}
        onClose={() => setRulesDialogOpen(false)}
        onSaveRules={handleSaveRules}
        currentRules={migrationRules}
      />
    </div>
  );
};

export default RepositoryList;
