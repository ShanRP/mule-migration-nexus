import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CheckCircle2, AlertTriangle, XCircle, ExternalLink, Eye, RefreshCw, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { useOrganizations } from '@/providers/OrganizationProvider';
import axios from 'axios';
import { useState } from 'react';
import { getLatestMuleVersion, getLatestJavaVersion } from '@/utils/muleDetection';
import { formatDistanceToNow } from 'date-fns';
import { createAzureDevOpsAPI } from '@/utils/azureDevopsApi';
import MigrationDetailsDialog from './MigrationDetailsDialog';
import RulesDialog from './RulesDialog';

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
  onMigrateAll: (rules: MigrationRules) => void;
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
    console.log('=== MIGRATION RULES SAVED WITH HIGHEST PRIORITY ===');
    console.log('Rules will override ALL default values:', rules);
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

  // CRITICAL FIX: Rules-based version functions with proper fallback
  const getRuleBasedJavaVersion = () => {
    const version = migrationRules.javaVersion;
    console.log(`CRITICAL: Java Version from Rules: "${version}"`);
    return version; // Don't fallback to default - use rules value directly
  };

  const getRuleBasedMuleVersion = () => {
    const version = migrationRules.muleVersion;
    console.log(`CRITICAL: Mule Version from Rules: "${version}"`);
    return version; // Don't fallback to default - use rules value directly
  };

  const getRuleBasedMinMuleVersion = () => {
    const version = migrationRules.minMuleVersion;
    console.log(`CRITICAL: Min Mule Version from Rules: "${version}"`);
    return version; // Don't fallback to default - use rules value directly
  };
  
  const getRuleBasedDependencyVersion = (artifactId: string, defaultVersion: string) => {
    const customRule = migrationRules.dependencyVersions.find(dep => dep.artifactId === artifactId);
    const version = customRule?.version || defaultVersion;
    console.log(`Dependency ${artifactId} Priority Check - Rules: ${customRule?.version}, Default: ${defaultVersion}, Using: ${version}`);
    return version;
  };
  
  const getRuleBasedConnectorReplacement = (connectorName: string) => {
    const customReplacement = migrationRules.connectorReplacements.find(rep => 
      connectorName.toLowerCase().includes(rep.from.toLowerCase())
    );
    const replacement = customReplacement?.to || 'logger';
    console.log(`Connector ${connectorName} Priority Check - Rules: ${customReplacement?.to}, Using: ${replacement}`);
    return replacement;
  };

  // Enhanced function to update dependency versions in POM XML with RULES PRIORITY
  const updatePomDependencies = (pomXml: string, dependencies: MuleDependency[], selections: MigrationSelections, rules: MigrationRules): string => {
    let updatedPom = pomXml;
    
    console.log('=== POM UPDATE: MIGRATION RULES HAVE ABSOLUTE PRIORITY ===');
    console.log('Active Migration Rules:', rules);
    
    // Update app.runtime version if selected - RULES FIRST
    if (selections.muleRuntime) {
      const ruleBasedMuleVersion = rules.muleVersion;
      console.log(`RULES PRIORITY: Setting app.runtime to ${ruleBasedMuleVersion}`);
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
        const ruleBasedVersion = getRuleBasedDependencyVersion(dep.artifactId, dep.latestVersion);
        
        if (ruleBasedVersion && ruleBasedVersion !== dep.version) {
          console.log(`ABSOLUTE PRIORITY UPDATE: ${dep.artifactId} from ${dep.version} to ${ruleBasedVersion} (Rules Priority)`);
          
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
    
    if (!updatedPom.includes('<!-- Updated for CloudHub 2.0 migration with RULES PRIORITY -->')) {
      updatedPom = updatedPom + '\n<!-- Updated for CloudHub 2.0 migration with RULES PRIORITY -->';
    }
    
    return updatedPom;
  };

  // Enhanced function to replace connectors with RULES PRIORITY
  const replaceCloudHubConnectors = (xmlContent: string, selections: MigrationSelections, rules: MigrationRules): string => {
    let updatedXml = xmlContent;
    
    console.log('=== CONNECTOR REPLACEMENT: MIGRATION RULES HAVE ABSOLUTE PRIORITY ===');
    console.log('Active Migration Rules:', rules);
    
    // Only process selected connectors
    const selectedCloudHubConnectors = selections.connectors.filter(name => 
      name.toLowerCase().includes('cloudhub')
    );
    
    if (selectedCloudHubConnectors.length === 0) {
      return xmlContent;
    }
    
    // PRIORITY 1: Get replacement connector from migration rules
    const ruleBasedReplacement = getRuleBasedConnectorReplacement('cloudhub');
    console.log(`ABSOLUTE PRIORITY: Using connector replacement: ${ruleBasedReplacement} (from migration rules)`);
    
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
        replacement: `<${ruleBasedReplacement}:log level="INFO" message="CloudHub notification replaced with ${ruleBasedReplacement} (RULES PRIORITY)" />`
      },
      {
        pattern: /<cloudhub:create-notification[^>]*\/>/g,
        replacement: `<${ruleBasedReplacement}:log level="INFO" message="CloudHub notification replaced with ${ruleBasedReplacement} (RULES PRIORITY)" />`
      },
      {
        pattern: /<cloudhub:list-notifications[^>]*>[\s\S]*?<\/cloudhub:list-notifications>/g,
        replacement: `<${ruleBasedReplacement}:log level="INFO" message="CloudHub list notifications replaced with ${ruleBasedReplacement} (RULES PRIORITY)" />`
      },
      {
        pattern: /<cloudhub:list-notifications[^>]*\/>/g,
        replacement: `<${ruleBasedReplacement}:log level="INFO" message="CloudHub list notifications replaced with ${ruleBasedReplacement} (RULES PRIORITY)" />`
      },
      {
        pattern: /<cloudhub:get-application[^>]*>[\s\S]*?<\/cloudhub:get-application>/g,
        replacement: `<${ruleBasedReplacement}:log level="INFO" message="CloudHub get application replaced with ${ruleBasedReplacement} (RULES PRIORITY)" />`
      },
      {
        pattern: /<cloudhub:get-application[^>]*\/>/g,
        replacement: `<${ruleBasedReplacement}:log level="INFO" message="CloudHub get application replaced with ${ruleBasedReplacement} (RULES PRIORITY)" />`
      },
      {
        pattern: /<cloudhub:[^>]*>[\s\S]*?<\/cloudhub:[^>]*>/g,
        replacement: `<${ruleBasedReplacement}:log level="INFO" message="CloudHub operation replaced with ${ruleBasedReplacement} (RULES PRIORITY)" />`
      },
      {
        pattern: /<cloudhub:[^>]*\/>/g,
        replacement: `<${ruleBasedReplacement}:log level="INFO" message="CloudHub operation replaced with ${ruleBasedReplacement} (RULES PRIORITY)" />`
      }
    ];
    
    cloudHubPatterns.forEach(({ pattern, replacement }) => {
      const matches = updatedXml.match(pattern);
      if (matches) {
        console.log(`ABSOLUTE PRIORITY: Replacing CloudHub connectors with ${ruleBasedReplacement}:`, matches);
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
  const migrateGitHubApplication = async (app: MuleApplication, selections: MigrationSelections, rules: MigrationRules) => {
    console.log('=== GITHUB MIGRATION: APPLYING RULES WITH ABSOLUTE PRIORITY ===');
    console.log('Application:', app.applicationName);
    console.log('Migration Rules (ABSOLUTE PRIORITY):', rules);
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
          
          const updatedPom = updatePomDependencies(pomXml, app.dependencies, selections, rules);
          
          await axios.put(
            `https://api.github.com/repos/${repoPath}/contents/${pomPath}`,
            {
              message: `Mule migration: update with RULES PRIORITY - ${pomPath}`,
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
    
    // CRITICAL FIX: Update artifact JSON files with rules-based Java version
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
            const ruleBasedJavaVersion = rules.javaVersion; // Use rules directly, no fallback
            console.log(`ABSOLUTE PRIORITY: Setting Java version to ${ruleBasedJavaVersion} (from rules)`);
            updatedAj.javaSpecificationVersions = [ruleBasedJavaVersion];
          }
          
          if (selections.minMuleVersion) {
            const ruleBasedMinMuleVersion = rules.minMuleVersion; // Use rules directly, no fallback
            console.log(`ABSOLUTE PRIORITY: Setting min Mule version to ${ruleBasedMinMuleVersion} (from rules)`);
            updatedAj.minMuleVersion = ruleBasedMinMuleVersion;
          }
          
          await axios.put(
            `https://api.github.com/repos/${repoPath}/contents/${ajPath}`,
            {
              message: `Mule migration: update artifact with RULES PRIORITY - ${ajPath}`,
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
          
          const updatedXml = replaceCloudHubConnectors(xmlContent, selections, rules) + '\n<!-- Updated for CloudHub 2.0 migration with RULES PRIORITY -->';
          
          await axios.put(
            `https://api.github.com/repos/${repoPath}/contents/${xmlPath}`,
            {
              message: `Mule migration: update connectors with RULES PRIORITY - ${xmlPath}`,
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
  const migrateAzureApplication = async (app: MuleApplication, selections: MigrationSelections, rules: MigrationRules) => {
    try {
      console.log('=== AZURE DEVOPS MIGRATION: APPLYING RULES WITH ABSOLUTE PRIORITY ===');
      console.log('Application:', app.applicationName);
      console.log('Migration Rules (ABSOLUTE PRIORITY):', JSON.stringify(rules, null, 2));
      console.log('Selected Migration Items:', selections);
      
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
      
      // Update POM files if selected - RULES PRIORITY
      if ((selections.muleRuntime || selections.dependencies.length > 0) && app.pomPaths) {
        for (const pomPath of app.pomPaths) {
          let pomXml = await azureApi.getFileContent(project, repoId, pomPath);
          if (pomXml && typeof pomXml === 'string') {
            const updatedPom = updatePomDependencies(pomXml, app.dependencies, selections, rules);
            filesToCommit.push({ path: pomPath, content: updatedPom });
          }
        }
      }
      
      // CRITICAL FIX: Update artifact JSON files with rules-based versions
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
            const ruleBasedJavaVersion = rules.javaVersion; // Use rules directly, no fallback
            console.log(`ABSOLUTE PRIORITY: Setting Java version to ${ruleBasedJavaVersion} (from rules)`);
            updatedAj.javaSpecificationVersions = [ruleBasedJavaVersion];
          }
          
          if (selections.minMuleVersion) {
            const ruleBasedMinMuleVersion = rules.minMuleVersion; // Use rules directly, no fallback
            console.log(`ABSOLUTE PRIORITY: Setting min Mule version to ${ruleBasedMinMuleVersion} (from rules)`);
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
            const updatedXml = replaceCloudHubConnectors(xmlContent, selections, rules) + '\n<!-- Updated for CloudHub 2.0 migration with RULES PRIORITY -->';
            filesToCommit.push({ path: xmlPath, content: updatedXml });
          }
        }
      }
      
      // CRITICAL: Commit all changes with rules data - ensuring rules are passed
      if (filesToCommit.length > 0) {
        console.log('=== CRITICAL: SENDING MIGRATION RULES TO AZURE DEVOPS EDGE FUNCTION ===');
        console.log('Migration Rules being sent:', JSON.stringify(rules, null, 2));
        console.log('Files to commit:', filesToCommit.length);
        
        const committed = await azureApi.commitFiles(
          project,
          repoId,
          'mulemigration',
          filesToCommit,
          'Mule migration: update with RULES PRIORITY',
          rules  // CRITICAL: Ensure rules are passed
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
      toast.error(`Failed to migrate ${app.name}: ${error.message}`);
      return false;
    }
  };

  // Handle selective migration from dialog with RULES PRIORITY
  const handleSelectiveMigration = async (app: MuleApplication, selections: MigrationSelections, rules: MigrationRules) => {
    setMigrating(true);
    try {
      console.log('=== STARTING SELECTIVE MIGRATION WITH RULES ABSOLUTE PRIORITY ===');
      console.log('Application:', app.applicationName);
      console.log('Migration selections:', selections);
      console.log('Migration rules (ABSOLUTE PRIORITY):', JSON.stringify(rules, null, 2));
      
      if (repositoryType === 'github') {
        await migrateGitHubApplication(app, selections, rules);
      } else if (repositoryType === 'azure_devops') {
        await migrateAzureApplication(app, selections, rules);
      }
      
      // Update application status
      setApplications(prev => prev.map(a => 
        a.id === app.id 
          ? { ...a, status: 'completed', lastUpdated: new Date().toISOString() }
          : a
      ));
      
      toast.success(`Migration completed for ${app.applicationName} with RULES PRIORITY!`);
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
    
    // CRITICAL FIX: Check for runtime updates using rules-based versions
    if (app.muleRuntime !== getRuleBasedMuleVersion()) count++;
    if (app.javaVersion !== getRuleBasedJavaVersion()) count++;
    
    // Check for dependency updates
    count += app.dependencies.filter(dep => dep.version !== dep.latestVersion).length;
    
    // Check for deprecated items
    count += app.dependencies.filter(dep => dep.isDeprecated).length;
    count += app.connectors.filter(conn => conn.isDeprecated).length;
    
    return count;
  };

  const getUpdateSummary = (app: MuleApplication) => {
    const updates = [];
    
    // CRITICAL FIX: Use rules-based versions for update summary
    if (app.muleRuntime !== getRuleBasedMuleVersion()) {
      updates.push(`Mule Runtime: ${app.muleRuntime} → ${getRuleBasedMuleVersion()}`);
    }
    
    if (app.javaVersion !== getRuleBasedJavaVersion()) {
      updates.push(`Java: ${app.javaVersion} → ${getRuleBasedJavaVersion()}`);
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
                className="flex items-center space-x-1 bg-red-50 border-red-300 text-red-800 hover:bg-red-100"
              >
                <Settings className="h-4 w-4" />
                <span>Rules (ABSOLUTE PRIORITY)</span>
              </Button>
              <Button variant="outline" size="sm" onClick={selectAll}>
                Select All
              </Button>
              <Button variant="outline" size="sm" onClick={deselectAll}>
                Deselect All
              </Button>
              <Button 
                onClick={() => onMigrateAll(migrationRules)}
                disabled={selectedCount === 0 || migrating}
                size="lg"
                className="bg-red-600 hover:bg-red-700"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {migrating ? 'Migrating...' : `Migrate All (${selectedCount})`}
              </Button>
            </div>
          </CardTitle>
          <CardDescription>
            Select applications and view details to customize your CloudHub 2.0 migration. <strong>Migration rules configured will take ABSOLUTE PRIORITY over all defaults.</strong>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Migration Rules Status */}
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center space-x-2">
              <Settings className="h-4 w-4 text-red-600" />
              <div>
                <p className="font-semibold text-red-800">Active Migration Rules (ABSOLUTE PRIORITY)</p>
                <p className="text-sm text-red-700">
                  Java: <strong>{migrationRules.javaVersion}</strong> | 
                  Mule: <strong>{migrationRules.muleVersion}</strong> | 
                  MinMule: <strong>{migrationRules.minMuleVersion}</strong> | 
                  Custom Dependencies: <strong>{migrationRules.dependencyVersions.length}</strong> | 
                  Connector Replacements: <strong>{migrationRules.connectorReplacements.length}</strong>
                </p>
              </div>
            </div>
          </div>
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
                        {app.muleRuntime !== getRuleBasedMuleVersion() && (
                          <Badge variant="outline" className="text-yellow-600 text-xs">
                            Mule → {getRuleBasedMuleVersion()}
                          </Badge>
                        )}
                        {app.javaVersion !== getRuleBasedJavaVersion() && (
                          <Badge variant="outline" className="text-yellow-600 text-xs">
                            Java → {getRuleBasedJavaVersion()}
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
        migrationRules={migrationRules}
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
